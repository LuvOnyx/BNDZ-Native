using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

public sealed class FolderSizeProgress
{
    public int Current { get; set; }
    public int Total { get; set; }
    public string Path { get; set; } = "";
    public int Percent { get; set; }
    public long BytesScanned { get; set; }
}

public sealed class FolderSizeResult
{
    public Dictionary<string, long> Sizes { get; set; } = new();
    public bool Cancelled { get; set; }
    public int ScannedCount { get; set; }
    public int CachedCount { get; set; }
}

public sealed class FolderSizeService
{
    private readonly string _cachePath;
    private readonly object _cacheLock = new();
    private CancellationTokenSource? _scanCts;

    private sealed class CacheEntry
    {
        public long Size { get; set; }
        public long DirModifiedUtcTicks { get; set; }
        public long ScannedAtUtcTicks { get; set; }
    }

    public FolderSizeService()
    {
        string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BNDZ64");
        Directory.CreateDirectory(dir);
        _cachePath = Path.Combine(dir, "folder_sizes.json");
    }

    public void CancelScan()
    {
        try { _scanCts?.Cancel(); } catch { }
    }

    public async Task<FolderSizeResult> ScanFoldersAsync(
        IEnumerable<string> rawPaths,
        bool forceRescan,
        Action<FolderSizeProgress>? onProgress,
        CancellationToken externalCt = default)
    {
        _scanCts?.Cancel();
        _scanCts = CancellationTokenSource.CreateLinkedTokenSource(externalCt);
        var ct = _scanCts.Token;

        var paths = rawPaths
            .Select(NormalizePath)
            .Where(p => !string.IsNullOrEmpty(p) && Directory.Exists(p))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        var cache = LoadCache();
        var result = new FolderSizeResult();
        int total = paths.Count;
        int current = 0;

        foreach (var path in paths)
        {
            ct.ThrowIfCancellationRequested();
            current++;
            onProgress?.Invoke(new FolderSizeProgress
            {
                Current = current,
                Total = total,
                Path = path,
                Percent = total > 0 ? (int)((current - 1) * 100.0 / total) : 0
            });

            try
            {
                var dirInfo = new DirectoryInfo(path);
                long modifiedTicks = dirInfo.LastWriteTimeUtc.Ticks;

                if (!forceRescan && cache.TryGetValue(path, out var cached) && cached.DirModifiedUtcTicks == modifiedTicks)
                {
                    result.Sizes[path] = cached.Size;
                    result.CachedCount++;
                    continue;
                }

                long size = await Task.Run(() => ComputeDirectorySize(path, ct, bytes =>
                {
                    onProgress?.Invoke(new FolderSizeProgress
                    {
                        Current = current,
                        Total = total,
                        Path = path,
                        Percent = total > 0 ? (int)((current - 1) * 100.0 / total) : 0,
                        BytesScanned = bytes
                    });
                }), ct);

                cache[path] = new CacheEntry
                {
                    Size = size,
                    DirModifiedUtcTicks = modifiedTicks,
                    ScannedAtUtcTicks = DateTime.UtcNow.Ticks
                };
                result.Sizes[path] = size;
                result.ScannedCount++;
            }
            catch (OperationCanceledException)
            {
                result.Cancelled = true;
                break;
            }
            catch
            {
                result.Sizes[path] = -1;
            }
        }

        if (!result.Cancelled)
            SaveCache(cache);

        onProgress?.Invoke(new FolderSizeProgress
        {
            Current = current,
            Total = total,
            Path = "",
            Percent = result.Cancelled ? 0 : 100
        });

        return result;
    }

    public long? GetCachedSize(string path)
    {
        path = NormalizePath(path);
        var cache = LoadCache();
        if (!cache.TryGetValue(path, out var entry)) return null;
        if (!Directory.Exists(path)) return null;
        try
        {
            var ticks = new DirectoryInfo(path).LastWriteTimeUtc.Ticks;
            if (ticks != entry.DirModifiedUtcTicks) return null;
            return entry.Size;
        }
        catch { return null; }
    }

    private static long ComputeDirectorySize(string root, CancellationToken ct, Action<long>? onBytes)
    {
        long total = 0;
        var stack = new Stack<string>();
        stack.Push(root);

        while (stack.Count > 0)
        {
            ct.ThrowIfCancellationRequested();
            string dir = stack.Pop();
            try
            {
                foreach (var file in Directory.EnumerateFiles(dir))
                {
                    ct.ThrowIfCancellationRequested();
                    try
                    {
                        total += new FileInfo(file).Length;
                        onBytes?.Invoke(total);
                    }
                    catch { }
                }
                foreach (var sub in Directory.EnumerateDirectories(dir))
                {
                    ct.ThrowIfCancellationRequested();
                    stack.Push(sub);
                }
            }
            catch { }
        }
        return total;
    }

    private Dictionary<string, CacheEntry> LoadCache()
    {
        lock (_cacheLock)
        {
            try
            {
                if (!File.Exists(_cachePath)) return new Dictionary<string, CacheEntry>(StringComparer.OrdinalIgnoreCase);
                var json = File.ReadAllText(_cachePath);
                return JsonSerializer.Deserialize<Dictionary<string, CacheEntry>>(json)
                    ?? new Dictionary<string, CacheEntry>(StringComparer.OrdinalIgnoreCase);
            }
            catch
            {
                return new Dictionary<string, CacheEntry>(StringComparer.OrdinalIgnoreCase);
            }
        }
    }

    private void SaveCache(Dictionary<string, CacheEntry> cache)
    {
        lock (_cacheLock)
        {
            try
            {
                var json = JsonSerializer.Serialize(cache, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_cachePath, json);
            }
            catch { }
        }
    }

    private static string NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        if (path.StartsWith("/")) path = path[1..];
        path = path.Replace('/', '\\');
        while (path.Contains("\\\\")) path = path.Replace("\\\\", "\\");
        if (path.Length == 2 && path[1] == ':') path += "\\";
        return path;
    }
}
