using System;
using System.IO;
using SkiaSharp;

namespace BNDZ.Services;

/// <summary>
/// Fast image thumbnails via SkiaSharp when the path is a decodeable still image.
/// Honors EXIF/orientation via <see cref="SKCodec.EncodedOrigin"/>.
/// </summary>
public static class SkiaThumbnailService
{
    private static readonly string[] ImageExts =
    {
        ".png", ".jpg", ".jpeg", ".jfif", ".gif", ".bmp", ".webp", ".wbmp",
        ".tif", ".tiff", ".ico",
    };

    public static bool IsLikelyImage(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var ext = Path.GetExtension(path);
        foreach (var e in ImageExts)
        {
            if (ext.Equals(e, StringComparison.OrdinalIgnoreCase))
                return true;
        }
        return false;
    }

    /// <summary>Returns raw base64 PNG (no data: prefix), or empty on failure.</summary>
    public static string TryEncodeThumbnailBase64(string filePath, int pixelSize)
    {
        try
        {
            if (!IsLikelyImage(filePath) || !File.Exists(filePath))
                return "";

            var size = Math.Clamp(pixelSize <= 0 ? 256 : pixelSize, 16, 1024);
            using var input = File.OpenRead(filePath);
            using var codec = SKCodec.Create(input);
            if (codec == null) return "";

            using var original = SKBitmap.Decode(codec);
            if (original == null || original.Width <= 0 || original.Height <= 0)
                return "";

            using var oriented = ApplyEncodedOrigin(original, codec.EncodedOrigin);
            var src = oriented ?? original;

            var scale = Math.Min(size / (float)src.Width, size / (float)src.Height);
            if (scale > 1f) scale = 1f;
            var tw = Math.Max(1, (int)Math.Round(src.Width * scale));
            var th = Math.Max(1, (int)Math.Round(src.Height * scale));

            using var resized = src.Resize(
                new SKImageInfo(tw, th),
                new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
            if (resized == null) return "";

            using var image = SKImage.FromBitmap(resized);
            using var data = image.Encode(SKEncodedImageFormat.Png, 90);
            if (data == null) return "";
            return Convert.ToBase64String(data.ToArray());
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[SkiaThumb] {ex.Message}");
            return "";
        }
    }

    /// <summary>2×2 collage of images inside a folder for list/grid folder thumbs.</summary>
    public static string TryEncodeFolderCollageBase64(string folderPath, int pixelSize)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(folderPath) || !Directory.Exists(folderPath))
                return "";

            var size = Math.Clamp(pixelSize <= 0 ? 128 : pixelSize, 32, 512);
            var images = new List<string>(4);
            // Cap scan — huge system folders (Windows, Program Files) must not stall IPC.
            var scanned = 0;
            const int maxScan = 64;
            foreach (var file in Directory.EnumerateFiles(folderPath))
            {
                scanned++;
                if (scanned > maxScan) break;
                if (!IsLikelyImage(file)) continue;
                images.Add(file);
                if (images.Count >= 4) break;
            }
            if (images.Count == 0) return "";

            // Single image → normal thumb.
            if (images.Count == 1)
                return TryEncodeThumbnailBase64(images[0], size);

            var cell = Math.Max(8, size / 2);
            using var canvasBmp = new SKBitmap(size, size);
            using var canvas = new SKCanvas(canvasBmp);
            canvas.Clear(new SKColor(28, 30, 36));

            for (var i = 0; i < images.Count && i < 4; i++)
            {
                var thumbB64 = TryEncodeThumbnailBase64(images[i], cell);
                if (string.IsNullOrEmpty(thumbB64)) continue;
                var bytes = Convert.FromBase64String(thumbB64);
                using var tile = SKBitmap.Decode(bytes);
                if (tile == null) continue;
                var x = (i % 2) * cell;
                var y = (i / 2) * cell;
                var dest = new SKRect(x + 1, y + 1, x + cell - 1, y + cell - 1);
                canvas.DrawBitmap(tile, dest);
            }

            using var image = SKImage.FromBitmap(canvasBmp);
            using var data = image.Encode(SKEncodedImageFormat.Png, 88);
            if (data == null) return "";
            return Convert.ToBase64String(data.ToArray());
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[SkiaFolder] {ex.Message}");
            return "";
        }
    }

    private static SKBitmap? ApplyEncodedOrigin(SKBitmap bitmap, SKEncodedOrigin origin)
    {
        if (origin == SKEncodedOrigin.TopLeft || origin == SKEncodedOrigin.Default)
            return null;
        return RotateFlipManual(bitmap, origin);
    }

    private static SKBitmap? RotateFlipManual(SKBitmap bitmap, SKEncodedOrigin origin)
    {
        try
        {
            var degrees = origin switch
            {
                SKEncodedOrigin.RightTop => 90,
                SKEncodedOrigin.BottomRight => 180,
                SKEncodedOrigin.LeftBottom => 270,
                _ => 0,
            };
            var mirror = origin is SKEncodedOrigin.TopRight
                or SKEncodedOrigin.BottomLeft
                or SKEncodedOrigin.LeftTop
                or SKEncodedOrigin.RightBottom;

            var w = bitmap.Width;
            var h = bitmap.Height;
            var swap = degrees is 90 or 270;
            var dw = swap ? h : w;
            var dh = swap ? w : h;
            var info = new SKImageInfo(dw, dh);
            var dest = new SKBitmap(info);
            using var canvas = new SKCanvas(dest);
            canvas.Clear(SKColors.Transparent);
            canvas.Translate(dw / 2f, dh / 2f);
            if (mirror) canvas.Scale(-1, 1);
            if (degrees != 0) canvas.RotateDegrees(degrees);
            canvas.Translate(-w / 2f, -h / 2f);
            canvas.DrawBitmap(bitmap, 0, 0);
            return dest;
        }
        catch
        {
            return null;
        }
    }
}
