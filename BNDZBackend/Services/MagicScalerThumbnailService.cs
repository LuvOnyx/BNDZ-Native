using System;
using System.IO;
using PhotoSauce.MagicScaler;

namespace BNDZ.Services;

/// <summary>
/// High-quality thumbnail-scale decode via PhotoSauce MagicScaler (WIC + SIMD).
/// Prefer this ahead of full Skia decode for JPEG/PNG/WEBP/TIFF list thumbs.
/// </summary>
public static class MagicScalerThumbnailService
{
    private static readonly HashSet<string> SupportedExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".jpg", ".jpeg", ".jfif", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp",
    };

    public static bool IsSupported(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        return SupportedExts.Contains(Path.GetExtension(path));
    }

    /// <summary>Returns raw base64 PNG (no data: prefix), or empty on failure.</summary>
    public static string TryEncodeThumbnailBase64(string filePath, int pixelSize)
    {
        try
        {
            if (!File.Exists(filePath) || !IsSupported(filePath))
                return "";

            var size = Math.Clamp(pixelSize <= 0 ? 128 : pixelSize, 16, 1024);
            using var ms = new MemoryStream();
            var settings = new ProcessImageSettings
            {
                Width = size,
                Height = size,
                ResizeMode = CropScaleMode.Max,
                Anchor = CropAnchor.Center,
                HybridMode = HybridScaleMode.FavorQuality,
            };
            MagicImageProcessor.ProcessImage(filePath, ms, settings);
            if (ms.Length < 32) return "";
            return Convert.ToBase64String(ms.ToArray());
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[MagicScalerThumb] {ex.Message}");
            return "";
        }
    }
}
