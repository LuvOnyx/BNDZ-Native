using System;
using System.Buffers;
using System.Collections.Generic;
using System.IO;
using System.IO.Hashing;
using System.Linq;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

public sealed class DuplicateScanProgress
{
    public int FilesScanned { get; set; }
    public int TotalFiles { get; set; }
    public string CurrentPath { get; set; } = "";
    public int Percent { get; set; }
}

public sealed class DuplicateGroup
{
    public string Hash { get; set; } = "";
    public long Size { get; set; }
    public List<string> Paths { get; set; } = new();
}

public sealed class DuplicateScanResult
{
    public List<DuplicateGroup> Groups { get; set; } = new();
    public bool Cancelled { get; set; }
}

public sealed class DuplicateFinderService
{
    private CancellationTokenSource? _scanCts;

    public void CancelScan()
    {
        try { _scanCts?.Cancel(); } catch { }
    }

    public async Task<DuplicateScanResult> ScanAsync(
        string rawRoot,
        bool recursive,
        long minSizeBytes,
        Action<DuplicateScanProgress>? onProgress,
        CancellationToken externalCt = default)
    {
        _scanCts?.Cancel();
        _scanCts = CancellationTokenSource.CreateLinkedTokenSource(externalCt);
        var ct = _scanCts.Token;

        var root = NormalizePath(rawRoot);
        var result = new DuplicateScanResult();
        if (string.IsNullOrEmpty(root) || !Directory.Exists(root))
            return result;

        var files = EnumerateFiles(root, recursive);
        int total = files.Count;
        var bySize = new Dictionary<long, List<string>>();

        int scanned = 0;
        foreach (var file in files)
        {
            ct.ThrowIfCancellationRequested();
            scanned++;
            try
            {
                var fi = new FileInfo(file);
                if (!fi.Exists || fi.Length < minSizeBytes) continue;
                if (!bySize.TryGetValue(fi.Length, out var list))
                {
                    list = new List<string>();
                    bySize[fi.Length] = list;
                }
                list.Add(file);
            }
            catch { /* skip inaccessible */ }

            if (scanned % 25 == 0 || scanned == total)
            {
                onProgress?.Invoke(new DuplicateScanProgress
                {
                    FilesScanned = scanned,
                    TotalFiles = total,
                    CurrentPath = file,
                    Percent = total > 0 ? (int)Math.Round(scanned * 100.0 / total) : 0,
                });
            }
        }

        // Size → XxHash64 (fast) → SHA-256 (authoritative) for true duplicates.
        var hashGroups = new Dictionary<string, DuplicateGroup>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in bySize.Where(x => x.Value.Count > 1))
        {
            ct.ThrowIfCancellationRequested();
            var byXx = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            foreach (var path in kv.Value)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var xx = await ComputeXxHash64Async(path, ct).ConfigureAwait(false);
                    if (!byXx.TryGetValue(xx, out var list))
                    {
                        list = new List<string>();
                        byXx[xx] = list;
                    }
                    list.Add(path);
                }
                catch { /* skip */ }
            }

            foreach (var xxGroup in byXx.Values.Where(g => g.Count > 1))
            {
                foreach (var path in xxGroup)
                {
                    ct.ThrowIfCancellationRequested();
                    try
                    {
                        string hash = await ComputeSha256Async(path, ct).ConfigureAwait(false);
                        if (!hashGroups.TryGetValue(hash, out var group))
                        {
                            group = new DuplicateGroup { Hash = hash, Size = kv.Key, Paths = new List<string>() };
                            hashGroups[hash] = group;
                        }
                        group.Paths.Add(path);
                    }
                    catch { /* skip */ }
                }
            }
        }

        result.Groups = hashGroups.Values
            .Where(g => g.Paths.Count > 1)
            .OrderByDescending(g => g.Size * g.Paths.Count)
            .ToList();

        return result;
    }

    private static List<string> EnumerateFiles(string root, bool recursive)
    {
        var files = new List<string>();
        try
        {
            files.AddRange(Directory.GetFiles(root));
            if (recursive)
            {
                foreach (var dir in Directory.GetDirectories(root))
                {
                    try { files.AddRange(EnumerateFiles(dir, true)); }
                    catch { /* skip */ }
                }
            }
        }
        catch { }
        return files;
    }

    private static async Task<string> ComputeXxHash64Async(string path, CancellationToken ct)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
        var hasher = new XxHash64();
        var buffer = ArrayPool<byte>.Shared.Rent(256 * 1024);
        try
        {
            int read;
            while ((read = await stream.ReadAsync(buffer.AsMemory(0, buffer.Length), ct).ConfigureAwait(false)) > 0)
                hasher.Append(buffer.AsSpan(0, read));
            return Convert.ToHexString(hasher.GetHashAndReset()).ToLowerInvariant();
        }
        finally
        {
            ArrayPool<byte>.Shared.Return(buffer);
        }
    }

    private static async Task<string> ComputeSha256Async(string path, CancellationToken ct)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
        using var sha = SHA256.Create();
        var hash = await sha.ComputeHashAsync(stream, ct).ConfigureAwait(false);
        return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
    }

    private static string NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        try { return Path.GetFullPath(path.Trim()); }
        catch { return path.Trim(); }
    }
}
