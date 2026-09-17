using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>
/// Shell HBITMAP / HICON → PNG base64 with Format32bppArgb alpha preserved.
/// Avoids Icon.ToBitmap + MakeTransparent (color-key / white-plate destroy alpha).
/// Pixels are extracted top-down via GetDIBits (biHeight &lt; 0) so both shell icons
/// and IShellItemImageFactory content thumbs stay right-side-up — never blind scanline flip.
/// </summary>
internal static class ShellArgbPngEncoder
{
    private const uint DIB_RGB_COLORS = 0;
    private const int BI_RGB = 0;

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAP
    {
        public int bmType;
        public int bmWidth;
        public int bmHeight;
        public int bmWidthBytes;
        public short bmPlanes;
        public short bmBitsPixel;
        public IntPtr bmBits;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER
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

    [StructLayout(LayoutKind.Sequential)]
    private struct ICONINFO
    {
        public bool fIcon;
        public int xHotspot;
        public int yHotspot;
        public IntPtr hbmMask;
        public IntPtr hbmColor;
    }

    [DllImport("gdi32.dll")]
    private static extern int GetObject(IntPtr hgdiobj, int cbBuffer, out BITMAP lpvObject);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern int GetDIBits(IntPtr hdc, IntPtr hbmp, uint uStartScan, uint cScanLines,
        IntPtr lpvBits, ref BITMAPINFOHEADER lpbi, uint uUsage);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool GetIconInfo(IntPtr hIcon, out ICONINFO piconinfo);

    /// <summary>Encode a shell / GDI HBITMAP as raw base64 PNG (no data: prefix).</summary>
    public static string EncodeHBitmapPngBase64(IntPtr hBitmap)
    {
        if (hBitmap == IntPtr.Zero)
            return "";

        try
        {
            if (GetObject(hBitmap, Marshal.SizeOf<BITMAP>(), out BITMAP bm) == 0)
                return EncodeViaFromHbitmapFallback(hBitmap);

            int width = bm.bmWidth;
            int height = Math.Abs(bm.bmHeight);
            if (width <= 0 || height <= 0)
                return "";

            // Prefer GetDIBits top-down (negative biHeight) — orientation-correct for icons AND image thumbs.
            var viaDiBits = EncodeViaGetDiBitsTopDown(hBitmap, width, height);
            if (!string.IsNullOrEmpty(viaDiBits))
                return viaDiBits;

            return EncodeViaFromHbitmapFallback(hBitmap);
        }
        catch
        {
            return "";
        }
    }

    private static string EncodeViaGetDiBitsTopDown(IntPtr hBitmap, int width, int height)
    {
        IntPtr screenDc = GetDC(IntPtr.Zero);
        if (screenDc == IntPtr.Zero) return "";
        IntPtr memDc = CreateCompatibleDC(screenDc);
        if (memDc == IntPtr.Zero)
        {
            ReleaseDC(IntPtr.Zero, screenDc);
            return "";
        }

        // 32bpp top-down DIB: biHeight negative → scanlines already top→bottom for GDI+.
        int stride = ((width * 32 + 31) / 32) * 4;
        int byteCount = checked(stride * height);
        IntPtr pixels = Marshal.AllocHGlobal(byteCount);
        try
        {
            var bi = new BITMAPINFOHEADER
            {
                biSize = Marshal.SizeOf<BITMAPINFOHEADER>(),
                biWidth = width,
                biHeight = -height,
                biPlanes = 1,
                biBitCount = 32,
                biCompression = BI_RGB,
                biSizeImage = byteCount,
            };

            int got = GetDIBits(memDc, hBitmap, 0, (uint)height, pixels, ref bi, DIB_RGB_COLORS);
            if (got == 0)
                return "";

            using var wrapped = new Bitmap(width, height, stride, PixelFormat.Format32bppArgb, pixels);
            using var clone = new Bitmap(wrapped);
            return SavePngBase64(clone);
        }
        finally
        {
            Marshal.FreeHGlobal(pixels);
            DeleteDC(memDc);
            ReleaseDC(IntPtr.Zero, screenDc);
        }
    }

    /// <summary>Encode an HICON as raw base64 PNG — prefers color bitmap alpha, else DrawIcon on ARGB.</summary>
    public static string EncodeHIconPngBase64(IntPtr hIcon)
    {
        if (hIcon == IntPtr.Zero)
            return "";

        try
        {
            if (GetIconInfo(hIcon, out ICONINFO ii))
            {
                try
                {
                    if (ii.hbmColor != IntPtr.Zero)
                    {
                        var fromColor = EncodeHBitmapPngBase64(ii.hbmColor);
                        if (!string.IsNullOrEmpty(fromColor))
                            return fromColor;
                    }
                }
                finally
                {
                    if (ii.hbmColor != IntPtr.Zero) DeleteObject(ii.hbmColor);
                    if (ii.hbmMask != IntPtr.Zero) DeleteObject(ii.hbmMask);
                }
            }

            using var icon = (Icon)Icon.FromHandle(hIcon).Clone();
            int w = Math.Max(1, icon.Width);
            int h = Math.Max(1, icon.Height);
            using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                g.CompositingMode = CompositingMode.SourceOver;
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.DrawIcon(icon, new Rectangle(0, 0, w, h));
            }
            return SavePngBase64(bmp);
        }
        catch
        {
            return "";
        }
    }

    /// <summary>PNG-encode an existing bitmap without MakeTransparent color-keying.</summary>
    public static string EncodeBitmapPngBase64(Bitmap bitmap)
    {
        if (bitmap == null)
            return "";
        try
        {
            if (bitmap.PixelFormat == PixelFormat.Format32bppArgb)
                return SavePngBase64(bitmap);

            using var argb = new Bitmap(bitmap.Width, bitmap.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(argb))
            {
                g.Clear(Color.Transparent);
                g.CompositingMode = CompositingMode.SourceOver;
                g.DrawImage(bitmap, 0, 0, bitmap.Width, bitmap.Height);
            }
            return SavePngBase64(argb);
        }
        catch
        {
            return "";
        }
    }

    private static string EncodeViaFromHbitmapFallback(IntPtr hBitmap)
    {
        try
        {
            using var gdi = Image.FromHbitmap(hBitmap);
            if (gdi.PixelFormat != PixelFormat.Format32bppArgb && gdi.PixelFormat != PixelFormat.Format32bppPArgb)
                return "";
            using var argb = new Bitmap(gdi.Width, gdi.Height, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(argb))
            {
                g.Clear(Color.Transparent);
                g.CompositingMode = CompositingMode.SourceOver;
                g.DrawImage(gdi, 0, 0, gdi.Width, gdi.Height);
            }
            return SavePngBase64(argb);
        }
        catch
        {
            return "";
        }
    }

    private static string SavePngBase64(Bitmap bitmap)
    {
        using var ms = new MemoryStream();
        bitmap.Save(ms, ImageFormat.Png);
        return Convert.ToBase64String(ms.ToArray());
    }
}
