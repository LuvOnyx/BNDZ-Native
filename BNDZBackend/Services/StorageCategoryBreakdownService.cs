using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>
/// Fast multi-segment storage breakdown by extension/kind.
/// Extension + size only (no hashing). Soft time/file budgets, skip system dirs on drive roots,
/// stream progress, cache last result per path.
/// </summary>
public sealed class StorageBreakdownProgress
{
    public int Percent { get; set; }
    public string Phase { get; set; } = "";
    public string CurrentPath { get; set; } = "";
    public int FilesSeen { get; set; }
    public long BytesSeen { get; set; }
    public bool Partial { get; set; }
}

public sealed class StorageBreakdownTopItem
{
    public string Path { get; set; } = "";
    public string Name { get; set; } = "";
    public long Size { get; set; }
    public bool IsDirectory { get; set; }
}

public sealed class StorageBreakdownSegment
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Color { get; set; } = "#6b7280";
    public long TotalBytes { get; set; }
    public int FileCount { get; set; }
    public double Percent { get; set; }
    public List<StorageBreakdownTopItem> TopItems { get; set; } = new();
}

public sealed class StorageBreakdownResult
{
    public string RootPath { get; set; } = "";
    public List<StorageBreakdownSegment> Segments { get; set; } = new();
    public long TotalBytes { get; set; }
    public int FilesSeen { get; set; }
    public bool Partial { get; set; }
    public bool Cancelled { get; set; }
    public bool FromCache { get; set; }
    public bool DriveRootLimited { get; set; }
    public string? Warning { get; set; }
    public int ElapsedMs { get; set; }
}

public sealed class StorageCategoryBreakdownService
{
    public const int DefaultTimeBudgetMs = 12_000;
    public const int DefaultMaxFiles = 80_000;
    public const int DriveRootMaxDepth = 4;
    public const int TopN = 5;
    private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(8);

    private static readonly HashSet<string> SkipDirNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "WinSxS", "Installer", "$Recycle.Bin", "System Volume Information",
        "Windows.old", "$WINDOWS.~BT", "$WINDOWS.~WS", "Temp", "tmp",
        "node_modules", ".git", ".svn", "CSCACHE", "packages",
    };

    private readonly ConcurrentDictionary<string, (StorageBreakdownResult Result, DateTime Utc)> _cache =
        new(StringComparer.OrdinalIgnoreCase);
    private CancellationTokenSource? _cts;
    private readonly object _gate = new();

    public void CancelScan()
    {
        try { _cts?.Cancel(); } catch { /* ignore */ }
    }

    public async Task<StorageBreakdownResult> ScanAsync(
        string rootPath,
        int? timeBudgetMs,
        int? maxFiles,
        bool forceRescan,
        Action<StorageBreakdownProgress>? onProgress,
        CancellationToken externalCt = default)
    {
        string root = Normalize(rootPath);
        if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
        {
            return new StorageBreakdownResult
            {
                RootPath = root ?? "",
                Warning = "Path not found",
            };
        }

        string cacheKey = root.TrimEnd('\\').ToLowerInvariant();
        if (!forceRescan && _cache.TryGetValue(cacheKey, out var hit) && DateTime.UtcNow - hit.Utc < CacheTtl)
        {
            var cached = CloneResult(hit.Result);
            cached.FromCache = true;
            onProgress?.Invoke(new StorageBreakdownProgress
            {
                Percent = 100,
                Phase = "Cached",
                CurrentPath = root,
                FilesSeen = cached.FilesSeen,
                BytesSeen = cached.TotalBytes,
            });
            return cached;
        }

        CancellationTokenSource linked;
        lock (_gate)
        {
            try { _cts?.Cancel(); } catch { /* ignore */ }
            _cts = CancellationTokenSource.CreateLinkedTokenSource(externalCt);
            linked = _cts;
        }
        var ct = linked.Token;

        int budgetMs = Math.Clamp(timeBudgetMs ?? DefaultTimeBudgetMs, 2_000, 60_000);
        int fileCap = Math.Clamp(maxFiles ?? DefaultMaxFiles, 2_000, 500_000);
        bool driveRoot = IsDriveRoot(root);
        int maxDepth = driveRoot ? DriveRootMaxDepth : int.MaxValue;

        var result = await Task.Run(() => Walk(root, budgetMs, fileCap, maxDepth, driveRoot, onProgress, ct), CancellationToken.None)
            .ConfigureAwait(false);

        if (!result.Cancelled)
            _cache[cacheKey] = (CloneResult(result), DateTime.UtcNow);

        return result;
    }

    private static StorageBreakdownResult Walk(
        string root,
        int budgetMs,
        int fileCap,
        int maxDepth,
        bool driveRoot,
        Action<StorageBreakdownProgress>? onProgress,
        CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();
        var buckets = CreateBuckets();
        var topHeaps = buckets.Keys.ToDictionary(
            k => k,
            _ => new List<StorageBreakdownTopItem>(),
            StringComparer.OrdinalIgnoreCase);

        int filesSeen = 0;
        long bytesSeen = 0;
        bool partial = false;
        bool cancelled = false;
        string current = root;
        int lastPct = -1;

        var stack = new Stack<(string Path, int Depth)>();
        stack.Push((root, 0));

        void Report(string phase, bool force = false)
        {
            int pctTime = (int)(sw.ElapsedMilliseconds * 100.0 / Math.Max(1, budgetMs));
            int pctFiles = (int)(filesSeen * 100.0 / Math.Max(1, fileCap));
            int pct = Math.Min(99, Math.Max(pctTime, pctFiles));
            if (!force && pct == lastPct && filesSeen % 250 != 0) return;
            lastPct = pct;
            onProgress?.Invoke(new StorageBreakdownProgress
            {
                Percent = pct,
                Phase = phase,
                CurrentPath = current,
                FilesSeen = filesSeen,
                BytesSeen = bytesSeen,
                Partial = partial,
            });
        }

        Report("Scanning", true);

        try
        {
            while (stack.Count > 0)
            {
                ct.ThrowIfCancellationRequested();
                if (sw.ElapsedMilliseconds >= budgetMs || filesSeen >= fileCap)
                {
                    partial = true;
                    break;
                }

                var (dir, depth) = stack.Pop();
                current = dir;

                IEnumerable<string> files;
                try { files = Directory.EnumerateFiles(dir); }
                catch { continue; }

                foreach (var file in files)
                {
                    ct.ThrowIfCancellationRequested();
                    if (sw.ElapsedMilliseconds >= budgetMs || filesSeen >= fileCap)
                    {
                        partial = true;
                        break;
                    }

                    try
                    {
                        var fi = new FileInfo(file);
                        long size = fi.Length;
                        string cat = Classify(fi.Name);
                        buckets[cat].TotalBytes += size;
                        buckets[cat].FileCount++;
                        filesSeen++;
                        bytesSeen += size;
                        ConsiderTop(topHeaps[cat], file, fi.Name, size);
                    }
                    catch { /* locked / access */ }
                }

                if (partial) break;
                if (depth >= maxDepth) continue;

                IEnumerable<string> subs;
                try { subs = Directory.EnumerateDirectories(dir); }
                catch { continue; }

                foreach (var sub in subs)
                {
                    ct.ThrowIfCancellationRequested();
                    string name = Path.GetFileName(sub);
                    if (ShouldSkipDir(name, driveRoot, depth)) continue;
                    stack.Push((sub, depth + 1));
                }

                if (filesSeen % 400 == 0) Report("Scanning");
            }
        }
        catch (OperationCanceledException)
        {
            cancelled = true;
            partial = true;
        }

        long total = buckets.Values.Sum(b => b.TotalBytes);
        var segments = new List<StorageBreakdownSegment>();
        foreach (var b in buckets.Values.OrderByDescending(x => x.TotalBytes))
        {
            if (b.TotalBytes <= 0 && b.FileCount <= 0) continue;
            b.Percent = total > 0 ? (b.TotalBytes * 100.0 / total) : 0;
            b.TopItems = topHeaps[b.Id]
                .OrderByDescending(t => t.Size)
                .Take(TopN)
                .ToList();
            segments.Add(b);
        }

        onProgress?.Invoke(new StorageBreakdownProgress
        {
            Percent = cancelled ? Math.Max(0, lastPct) : 100,
            Phase = cancelled ? "Cancelled" : (partial ? "Partial" : "Done"),
            CurrentPath = current,
            FilesSeen = filesSeen,
            BytesSeen = bytesSeen,
            Partial = partial,
        });

        string? warning = null;
        if (driveRoot)
            warning = "Drive root scan is depth-limited and skips system folders so the app stays responsive.";
        else if (partial && !cancelled)
            warning = "Sampled scan — results are partial (time or file budget reached).";

        return new StorageBreakdownResult
        {
            RootPath = root,
            Segments = segments,
            TotalBytes = total,
            FilesSeen = filesSeen,
            Partial = partial,
            Cancelled = cancelled,
            DriveRootLimited = driveRoot,
            Warning = warning,
            ElapsedMs = (int)sw.ElapsedMilliseconds,
        };
    }

    private static Dictionary<string, StorageBreakdownSegment> CreateBuckets() => new(StringComparer.OrdinalIgnoreCase)
    {
        ["media"] = new() { Id = "media", Name = "Media", Color = "#c084fc" },
        ["documents"] = new() { Id = "documents", Name = "Documents", Color = "#fbbf24" },
        ["archives"] = new() { Id = "archives", Name = "Archives", Color = "#fb923c" },
        ["installers"] = new() { Id = "installers", Name = "Apps / Installers", Color = "#38bdf8" },
        ["audio"] = new() { Id = "audio", Name = "Audio", Color = "#2dd4bf" },
        ["other"] = new() { Id = "other", Name = "Other", Color = "#94a3b8" },
    };

    private static string Classify(string fileName)
    {
        string ext = Path.GetExtension(fileName).ToLowerInvariant();
        return ext switch
        {
            ".png" or ".jpg" or ".jpeg" or ".gif" or ".bmp" or ".webp" or ".svg" or ".ico"
                or ".heic" or ".tif" or ".tiff" or ".raw" or ".cr2" or ".nef" or ".arw"
                or ".mp4" or ".mkv" or ".avi" or ".mov" or ".wmv" or ".webm" or ".m4v"
                or ".mpeg" or ".mpg" or ".flv" or ".3gp" => "media",

            ".pdf" or ".doc" or ".docx" or ".xls" or ".xlsx" or ".ppt" or ".pptx"
                or ".txt" or ".rtf" or ".odt" or ".ods" or ".odp" or ".csv" or ".md"
                or ".epub" or ".pages" or ".numbers" or ".key" => "documents",

            ".zip" or ".rar" or ".7z" or ".tar" or ".gz" or ".bz2" or ".xz"
                or ".tgz" or ".iso" or ".img" or ".cab" or ".lz4" => "archives",

            ".exe" or ".msi" or ".msix" or ".appx" or ".msixbundle" or ".appxbundle"
                or ".bat" or ".cmd" or ".ps1" or ".dmg" or ".pkg" or ".deb" or ".rpm"
                or ".apk" or ".ipa" or ".msu" or ".msp" => "installers",

            ".mp3" or ".wav" or ".flac" or ".aac" or ".ogg" or ".m4a" or ".wma"
                or ".aiff" or ".aif" or ".opus" or ".mid" or ".midi" => "audio",

            _ => "other",
        };
    }

    private static void ConsiderTop(List<StorageBreakdownTopItem> list, string path, string name, long size)
    {
        if (size <= 0) return;
        if (list.Count < TopN)
        {
            list.Add(new StorageBreakdownTopItem { Path = path, Name = name, Size = size });
            return;
        }

        int minIdx = 0;
        for (int i = 1; i < list.Count; i++)
            if (list[i].Size < list[minIdx].Size) minIdx = i;
        if (size <= list[minIdx].Size) return;
        list[minIdx] = new StorageBreakdownTopItem { Path = path, Name = name, Size = size };
    }

    private static bool ShouldSkipDir(string name, bool driveRoot, int depth)
    {
        if (string.IsNullOrEmpty(name)) return true;
        if (name.StartsWith('$') && depth <= 1) return true;
        if (SkipDirNames.Contains(name)) return true;
        if (driveRoot && depth <= 1)
        {
            string lower = name.ToLowerInvariant();
            if (lower is "windows" or "programdata" or "recovery" or "perflogs" or "documents and settings")
                return true;
        }
        return false;
    }

    private static bool IsDriveRoot(string path)
    {
        try
        {
            var full = Path.GetFullPath(path).TrimEnd('\\') + "\\";
            return full.Length == 3 && char.IsLetter(full[0]) && full[1] == ':' && full[2] == '\\';
        }
        catch { return false; }
    }

    private static string Normalize(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        path = path.Replace('/', '\\').Trim();
        if (path.StartsWith(@"\\?\", StringComparison.Ordinal)) path = path[4..];
        if (path.Length == 2 && path[1] == ':') path += "\\";
        return path;
    }

    private static StorageBreakdownResult CloneResult(StorageBreakdownResult src) => new()
    {
        RootPath = src.RootPath,
        Segments = src.Segments.Select(s => new StorageBreakdownSegment
        {
            Id = s.Id,
            Name = s.Name,
            Color = s.Color,
            TotalBytes = s.TotalBytes,
            FileCount = s.FileCount,
            Percent = s.Percent,
            TopItems = s.TopItems.Select(t => new StorageBreakdownTopItem
            {
                Path = t.Path,
                Name = t.Name,
                Size = t.Size,
                IsDirectory = t.IsDirectory,
            }).ToList(),
        }).ToList(),
        TotalBytes = src.TotalBytes,
        FilesSeen = src.FilesSeen,
        Partial = src.Partial,
        Cancelled = src.Cancelled,
        FromCache = src.FromCache,
        DriveRootLimited = src.DriveRootLimited,
        Warning = src.Warning,
        ElapsedMs = src.ElapsedMs,
    };
}
