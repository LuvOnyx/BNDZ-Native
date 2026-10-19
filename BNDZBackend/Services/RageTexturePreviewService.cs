using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
#if BNDZ_HAS_CODEWALKER
using CodeWalker.GameFiles;
using CodeWalker.Utils;
using SkiaSharp;
#endif

namespace BNDZ.Services;

/// <summary>
/// Extracts the textures inside a RAGE texture dictionary (.ytd) as PNG files
/// so the preview panel and Quick Look can show a texture gallery — a .ytd has
/// no geometry, so the model preview path cannot render it. Decoding reuses
/// the same CodeWalker DDSIO path as the model preview's texture attach.
/// Extracted PNGs are cached under LocalAppData like the model GLBs.
/// </summary>
public static class RageTexturePreviewService
{
    public sealed record TextureItem(string Name, int Width, int Height, string Format, string Path);

    private const int MaxTextures = 96;
    private const int MaxDimension = 1024;

    public static bool IsRageTextureExt(string? ext)
    {
        if (string.IsNullOrWhiteSpace(ext)) return false;
        return ext.Trim().TrimStart('.').Equals("ytd", StringComparison.OrdinalIgnoreCase);
    }

    public static (bool ok, List<TextureItem> items, int skipped, string? error) TryGetTextures(string sourcePath)
    {
#if !BNDZ_HAS_CODEWALKER
        return (false, new List<TextureItem>(), 0,
            "Texture preview requires CodeWalker.Core (run scripts/build-bndz-native.ps1).");
#else
        try
        {
            if (string.IsNullOrWhiteSpace(sourcePath) || !File.Exists(sourcePath))
                return (false, new List<TextureItem>(), 0, "File not found");
            if (!IsRageTextureExt(Path.GetExtension(sourcePath)))
                return (false, new List<TextureItem>(), 0, "Not a RAGE texture dictionary");

            var fi = new FileInfo(sourcePath);
            var cacheKey = $"{fi.FullName}|{fi.Length}|{fi.LastWriteTimeUtc.Ticks}|ytd1";
            var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(cacheKey)))[..16];
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BNDZ", "ModelPreviewCache",
                $"ytd_{hash}_{Sanitize(Path.GetFileNameWithoutExtension(fi.Name))}");
            var manifestPath = Path.Combine(dir, "manifest.json");
            if (File.Exists(manifestPath))
            {
                try
                {
                    var cached = JsonSerializer.Deserialize<List<TextureItem>>(File.ReadAllText(manifestPath));
                    if (cached != null && cached.All(t => File.Exists(t.Path)))
                        return (true, cached, 0, null);
                }
                catch { /* fall through and rebuild */ }
            }

            var ytd = new YtdFile { Name = fi.Name };
            ytd.Load(File.ReadAllBytes(sourcePath));
            var textures = ytd.TextureDict?.Textures?.data_items;
            if (textures == null || textures.Length == 0)
                return (false, new List<TextureItem>(), 0, "This texture dictionary has no textures in it.");

            Directory.CreateDirectory(dir);
            var items = new List<TextureItem>();
            var skipped = 0;
            var index = 0;
            foreach (var tex in textures)
            {
                if (tex == null) continue;
                if (items.Count >= MaxTextures) { skipped++; continue; }
                var name = string.IsNullOrWhiteSpace(tex.Name) ? $"texture_{index}" : tex.Name;
                index++;
                try
                {
                    var rgba = DDSIO.GetPixels(tex, 0);
                    var w = (int)tex.Width;
                    var h = (int)tex.Height;
                    if (rgba == null || w <= 0 || h <= 0 || rgba.Length < w * h * 4) { skipped++; continue; }

                    using var bmp = new SKBitmap(w, h, SKColorType.Rgba8888, SKAlphaType.Premul);
                    System.Runtime.InteropServices.Marshal.Copy(rgba, 0, bmp.GetPixels(), w * h * 4);
                    SKBitmap finalBmp = bmp;
                    var owned = false;
                    if (w > MaxDimension || h > MaxDimension)
                    {
                        var scale = MaxDimension / (double)Math.Max(w, h);
                        var nw = Math.Max(1, (int)Math.Round(w * scale));
                        var nh = Math.Max(1, (int)Math.Round(h * scale));
                        var resized = bmp.Resize(new SKImageInfo(nw, nh, SKColorType.Rgba8888, SKAlphaType.Premul), SKFilterQuality.Medium);
                        if (resized != null) { finalBmp = resized; owned = true; }
                    }
                    using var img = SKImage.FromBitmap(finalBmp);
                    using var data = img.Encode(SKEncodedImageFormat.Png, 90);
                    var outPath = Path.Combine(dir, $"{items.Count:D2}_{Sanitize(name)}.png");
                    using (var fs = File.Create(outPath))
                        data.SaveTo(fs);
                    if (owned) finalBmp.Dispose();
                    items.Add(new TextureItem(name, w, h, tex.Format.ToString(), outPath));
                }
                catch
                {
                    skipped++;
                }
            }

            if (items.Count == 0)
                return (false, items, skipped, "None of the textures in this file could be decoded.");

            File.WriteAllText(manifestPath, JsonSerializer.Serialize(items));
            return (true, items, skipped, null);
        }
        catch (Exception ex)
        {
            return (false, new List<TextureItem>(), 0, ex.Message);
        }
#endif
    }

    private static string Sanitize(string name)
    {
        var sb = new StringBuilder(name.Length);
        foreach (var ch in name)
            sb.Append(char.IsLetterOrDigit(ch) || ch is '-' or '_' or '.' ? ch : '_');
        var s = sb.ToString().Trim('.');
        return s.Length == 0 ? "texture" : (s.Length > 60 ? s[..60] : s);
    }
}
