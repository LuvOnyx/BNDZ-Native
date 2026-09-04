using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;

namespace BNDZ.Services;

/// <summary>
/// Click-through layered ghost that follows the cursor during outbound OLE.
/// WebView2 cannot paint outside the HWND, and IDragSourceHelper fails on this host
/// (CoCreate QI → E_NOINTERFACE) — so we own a topmost WS_EX_TRANSPARENT overlay instead.
/// Does not capture mouse input; wallpaper / Explorer drops stay intact.
/// </summary>
internal static class BndzOutboundDragGhostOverlay
{
    private const int WsPopup = unchecked((int)0x80000000);
    private const int WsExLayered = 0x00080000;
    private const int WsExTransparent = 0x00000020;
    private const int WsExTopmost = 0x00000008;
    private const int WsExToolwindow = 0x00000080;
    private const int WsExNoactivate = 0x08000000;
    private const int UlwAlpha = 0x00000002;
    private const byte AcSrcOver = 0x00;
    private const byte AcSrcAlpha = 0x01;
    private const uint SwpNosize = 0x0001;
    private const uint SwpNoactivate = 0x0010;
    private const uint SwpShowwindow = 0x0040;
    private const uint SwpHidewindow = 0x0080;
    private static readonly IntPtr HwndTopmost = new(-1);

    private static readonly object Gate = new();
    private static IntPtr _hwnd;
    private static IntPtr _hbm;
    private static int _width;
    private static int _height;
    private static int _hotX = 18;
    private static int _hotY = 14;
    private static int _visible;
    private static int _lastX = int.MinValue;
    private static int _lastY = int.MinValue;
    private static bool _copyMode;
    private static string[] _paths = Array.Empty<string>();
    private static bool _classRegistered;
    private static WndProcKeepAlive? _wndProcKeepAlive;

    private delegate IntPtr WndProcKeepAlive(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct PointNative
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct SizeNative
    {
        public int cx;
        public int cy;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BlendFunction
    {
        public byte BlendOp;
        public byte BlendFlags;
        public byte SourceConstantAlpha;
        public byte AlphaFormat;
    }

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern ushort RegisterClassW(ref WndClassEx lpwcx);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern IntPtr CreateWindowExW(
        int dwExStyle, string lpClassName, string lpWindowName, int dwStyle,
        int x, int y, int nWidth, int nHeight,
        IntPtr hWndParent, IntPtr hMenu, IntPtr hInstance, IntPtr lpParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyWindow(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UpdateLayeredWindow(
        IntPtr hwnd, IntPtr hdcDst, ref PointNative pptDst, ref SizeNative psize,
        IntPtr hdcSrc, ref PointNative pptSrc, int crKey, ref BlendFunction pblend, int dwFlags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(
        IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out PointNative lpPoint);

    [DllImport("user32.dll")]
    private static extern IntPtr DefWindowProcW(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandleW(string? lpModuleName);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WndClassEx
    {
        public uint cbSize;
        public uint style;
        public IntPtr lpfnWndProc;
        public int cbClsExtra;
        public int cbWndExtra;
        public IntPtr hInstance;
        public IntPtr hIcon;
        public IntPtr hCursor;
        public IntPtr hbrBackground;
        public string? lpszMenuName;
        public string lpszClassName;
        public IntPtr hIconSm;
    }

    public static void Show(string[]? paths, bool copyMode)
    {
        if (paths is not { Length: > 0 }) return;
        lock (Gate)
        {
            _paths = paths;
            _copyMode = copyMode;
            EnsureWindow();
            RebuildBitmapUnlocked();
            if (_hwnd == IntPtr.Zero || _hbm == IntPtr.Zero) return;
            if (!GetCursorPos(out var pt)) return;
            PaintAtUnlocked(pt.x - _hotX, pt.y - _hotY, show: true);
            Interlocked.Exchange(ref _visible, 1);
            AppendLog($"outbound-ghost show copy={copyMode} count={paths.Length}");
        }
    }

    public static void SetCopyMode(bool copyMode)
    {
        if (Volatile.Read(ref _visible) == 0) return;
        lock (Gate)
        {
            if (_copyMode == copyMode) return;
            _copyMode = copyMode;
            RebuildBitmapUnlocked();
            if (_hwnd == IntPtr.Zero || _hbm == IntPtr.Zero) return;
            if (!GetCursorPos(out var pt)) return;
            PaintAtUnlocked(pt.x - _hotX, pt.y - _hotY, show: true);
        }
    }

    public static void FollowCursor()
    {
        if (Volatile.Read(ref _visible) == 0) return;
        if (!GetCursorPos(out var pt)) return;
        var x = pt.x - _hotX;
        var y = pt.y - _hotY;
        if (x == _lastX && y == _lastY) return;
        lock (Gate)
        {
            if (Volatile.Read(ref _visible) == 0 || _hwnd == IntPtr.Zero) return;
            PaintAtUnlocked(x, y, show: true);
        }
    }

    public static void Hide()
    {
        if (Interlocked.Exchange(ref _visible, 0) == 0 && _hwnd == IntPtr.Zero) return;
        lock (Gate)
        {
            if (_hwnd != IntPtr.Zero)
            {
                try { SetWindowPos(_hwnd, HwndTopmost, 0, 0, 0, 0, SwpNosize | SwpNoactivate | SwpHidewindow); }
                catch { /* ignore */ }
            }
            FreeBitmapUnlocked();
            _lastX = int.MinValue;
            _lastY = int.MinValue;
            AppendLog("outbound-ghost hide");
        }
    }

    private static void EnsureWindow()
    {
        if (_hwnd != IntPtr.Zero) return;
        EnsureClass();
        var ex = WsExLayered | WsExTransparent | WsExTopmost | WsExToolwindow | WsExNoactivate;
        _hwnd = CreateWindowExW(
            ex,
            "BndzOutboundDragGhost",
            "",
            WsPopup,
            0, 0, 8, 8,
            IntPtr.Zero, IntPtr.Zero, GetModuleHandleW(null), IntPtr.Zero);
        if (_hwnd == IntPtr.Zero)
            AppendLog($"outbound-ghost CreateWindow failed err={Marshal.GetLastWin32Error()}");
    }

    private static void EnsureClass()
    {
        if (_classRegistered) return;
        _wndProcKeepAlive = static (h, m, w, l) => DefWindowProcW(h, m, w, l);
        var wc = new WndClassEx
        {
            cbSize = (uint)Marshal.SizeOf<WndClassEx>(),
            lpfnWndProc = Marshal.GetFunctionPointerForDelegate(_wndProcKeepAlive),
            hInstance = GetModuleHandleW(null),
            lpszClassName = "BndzOutboundDragGhost",
        };
        var atom = RegisterClassW(ref wc);
        if (atom == 0 && Marshal.GetLastWin32Error() != 1410) // already exists
            AppendLog($"outbound-ghost RegisterClass failed err={Marshal.GetLastWin32Error()}");
        _classRegistered = true;
    }

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateDIBSection(
        IntPtr hdc, ref BitmapInfoHeader pbmi, uint iUsage, out IntPtr ppvBits, IntPtr hSection, uint dwOffset);

    [StructLayout(LayoutKind.Sequential)]
    private struct BitmapInfoHeader
    {
        public int biSize;
        public int biWidth;
        public int biHeight;
        public short biPlanes;
        public short biBitCount;
        public int biCompression;
        public int biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public int biClrUsed;
        public int biClrImportant;
    }

    private const uint BiRgb = 0;
    private const uint DibRgbColors = 0;

    private static void RebuildBitmapUnlocked()
    {
        FreeBitmapUnlocked();
        using var bmp = BuildCardBitmap(_paths, _copyMode);
        if (bmp is null) return;
        _width = bmp.Width;
        _height = bmp.Height;
        _hotX = 16;
        _hotY = 12;
        _hbm = CreatePremultipliedHbitmap(bmp);
    }

    private static IntPtr CreatePremultipliedHbitmap(Bitmap bmp)
    {
        var w = bmp.Width;
        var h = bmp.Height;
        var hdr = new BitmapInfoHeader
        {
            biSize = Marshal.SizeOf<BitmapInfoHeader>(),
            biWidth = w,
            biHeight = -h, // top-down
            biPlanes = 1,
            biBitCount = 32,
            biCompression = unchecked((int)BiRgb),
        };
        var screenDc = GetDC(IntPtr.Zero);
        var dib = CreateDIBSection(screenDc, ref hdr, DibRgbColors, out var bits, IntPtr.Zero, 0);
        ReleaseDC(IntPtr.Zero, screenDc);
        if (dib == IntPtr.Zero || bits == IntPtr.Zero) return IntPtr.Zero;

        var data = bmp.LockBits(
            new Rectangle(0, 0, w, h),
            ImageLockMode.ReadOnly,
            PixelFormat.Format32bppArgb);
        try
        {
            var srcStride = Math.Abs(data.Stride);
            var dstStride = w * 4;
            var row = new byte[srcStride];
            for (var y = 0; y < h; y++)
            {
                Marshal.Copy(data.Scan0 + y * srcStride, row, 0, srcStride);
                // Premultiply into DIB (already premultiplied in BuildCardBitmap).
                Marshal.Copy(row, 0, bits + y * dstStride, dstStride);
            }
        }
        finally
        {
            bmp.UnlockBits(data);
        }
        return dib;
    }

    private static void FreeBitmapUnlocked()
    {
        if (_hbm == IntPtr.Zero) return;
        try { DeleteObject(_hbm); } catch { /* ignore */ }
        _hbm = IntPtr.Zero;
    }

    private static void PaintAtUnlocked(int x, int y, bool show)
    {
        if (_hwnd == IntPtr.Zero || _hbm == IntPtr.Zero || _width <= 0 || _height <= 0) return;

        var screenDc = GetDC(IntPtr.Zero);
        var memDc = CreateCompatibleDC(screenDc);
        var old = SelectObject(memDc, _hbm);
        try
        {
            var dst = new PointNative { x = x, y = y };
            var src = new PointNative { x = 0, y = 0 };
            var size = new SizeNative { cx = _width, cy = _height };
            var blend = new BlendFunction
            {
                BlendOp = AcSrcOver,
                BlendFlags = 0,
                SourceConstantAlpha = 255,
                AlphaFormat = AcSrcAlpha,
            };
            UpdateLayeredWindow(_hwnd, IntPtr.Zero, ref dst, ref size, memDc, ref src, 0, ref blend, UlwAlpha);
            if (show)
                SetWindowPos(_hwnd, HwndTopmost, x, y, 0, 0, SwpNosize | SwpNoactivate | SwpShowwindow);
            _lastX = x;
            _lastY = y;
        }
        finally
        {
            SelectObject(memDc, old);
            DeleteDC(memDc);
            ReleaseDC(IntPtr.Zero, screenDc);
        }
    }

    private static Bitmap? BuildCardBitmap(string[] paths, bool copyMode)
    {
        if (paths.Length == 0) return null;
        var lead = paths[0];
        var leaf = Path.GetFileName(lead.TrimEnd('\\', '/'));
        if (string.IsNullOrWhiteSpace(leaf)) leaf = lead;
        if (leaf.Length > 28) leaf = leaf[..25] + "…";
        var count = paths.Length;
        var meta = copyMode
            ? (count > 1 ? $"Copy · {count} items" : "Copy")
            : (count > 1 ? $"Move · {count} items" : "Move");

        const int padX = 12;
        const int padY = 10;
        const int icon = 34;
        const int gap = 10;
        const int maxText = 200;

        using var measureBmp = new Bitmap(8, 8, PixelFormat.Format32bppArgb);
        using var mg = Graphics.FromImage(measureBmp);
        using var labelFont = new Font("Segoe UI Semibold", 12f, FontStyle.Regular, GraphicsUnit.Pixel);
        using var metaFont = new Font("Segoe UI", 10f, FontStyle.Regular, GraphicsUnit.Pixel);
        var labelSize = mg.MeasureString(leaf, labelFont, maxText);
        var metaSize = mg.MeasureString(meta, metaFont, maxText);
        var textW = Math.Max(labelSize.Width, metaSize.Width);
        textW = Math.Clamp(textW, 80, maxText);
        var w = (int)Math.Ceiling(padX + icon + gap + textW + padX);
        var h = (int)Math.Ceiling(Math.Max(icon, labelSize.Height + 2 + metaSize.Height) + padY * 2);

        var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.Clear(Color.Transparent);
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.CompositingMode = CompositingMode.SourceOver;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;

            var card = new RectangleF(0.5f, 0.5f, w - 1f, h - 1f);
            using (var path = RoundRect(card, 14f))
            {
                using var bg = new LinearGradientBrush(
                    card,
                    Color.FromArgb(250, 50, 55, 72),
                    Color.FromArgb(252, 28, 32, 44),
                    145f);
                g.FillPath(bg, path);
                using var border = new Pen(Color.FromArgb(90, 255, 255, 255), 1f);
                g.DrawPath(border, path);
            }

            var well = new RectangleF(padX, (h - icon) / 2f, icon, icon);
            using (var wellPath = RoundRect(well, 10f))
            {
                using var wellFill = new SolidBrush(Color.FromArgb(40, 255, 255, 255));
                g.FillPath(wellFill, wellPath);
                using var wellBorder = new Pen(Color.FromArgb(50, 255, 255, 255), 1f);
                g.DrawPath(wellBorder, wellPath);
            }

            try
            {
                using var ico = ExtractIcon(lead);
                if (ico != null)
                    g.DrawIcon(ico, Rectangle.Round(new RectangleF(well.X + 4, well.Y + 4, icon - 8, icon - 8)));
                else
                    DrawFallback(g, well, Directory.Exists(lead));
            }
            catch
            {
                DrawFallback(g, well, Directory.Exists(lead));
            }

            // Op badge (move magenta / copy green) — matches FE .bndz-drag-ghost-op-*
            var badge = new RectangleF(well.Right - 10, well.Bottom - 10, 14, 14);
            using (var badgePath = RoundRect(badge, 5f))
            {
                var badgeColor = copyMode
                    ? Color.FromArgb(255, 34, 197, 94)
                    : Color.FromArgb(255, 192, 132, 252);
                using var badgeFill = new SolidBrush(badgeColor);
                g.FillPath(badgeFill, badgePath);
                using var badgeBorder = new Pen(Color.FromArgb(160, 0, 0, 0), 1f);
                g.DrawPath(badgeBorder, badgePath);
                using var badgeFont = new Font("Segoe UI", 8f, FontStyle.Bold, GraphicsUnit.Pixel);
                using var badgeText = new SolidBrush(copyMode
                    ? Color.FromArgb(255, 10, 21, 15)
                    : Color.FromArgb(255, 24, 10, 36));
                var mark = copyMode ? "+" : "→";
                var ms = g.MeasureString(mark, badgeFont);
                g.DrawString(mark, badgeFont, badgeText, badge.X + (badge.Width - ms.Width) / 2f, badge.Y + 0.5f);
            }

            var textX = padX + icon + gap;
            var textY = (h - (labelSize.Height + 2 + metaSize.Height)) / 2f;
            using var labelBrush = new SolidBrush(Color.FromArgb(245, 236, 240, 248));
            using var metaBrush = new SolidBrush(Color.FromArgb(180, 160, 176, 196));
            g.DrawString(leaf, labelFont, labelBrush, new RectangleF(textX, textY, textW + 4, labelSize.Height + 2));
            g.DrawString(meta, metaFont, metaBrush, new RectangleF(textX, textY + labelSize.Height + 1, textW + 4, metaSize.Height + 2));
        }

        PremultiplyAlpha(bmp);
        return bmp;
    }

    private static void PremultiplyAlpha(Bitmap bmp)
    {
        var data = bmp.LockBits(
            new Rectangle(0, 0, bmp.Width, bmp.Height),
            ImageLockMode.ReadWrite,
            PixelFormat.Format32bppArgb);
        try
        {
            var stride = data.Stride;
            var h = bmp.Height;
            var w = bmp.Width;
            var buf = new byte[Math.Abs(stride) * h];
            Marshal.Copy(data.Scan0, buf, 0, buf.Length);
            for (var y = 0; y < h; y++)
            {
                var row = y * Math.Abs(stride);
                for (var x = 0; x < w; x++)
                {
                    var i = row + x * 4;
                    var a = buf[i + 3];
                    if (a == 255) continue;
                    if (a == 0)
                    {
                        buf[i] = 0;
                        buf[i + 1] = 0;
                        buf[i + 2] = 0;
                        continue;
                    }
                    buf[i] = (byte)(buf[i] * a / 255);
                    buf[i + 1] = (byte)(buf[i + 1] * a / 255);
                    buf[i + 2] = (byte)(buf[i + 2] * a / 255);
                }
            }
            Marshal.Copy(buf, 0, data.Scan0, buf.Length);
        }
        finally
        {
            bmp.UnlockBits(data);
        }
    }

    private static GraphicsPath RoundRect(RectangleF r, float radius)
    {
        var path = new GraphicsPath();
        var d = radius * 2f;
        path.AddArc(r.X, r.Y, d, d, 180, 90);
        path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
        path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
        path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
        path.CloseFigure();
        return path;
    }

    private static Icon? ExtractIcon(string path)
    {
        try
        {
            if (File.Exists(path) || Directory.Exists(path))
                return Icon.ExtractAssociatedIcon(path);
        }
        catch { /* ignore */ }
        return null;
    }

    private static void DrawFallback(Graphics g, RectangleF well, bool isDir)
    {
        var r = Rectangle.Round(new RectangleF(well.X + 6, well.Y + 6, well.Width - 12, well.Height - 12));
        using var fill = new SolidBrush(Color.FromArgb(220, 200, 210, 220));
        using var pen = new Pen(Color.FromArgb(200, 60, 70, 90), 1.5f);
        g.FillRectangle(fill, r);
        g.DrawRectangle(pen, r);
        if (isDir)
            g.FillRectangle(Brushes.Goldenrod, new Rectangle(r.X, r.Y, r.Width, 7));
    }

    private static void AppendLog(string line)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BNDZ");
            Directory.CreateDirectory(dir);
            File.AppendAllText(Path.Combine(dir, "ole-dnd.log"), $"{DateTime.Now:HH:mm:ss.fff} {line}{Environment.NewLine}");
        }
        catch { /* ignore */ }
    }
}
