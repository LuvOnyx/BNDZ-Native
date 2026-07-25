using System;
using System.IO;
using System.Linq;

namespace BNDZ.Services;

/// <summary>Clears Windows Explorer thumbcache databases and BNDZ icon/thumbnail caches.</summary>
public static class ThumbnailCacheService
{
    public static ThumbnailClearResult ClearAll()
    {
        int filesRemoved = 0;
        long bytesFreed = 0;
        var errors = new System.Collections.Generic.List<string>();

        void TryDelete(string path)
        {
            try
            {
                if (!File.Exists(path)) return;
                var len = new FileInfo(path).Length;
                File.Delete(path);
                filesRemoved++;
                bytesFreed += len;
            }
            catch (Exception ex)
            {
                errors.Add($"{Path.GetFileName(path)}: {ex.Message}");
            }
        }

        try
        {
            // Product L1 + L2 (CAS/SQLite under %LocalAppData%/BNDZ/Cache).
            var (casFiles, casBytes) = BndzMediaDiskCache.Instance.ClearAll();
            filesRemoved += casFiles;
            bytesFreed += casBytes;
            BndzHostCaches.ClearAll(includeDisk: false);

            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var bndzCache = Path.Combine(localAppData, "BNDZ", "Cache");
            if (Directory.Exists(bndzCache))
            {
                foreach (var file in Directory.EnumerateFiles(bndzCache, "*", SearchOption.AllDirectories))
                    TryDelete(file);
            }

            var explorerDir = Path.Combine(localAppData, "Microsoft", "Windows", "Explorer");
            if (Directory.Exists(explorerDir))
            {
                foreach (var file in Directory.EnumerateFiles(explorerDir, "thumbcache_*.db", SearchOption.TopDirectoryOnly))
                    TryDelete(file);
                foreach (var file in Directory.EnumerateFiles(explorerDir, "iconcache_*.db", SearchOption.TopDirectoryOnly))
                    TryDelete(file);
            }

            var legacyBndz = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BNDZ64", "thumbcache");
            if (Directory.Exists(legacyBndz))
            {
                foreach (var file in Directory.EnumerateFiles(legacyBndz, "*", SearchOption.AllDirectories))
                    TryDelete(file);
            }
        }
        catch (Exception ex)
        {
            errors.Add(ex.Message);
        }

        return new ThumbnailClearResult
        {
            Success = errors.Count == 0,
            FilesRemoved = filesRemoved,
            BytesFreed = bytesFreed,
            Error = errors.Count > 0 ? string.Join("; ", errors.Take(3)) : null,
        };
    }

    public sealed class ThumbnailClearResult
    {
        public bool Success { get; init; }
        public int FilesRemoved { get; init; }
        public long BytesFreed { get; init; }
        public string? Error { get; init; }
    }
}
