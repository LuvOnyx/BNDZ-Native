using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>
/// Lens Stage — content twins, folder orbit, and media peers for a focused file.
/// Native aggregate used by the preview Lens surface (no sidecars).
/// </summary>
public sealed class BndzLensService
{
    public static BndzLensService Instance { get; } = new();

    private BndzLensService() { }

    public async Task<object> BuildLensStageAsync(string paneOrWinPath, CancellationToken ct = default)
    {
        var win = ToWinPath(paneOrWinPath);
        var pane = ToPanePath(win);
        var focusName = Path.GetFileName(win);
        var focusExists = File.Exists(win);

        object? focus = null;
        string? sha256 = null;
        long size = 0;
        long modified = 0;
        string? mediaKind = null;

        if (focusExists)
        {
            try
            {
                var fi = new FileInfo(win);
                size = fi.Length;
                modified = new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeSeconds();
                mediaKind = ClassifyExt(fi.Extension);
                focus = new
                {
                    path = pane,
                    name = fi.Name,
                    size,
                    modified,
                    mediaKind,
                    type = "file",
                };
                if (size > 0 && size <= 512L * 1024 * 1024)
                    sha256 = await HashSha256HexAsync(win, ct).ConfigureAwait(false);
            }
            catch { }
        }
        else
        {
            var entry = BndzFileIndexService.Instance.GetEntry(pane);
            if (entry != null)
            {
                size = entry.TryGetValue("size", out var s) && s is long sl ? sl : 0;
                if (entry.TryGetValue("modifiedUnix", out var mu) && mu is long mul)
                    modified = mul;
                else if (entry.TryGetValue("modified", out var m) && m is long ml)
                    modified = ml;
                else if (entry.TryGetValue("modified", out m) && m is string ms && DateTimeOffset.TryParse(ms, out var dto))
                    modified = dto.ToUnixTimeSeconds();
                mediaKind = entry.TryGetValue("mediaKind", out var mk) ? mk as string : null;
                focusName = entry.TryGetValue("name", out var n) ? n as string ?? focusName : focusName;
                focus = new
                {
                    path = pane,
                    name = focusName,
                    size,
                    modified,
                    mediaKind,
                    type = entry.TryGetValue("isDirectory", out var d) && d is true ? "directory" : "file",
                };
            }
        }

        var orbit = BndzFileIndexService.Instance.GetOrbitSiblings(pane, 8);
        var sizePeers = size > 0
            ? BndzFileIndexService.Instance.FindSameSize(pane, size, 36)
            : [];
        var mediaPeers = !string.IsNullOrWhiteSpace(mediaKind)
            ? BndzFileIndexService.Instance.FindMediaPeers(pane, mediaKind!, size, 12)
            : [];

        var twins = new List<object>();
        if (!string.IsNullOrWhiteSpace(sha256) && sizePeers.Count > 0)
        {
            var candidates = sizePeers
                .Select(ExtractPath)
                .Where(p => !string.IsNullOrWhiteSpace(p) && !string.Equals(p, pane, StringComparison.OrdinalIgnoreCase))
                .Take(28)
                .ToList();

            var matched = await Task.WhenAll(candidates.Select(async candidatePane =>
            {
                ct.ThrowIfCancellationRequested();
                var cWin = ToWinPath(candidatePane!);
                if (!File.Exists(cWin)) return null;
                try
                {
                    var fi = new FileInfo(cWin);
                    if (fi.Length != size) return null;
                    if (fi.Length > 512L * 1024 * 1024) return null;
                    var h = await HashSha256HexAsync(cWin, ct).ConfigureAwait(false);
                    if (!string.Equals(h, sha256, StringComparison.OrdinalIgnoreCase)) return null;
                    return (object)new
                    {
                        path = candidatePane,
                        name = fi.Name,
                        size = fi.Length,
                        modified = new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeSeconds(),
                        mediaKind = ClassifyExt(fi.Extension),
                        type = "file",
                        relation = "twin",
                        sha256 = h,
                    };
                }
                catch
                {
                    return null;
                }
            })).ConfigureAwait(false);

            twins.AddRange(matched.Where(x => x != null)!);
        }

        // Enrich size peers that aren't twins yet (same size, unverified / different hash).
        var twinPaths = new HashSet<string>(
            twins.Select(t => ExtractPath(t)!).Where(p => p != null)!,
            StringComparer.OrdinalIgnoreCase);

        var sameSize = sizePeers
            .Select(p =>
            {
                var path = ExtractPath(p);
                if (string.IsNullOrWhiteSpace(path) || twinPaths.Contains(path)) return null;
                return EnrichRow(p, "sameSize");
            })
            .Where(x => x != null)
            .Take(12)
            .Cast<object>()
            .ToList();

        var media = mediaPeers
            .Select(p => EnrichRow(p, "media"))
            .Where(x => x != null)
            .Take(10)
            .Cast<object>()
            .ToList();

        var orbitRows = orbit
            .Select(p => EnrichRow(p, "orbit"))
            .Where(x => x != null)
            .Cast<object>()
            .ToList();

        string? camera = null;
        string? taken = null;
        try
        {
            if (focusExists)
            {
                var meta = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                MediaTagMetadataService.Enrich(meta, win);
                if (meta.TryGetValue("Lens Model", out var lens) && !string.IsNullOrWhiteSpace(lens))
                    camera = lens;
                else if (meta.TryGetValue("Camera Model", out var cam) && !string.IsNullOrWhiteSpace(cam))
                    camera = cam;
                else if (meta.TryGetValue("Make", out var make) && meta.TryGetValue("Model", out var model))
                    camera = $"{make} {model}".Trim();
                if (meta.TryGetValue("Date Taken", out var dt)) taken = dt;
                else if (meta.TryGetValue("Date/Time Original", out var dto)) taken = dto;
            }
        }
        catch { }

        return new
        {
            focus,
            sha256,
            twins,
            orbit = orbitRows,
            sameSize,
            mediaPeers = media,
            facts = new { camera, taken, mediaKind, size, modified },
            generatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        };
    }

    private static object? EnrichRow(object row, string relation)
    {
        var path = ExtractPath(row);
        if (string.IsNullOrWhiteSpace(path)) return null;
        var name = row.GetType().GetProperty("name")?.GetValue(row) as string
            ?? Path.GetFileName(ToWinPath(path));
        var size = row.GetType().GetProperty("size")?.GetValue(row) as long? ?? 0L;
        var modifiedProp = row.GetType().GetProperty("modified")?.GetValue(row);
        long modified = 0;
        if (modifiedProp is long l) modified = l;
        else if (modifiedProp is string s && DateTimeOffset.TryParse(s, out var dto)) modified = dto.ToUnixTimeSeconds();
        var createdProp = row.GetType().GetProperty("created")?.GetValue(row);
        long created = 0;
        if (createdProp is long cl) created = cl;
        else if (createdProp is string cs && DateTimeOffset.TryParse(cs, out var cto)) created = cto.ToUnixTimeSeconds();
        var type = row.GetType().GetProperty("type")?.GetValue(row) as string ?? "file";
        var ext = row.GetType().GetProperty("extension")?.GetValue(row) as string;
        var mediaKind = row.GetType().GetProperty("mediaKind")?.GetValue(row) as string;
        if (string.IsNullOrWhiteSpace(mediaKind))
            mediaKind = ClassifyExt(!string.IsNullOrWhiteSpace(ext) ? $".{ext}" : Path.GetExtension(name));
        return new
        {
            path,
            name,
            size,
            modified,
            created,
            type,
            relation,
            extension = ext,
            mediaKind,
        };
    }

    private static string? ExtractPath(object? row)
    {
        if (row == null) return null;
        return row.GetType().GetProperty("path")?.GetValue(row) as string;
    }

    private static async Task<string> HashSha256HexAsync(string winPath, CancellationToken ct)
    {
        await using var stream = new FileStream(
            winPath, FileMode.Open, FileAccess.Read, FileShare.Read,
            1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        using var sha = SHA256.Create();
        var hash = await sha.ComputeHashAsync(stream, ct).ConfigureAwait(false);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string ClassifyExt(string? ext)
    {
        var e = (ext ?? "").TrimStart('.').ToLowerInvariant();
        return e switch
        {
            "jpg" or "jpeg" or "png" or "gif" or "bmp" or "webp" or "heic" or "tif" or "tiff" or "avif" => "image",
            "mp4" or "mkv" or "mov" or "avi" or "webm" or "wmv" or "m4v" => "video",
            "mp3" or "wav" or "flac" or "aac" or "m4a" or "ogg" or "wma" or "opus" => "audio",
            "pdf" or "doc" or "docx" or "xls" or "xlsx" or "ppt" or "pptx" or "txt" or "md" => "document",
            _ => "",
        };
    }

    private static string ToWinPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        var p = path.Replace('/', '\\');
        if (p.StartsWith("\\") && p.Length >= 3 && char.IsLetter(p[1]) && p[2] == ':')
            p = p[1..];
        if (p.StartsWith("/") || (p.Length >= 2 && p[0] == '\\' && char.IsLetter(p[1])))
        {
            /* keep */
        }
        if (p.Length >= 3 && p[0] == '/' && char.IsLetter(p[1]) && p[2] == ':')
            p = p[1..].Replace('/', '\\');
        else if (p.Length >= 2 && char.IsLetter(p[0]) && p[1] == ':')
            p = p.Replace('/', '\\');
        else
            p = p.TrimStart('\\', '/').Replace('/', '\\');
        return p;
    }

    private static string ToPanePath(string winPath)
    {
        var p = winPath.Replace('\\', '/');
        if (p.Length >= 2 && char.IsLetter(p[0]) && p[1] == ':')
            return "/" + p;
        return p.StartsWith('/') ? p : "/" + p;
    }
}
