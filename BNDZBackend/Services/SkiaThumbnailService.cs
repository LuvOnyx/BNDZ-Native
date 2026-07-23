using System;
using System.IO;
using SkiaSharp;

namespace BNDZ.Services;

/// <summary>
/// Fast image thumbnails via SkiaSharp when the path is a decodeable still image.
/// Shell thumbs remain the primary path for folders / exe / documents.
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
            using var original = SKBitmap.Decode(input);
            if (original == null || original.Width <= 0 || original.Height <= 0)
                return "";

            var scale = Math.Min(size / (float)original.Width, size / (float)original.Height);
            if (scale > 1f) scale = 1f;
            var tw = Math.Max(1, (int)Math.Round(original.Width * scale));
            var th = Math.Max(1, (int)Math.Round(original.Height * scale));

            using var resized = original.Resize(
                new SKImageInfo(tw, th),
                new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
            if (resized == null) return "";

            using var image = SKImage.FromBitmap(resized);
            using var data = image.Encode(SKEncodedImageFormat.Png, 90);
            if (data == null) return "";
            using var ms = BndzHostCaches.Streams.GetStream("skia-thumb");
            data.SaveTo(ms);
            if (ms.TryGetBuffer(out var segment) && segment.Array != null)
                return Convert.ToBase64String(segment.Array, segment.Offset, segment.Count);
            return Convert.ToBase64String(ms.ToArray());
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[SkiaThumb] {ex.Message}");
            return "";
        }
    }
}
