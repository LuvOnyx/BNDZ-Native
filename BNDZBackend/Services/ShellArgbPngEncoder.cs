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
/// HBITMAP path mirrors Files scan0 style: GetObject BITMAP bits → flip → 32bpp ARGB PNG.
/// </summary>
internal static class ShellArgbPngEncoder
{
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

            // 32bpp DIBSECTION with bits pointer — Files-style scan0 path.
            if (bm.bmBitsPixel == 32 && bm.bmBits != IntPtr.Zero && bm.bmWidthBytes > 0)
            {
                int stride = bm.bmWidthBytes;
                int byteCount = checked(stride * height);
                IntPtr flipped = Marshal.AllocHGlobal(byteCount);
                try
                {
                    // Match Files: treat source rows as top→bottom in bmBits, flip for GDI+ top-down.
                    var row = new byte[stride];
                    for (int y = 0; y < height; y++)
                    {
                        IntPtr src = IntPtr.Add(bm.bmBits, y * stride);
                        IntPtr dst = IntPtr.Add(flipped, (height - y - 1) * stride);
                        Marshal.Copy(src, row, 0, stride);
                        Marshal.Copy(row, 0, dst, stride);
                    }

                    using var wrapped = new Bitmap(width, height, stride, PixelFormat.Format32bppArgb, flipped);
                    // Clone so we can free the temporary buffer before PNG encode returns.
                    using var clone = new Bitmap(wrapped);
                    return SavePngBase64(clone);
                }
                finally
                {
                    Marshal.FreeHGlobal(flipped);
                }
            }

            return EncodeViaFromHbitmapFallback(hBitmap);
        }
        catch
        {
            return "";
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

            // GDI+ DrawIcon onto Format32bppArgb — do not use Icon.ToBitmap (kills Vista+ alpha).
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
        // Image.FromHbitmap often flattens alpha — still better than MakeTransparent on white plates.
        using var gdi = Image.FromHbitmap(hBitmap);
        using var argb = new Bitmap(gdi.Width, gdi.Height, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(argb))
        {
            g.Clear(Color.Transparent);
            g.CompositingMode = CompositingMode.SourceOver;
            g.DrawImage(gdi, 0, 0, gdi.Width, gdi.Height);
        }
        return SavePngBase64(argb);
    }

    private static string SavePngBase64(Bitmap bitmap)
    {
        using var ms = new MemoryStream();
        bitmap.Save(ms, ImageFormat.Png);
        return Convert.ToBase64String(ms.ToArray());
    }
}
