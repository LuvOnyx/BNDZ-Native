using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using ComIDataObject = System.Runtime.InteropServices.ComTypes.IDataObject;

namespace BNDZ.Services;

/// <summary>
/// Attaches an Explorer-class drag ghost via <c>IDragSourceHelper::InitializeFromBitmap</c>.
/// WebView2/WinUI HWNDs do not handle <c>DI_GETDRAGIMAGE</c>, so <c>InitializeFromWindow</c> is a no-op.
/// On failure, the caller's <see cref="ComIDataObject"/> is left unchanged (never replace shell
/// payload with a half-built overlay — that yielded DoDragDrop effect=NONE).
/// </summary>
internal static class BndzShellDragImage
{
    private static readonly Guid[] DragDropHelperClsids =
    [
        new("DE5BF786-477A-11D2-839D-00C04FD918D0"),
        new("4657278A-411B-11D2-839A-00C04FD918D0"),
    ];
    private static readonly Guid IidDragSourceHelper = new("DE5BF785-477A-11D2-839D-00C04FD918D0");

    [StructLayout(LayoutKind.Sequential)]
    private struct Win32Size
    {
        public int cx;
        public int cy;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Win32Point
    {
        public int x;
        public int y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ShDragImage
    {
        public Win32Size sizeDragImage;
        public Win32Point ptOffset;
        public IntPtr hbmpDragImage;
        public int crColorKey;
    }

    // IID is DE5BF785 — not the coclass CLSID (DE5BF786).
    [ComImport]
    [Guid("DE5BF785-477A-11D2-839D-00C04FD918D0")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDragSourceHelperNative
    {
        void InitializeFromBitmap(ref ShDragImage dragImage, [MarshalAs(UnmanagedType.Interface)] ComIDataObject dataObject);
        void InitializeFromWindow(IntPtr hwnd, ref Win32Point pt, [MarshalAs(UnmanagedType.Interface)] ComIDataObject dataObject);
    }

    [DllImport("gdi32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("ole32.dll")]
    private static extern int CoCreateInstance(
        ref Guid rclsid,
        IntPtr pUnkOuter,
        uint dwClsContext,
        ref Guid riid,
        out IntPtr ppv);

    private const uint ClsctxInprocServer = 0x1;
    private const uint ClsctxInprocHandler = 0x2;

    /// <summary>
    /// Stamp a shell drag bitmap onto the outbound data object.
    /// Only replaces <paramref name="dataObject"/> with a writable overlay after a successful
    /// <c>InitializeFromBitmap</c>. Failures restore the original shell IDataObject.
    /// </summary>
    public static bool TryAttach(ref ComIDataObject dataObject, string[] paths)
    {
        if (dataObject is null || paths is null || paths.Length == 0)
            return false;

        var original = dataObject;
        IntPtr hBitmap = IntPtr.Zero;
        try
        {
            // Create helper first — many machines lack CLSID_DragDropHelper; never mutate payload then.
            var helper = CreateDragSourceHelper();
            if (helper is null)
                return false;

            using var bmp = BuildDragBitmap(paths);
            if (bmp is null) return false;

            hBitmap = bmp.GetHbitmap(Color.Magenta);
            var shdi = new ShDragImage
            {
                sizeDragImage = new Win32Size { cx = bmp.Width, cy = bmp.Height },
                ptOffset = new Win32Point { x = 14, y = 10 },
                hbmpDragImage = hBitmap,
                crColorKey = Color.Magenta.ToArgb() & 0x00FFFFFF,
            };

            // Writable overlay so InitializeFromBitmap can SetData on read-only shell objects.
            var target = dataObject is BndzOleDataObjectOverlay existing
                ? existing
                : new BndzOleDataObjectOverlay(dataObject);

            helper.InitializeFromBitmap(ref shdi, target);
            // Shell copies/owns the HBITMAP after a successful InitializeFromBitmap.
            hBitmap = IntPtr.Zero;
            dataObject = target;
            return true;
        }
        catch (Exception ex)
        {
            dataObject = original;
            System.Diagnostics.Debug.WriteLine($"[OleDrag] InitializeFromBitmap: {ex.Message}");
            try
            {
                var dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "BNDZ");
                Directory.CreateDirectory(dir);
                File.AppendAllText(
                    Path.Combine(dir, "ole-dnd.log"),
                    $"{DateTime.Now:HH:mm:ss.fff} shell drag image fail {ex.GetType().Name}: {ex.Message}{Environment.NewLine}");
            }
            catch { /* ignore */ }
            return false;
        }
        finally
        {
            if (hBitmap != IntPtr.Zero)
                DeleteObject(hBitmap);
        }
    }

    private static IDragSourceHelperNative? CreateDragSourceHelper()
    {
        var iid = IidDragSourceHelper;
        var lastHr = 0;
        foreach (var clsidRaw in DragDropHelperClsids)
        {
            foreach (var ctx in new[] { ClsctxInprocServer, ClsctxInprocHandler, ClsctxInprocServer | ClsctxInprocHandler })
            {
                var clsid = clsidRaw;
                var hr = CoCreateInstance(ref clsid, IntPtr.Zero, ctx, ref iid, out var punk);
                if (hr < 0 || punk == IntPtr.Zero)
                {
                    lastHr = hr;
                    continue;
                }

                try
                {
                    return (IDragSourceHelperNative)Marshal.GetTypedObjectForIUnknown(punk, typeof(IDragSourceHelperNative))!;
                }
                finally
                {
                    Marshal.Release(punk);
                }
            }
        }

        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BNDZ");
            Directory.CreateDirectory(dir);
            File.AppendAllText(
                Path.Combine(dir, "ole-dnd.log"),
                $"{DateTime.Now:HH:mm:ss.fff} shell drag image unavailable CoCreate hr=0x{lastHr:X8}{Environment.NewLine}");
        }
        catch { /* ignore */ }
        return null;
    }

    private static Bitmap? BuildDragBitmap(string[] paths)
    {
        var lead = paths[0];
        if (string.IsNullOrWhiteSpace(lead)) return null;

        const int size = 72;
        var multi = paths.Length > 1;
        var h = multi ? size + 22 : size;
        var bmp = new Bitmap(size + 8, h, PixelFormat.Format32bppArgb);
        using var g = Graphics.FromImage(bmp);
        g.Clear(Color.Magenta);
        g.SmoothingMode = SmoothingMode.HighQuality;
        g.InterpolationMode = InterpolationMode.HighQualityBicubic;

        try
        {
            using var icon = ExtractIcon(lead);
            if (icon != null)
                g.DrawIcon(icon, new Rectangle(8, 4, size - 8, size - 8));
            else
                DrawFallbackGlyph(g, size, Directory.Exists(lead));
        }
        catch
        {
            DrawFallbackGlyph(g, size, Directory.Exists(lead));
        }

        if (multi)
        {
            using var font = new Font("Segoe UI", 10f, FontStyle.Bold, GraphicsUnit.Pixel);
            using var brush = new SolidBrush(Color.FromArgb(255, 32, 32, 36));
            using var fill = new SolidBrush(Color.FromArgb(255, 240, 240, 245));
            var label = paths.Length > 99 ? "99+" : paths.Length.ToString();
            var sz = g.MeasureString(label, font);
            var rect = new RectangleF(size - sz.Width - 2, size - 4, sz.Width + 8, sz.Height + 4);
            g.FillRectangle(fill, rect);
            g.DrawString(label, font, brush, rect.X + 3, rect.Y + 1);
        }

        return bmp;
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

    private static void DrawFallbackGlyph(Graphics g, int size, bool isDir)
    {
        using var pen = new Pen(Color.FromArgb(255, 60, 60, 70), 2f);
        using var brush = new SolidBrush(Color.FromArgb(255, 220, 220, 230));
        var r = new Rectangle(14, 10, size - 28, size - 28);
        g.FillRectangle(brush, r);
        g.DrawRectangle(pen, r);
        if (isDir)
            g.FillRectangle(Brushes.Goldenrod, new Rectangle(r.X, r.Y, r.Width, 10));
    }
}
