using System;
using System.IO;
using Vanara.PInvoke;
using Vanara.Windows.Shell;

namespace BNDZ.Services;

/// <summary>
/// Prefer Explorer's thumbnail cache (InCacheOnly) before extracting new thumbs —
/// matches Files / Explorer warm-navigate behavior.
/// Full IThumbnailCache COM is available via CsWin32 NativeMethods.txt for future deepen;
/// Vanara InCacheOnly is the live path today.
/// </summary>
public static class ShellThumbnailCacheService
{
    /// <summary>Returns raw base64 PNG, or empty when not cached / unavailable.</summary>
    public static string TryGetCachedBase64(string filePath, int pixelSize)
    {
        if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
            return "";

        var size = Math.Clamp(pixelSize <= 0 ? 128 : pixelSize, 16, 512);

        try
        {
            using var item = new ShellItem(filePath);
            using var hbmp = item.GetImage(
                new SIZE(size, size),
                ShellItemGetImageOptions.ResizeToFit
                | ShellItemGetImageOptions.ThumbnailOnly
                | ShellItemGetImageOptions.InCacheOnly);
            if (hbmp == null || hbmp.IsInvalid)
                return "";

            using var bitmap = hbmp.ToBitmap();
            using var ms = new MemoryStream();
            bitmap.MakeTransparent();
            bitmap.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
            return Convert.ToBase64String(ms.ToArray());
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ThumbCache] {ex.Message}");
            return "";
        }
    }
}
