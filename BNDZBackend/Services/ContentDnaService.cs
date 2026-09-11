using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Numerics;
using System.Text.Json;
using System.Text.Json.Serialization;
using SkiaSharp;

namespace BNDZ.Services;

/// <summary>
/// Perceptual DNA for images (dHash via SkiaSharp) and audio (size+duration+waveform fingerprint).
/// Stored under %LocalAppData%/BNDZ/ContentDna/.
/// </summary>
public sealed class ContentDnaService
{
    private static readonly Lazy<ContentDnaService> Lazy = new(() => new ContentDnaService());
    public static ContentDnaService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly HashSet<string> ImageExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".png", ".jpg", ".jpeg", ".jfif", ".gif", ".bmp", ".webp", ".tif", ".tiff", ".avif", ".heic", ".heif",
    };

    private static readonly HashSet<string> AudioExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp3", ".wav", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".wma", ".opus", ".aiff", ".aif", ".ape", ".wv",
    };

    private const int ImageHammingThreshold = 12;
    private const double AudioDurationToleranceSec = 0.5;
    private const double AudioSizeTolerancePct = 0.05;

    private readonly string _root;
    private readonly string _indexFile;
    private readonly object _lock = new();
    private Dictionary<string, ContentDnaRecord> _index = new(StringComparer.OrdinalIgnoreCase);

    private ContentDnaService()
    {
        _root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "ContentDna");
        _indexFile = Path.Combine(_root, "index.json");
        Directory.CreateDirectory(_root);
        LoadIndex();
    }

    private void LoadIndex()
    {
        try
        {
            if (!System.IO.File.Exists(_indexFile)) return;
            var list = JsonSerializer.Deserialize<List<ContentDnaRecord>>(System.IO.File.ReadAllText(_indexFile), Json);
            if (list == null) return;
            _index = list
                .Where(r => !string.IsNullOrWhiteSpace(r.Path))
                .GroupBy(r => Normalize(r.Path))
                .ToDictionary(g => g.Key, g => g.Last(), StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ContentDna] LoadIndex: {ex.Message}");
        }
    }

    private void PersistIndex()
    {
        var list = _index.Values.OrderBy(r => r.Path, StringComparer.OrdinalIgnoreCase).ToList();
        System.IO.File.WriteAllText(_indexFile, JsonSerializer.Serialize(list, Json));
    }

    public ContentDnaScanResult ScanFolder(string folderPath, bool includeSubfolders = true)
    {
        var root = Normalize(folderPath);
        if (!Directory.Exists(root))
            throw new DirectoryNotFoundException(root);

        var scanned = 0;
        var option = includeSubfolders ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
        foreach (var file in Directory.EnumerateFiles(root, "*", option))
        {
            if (!IsSupported(file)) continue;
            try
            {
                ScanFile(file);
                scanned++;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ContentDna] Scan {file}: {ex.Message}");
            }
        }

        return new ContentDnaScanResult { Ok = true, Scanned = scanned, Folder = root };
    }

    public ContentDnaRecord ScanFile(string filePath)
    {
        var path = Normalize(filePath);
        if (!System.IO.File.Exists(path))
            throw new System.IO.FileNotFoundException(path);

        var ext = Path.GetExtension(path);
        ContentDnaRecord record;
        if (ImageExts.Contains(ext))
            record = BuildImageRecord(path);
        else if (AudioExts.Contains(ext))
            record = BuildAudioRecord(path);
        else
            throw new NotSupportedException($"Unsupported extension: {ext}");

        lock (_lock)
        {
            _index[path] = record;
            PersistIndex();
        }
        return record;
    }

    public ContentDnaRelativesResult GetRelativesForPath(string filePath, int maxResults = 12)
    {
        var path = Normalize(filePath);
        if (!System.IO.File.Exists(path))
            return new ContentDnaRelativesResult { Ok = false, Error = "File not found." };

        ContentDnaRecord? focus;
        lock (_lock)
        {
            if (!_index.TryGetValue(path, out focus))
            {
                try { focus = ScanFile(path); }
                catch (Exception ex) { return new ContentDnaRelativesResult { Ok = false, Error = ex.Message }; }
            }
        }

        var folder = Path.GetDirectoryName(path) ?? "";
        var treeRoot = FindTreeRoot(folder);
        EnsureFolderIndexed(folder, treeRoot);

        var candidates = new List<ContentDnaRelative>();
        lock (_lock)
        {
            foreach (var kv in _index)
            {
                if (string.Equals(kv.Key, path, StringComparison.OrdinalIgnoreCase)) continue;
                if (!IsInTree(kv.Key, treeRoot)) continue;
                var rel = ScoreRelative(focus!, kv.Value);
                if (rel != null) candidates.Add(rel);
            }
        }

        return new ContentDnaRelativesResult
        {
            Ok = true,
            Path = path,
            Kind = focus!.Kind,
            Relatives = candidates
                .OrderByDescending(r => r.Score)
                .ThenBy(r => r.Path, StringComparer.OrdinalIgnoreCase)
                .Take(maxResults)
                .ToList(),
        };
    }

    private void EnsureFolderIndexed(string folder, string treeRoot)
    {
        lock (_lock)
        {
            var hasAny = _index.Keys.Any(p => IsInTree(p, treeRoot));
            if (hasAny) return;
        }
        ScanFolder(treeRoot, includeSubfolders: true);
    }

    private static string FindTreeRoot(string folder)
    {
        var current = Normalize(folder);
        var parent = Directory.GetParent(current);
        while (parent != null)
        {
            var name = parent.Name;
            if (name.Equals("Projects", StringComparison.OrdinalIgnoreCase)
                || name.Equals("Music", StringComparison.OrdinalIgnoreCase)
                || name.Equals("Audio", StringComparison.OrdinalIgnoreCase)
                || name.Equals("Samples", StringComparison.OrdinalIgnoreCase)
                || name.Equals("Bounces", StringComparison.OrdinalIgnoreCase)
                || name.Equals("Exports", StringComparison.OrdinalIgnoreCase))
            {
                return parent.FullName;
            }
            parent = parent.Parent;
        }
        return current;
    }

    private static bool IsInTree(string filePath, string treeRoot)
    {
        var norm = Normalize(filePath);
        var root = Normalize(treeRoot).TrimEnd('\\') + "\\";
        return norm.StartsWith(root, StringComparison.OrdinalIgnoreCase);
    }

    private ContentDnaRelative? ScoreRelative(ContentDnaRecord focus, ContentDnaRecord other)
    {
        if (!string.Equals(focus.Kind, other.Kind, StringComparison.OrdinalIgnoreCase))
            return null;

        if (focus.Kind == "image" && !string.IsNullOrEmpty(focus.Hash) && !string.IsNullOrEmpty(other.Hash))
        {
            var dist = HammingDistance(focus.Hash, other.Hash);
            if (dist > ImageHammingThreshold) return null;
            var score = 1.0 - dist / 64.0;
            return new ContentDnaRelative
            {
                Path = other.Path,
                Kind = other.Kind,
                Score = Math.Round(score, 3),
                Reason = dist == 0 ? "Identical perceptual hash" : $"Near-duplicate (Δ{dist})",
                Hash = other.Hash,
            };
        }

        if (focus.Kind == "audio")
        {
            var score = AudioSimilarity(focus, other);
            if (score < 0.72) return null;
            return new ContentDnaRelative
            {
                Path = other.Path,
                Kind = other.Kind,
                Score = Math.Round(score, 3),
                Reason = BuildAudioReason(focus, other),
                Fingerprint = other.Fingerprint,
                DurationSec = other.DurationSec,
            };
        }

        return null;
    }

    private static string BuildAudioReason(ContentDnaRecord focus, ContentDnaRecord other)
    {
        var parts = new List<string>();
        if (focus.DurationSec > 0 && other.DurationSec > 0
            && Math.Abs(focus.DurationSec - other.DurationSec) <= AudioDurationToleranceSec)
            parts.Add("same duration");
        if (focus.Size > 0 && other.Size > 0)
        {
            var pct = Math.Abs(focus.Size - other.Size) / (double)Math.Max(focus.Size, other.Size);
            if (pct <= AudioSizeTolerancePct) parts.Add("similar size");
        }
        if (!string.IsNullOrEmpty(focus.Fingerprint) && focus.Fingerprint == other.Fingerprint)
            parts.Add("waveform fingerprint match");
        if (NameSimilarity(Path.GetFileNameWithoutExtension(focus.Path), Path.GetFileNameWithoutExtension(other.Path)) > 0.6)
            parts.Add("name similarity");
        return parts.Count > 0 ? string.Join(" · ", parts) : "audio DNA match";
    }

    private static double AudioSimilarity(ContentDnaRecord a, ContentDnaRecord b)
    {
        var score = 0.0;
        var weight = 0.0;

        if (a.DurationSec > 0 && b.DurationSec > 0)
        {
            var durDiff = Math.Abs(a.DurationSec - b.DurationSec);
            var durScore = durDiff <= AudioDurationToleranceSec ? 1.0 : Math.Max(0, 1.0 - durDiff / Math.Max(a.DurationSec, b.DurationSec));
            score += durScore * 0.35;
            weight += 0.35;
        }

        if (a.Size > 0 && b.Size > 0)
        {
            var pct = Math.Abs(a.Size - b.Size) / (double)Math.Max(a.Size, b.Size);
            var sizeScore = pct <= AudioSizeTolerancePct ? 1.0 : Math.Max(0, 1.0 - pct);
            score += sizeScore * 0.25;
            weight += 0.25;
        }

        if (!string.IsNullOrEmpty(a.Fingerprint) && !string.IsNullOrEmpty(b.Fingerprint))
        {
            var fpScore = string.Equals(a.Fingerprint, b.Fingerprint, StringComparison.OrdinalIgnoreCase) ? 1.0 : 0.0;
            score += fpScore * 0.3;
            weight += 0.3;
        }

        var nameScore = NameSimilarity(Path.GetFileNameWithoutExtension(a.Path), Path.GetFileNameWithoutExtension(b.Path));
        score += nameScore * 0.1;
        weight += 0.1;

        return weight > 0 ? score / weight : 0;
    }

    private static double NameSimilarity(string a, string b)
    {
        if (string.IsNullOrWhiteSpace(a) || string.IsNullOrWhiteSpace(b)) return 0;
        a = a.ToLowerInvariant();
        b = b.ToLowerInvariant();
        if (a == b) return 1;
        if (a.Contains(b, StringComparison.Ordinal) || b.Contains(a, StringComparison.Ordinal)) return 0.75;
        var longer = a.Length >= b.Length ? a : b;
        var shorter = a.Length < b.Length ? a : b;
        var matches = 0;
        for (var i = 0; i < shorter.Length; i++)
            if (shorter[i] == longer[i]) matches++;
        return matches / (double)longer.Length;
    }

    private ContentDnaRecord BuildImageRecord(string path)
    {
        var fi = new System.IO.FileInfo(path);
        var hash = ComputeDHash(path);
        return new ContentDnaRecord
        {
            Path = path,
            Kind = "image",
            Hash = hash,
            Size = fi.Length,
            ScannedUtc = DateTime.UtcNow.ToString("o"),
        };
    }

    private ContentDnaRecord BuildAudioRecord(string path)
    {
        var fi = new System.IO.FileInfo(path);
        double duration = 0;
        try
        {
            using var file = TagLib.File.Create(path);
            if (file.Properties.Duration > TimeSpan.Zero)
                duration = file.Properties.Duration.TotalSeconds;
        }
        catch { /* optional */ }

        return new ContentDnaRecord
        {
            Path = path,
            Kind = "audio",
            Size = fi.Length,
            DurationSec = Math.Round(duration, 3),
            Fingerprint = ComputeWaveformFingerprint(path),
            ScannedUtc = DateTime.UtcNow.ToString("o"),
        };
    }

    private static string ComputeDHash(string path)
    {
        using var input = System.IO.File.OpenRead(path);
        using var codec = SKCodec.Create(input);
        if (codec == null) return "";
        using var original = SKBitmap.Decode(codec);
        if (original == null || original.Width <= 0 || original.Height <= 0) return "";

        const int w = 9;
        const int h = 8;
        using var resized = original.Resize(new SKImageInfo(w, h), new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
        if (resized == null) return "";

        ulong hash = 0;
        var bit = 0;
        for (var y = 0; y < h; y++)
        {
            for (var x = 0; x < w - 1; x++)
            {
                var left = resized.GetPixel(x, y);
                var right = resized.GetPixel(x + 1, y);
                var leftLum = 0.299 * left.Red + 0.587 * left.Green + 0.114 * left.Blue;
                var rightLum = 0.299 * right.Red + 0.587 * right.Green + 0.114 * right.Blue;
                if (leftLum > rightLum)
                    hash |= 1UL << bit;
                bit++;
            }
        }
        return hash.ToString("x16");
    }

    private static string ComputeWaveformFingerprint(string path)
    {
        try
        {
            var len = new System.IO.FileInfo(path).Length;
            if (len <= 0) return "";
            var sampleSize = (int)Math.Min(8192, len);
            var buf = new byte[sampleSize * 3];
            using var fs = System.IO.File.OpenRead(path);
            var readHead = fs.Read(buf, 0, sampleSize);
            fs.Seek(Math.Max(0, len - sampleSize), SeekOrigin.Begin);
            var readTail = fs.Read(buf, sampleSize, sampleSize);
            fs.Seek(len / 2, SeekOrigin.Begin);
            var readMid = fs.Read(buf, sampleSize * 2, sampleSize);
            var used = readHead + readTail + readMid;
            if (used <= 0) return "";
            ulong acc = 0;
            for (var i = 0; i < used; i++)
                acc = (acc * 131) + buf[i];
            return acc.ToString("x16");
        }
        catch
        {
            return "";
        }
    }

    private static int HammingDistance(string hexA, string hexB)
    {
        if (!ulong.TryParse(hexA, System.Globalization.NumberStyles.HexNumber, null, out var a)
            || !ulong.TryParse(hexB, System.Globalization.NumberStyles.HexNumber, null, out var b))
            return 64;
        return BitOperations.PopCount(a ^ b);
    }

    private static bool IsSupported(string path)
    {
        var ext = Path.GetExtension(path);
        return ImageExts.Contains(ext) || AudioExts.Contains(ext);
    }

    private static string Normalize(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        return Path.GetFullPath(path.Replace('/', '\\').Trim());
    }
}

public sealed class ContentDnaRecord
{
    public string Path { get; set; } = "";
    public string Kind { get; set; } = "";
    public string? Hash { get; set; }
    public string? Fingerprint { get; set; }
    public long Size { get; set; }
    public double DurationSec { get; set; }
    public string ScannedUtc { get; set; } = "";
}

public sealed class ContentDnaRelative
{
    public string Path { get; set; } = "";
    public string Kind { get; set; } = "";
    public double Score { get; set; }
    public string Reason { get; set; } = "";
    public string? Hash { get; set; }
    public string? Fingerprint { get; set; }
    public double DurationSec { get; set; }
}

public sealed class ContentDnaScanResult
{
    public bool Ok { get; set; }
    public int Scanned { get; set; }
    public string Folder { get; set; } = "";
    public string? Error { get; set; }
}

public sealed class ContentDnaRelativesResult
{
    public bool Ok { get; set; }
    public string Path { get; set; } = "";
    public string Kind { get; set; } = "";
    public List<ContentDnaRelative> Relatives { get; set; } = new();
    public string? Error { get; set; }
}
