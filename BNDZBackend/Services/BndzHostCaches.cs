using System;
using System.Collections.Concurrent;
using System.Linq;
using System.Threading;
using BitFaster.Caching.Lru;
using Microsoft.IO;

namespace BNDZ.Services;

/// <summary>
/// Shared host caches — L1 RAM LRU for icons/thumbs, backed by durable L2
/// <see cref="BndzMediaDiskCache"/> (CAS + SQLite).
/// </summary>
public static class BndzHostCaches
{
    public static RecyclableMemoryStreamManager Streams { get; } = new();

    /// <summary>Shell / type icons as base64 PNG (extension or path keyed).</summary>
    public static ConcurrentLru<string, string> Icons { get; } = new(capacity: 8192);

    /// <summary>Thumbnails keyed by path|size|mtimeTicks.</summary>
    public static ConcurrentLru<string, string> Thumbnails { get; } = new(capacity: 2048);

    /// <summary>Negative CAS — failed extract keys with UTC ticks when recorded.</summary>
    private static readonly ConcurrentDictionary<string, long> ThumbNegatives = new(StringComparer.OrdinalIgnoreCase);

    /// <summary>Do not retry a failed extract for this long (mtime key already invalidates on change).</summary>
    private static readonly long NegativeTtlTicks = TimeSpan.FromMinutes(10).Ticks;

    private static long _iconL1Hits, _iconL2Hits, _iconMissExtract;
    private static long _thumbL1Hits, _thumbL2Hits, _thumbMissExtract, _thumbNegHits;
    private static long _thumbExtractWindowStart = Environment.TickCount64;
    private static long _thumbExtractWindowCount;

    public static object GetPerfSnapshot()
    {
        var now = Environment.TickCount64;
        var start = Interlocked.Read(ref _thumbExtractWindowStart);
        var count = Interlocked.Read(ref _thumbExtractWindowCount);
        var elapsedSec = Math.Max(0.001, (now - start) / 1000.0);
        if (now - start > 5000)
        {
            Interlocked.Exchange(ref _thumbExtractWindowStart, now);
            Interlocked.Exchange(ref _thumbExtractWindowCount, 0);
        }
        return new
        {
            iconL1Hits = Interlocked.Read(ref _iconL1Hits),
            iconL2Hits = Interlocked.Read(ref _iconL2Hits),
            iconExtracts = Interlocked.Read(ref _iconMissExtract),
            thumbL1Hits = Interlocked.Read(ref _thumbL1Hits),
            thumbL2Hits = Interlocked.Read(ref _thumbL2Hits),
            thumbExtracts = Interlocked.Read(ref _thumbMissExtract),
            thumbNegHits = Interlocked.Read(ref _thumbNegHits),
            thumbExtractsPerSec = Math.Round(count / elapsedSec, 2),
            iconLruCount = Icons.Count,
            thumbLruCount = Thumbnails.Count,
            thumbNegCount = ThumbNegatives.Count,
        };
    }

    public static string IconCacheKey(string path, bool isDirectory)
    {
        path ??= "";
        bool isVirtual = ShellPathResolver.IsShellVirtualPath(path)
            || path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase);
        if (!isVirtual && !isDirectory && path.Length > 0
            && !path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            && !path.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase)
            && !path.EndsWith(".ico", StringComparison.OrdinalIgnoreCase))
        {
            var ext = System.IO.Path.GetExtension(path);
            if (!string.IsNullOrEmpty(ext))
                return ext.ToLowerInvariant();
        }
        return path;
    }

    public static string ThumbnailCacheKey(string path, int size)
    {
        long mtime = 0;
        try
        {
            if (System.IO.File.Exists(path))
                mtime = System.IO.File.GetLastWriteTimeUtc(path).Ticks;
            else if (System.IO.Directory.Exists(path))
                mtime = System.IO.Directory.GetLastWriteTimeUtc(path).Ticks;
        }
        catch { }
        return $"{path}|{size}|{mtime}";
    }

    /// <summary>
    /// L1 → L2 → extract. Honors disk-cache policy and "cached only" modes.
    /// </summary>
    public static string? ResolveIconBase64(string path, bool isDirectory, Func<string> extract)
    {
        var key = IconCacheKey(path, isDirectory);
        if (Icons.TryGet(key, out var hit) && !string.IsNullOrEmpty(hit))
        {
            Interlocked.Increment(ref _iconL1Hits);
            return hit;
        }

        var disk = BndzMediaDiskCache.Instance;
        if (disk.CurrentPolicy.CacheIconsOnDisk)
        {
            var fromDisk = disk.TryGetBase64(BndzMediaDiskCache.Kind.Icon, key);
            if (!string.IsNullOrEmpty(fromDisk))
            {
                Interlocked.Increment(ref _iconL2Hits);
                Icons.AddOrUpdate(key, fromDisk);
                return fromDisk;
            }
        }

        if (disk.CurrentPolicy.ShowCachedIconsOnly)
            return null;

        string extracted;
        try { extracted = extract() ?? ""; }
        catch { extracted = ""; }

        if (string.IsNullOrEmpty(extracted))
            return null;

        Interlocked.Increment(ref _iconMissExtract);
        Icons.AddOrUpdate(key, extracted);
        if (disk.CurrentPolicy.CacheIconsOnDisk)
            disk.PutBase64(BndzMediaDiskCache.Kind.Icon, key, extracted);
        return extracted;
    }

    /// <summary>L1 → L2 → extract for thumbnails (path/mtime keyed).</summary>
    public static string? ResolveThumbnailBase64(string path, int size, Func<string> extract)
    {
        var key = ThumbnailCacheKey(path, size);
        if (Thumbnails.TryGet(key, out var hit) && !string.IsNullOrEmpty(hit))
        {
            Interlocked.Increment(ref _thumbL1Hits);
            return hit;
        }

        if (ThumbNegatives.TryGetValue(key, out var negAt))
        {
            if (DateTime.UtcNow.Ticks - negAt < NegativeTtlTicks)
            {
                Interlocked.Increment(ref _thumbNegHits);
                return null;
            }
            ThumbNegatives.TryRemove(key, out _);
        }

        var disk = BndzMediaDiskCache.Instance;
        var allowDisk = disk.AllowsThumbPath(path);
        if (allowDisk)
        {
            var fromDisk = disk.TryGetBase64(BndzMediaDiskCache.Kind.Thumbnail, key);
            if (!string.IsNullOrEmpty(fromDisk))
            {
                Interlocked.Increment(ref _thumbL2Hits);
                Thumbnails.AddOrUpdate(key, fromDisk);
                return fromDisk;
            }
        }

        // Gold path: extract on cold miss, then write CAS.
        string extracted;
        try { extracted = extract() ?? ""; }
        catch { extracted = ""; }

        if (string.IsNullOrEmpty(extracted))
        {
            ThumbNegatives[key] = DateTime.UtcNow.Ticks;
            // Cap negative map growth.
            if (ThumbNegatives.Count > 8000)
            {
                foreach (var stale in ThumbNegatives.Keys.Take(2000))
                    ThumbNegatives.TryRemove(stale, out _);
            }
            return null;
        }

        Interlocked.Increment(ref _thumbMissExtract);
        Interlocked.Increment(ref _thumbExtractWindowCount);
        ThumbNegatives.TryRemove(key, out _);
        Thumbnails.AddOrUpdate(key, extracted);
        if (allowDisk)
            disk.PutBase64(BndzMediaDiskCache.Kind.Thumbnail, key, extracted);
        return extracted;
    }

    public static void ClearIcons() => Icons.Clear();

    public static void ClearThumbnails()
    {
        Thumbnails.Clear();
        ThumbNegatives.Clear();
    }

    public static void ClearAll(bool includeDisk = true)
    {
        ClearIcons();
        ClearThumbnails();
        if (includeDisk)
            BndzMediaDiskCache.Instance.ClearAll();
    }
}
