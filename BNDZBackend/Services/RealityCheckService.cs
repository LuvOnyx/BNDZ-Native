using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

public sealed class RealityCheckRef
{
    public string RefPath { get; set; } = "";
    public string ResolvedPath { get; set; } = "";
    public bool Exists { get; set; }
    public string Source { get; set; } = "";
    public string ProjectFile { get; set; } = "";
}

public sealed class RealityCheckScanResult
{
    public string RootPath { get; set; } = "";
    public int ProjectFileCount { get; set; }
    public int TotalRefs { get; set; }
    public int MissingCount { get; set; }
    public int OkCount { get; set; }
    public List<RealityCheckRef> References { get; set; } = new();
    public string ScannedUtc { get; set; } = "";
}

public sealed class RealityCheckService
{
    private static readonly Lazy<RealityCheckService> Lazy = new(() => new RealityCheckService());
    public static RealityCheckService Instance => Lazy.Value;

    private static readonly string[] ProjectExtensions =
    {
        ".bndz-refs.json", ".json", ".txt", ".als", ".xml", ".playlist", ".m3u", ".m3u8",
    };

    private static readonly Regex PathLikeRegex = new(
        @"(?:[A-Za-z]:\\[^\s""<>|*?]+|\\\\[^\s""<>|*?]+|\.{0,2}[\\/][^\s""<>|*?]+)",
        RegexOptions.Compiled);

    private static readonly Regex XmlPathRegex = new(
        @"<(?:Path|RelativePath|FileRef|Name|value)>([^<]+)</(?:Path|RelativePath|FileRef|Name|value)>",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private readonly object _gate = new();
    private RealityCheckScanResult? _lastScan;
    private HashSet<string> _missingPaths = new(StringComparer.OrdinalIgnoreCase);
    private HashSet<string> _okPaths = new(StringComparer.OrdinalIgnoreCase);
    private volatile bool _active;

    public bool IsActive => _active;

    public void SetActive(bool active)
    {
        _active = active;
        if (!active)
        {
            lock (_gate)
            {
                _missingPaths.Clear();
                _okPaths.Clear();
            }
        }
    }

    public RealityCheckScanResult? GetLastScan()
    {
        lock (_gate) return _lastScan;
    }

    public bool IsPathMissing(string? winPath)
    {
        if (!_active || string.IsNullOrWhiteSpace(winPath)) return false;
        lock (_gate) return _missingPaths.Contains(NormalizePath(winPath));
    }

    public bool IsPathOk(string? winPath)
    {
        if (!_active || string.IsNullOrWhiteSpace(winPath)) return false;
        lock (_gate) return _okPaths.Contains(NormalizePath(winPath));
    }

    public IReadOnlyCollection<string> GetMissingPaths()
    {
        lock (_gate) return _missingPaths.ToList();
    }

    public async Task<RealityCheckScanResult> ScanAsync(string rootWinPath, CancellationToken ct = default)
    {
        var root = Path.GetFullPath(rootWinPath.TrimEnd('\\', '/'));
        if (!Directory.Exists(root))
            throw new DirectoryNotFoundException($"Root path does not exist: {root}");

        var refs = new List<RealityCheckRef>();
        var projectFiles = new List<string>();

        await Task.Run(() =>
        {
            CollectProjectFiles(root, projectFiles, ct);
            foreach (var projectFile in projectFiles)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var parsed = ParseProjectFile(projectFile, root);
                    refs.AddRange(parsed);
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[RealityCheck] Parse {projectFile}: {ex.Message}");
                }
            }
        }, ct).ConfigureAwait(false);

        var deduped = refs
            .GroupBy(r => NormalizePath(r.ResolvedPath), StringComparer.OrdinalIgnoreCase)
            .Select(g => g.First())
            .ToList();

        var missing = deduped.Where(r => !r.Exists).ToList();
        var ok = deduped.Where(r => r.Exists).ToList();

        var result = new RealityCheckScanResult
        {
            RootPath = root,
            ProjectFileCount = projectFiles.Count,
            TotalRefs = deduped.Count,
            MissingCount = missing.Count,
            OkCount = ok.Count,
            References = deduped.OrderBy(r => r.Exists).ThenBy(r => r.ResolvedPath, StringComparer.OrdinalIgnoreCase).ToList(),
            ScannedUtc = DateTime.UtcNow.ToString("o"),
        };

        lock (_gate)
        {
            _lastScan = result;
            _missingPaths = new HashSet<string>(missing.Select(r => NormalizePath(r.ResolvedPath)), StringComparer.OrdinalIgnoreCase);
            _okPaths = new HashSet<string>(ok.Select(r => NormalizePath(r.ResolvedPath)), StringComparer.OrdinalIgnoreCase);
        }

        return result;
    }

    private static void CollectProjectFiles(string root, List<string> files, CancellationToken ct)
    {
        var stack = new Stack<(string Dir, int Depth)>();
        stack.Push((root, 0));

        while (stack.Count > 0)
        {
            ct.ThrowIfCancellationRequested();
            var (dir, depth) = stack.Pop();

            IEnumerable<string> entries;
            try
            {
                entries = Directory.EnumerateFileSystemEntries(dir);
            }
            catch
            {
                continue;
            }

            foreach (var entry in entries)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    if (Directory.Exists(entry))
                    {
                        if (depth < 8) stack.Push((entry, depth + 1));
                        continue;
                    }

                    var name = Path.GetFileName(entry);
                    if (name.Equals(".bndz-refs.json", StringComparison.OrdinalIgnoreCase)
                        || ProjectExtensions.Any(ext => name.EndsWith(ext, StringComparison.OrdinalIgnoreCase)))
                    {
                        files.Add(entry);
                    }
                }
                catch { }
            }
        }
    }

    private List<RealityCheckRef> ParseProjectFile(string projectFile, string scanRoot)
    {
        var ext = Path.GetExtension(projectFile).ToLowerInvariant();
        var baseDir = Path.GetDirectoryName(projectFile) ?? scanRoot;

        if (projectFile.EndsWith(".bndz-refs.json", StringComparison.OrdinalIgnoreCase))
            return ParseBndzRefs(projectFile, baseDir);

        return ext switch
        {
            ".txt" or ".m3u" or ".m3u8" or ".playlist" => ParseLineList(projectFile, baseDir),
            ".json" => ParseJsonRefs(projectFile, baseDir),
            ".als" => ParseAlsXml(projectFile, baseDir),
            ".xml" => ParseXmlPaths(projectFile, baseDir),
            _ => ParseLineList(projectFile, baseDir),
        };
    }

    private List<RealityCheckRef> ParseBndzRefs(string path, string baseDir)
    {
        var refs = new List<RealityCheckRef>();
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            ExtractJsonPaths(doc.RootElement, refs, path, baseDir, "bndz-refs");
        }
        catch { }
        return refs;
    }

    private List<RealityCheckRef> ParseJsonRefs(string path, string baseDir)
    {
        var refs = new List<RealityCheckRef>();
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(path));
            ExtractJsonPaths(doc.RootElement, refs, path, baseDir, "json");
        }
        catch
        {
            foreach (var match in PathLikeRegex.Matches(File.ReadAllText(path)).Cast<Match>())
            {
                AddRef(refs, match.Value, path, baseDir, "json-text");
            }
        }
        return refs;
    }

    private static void ExtractJsonPaths(JsonElement el, List<RealityCheckRef> refs, string projectFile, string baseDir, string source)
    {
        switch (el.ValueKind)
        {
            case JsonValueKind.String:
                var s = el.GetString();
                if (LooksLikePath(s))
                    AddRef(refs, s!, projectFile, baseDir, source);
                break;
            case JsonValueKind.Array:
                foreach (var item in el.EnumerateArray())
                    ExtractJsonPaths(item, refs, projectFile, baseDir, source);
                break;
            case JsonValueKind.Object:
                foreach (var prop in el.EnumerateObject())
                {
                    if (prop.Name.Contains("path", StringComparison.OrdinalIgnoreCase)
                        || prop.Name.Contains("file", StringComparison.OrdinalIgnoreCase)
                        || prop.Name.Contains("asset", StringComparison.OrdinalIgnoreCase)
                        || prop.Name.Contains("sample", StringComparison.OrdinalIgnoreCase))
                    {
                        ExtractJsonPaths(prop.Value, refs, projectFile, baseDir, source);
                    }
                    else
                    {
                        ExtractJsonPaths(prop.Value, refs, projectFile, baseDir, source);
                    }
                }
                break;
        }
    }

    private static List<RealityCheckRef> ParseLineList(string path, string baseDir)
    {
        var refs = new List<RealityCheckRef>();
        foreach (var line in File.ReadAllLines(path))
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith("#", StringComparison.Ordinal)) continue;
            if (trimmed.StartsWith("file://", StringComparison.OrdinalIgnoreCase))
                trimmed = trimmed[7..];
            if (LooksLikePath(trimmed))
                AddRef(refs, trimmed, path, baseDir, "txt");
        }
        return refs;
    }

    private static List<RealityCheckRef> ParseXmlPaths(string path, string baseDir)
    {
        var refs = new List<RealityCheckRef>();
        var text = File.ReadAllText(path);
        foreach (Match m in XmlPathRegex.Matches(text))
        {
            var val = m.Groups[1].Value.Trim();
            if (LooksLikePath(val))
                AddRef(refs, val, path, baseDir, "xml");
        }
        return refs;
    }

    private static List<RealityCheckRef> ParseAlsXml(string path, string baseDir)
    {
        try
        {
            using var fs = File.OpenRead(path);
            using var gz = new GZipStream(fs, CompressionMode.Decompress);
            using var reader = new StreamReader(gz);
            var xml = reader.ReadToEnd();
            var refs = new List<RealityCheckRef>();
            foreach (Match m in XmlPathRegex.Matches(xml))
            {
                var val = m.Groups[1].Value.Trim();
                if (val.Length < 2) continue;
                AddRef(refs, val, path, baseDir, "als");
            }
            foreach (Match m in PathLikeRegex.Matches(xml))
            {
                AddRef(refs, m.Value, path, baseDir, "als-text");
            }
            return refs;
        }
        catch
        {
            return new List<RealityCheckRef>();
        }
    }

    private static void AddRef(List<RealityCheckRef> refs, string rawPath, string projectFile, string baseDir, string source)
    {
        var resolved = ResolveRefPath(rawPath, baseDir);
        if (string.IsNullOrWhiteSpace(resolved)) return;

        refs.Add(new RealityCheckRef
        {
            RefPath = rawPath,
            ResolvedPath = resolved,
            Exists = File.Exists(resolved) || Directory.Exists(resolved),
            Source = source,
            ProjectFile = projectFile,
        });
    }

    private static string ResolveRefPath(string raw, string baseDir)
    {
        var trimmed = raw.Trim().Trim('"', '\'');
        if (trimmed.StartsWith("file://", StringComparison.OrdinalIgnoreCase))
            trimmed = trimmed[7..];

        try
        {
            if (Path.IsPathRooted(trimmed))
                return Path.GetFullPath(trimmed);
            return Path.GetFullPath(Path.Combine(baseDir, trimmed));
        }
        catch
        {
            return trimmed;
        }
    }

    private static bool LooksLikePath(string? s)
    {
        if (string.IsNullOrWhiteSpace(s) || s.Length < 3) return false;
        if (s.Contains("http://", StringComparison.OrdinalIgnoreCase)
            || s.Contains("https://", StringComparison.OrdinalIgnoreCase))
            return false;
        if (Regex.IsMatch(s, @"^[A-Za-z]:\\")) return true;
        if (s.StartsWith(@"\\")) return true;
        if (s.StartsWith("./") || s.StartsWith(".\\") || s.StartsWith("../") || s.StartsWith("..\\")) return true;
        if (s.Contains('\\') || s.Contains('/')) return s.Contains('.') || s.Length > 8;
        return false;
    }

    private static string NormalizePath(string path)
    {
        try { return Path.GetFullPath(path.Trim()); }
        catch { return path.Trim(); }
    }
}
