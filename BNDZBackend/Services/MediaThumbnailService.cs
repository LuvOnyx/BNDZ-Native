using System;
using System.IO;
using System.Threading.Tasks;
using SkiaSharp;
using TagLib;
using Vanara.PInvoke;
using Vanara.Windows.Shell;
using TagFile = TagLib.File;

namespace BNDZ.Services;

/// <summary>
/// Gold-path list/preview thumbnail extraction — small PNG bytes for CAS, never full-file pixels.
/// Order: Skia stills → TagLib embedded art (audio/video) → Windows shell ThumbnailOnly → icon fallback.
/// </summary>
public static class MediaThumbnailService
{
    private static readonly HashSet<string> AudioExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".oga", ".wav", ".wma", ".opus", ".aiff", ".ape",
    };

    private static readonly HashSet<string> VideoExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp4", ".mkv", ".mov", ".avi", ".webm", ".m4v", ".wmv", ".mpg", ".mpeg", ".flv", ".ts", ".m2ts",
    };

    private static readonly HashSet<string> ArchiveExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".zip", ".rar", ".7z", ".tar", ".gz", ".tgz", ".bz2", ".xz", ".cab", ".iso",
    };

    private static readonly HashSet<string> ShellPreferExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".svg", ".heic", ".heif", ".avif", ".psd", ".ai", ".eps",
        ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
    };

    /// <summary>Extract a list-grade thumbnail as raw base64 PNG (no data: prefix).</summary>
    public static string ExtractBase64(string filePath, int pixelSize)
    {
        if (string.IsNullOrWhiteSpace(filePath))
            return "";

        filePath = ShellPathResolver.ResolveForShell(filePath);
        if (string.IsNullOrWhiteSpace(filePath))
            return "";

        var size = Math.Clamp(pixelSize <= 0 ? 128 : pixelSize, 16, 512);

        // Folder collage only — never shell GetImage for folders (hangs on system roots like C:\Windows).
        // List cells use shell glyphs for folders when collage is empty.
        if (Directory.Exists(filePath))
            return SkiaThumbnailService.TryEncodeFolderCollageBase64(filePath, size);

        if (!System.IO.File.Exists(filePath))
            return "";

        var ext = Path.GetExtension(filePath);

        // 1) Fast Skia stills (png/jpg/webp/…) — EXIF-oriented.
        var skia = SkiaThumbnailService.TryEncodeThumbnailBase64(filePath, size);
        if (!string.IsNullOrEmpty(skia))
            return skia;

        // 2) Video: prefer Windows shell poster frames (fast, mid-clip when provider supports it).
        if (VideoExts.Contains(ext))
        {
            var videoShell = TryShellThumbnailBase64(filePath, size, thumbnailOnly: true);
            if (!string.IsNullOrEmpty(videoShell))
                return videoShell;
            var videoArt = TryTagLibPictureBase64(filePath, size);
            if (!string.IsNullOrEmpty(videoArt))
                return videoArt;
            var videoAny = TryShellThumbnailBase64(filePath, size, thumbnailOnly: false);
            if (!string.IsNullOrEmpty(videoAny))
                return videoAny;
            return "";
        }

        // 3) Audio / containers: embedded cover art first (album art is the product signal).
        if (AudioExts.Contains(ext))
        {
            var art = TryTagLibPictureBase64(filePath, size);
            if (!string.IsNullOrEmpty(art))
                return art;
        }

        // 4) Windows shell thumbnail providers (SVG, archives, Office, HEIC, remaining audio…)
        var shellThumb = TryShellThumbnailBase64(filePath, size, thumbnailOnly: true);
        if (!string.IsNullOrEmpty(shellThumb))
            return shellThumb;

        // 5) Softer shell GetImage — images included (Skia miss / stubborn codecs), plus
        // archives / Office / audio that often only expose icon-or-thumb via GetImage.
        if (SkiaThumbnailService.IsLikelyImage(filePath)
            || ArchiveExts.Contains(ext)
            || ShellPreferExts.Contains(ext)
            || AudioExts.Contains(ext))
        {
            var shellAny = TryShellThumbnailBase64(filePath, size, thumbnailOnly: false);
            if (!string.IsNullOrEmpty(shellAny))
                return shellAny;
        }

        return "";
    }

    /// <summary>Same as <see cref="ExtractBase64"/> but never blocks the IPC thread past <paramref name="timeoutMs"/>.</summary>
    public static string ExtractBase64Bounded(string filePath, int pixelSize, int timeoutMs = 6000)
    {
        try
        {
            var task = Task.Run(() => ExtractBase64(filePath, pixelSize));
            if (task.Wait(Math.Clamp(timeoutMs, 500, 30_000)))
                return task.Result ?? "";
            System.Diagnostics.Debug.WriteLine($"[MediaThumb] extract timeout {timeoutMs}ms: {filePath}");
            return "";
        }
        catch
        {
            return "";
        }
    }

    private static string TryTagLibPictureBase64(string filePath, int pixelSize)
    {
        try
        {
            using var file = TagFile.Create(filePath);
            var pics = file.Tag?.Pictures;
            if (pics == null || pics.Length == 0)
                return "";

            // Prefer FrontCover, else first picture with data.
            IPicture? best = null;
            foreach (var p in pics)
            {
                if (p?.Data?.Data == null || p.Data.Data.Length == 0) continue;
                if (p.Type == PictureType.FrontCover) { best = p; break; }
                best ??= p;
            }
            if (best?.Data?.Data == null || best.Data.Data.Length == 0)
                return "";

            return EncodeBytesToSizedPngBase64(best.Data.Data, pixelSize);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[MediaThumb/TagLib] {ex.Message}");
            return "";
        }
    }

    private static string EncodeBytesToSizedPngBase64(byte[] imageBytes, int pixelSize)
    {
        try
        {
            using var original = SKBitmap.Decode(imageBytes);
            if (original == null || original.Width <= 0 || original.Height <= 0)
                return "";

            var scale = Math.Min(pixelSize / (float)original.Width, pixelSize / (float)original.Height);
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
            return Convert.ToBase64String(data.ToArray());
        }
        catch
        {
            return "";
        }
    }

    private static string TryShellThumbnailBase64(string filePath, int pixelSize, bool thumbnailOnly)
    {
        try
        {
            // Shell GetImage can hang indefinitely on protected/system paths — bound it.
            var task = Task.Run(() =>
            {
                using var item = new ShellItem(filePath);
                var flags = ShellItemGetImageOptions.ResizeToFit;
                if (thumbnailOnly)
                    flags |= ShellItemGetImageOptions.ThumbnailOnly;
                else
                    flags |= ShellItemGetImageOptions.BiggerSizeOk;

                using var hbmp = item.GetImage(new SIZE(pixelSize, pixelSize), flags);
                if (hbmp == null || hbmp.IsInvalid)
                    return "";
                using var bitmap = hbmp.ToBitmap();
                using var ms = new MemoryStream();
                bitmap.MakeTransparent();
                bitmap.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
                return Convert.ToBase64String(ms.ToArray());
            });
            if (!task.Wait(4500))
            {
                System.Diagnostics.Debug.WriteLine($"[MediaThumb/Shell] timeout: {filePath}");
                return "";
            }
            return task.Result ?? "";
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[MediaThumb/Shell] {ex.Message}");
            return "";
        }
    }
}
