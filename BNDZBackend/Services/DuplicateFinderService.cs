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
    /// <summary>Enumerating | Hashing | Matching</summary>
    public string Phase { get; set; } = "";
}

public sealed class DuplicateGroup
{
    public string Hash { get; set; } = "";
    public long Size { get; set; }
    public List<string> Paths { get; set; } = new();
    /// <summary>Unix seconds last-write, parallel to Paths (for keep-newest).</summary>
    public List<long> Modified { get; set; } = new();
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

        // Stream enumeration with cancel + progress. The old Directory.GetFiles recurse
        // built a full List before any progress - on C:\ that alone blew the 60s host wait.
        var bySize = new Dictionary<long, List<string>>();
        int enumerated = 0;
        await Task.Run(() =>
        {
            EnumerateCandidateFiles(root, recursive, minSizeBytes, bySize, ref enumerated, onProgress, ct);
        }, ct).ConfigureAwait(false);

        ct.ThrowIfCancellationRequested();

        var candidates = bySize.Where(x => x.Value.Count > 1).ToList();
        int hashTotal = candidates.Sum(c => c.Value.Count);
        int hashed = 0;

        // Size -> XxHash64 (fast) -> SHA-256 (authoritative) for true duplicates.
        var hashGroups = new Dictionary<string, DuplicateGroup>(StringComparer.OrdinalIgnoreCase);
        foreach (var kv in candidates)
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

                hashed++;
                if (hashed % 8 == 0 || hashed == hashTotal)
                {
                    onProgress?.Invoke(new DuplicateScanProgress
                    {
                        FilesScanned = hashed,
                        TotalFiles = hashTotal,
                        CurrentPath = path,
                        Percent = hashTotal > 0 ? (int)Math.Round(hashed * 100.0 / hashTotal) : 0,
                        Phase = "Hashing",
                    });
                }
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
                            group = new DuplicateGroup { Hash = hash, Size = kv.Key, Paths = new List<string>(), Modified = new List<long>() };
                            hashGroups[hash] = group;
                        }
                        group.Paths.Add(path);
                        long mod = 0;
                        try { mod = new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeSeconds(); } catch { }
                        group.Modified.Add(mod);
                    }
                    catch { /* skip */ }
                }
            }
        }

        result.Groups = hashGroups.Values
            .Where(g => g.Paths.Count > 1)
            .OrderByDescending(g => g.Size * g.Paths.Count)
            .ToList();

        onProgress?.Invoke(new DuplicateScanProgress
        {
            FilesScanned = hashTotal,
            TotalFiles = hashTotal,
            CurrentPath = "",
            Percent = 100,
            Phase = "Matching",
        });

        return result;
    }

    /// <summary>
    /// Iterative stack walk - cancel-friendly, reports progress while walking large trees.
    /// Only keeps paths that meet <paramref name="minSizeBytes"/> (size-bucket prefilter).
    /// </summary>
    private static void EnumerateCandidateFiles(
        string root,
        bool recursive,
        long minSizeBytes,
        Dictionary<long, List<string>> bySize,
        ref int enumerated,
        Action<DuplicateScanProgress>? onProgress,
        CancellationToken ct)
    {
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            ct.ThrowIfCancellationRequested();
            var dir = stack.Pop();
            try
            {
                foreach (var file in Directory.EnumerateFiles(dir))
                {
                    ct.ThrowIfCancellationRequested();
                    enumerated++;
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

                    if (enumerated % 64 == 0)
                    {
                        // Percent stays low during enum (unknown total); FE shows path + count.
                        onProgress?.Invoke(new DuplicateScanProgress
                        {
                            FilesScanned = enumerated,
                            TotalFiles = Math.Max(enumerated, bySize.Values.Sum(v => v.Count)),
                            CurrentPath = file,
                            Percent = 0,
                            Phase = "Enumerating",
                        });
                    }
                }

                if (!recursive) continue;
                foreach (var sub in Directory.EnumerateDirectories(dir))
                {
                    ct.ThrowIfCancellationRequested();
                    try { stack.Push(sub); }
                    catch { /* skip */ }
                }
            }
            catch (OperationCanceledException) { throw; }
            catch { /* skip inaccessible dirs */ }
        }

        onProgress?.Invoke(new DuplicateScanProgress
        {
            FilesScanned = enumerated,
            TotalFiles = enumerated,
            CurrentPath = root,
            Percent = 5,
            Phase = "Enumerating",
        });
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
