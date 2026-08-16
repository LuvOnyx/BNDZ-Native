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

    /// <summary>Approx UTF-16 byte weight of L1 thumbnail payloads (cap soft-evicts whole L1).</summary>
    private static long _thumbL1ApproxBytes;
    private const long ThumbL1MaxBytes = 128L * 1024 * 1024;

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

    public static string IconCacheKey(string path, bool isDirectory, int pixelSize = 48)
    {
        path ??= "";
        int band = pixelSize >= 320 ? 512
            : pixelSize >= 200 ? 256
            : pixelSize >= 96 ? 128
            : pixelSize >= 56 ? 64
            : pixelSize >= 40 ? 48
            : 32;
        bool isVirtual = ShellPathResolver.IsShellVirtualPath(path)
            || path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase)
            || path.StartsWith("::{", StringComparison.Ordinal);
        // Bust prior disk/L1 poison where CLSIDs were stored under the generic white-doc glyph.
        if (isVirtual)
            return "shellns:v2:" + path + "@" + band;
        if (!isDirectory && path.Length > 0
            && !path.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
            && !path.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase)
            && !path.EndsWith(".ico", StringComparison.OrdinalIgnoreCase))
        {
            var ext = System.IO.Path.GetExtension(path);
            if (!string.IsNullOrEmpty(ext))
                return ext.ToLowerInvariant() + "@" + band;
        }
        return path + "@" + band;
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
    /// L1 → L2 (base64 from CAS) → SYSICONINDEX map → extract.
    /// Shell glyphs always return base64 PNG (never bndz-media://) so list paint cannot 404
    /// when the custom-scheme handler or WebView CORS path misbehaves. CAS is still the L2 store.
    /// </summary>
    public static string? ResolveIconBase64(string path, bool isDirectory, Func<string> extract, int pixelSize = 48)
    {
        var key = IconCacheKey(path, isDirectory, pixelSize);
        if (Icons.TryGet(key, out var hit) && !string.IsNullOrEmpty(hit))
        {
            // Poisoned L1: CAS/legacy URLs — materialize bytes or ignore and reload from disk.
            if (BndzMediaScheme.IsCasDeliveryUrl(hit))
            {
                var materialised = BndzMediaDiskCache.Instance.TryReadBase64ByHash(BndzMediaScheme.ParseHash(hit));
                if (!string.IsNullOrEmpty(materialised))
                {
                    Icons.AddOrUpdate(key, materialised);
                    Interlocked.Increment(ref _iconL1Hits);
                    return materialised;
                }
            }
            else
            {
                Interlocked.Increment(ref _iconL1Hits);
                return hit;
            }
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

        // Shared imagelist glyphs are ~32–48px — skip for jumbo/hi-res asks (zoom-in grid/list).
        if (pixelSize < 64)
        {
            var sysHit = ShellGlyphMapService.Instance.TryResolveViaSysIconIndex(path, isDirectory);
            if (!string.IsNullOrEmpty(sysHit))
            {
                Interlocked.Increment(ref _iconL1Hits);
                Icons.AddOrUpdate(key, sysHit);
                return sysHit;
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
        if (pixelSize < 64)
            ShellGlyphMapService.Instance.RememberExtractedIcon(path, isDirectory, extracted);
        Icons.AddOrUpdate(key, extracted);
        if (disk.CurrentPolicy.CacheIconsOnDisk)
            disk.PutBase64(BndzMediaDiskCache.Kind.Icon, key, extracted);
        return extracted;
    }

    /// <summary>Same as ResolveIconBase64 but prefer CAS URL for thumbnails when warm.</summary>
    public static string? ResolveThumbnailDelivery(string path, int size, Func<string> extract)
    {
        var key = ThumbnailCacheKey(path, size);
        if (Thumbnails.TryGet(key, out var hit) && !string.IsNullOrEmpty(hit))
        {
            if (BndzMediaScheme.IsCasDeliveryUrl(hit))
            {
                var hash = BndzMediaScheme.ParseHash(hit);
                // Verify CAS blob still exists — else fall through to base64/extract.
                using var probe = BndzMediaDiskCache.Instance.OpenCasStreamByHash(hash ?? "");
                if (probe != null)
                {
                    // Rewrite legacy folder-map URLs to custom scheme.
                    var canonical = BndzMediaScheme.UrlForHash(hash!);
                    if (!string.Equals(hit, canonical, StringComparison.OrdinalIgnoreCase))
                    {
                        hit = canonical;
                        PutThumbnailL1(key, hit);
                    }
                    Interlocked.Increment(ref _thumbL1Hits);
                    return hit;
                }
                // Stale CAS URL in L1 — ignore and continue.
            }
            else
            {
                Interlocked.Increment(ref _thumbL1Hits);
                return hit;
            }
        }

        var disk = BndzMediaDiskCache.Instance;
        var allowDisk = disk.AllowsThumbPath(path);
        if (allowDisk)
        {
            var casUrl = disk.TryGetCasUrl(BndzMediaDiskCache.Kind.Thumbnail, key);
            if (!string.IsNullOrEmpty(casUrl))
            {
                Interlocked.Increment(ref _thumbL2Hits);
                PutThumbnailL1(key, casUrl);
                return casUrl;
            }
        }

        return ResolveThumbnailBase64(path, size, extract);
    }

    /// <summary>L1 → L2 → extract for thumbnails (path/mtime keyed).</summary>
    public static string? ResolveThumbnailBase64(string path, int size, Func<string> extract)
    {
        var key = ThumbnailCacheKey(path, size);
        if (Thumbnails.TryGet(key, out var hit) && !string.IsNullOrEmpty(hit))
        {
            if (BndzMediaScheme.IsCasDeliveryUrl(hit))
            {
                var materialised = BndzMediaDiskCache.Instance.TryReadBase64ByHash(BndzMediaScheme.ParseHash(hit));
                if (!string.IsNullOrEmpty(materialised))
                {
                    PutThumbnailL1(key, materialised);
                    Interlocked.Increment(ref _thumbL1Hits);
                    return materialised;
                }
            }
            else
            {
                Interlocked.Increment(ref _thumbL1Hits);
                return hit;
            }
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
                PutThumbnailL1(key, fromDisk);
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
        PutThumbnailL1(key, extracted);
        if (allowDisk)
            disk.PutBase64(BndzMediaDiskCache.Kind.Thumbnail, key, extracted);
        return extracted;
    }

    private static int EstimatePayloadBytes(string? value)
    {
        if (string.IsNullOrEmpty(value)) return 0;
        return checked(value.Length * 2);
    }

    private static void PutThumbnailL1(string key, string value)
    {
        Thumbnails.AddOrUpdate(key, value);
        var added = EstimatePayloadBytes(value);
        var total = Interlocked.Add(ref _thumbL1ApproxBytes, added);
        if (total <= ThumbL1MaxBytes) return;
        Thumbnails.Clear();
        Interlocked.Exchange(ref _thumbL1ApproxBytes, 0);
        Thumbnails.AddOrUpdate(key, value);
        Interlocked.Exchange(ref _thumbL1ApproxBytes, EstimatePayloadBytes(value));
    }

    public static void ClearIcons() => Icons.Clear();

    public static void ClearThumbnails()
    {
        Thumbnails.Clear();
        ThumbNegatives.Clear();
        Interlocked.Exchange(ref _thumbL1ApproxBytes, 0);
    }

    public static void ClearAll(bool includeDisk = true)
    {
        ClearIcons();
        ClearThumbnails();
        if (includeDisk)
            BndzMediaDiskCache.Instance.ClearAll();
    }
}
