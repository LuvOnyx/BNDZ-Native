using System;
using BitFaster.Caching.Lru;
using Microsoft.IO;

namespace BNDZ.Services;

/// <summary>
/// Shared host caches and buffer pools — icons, thumbnails, PNG encode streams.
/// </summary>
public static class BndzHostCaches
{
    public static RecyclableMemoryStreamManager Streams { get; } = new();

    /// <summary>Shell / type icons as base64 PNG (extension or path keyed).</summary>
    public static ConcurrentLru<string, string> Icons { get; } = new(capacity: 8192);

    /// <summary>Thumbnails keyed by path|size|mtimeTicks.</summary>
    public static ConcurrentLru<string, string> Thumbnails { get; } = new(capacity: 2048);

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

    public static void ClearIcons() => Icons.Clear();

    public static void ClearThumbnails() => Thumbnails.Clear();

    public static void ClearAll()
    {
        ClearIcons();
        ClearThumbnails();
    }
}
