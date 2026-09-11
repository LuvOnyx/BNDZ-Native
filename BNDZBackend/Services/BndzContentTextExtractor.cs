using System;
using System.IO;
using System.Text;
using UglyToad.PdfPig;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage;

namespace BNDZ.Services;

/// <summary>
/// Extract searchable text from PDF (PdfPig) and images (WinRT OCR) for content_fts.
/// </summary>
public static class BndzContentTextExtractor
{
    private static readonly HashSet<string> ImageOcrExts = new(StringComparer.OrdinalIgnoreCase)
    {
        "png", "jpg", "jpeg", "jfif", "bmp", "tif", "tiff", "webp",
    };

    public static string? TryExtract(string winPath, string ext, long size, int maxChars = 12_000)
    {
        if (string.IsNullOrWhiteSpace(winPath) || !File.Exists(winPath))
            return null;

        var e = (ext ?? "").TrimStart('.').ToLowerInvariant();
        if (e == "pdf")
            return TryExtractPdf(winPath, maxChars);

        if (ImageOcrExts.Contains(e))
        {
            // Bound OCR cost — screenshots and docs under 8 MB.
            if (size <= 0 || size > 8 * 1024 * 1024) return null;
            return TryExtractImageOcr(winPath, maxChars);
        }

        return null;
    }

    public static string? TryExtractPdf(string path, int maxChars)
    {
        try
        {
            using var doc = PdfDocument.Open(path);
            var sb = new StringBuilder(Math.Min(maxChars, 16_384));
            foreach (var page in doc.GetPages())
            {
                var t = page.Text;
                if (string.IsNullOrWhiteSpace(t)) continue;
                if (sb.Length > 0) sb.Append('\n');
                sb.Append(t);
                if (sb.Length >= maxChars) break;
            }
            if (sb.Length == 0) return null;
            if (sb.Length > maxChars) sb.Length = maxChars;
            return sb.ToString();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ContentExtract/Pdf] {ex.Message}");
            return null;
        }
    }

    public static string? TryExtractImageOcr(string path, int maxChars)
    {
        try
        {
            return TryExtractImageOcrAsync(path, maxChars).GetAwaiter().GetResult();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[ContentExtract/Ocr] {ex.Message}");
            return null;
        }
    }

    private static async Task<string?> TryExtractImageOcrAsync(string path, int maxChars)
    {
        var engine = OcrEngine.TryCreateFromUserProfileLanguages();
        if (engine is null) return null;

        var file = await StorageFile.GetFileFromPathAsync(path).AsTask().ConfigureAwait(false);
        using var stream = await file.OpenReadAsync().AsTask().ConfigureAwait(false);
        var decoder = await BitmapDecoder.CreateAsync(stream).AsTask().ConfigureAwait(false);
        using var softwareBitmap = await decoder.GetSoftwareBitmapAsync(
            BitmapPixelFormat.Bgra8,
            BitmapAlphaMode.Premultiplied).AsTask().ConfigureAwait(false);
        if (softwareBitmap is null) return null;

        var result = await engine.RecognizeAsync(softwareBitmap).AsTask().ConfigureAwait(false);
        var text = result?.Text?.Trim();
        if (string.IsNullOrWhiteSpace(text)) return null;
        return text.Length > maxChars ? text[..maxChars] : text;
    }
}
