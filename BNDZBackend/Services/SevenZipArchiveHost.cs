using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using SevenZip;

namespace BNDZ.Services;

/// <summary>
/// Thin host for 7z.dll via Squid-Box.SevenZipSharp.
/// Provides solid LZMA2 / RAR5 / encrypted archive support to ArchiveService.
/// Falls back silently to SharpCompress when 7z.dll is unavailable.
///
/// 7z.dll discovery order:
///   1. App base directory (co-located with BNDZ.exe)
///   2. runtimes/win-x64/native/7z.dll
///   3. %LOCALAPPDATA%\BNDZ\Tools\7z\7z.dll
///   4. %ProgramFiles%\7-Zip\7z.dll
///   5. %ProgramFiles(x86)%\7-Zip\7z.dll
/// </summary>
public static class SevenZipArchiveHost
{
    private static readonly object Gate = new();
    private static bool _configured;
    private static bool _available;

    public static bool IsAvailable()
    {
        EnsureConfigured();
        return _available;
    }

    /// <summary>Returns true for formats where 7z is strongly preferred (solid, RAR5, encrypted).</summary>
    public static bool PreferNative(string path)
    {
        var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
        return ext is "7z" or "rar" or "001";
    }

    // ─── List ─────────────────────────────────────────────────────────────────

    public static ArchiveService.ArchiveContentsResult? TryListContents(string archivePath, int limit = 5000)
    {
        if (!IsAvailable()) return null;
        try
        {
            using var extractor = new SevenZipExtractor(archivePath);
            var entries = new List<ArchiveService.ArchiveEntryDto>();
            long totalSize = 0, compSize = 0;

            foreach (var info in extractor.ArchiveFileData.Take(limit))
            {
                entries.Add(new ArchiveService.ArchiveEntryDto
                {
                    Path = info.FileName.Replace('\\', '/'),
                    Size = (long)info.Size,
                    CompressedSize = 0L,
                    IsDirectory = info.IsDirectory,
                    Modified = info.LastWriteTime == default
                        ? null
                        : info.LastWriteTime.ToString("o"),
                });
                if (!info.IsDirectory)
                {
                    totalSize += (long)info.Size;
                    compSize += 0L;
                }
            }

            return new ArchiveService.ArchiveContentsResult
            {
                Format = Path.GetExtension(archivePath).TrimStart('.').ToLowerInvariant(),
                Entries = entries,
                EntryCount = entries.Count,
                TotalSize = totalSize,
                TotalCompressedSize = compSize,
                SevenZipBacked = true,
            };
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[SevenZip/List] {ex.Message}");
            return null;
        }
    }

    // ─── Create ───────────────────────────────────────────────────────────────

    /// <summary>Create a solid LZMA2 .7z archive. fileDict maps fullSourcePath → entryName.</summary>
    public static bool TryCreateSolid7z(
        Dictionary<string, string> fileDict,
        string targetPath,
        Action<int, string>? onProgress = null)
    {
        if (!IsAvailable() || fileDict.Count == 0) return false;
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(targetPath) ?? ".");
            var compressor = new SevenZipCompressor
            {
                ArchiveFormat = OutArchiveFormat.SevenZip,
                CompressionMethod = CompressionMethod.Lzma2,
                CompressionLevel = CompressionLevel.Normal,
            };

            compressor.Compressing += (_, e) => onProgress?.Invoke(e.PercentDone, targetPath);

            compressor.CompressFileDictionary(fileDict, targetPath);
            onProgress?.Invoke(100, targetPath);
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[SevenZip/Create] {ex.Message}");
            return false;
        }
    }

    // ─── Extract ──────────────────────────────────────────────────────────────

    /// <summary>Extract a single entry (by archive-relative path) to a staging folder.</summary>
    public static bool TryExtractEntry(string archivePath, string entryPath, string destFolder)
    {
        if (!IsAvailable()) return false;
        try
        {
            Directory.CreateDirectory(destFolder);
            using var extractor = new SevenZipExtractor(archivePath);
            var norm = entryPath.Replace('\\', '/');
            var match = extractor.ArchiveFileData
                .Select((f, i) => (f, i))
                .FirstOrDefault(x => string.Equals(
                    x.f.FileName.Replace('\\', '/'), norm,
                    StringComparison.OrdinalIgnoreCase));
            if (string.IsNullOrEmpty(match.f.FileName))
                return false;

            if (match.f.IsDirectory)
            {
                if (!PathContainment.TryResolveContainedFile(destFolder, match.f.FileName, out var dir))
                    return false;
                Directory.CreateDirectory(dir);
                return true;
            }

            if (!PathContainment.TryResolveContainedFile(destFolder, match.f.FileName, out var destPath))
                return false;
            var parent = Path.GetDirectoryName(destPath);
            if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
            using (var fs = File.Create(destPath))
                extractor.ExtractFile(match.i, fs);
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[SevenZip/ExtractEntry] {ex.Message}");
            return false;
        }
    }

    /// <summary>Extract all contents of an archive to a destination folder.</summary>
    public static bool TryExtractAll(
        string archivePath,
        string destFolder,
        Action<int, string>? onProgress = null)
    {
        if (!IsAvailable()) return false;
        try
        {
            Directory.CreateDirectory(destFolder);
            using var extractor = new SevenZipExtractor(archivePath);
            var files = extractor.ArchiveFileData.ToList();
            for (var i = 0; i < files.Count; i++)
            {
                var info = files[i];
                var name = info.FileName ?? "";
                if (!PathContainment.TryResolveContainedFile(destFolder, name, out var destPath))
                {
                    Debug.WriteLine($"[SevenZip] skipped zip-slip entry: {name}");
                    continue;
                }
                if (info.IsDirectory)
                {
                    Directory.CreateDirectory(destPath);
                    onProgress?.Invoke((int)((i + 1) * 100.0 / Math.Max(files.Count, 1)), name);
                    continue;
                }
                var parent = Path.GetDirectoryName(destPath);
                if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
                using (var fs = File.Create(destPath))
                    extractor.ExtractFile(i, fs);
                onProgress?.Invoke((int)((i + 1) * 100.0 / Math.Max(files.Count, 1)), name);
            }
            onProgress?.Invoke(100, destFolder);
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[SevenZip/ExtractAll] {ex.Message}");
            return false;
        }
    }

    // ─── DLL configuration ────────────────────────────────────────────────────

    private static void EnsureConfigured()
    {
        if (_configured) return;
        lock (Gate)
        {
            if (_configured) return;
            _configured = true;
            try
            {
                var dll = LocateSevenZipDll();
                if (dll == null)
                {
                    Debug.WriteLine("[SevenZip] 7z.dll not found — SharpCompress fallback active.");
                    return;
                }
                SevenZipBase.SetLibraryPath(dll);
                _available = true;
                Debug.WriteLine($"[SevenZip] Loaded 7z.dll from {dll}");
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[SevenZip] Init failed: {ex.Message}");
            }
        }
    }

    private static string? LocateSevenZipDll()
    {
        var baseDir = AppContext.BaseDirectory;
        foreach (var candidate in new[]
        {
            Path.Combine(baseDir, "7z.dll"),
            Path.Combine(baseDir, "runtimes", "win-x64", "native", "7z.dll"),
            Path.Combine(baseDir, "x64", "7z.dll"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BNDZ", "Tools", "7z", "7z.dll"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                "7-Zip", "7z.dll"),
            Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                "7-Zip", "7z.dll"),
            @"C:\Program Files\7-Zip\7z.dll",
        })
        {
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
}
