using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

public sealed class CleanupScanProgress
{
    public int Percent { get; set; }
    public string Phase { get; set; } = "";
    public string CurrentPath { get; set; } = "";
}

public sealed class CleanupScanItem
{
    public string Id { get; set; } = "";
    public string Path { get; set; } = "";
    public string Name { get; set; } = "";
    public long Size { get; set; }
    public bool IsDirectory { get; set; }
    public string Detail { get; set; } = "";
    public bool DefaultSelected { get; set; } = true;
}

public sealed class CleanupScanCategory
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Description { get; set; } = "";
    /// <summary>safe | moderate | advanced</summary>
    public string Risk { get; set; } = "safe";
    public long TotalBytes { get; set; }
    public int ItemCount { get; set; }
    public List<CleanupScanItem> Items { get; set; } = new();
}

public sealed class CleanupScanResult
{
    public List<CleanupScanCategory> Categories { get; set; } = new();
    public long TotalBytes { get; set; }
    public bool Cancelled { get; set; }
}

public sealed class StorageCleanupScanService
{
    private const int MaxItemsPerCategory = 400;
    private const int MaxDepth = 6;
    private CancellationTokenSource? _scanCts;

    public void CancelScan()
    {
        try { _scanCts?.Cancel(); } catch { }
    }

    public async Task<CleanupScanResult> ScanAsync(
        string[]? categoryIds,
        long largeFileMinBytes,
        int largeFileLimit,
        Action<CleanupScanProgress>? onProgress,
        CancellationToken externalCt = default)
    {
        _scanCts?.Cancel();
        _scanCts = CancellationTokenSource.CreateLinkedTokenSource(externalCt);
        var ct = _scanCts.Token;

        var want = categoryIds is { Length: > 0 }
            ? new HashSet<string>(categoryIds, StringComparer.OrdinalIgnoreCase)
            : null;

        var result = new CleanupScanResult();
        var phases = BuildPhaseList(want);
        int phaseIndex = 0;

        void Report(string phase, string path, int localPct)
        {
            var pct = phases.Count == 0 ? 0 : (int)Math.Clamp((phaseIndex * 100.0 / phases.Count) + localPct / (double)phases.Count, 0, 99);
            onProgress?.Invoke(new CleanupScanProgress { Percent = pct, Phase = phase, CurrentPath = path });
        }

        await Task.Run(() =>
        {
            foreach (var phase in phases)
            {
                ct.ThrowIfCancellationRequested();
                phaseIndex++;
                CleanupScanCategory? cat = phase switch
                {
                    "user_temp" => ScanFolderCategory("user_temp", "User temp files", "Temporary files in your user TEMP folder", "safe",
                        ExpandEnv("%TEMP%"), recursive: true, risk: "safe", defaultSelected: true, Report),
                    "windows_temp" => ScanFolderCategory("windows_temp", "Windows temp", "System temp folder (requires admin for some files)", "moderate",
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "Temp"), recursive: true, risk: "moderate", defaultSelected: false, Report),
                    "recycle_bin" => ScanRecycleBin(Report),
                    "thumbnail_cache" => ScanFolderCategory("thumbnail_cache", "Thumbnail & icon cache", "BNDZ and Windows Explorer thumbnail caches", "safe",
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "Cache"), recursive: true, risk: "safe", defaultSelected: true, Report, extraRoots:
                        [
                            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Windows", "Explorer"),
                            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BNDZ64", "thumbcache"),
                        ]),
                    "browser_chrome" => ScanBrowserCache("browser_chrome", "Google Chrome cache", "Chrome browser disk cache", "chrome", Report),
                    "browser_edge" => ScanBrowserCache("browser_edge", "Microsoft Edge cache", "Edge browser disk cache", "edge", Report),
                    "browser_firefox" => ScanFirefoxCache(Report),
                    "crash_dumps" => ScanFolderCategory("crash_dumps", "Crash dumps", "Application crash dump files", "moderate",
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CrashDumps"), recursive: false, risk: "moderate", defaultSelected: false, Report),
                    "recent_shortcuts" => ScanFolderCategory("recent_shortcuts", "Recent items", "Windows recent shortcuts (.lnk)", "safe",
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Recent)), recursive: false, risk: "safe", defaultSelected: true, Report, fileFilter: f => f.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase)),
                    "downloads_temp" => ScanFolderCategory("downloads_temp", "Downloads clutter", "Partial downloads and .tmp in Downloads", "moderate",
                        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"), recursive: true, risk: "moderate", defaultSelected: false, Report,
                        fileFilter: f => f.EndsWith(".tmp", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".partial", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".crdownload", StringComparison.OrdinalIgnoreCase)),
                    "large_files" => ScanLargeFiles(largeFileMinBytes, largeFileLimit, Report, ct),
                    "large_folders" => ScanLargeFolders(Report, ct),
                    "empty_folders" => ScanEmptyFolders(Report, ct),
                    _ => null,
                };

                if (cat != null && cat.ItemCount > 0)
                {
                    result.Categories.Add(cat);
                    result.TotalBytes += cat.TotalBytes;
                }
            }
        }, ct).ConfigureAwait(false);

        onProgress?.Invoke(new CleanupScanProgress { Percent = 100, Phase = "Complete", CurrentPath = "" });
        return result;
    }

    private static List<string> BuildPhaseList(HashSet<string>? want)
    {
        var all = new[]
        {
            "user_temp", "windows_temp", "recycle_bin", "thumbnail_cache",
            "browser_chrome", "browser_edge", "browser_firefox",
            "crash_dumps", "recent_shortcuts", "downloads_temp",
            "large_files", "large_folders", "empty_folders",
        };
        if (want == null) return all.ToList();
        return all.Where(want.Contains).ToList();
    }

    private static string ExpandEnv(string path)
    {
        try { return Environment.ExpandEnvironmentVariables(path); }
        catch { return path; }
    }

    private CleanupScanCategory ScanFolderCategory(
        string id, string name, string description, string riskLabel,
        string root, bool recursive, string risk, bool defaultSelected,
        Action<string, string, int> report,
        string[]? extraRoots = null,
        Func<string, bool>? fileFilter = null)
    {
        var cat = new CleanupScanCategory { Id = id, Name = name, Description = description, Risk = risk };
        var roots = new List<string>();
        if (!string.IsNullOrWhiteSpace(root)) roots.Add(root);
        if (extraRoots != null) roots.AddRange(extraRoots.Where(r => !string.IsNullOrWhiteSpace(r)));

        long total = 0;
        int count = 0;
        foreach (var r in roots.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(r)) continue;
            try
            {
                if (!recursive)
                {
                    foreach (var file in Directory.EnumerateFiles(r))
                    {
                        if (fileFilter != null && !fileFilter(file)) continue;
                        report(name, file, 50);
                        try
                        {
                            var fi = new FileInfo(file);
                            if (!fi.Exists) continue;
                            total += fi.Length;
                            count++;
                            if (cat.Items.Count < MaxItemsPerCategory)
                            {
                                cat.Items.Add(new CleanupScanItem
                                {
                                    Id = $"{id}:{file}",
                                    Path = file,
                                    Name = fi.Name,
                                    Size = fi.Length,
                                    IsDirectory = false,
                                    Detail = FormatAge(fi.LastWriteTimeUtc),
                                    DefaultSelected = defaultSelected,
                                });
                            }
                        }
                        catch { /* skip locked */ }
                    }
                }
                else
                {
                    WalkDirectory(r, 0, (path, size, isDir) =>
                    {
                        if (fileFilter != null && !isDir && !fileFilter(path)) return;
                        total += size;
                        count++;
                        if (cat.Items.Count < MaxItemsPerCategory)
                        {
                            cat.Items.Add(new CleanupScanItem
                            {
                                Id = $"{id}:{path}",
                                Path = path,
                                Name = Path.GetFileName(path) ?? path,
                                Size = size,
                                IsDirectory = isDir,
                                DefaultSelected = defaultSelected,
                            });
                        }
                        if (count % 40 == 0) report(name, path, 50);
                    });
                }
            }
            catch { /* access denied */ }
        }

        cat.TotalBytes = total;
        cat.ItemCount = count;
        return cat;
    }

    private void WalkDirectory(string root, int depth, Action<string, long, bool> onItem)
    {
        if (depth > MaxDepth) return;
        try
        {
            foreach (var file in Directory.EnumerateFiles(root))
            {
                try
                {
                    var fi = new FileInfo(file);
                    if (fi.Exists) onItem(file, fi.Length, false);
                }
                catch { }
            }
            foreach (var dir in Directory.EnumerateDirectories(root))
            {
                try
                {
                    var di = new DirectoryInfo(dir);
                    long dirSize = 0;
                    try { dirSize = DirSizeQuick(di, depth + 1); } catch { }
                    onItem(dir, dirSize, true);
                    WalkDirectory(dir, depth + 1, onItem);
                }
                catch { }
            }
        }
        catch { }
    }

    private static long DirSizeQuick(DirectoryInfo dir, int depth)
    {
        if (depth > 3) return 0;
        long sum = 0;
        try
        {
            foreach (var f in dir.EnumerateFiles()) { try { sum += f.Length; } catch { } }
            if (depth < 3)
                foreach (var d in dir.EnumerateDirectories()) { try { sum += DirSizeQuick(d, depth + 1); } catch { } }
        }
        catch { }
        return sum;
    }

    private CleanupScanCategory ScanRecycleBin(Action<string, string, int> report)
    {
        var cat = new CleanupScanCategory
        {
            Id = "recycle_bin",
            Name = "Recycle Bin",
            Description = "Files waiting in the Recycle Bin — emptying is reversible until purged",
            Risk = "safe",
        };
        report("Recycle Bin", "", 10);
        try
        {
            var items = RecycleBinService.GetContentsAsync().GetAwaiter().GetResult();
            long total = 0;
            foreach (var obj in items)
            {
                try
                {
                    var t = obj.GetType();
                    long size = 0;
                    var sizeProp = t.GetProperty("size");
                    if (sizeProp?.GetValue(obj) is long sl) size = sl;
                    else if (sizeProp?.GetValue(obj) is int si) size = si;
                    var path = t.GetProperty("path")?.GetValue(obj) as string ?? "";
                    var name = t.GetProperty("name")?.GetValue(obj) as string ?? "Item";
                    var type = t.GetProperty("type")?.GetValue(obj) as string ?? "";
                    total += size;
                    if (cat.Items.Count < MaxItemsPerCategory)
                    {
                        cat.Items.Add(new CleanupScanItem
                        {
                            Id = $"recycle:{path}",
                            Path = path,
                            Name = name,
                            Size = size,
                            IsDirectory = type == "directory",
                            DefaultSelected = true,
                        });
                    }
                }
                catch { }
            }
            cat.TotalBytes = total;
            cat.ItemCount = items.Count;
        }
        catch { }
        return cat;
    }

    private CleanupScanCategory ScanBrowserCache(string id, string name, string desc, string browser, Action<string, string, int> report)
    {
        var local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        string? cacheRoot = browser switch
        {
            "chrome" => FindFirstExistingDir(local, @"Google\Chrome\User Data\Default\Cache", @"Google\Chrome\User Data\Default\Code Cache"),
            "edge" => FindFirstExistingDir(local, @"Microsoft\Edge\User Data\Default\Cache", @"Microsoft\Edge\User Data\Default\Code Cache"),
            _ => null,
        };
        if (cacheRoot == null)
            return new CleanupScanCategory { Id = id, Name = name, Description = desc, Risk = "moderate" };

        return ScanFolderCategory(id, name, desc, "moderate", cacheRoot, recursive: true, risk: "moderate", defaultSelected: false, report);
    }

    private CleanupScanCategory ScanFirefoxCache(Action<string, string, int> report)
    {
        var profiles = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Mozilla", "Firefox", "Profiles");
        if (!Directory.Exists(profiles))
            return new CleanupScanCategory { Id = "browser_firefox", Name = "Firefox cache", Description = "Firefox disk cache", Risk = "moderate" };

        var cat = new CleanupScanCategory { Id = "browser_firefox", Name = "Firefox cache", Description = "Firefox browser cache2 folders", Risk = "moderate" };
        long total = 0;
        int count = 0;
        foreach (var profile in Directory.EnumerateDirectories(profiles))
        {
            var cache2 = Path.Combine(profile, "cache2");
            if (!Directory.Exists(cache2)) continue;
            WalkDirectory(cache2, 0, (path, size, isDir) =>
            {
                total += size;
                count++;
                if (cat.Items.Count < MaxItemsPerCategory)
                    cat.Items.Add(new CleanupScanItem { Id = $"ff:{path}", Path = path, Name = Path.GetFileName(path) ?? path, Size = size, IsDirectory = isDir, DefaultSelected = false });
            });
        }
        cat.TotalBytes = total;
        cat.ItemCount = count;
        return cat;
    }

    private CleanupScanCategory ScanLargeFiles(long minBytes, int limit, Action<string, string, int> report, CancellationToken ct)
    {
        var cat = new CleanupScanCategory
        {
            Id = "large_files",
            Name = "Large files",
            Description = $"Files larger than {FormatBytes(minBytes)} on indexed drives",
            Risk = "advanced",
        };
        report("Large files", "", 20);
        try
        {
            var index = BndzFileIndexService.Instance;
            var rows = index.GetLargeFiles(Math.Min(limit, 500), minBytes);
            long total = 0;
            foreach (var row in rows)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    dynamic d = row;
                    string path = d.path ?? "";
                    string name = d.name ?? Path.GetFileName(path) ?? "file";
                    long size = d.size ?? 0L;
                    total += size;
                    cat.Items.Add(new CleanupScanItem
                    {
                        Id = $"large:{path}",
                        Path = path,
                        Name = name,
                        Size = size,
                        IsDirectory = false,
                        DefaultSelected = false,
                    });
                }
                catch { }
            }
            cat.TotalBytes = total;
            cat.ItemCount = cat.Items.Count;
        }
        catch
        {
            // Index may be empty — scan user profile top-level large files as fallback
            ScanUserProfileLargeFiles(cat, minBytes, limit, report, ct);
        }
        return cat;
    }

    private void ScanUserProfileLargeFiles(CleanupScanCategory cat, long minBytes, int limit, Action<string, string, int> report, CancellationToken ct)
    {
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Documents"),
        };
        int found = 0;
        foreach (var root in roots.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(root) || found >= limit) break;
            try
            {
                foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
                {
                    ct.ThrowIfCancellationRequested();
                    if (found >= limit) break;
                    try
                    {
                        var fi = new FileInfo(file);
                        if (!fi.Exists || fi.Length < minBytes) continue;
                        cat.Items.Add(new CleanupScanItem
                        {
                            Id = $"large:{file}",
                            Path = file,
                            Name = fi.Name,
                            Size = fi.Length,
                            DefaultSelected = false,
                        });
                        cat.TotalBytes += fi.Length;
                        found++;
                        if (found % 10 == 0) report("Large files", file, 60);
                    }
                    catch { }
                }
            }
            catch { }
        }
        cat.ItemCount = cat.Items.Count;
    }

    private CleanupScanCategory ScanLargeFolders(Action<string, string, int> report, CancellationToken ct)
    {
        var cat = new CleanupScanCategory
        {
            Id = "large_folders",
            Name = "Large folders",
            Description = "Heavy folders in your user profile (top-level scan)",
            Risk = "advanced",
        };
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (!Directory.Exists(profile)) return cat;

        var candidates = new List<(string path, long size)>();
        try
        {
            foreach (var dir in Directory.EnumerateDirectories(profile))
            {
                ct.ThrowIfCancellationRequested();
                report("Large folders", dir, 40);
                try
                {
                    var size = DirSizeQuick(new DirectoryInfo(dir), 0);
                    if (size > 50 * 1024 * 1024)
                        candidates.Add((dir, size));
                }
                catch { }
            }
        }
        catch { }

        foreach (var (path, size) in candidates.OrderByDescending(c => c.size).Take(32))
        {
            cat.Items.Add(new CleanupScanItem
            {
                Id = $"lfolder:{path}",
                Path = path,
                Name = Path.GetFileName(path) ?? path,
                Size = size,
                IsDirectory = true,
                DefaultSelected = false,
            });
            cat.TotalBytes += size;
        }
        cat.ItemCount = cat.Items.Count;
        return cat;
    }

    private CleanupScanCategory ScanEmptyFolders(Action<string, string, int> report, CancellationToken ct)
    {
        var cat = new CleanupScanCategory
        {
            Id = "empty_folders",
            Name = "Empty folders",
            Description = "Folders with no files (limited depth scan in Downloads, Temp, Documents)",
            Risk = "moderate",
        };
        var roots = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"),
            ExpandEnv("%TEMP%"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)),
        };
        int found = 0;
        foreach (var root in roots.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            if (!Directory.Exists(root)) continue;
            FindEmptyFolders(root, 0, cat, ref found, report, ct);
            if (found >= 200) break;
        }
        cat.ItemCount = cat.Items.Count;
        return cat;
    }

    private void FindEmptyFolders(string root, int depth, CleanupScanCategory cat, ref int found, Action<string, string, int> report, CancellationToken ct)
    {
        if (depth > 5 || found >= 200) return;
        try
        {
            foreach (var dir in Directory.EnumerateDirectories(root))
            {
                ct.ThrowIfCancellationRequested();
                bool hasFiles = false;
                try { hasFiles = Directory.EnumerateFileSystemEntries(dir).Any(); } catch { continue; }
                if (!hasFiles)
                {
                    found++;
                    cat.Items.Add(new CleanupScanItem
                    {
                        Id = $"empty:{dir}",
                        Path = dir,
                        Name = Path.GetFileName(dir) ?? dir,
                        Size = 0,
                        IsDirectory = true,
                        DefaultSelected = true,
                    });
                    report("Empty folders", dir, 70);
                }
                else
                {
                    FindEmptyFolders(dir, depth + 1, cat, ref found, report, ct);
                }
            }
        }
        catch { }
    }

    private static string? FindFirstExistingDir(string root, params string[] parts)
    {
        foreach (var p in parts)
        {
            var full = Path.Combine(root, p);
            if (Directory.Exists(full)) return full;
        }
        return null;
    }

    private static string FormatAge(DateTime utc) =>
        utc == default ? "" : $"{(DateTime.UtcNow - utc).TotalDays:F0}d ago";

    private static string FormatBytes(long bytes)
    {
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        double v = bytes;
        int u = 0;
        while (v >= 1024 && u < units.Length - 1) { v /= 1024; u++; }
        return $"{v:F1} {units[u]}";
    }

    public sealed class CleanupExecuteItem
    {
        public string CategoryId { get; set; } = "";
        public string Path { get; set; } = "";
        public bool IsDirectory { get; set; }
        public long Size { get; set; }
    }

    public sealed class CleanupExecuteResult
    {
        public int ProcessedCount { get; set; }
        public long FreedBytes { get; set; }
        public List<string> Errors { get; set; } = new();
    }

    public static async Task<CleanupExecuteResult> ExecuteCleanupAsync(IReadOnlyList<CleanupExecuteItem> items, IntPtr hwnd)
    {
        var result = new CleanupExecuteResult();
        var recycleRequested = items.Any(i => i.CategoryId == "recycle_bin");
        var thumbRequested = items.Any(i => i.CategoryId == "thumbnail_cache" && i.Path.Contains("BNDZ", StringComparison.OrdinalIgnoreCase));

        if (thumbRequested)
        {
            try
            {
                var clear = ThumbnailCacheService.ClearAll();
                result.ProcessedCount += clear.FilesRemoved;
                result.FreedBytes += clear.BytesFreed;
            }
            catch (Exception ex) { result.Errors.Add($"Thumbnail cache: {ex.Message}"); }
        }

        foreach (var item in items)
        {
            if (item.CategoryId == "recycle_bin") continue;
            if (item.CategoryId == "thumbnail_cache" && item.Path.Contains("BNDZ", StringComparison.OrdinalIgnoreCase)) continue;
            try
            {
                if (item.IsDirectory)
                {
                    if (Directory.Exists(item.Path))
                    {
                        Directory.Delete(item.Path, recursive: true);
                        result.ProcessedCount++;
                        result.FreedBytes += item.Size;
                    }
                }
                else if (File.Exists(item.Path))
                {
                    var len = new FileInfo(item.Path).Length;
                    File.Delete(item.Path);
                    result.ProcessedCount++;
                    result.FreedBytes += len;
                }
            }
            catch (Exception ex)
            {
                result.Errors.Add($"{item.Path}: {ex.Message}");
            }
            await Task.Yield();
        }

        if (recycleRequested)
        {
            try
            {
                if (RecycleBinService.Empty(hwnd))
                    result.ProcessedCount++;
                else
                    result.Errors.Add("Recycle Bin: empty operation failed");
            }
            catch (Exception ex) { result.Errors.Add($"Recycle Bin: {ex.Message}"); }
        }

        return result;
    }
}
