using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using SharpCompress.Archives;
using SharpCompress.Common;
using SharpCompress.Writers;
using SharpCompress.Writers.Zip;

namespace BNDZ.Services;

/// <summary>
/// Archive open/list/extract/create service (Wave 4: SevenZipSharp integration).
///
/// Format routing:
///   ZIP          — System.IO.Compression (primary, full r/w)
///   7z           — SevenZipArchiveHost/7z.dll for solid LZMA2 when available;
///                  SharpCompress fallback (deflate, no solid) when DLL missing
///   RAR / RAR5   — SevenZipArchiveHost/7z.dll (RAR4 + RAR5 + encrypted);
///                  SharpCompress fallback (RAR4 read-only)
///   All others   — SharpCompress
///
/// SevenZipArchiveHost.cs handles DLL discovery and exposes IsAvailable().
/// See BNDZ.csproj target Stage7zDll for automatic build-time DLL staging.
/// </summary>
public sealed class ArchiveService
{
    private readonly ConcurrentDictionary<string, string> _tempExtractCache = new(StringComparer.OrdinalIgnoreCase);

    private static readonly HashSet<string> ArchiveExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "cab", "jar", "war", "rpf"
    };

    public static bool IsArchivePath(string path)
    {
        var ext = Path.GetExtension(path).TrimStart('.');
        return ArchiveExtensions.Contains(ext);
    }

    // ------------------------------------------------------------------- list

    public ArchiveContentsResult ListContents(string path, int limit = 5000)
    {
        path = NormalizePath(path);
        if (!File.Exists(path))
            return new ArchiveContentsResult { Error = "File not found" };

        var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
        try
        {
            if (ext == "rpf")
                return RageRpfArchiveHost.TryListContents(path, limit)
                    ?? new ArchiveContentsResult { Format = "rpf", Error = "RPF list failed" };

            if (ext == "zip")
                return ListZipContents(path, limit);

            // Prefer SevenZipArchiveHost for solid 7z, RAR5, encrypted archives
            if (SevenZipArchiveHost.PreferNative(path) && SevenZipArchiveHost.IsAvailable())
            {
                var r7z = SevenZipArchiveHost.TryListContents(path, limit);
                if (r7z != null) return r7z;
            }

            // SharpCompress fallback
            using var archive = ArchiveFactory.OpenArchive(path);
            var entries  = new List<ArchiveEntryDto>();
            long total   = 0;
            long compact = 0;

            foreach (var entry in archive.Entries.Where(e => !e.IsDirectory).Take(limit))
            {
                entries.Add(MakeEntryDto(entry));
                total   += entry.Size;
                compact += entry.CompressedSize;
            }

            foreach (var entry in archive.Entries.Where(e => e.IsDirectory)
                         .Take(Math.Max(0, limit - entries.Count)))
                entries.Add(MakeEntryDto(entry));

            return new ArchiveContentsResult
            {
                Format              = ext,
                EntryCount          = entries.Count,
                TotalSize           = total,
                TotalCompressedSize = compact,
                Entries             = entries.OrderBy(e => e.Path).ToList()
            };
        }
        catch (Exception ex)
        {
            return new ArchiveContentsResult { Error = ex.Message, Format = ext };
        }
    }

    private static ArchiveContentsResult ListZipContents(string path, int limit)
    {
        var entries  = new List<ArchiveEntryDto>();
        long total   = 0;
        long compact = 0;

        using var zip = ZipFile.OpenRead(path);
        foreach (var entry in zip.Entries.Take(limit))
        {
            entries.Add(new ArchiveEntryDto
            {
                Path           = entry.FullName,
                Name           = entry.Name,
                Size           = entry.Length,
                CompressedSize = entry.CompressedLength,
                IsDirectory    = entry.FullName.EndsWith('/') || string.IsNullOrEmpty(entry.Name),
                Modified       = entry.LastWriteTime.ToString("O"),
            });
            if (!entry.FullName.EndsWith('/'))
            {
                total   += entry.Length;
                compact += entry.CompressedLength;
            }
        }

        return new ArchiveContentsResult
        {
            Format              = "zip",
            EntryCount          = entries.Count,
            TotalSize           = total,
            TotalCompressedSize = compact,
            Entries             = entries.OrderBy(e => e.Path).ToList()
        };
    }

    private static ArchiveEntryDto MakeEntryDto(IArchiveEntry entry)
    {
        var key  = entry.Key ?? "";
        var name = entry.IsDirectory
            ? Path.GetFileName(key.TrimEnd('/', '\\')) ?? key
            : Path.GetFileName(key) ?? key;
        return new ArchiveEntryDto
        {
            Path           = key,
            Name           = name,
            Size           = entry.Size,
            CompressedSize = entry.CompressedSize,
            IsDirectory    = entry.IsDirectory,
            Modified       = entry.LastModifiedTime?.ToString("O"),
        };
    }

    // --------------------------------------------------------------- create

    public async Task CreateArchiveAsync(
        IEnumerable<string> sourcePaths,
        string targetArchivePath,
        string format,
        Action<int, string>? onProgress = null,
        CancellationToken cancellationToken = default,
        Action<Process>? onProcessStarted = null)
    {
        await Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            var sources = sourcePaths.Select(NormalizePath)
                .Where(p => File.Exists(p) || Directory.Exists(p)).ToList();
            targetArchivePath = NormalizePath(targetArchivePath);
            format            = (format ?? "zip").ToLowerInvariant();

            if (sources.Count == 0)
            {
                if (format == "zip")
                {
                    using var emptyZip = File.Create(targetArchivePath);
                    using var za       = new ZipArchive(emptyZip, ZipArchiveMode.Create);
                    _ = za;
                    onProgress?.Invoke(100, targetArchivePath);
                    return;
                }
                throw new InvalidOperationException("No valid source paths");
            }

            var targetDir = Path.GetDirectoryName(targetArchivePath);
            if (!string.IsNullOrEmpty(targetDir) && !Directory.Exists(targetDir))
                Directory.CreateDirectory(targetDir);

            if (format == "zip")
            {
                CreateZipArchive(sources, targetArchivePath, onProgress, cancellationToken);
                return;
            }

            if (format == "7z")
            {
                // SevenZipArchiveHost: solid LZMA2 when 7z.dll present
                var fileDict = CollectFiles(sources)
                    .ToDictionary(t => t.entryName.Replace('/', '\\'), t => t.fullPath);

                if (!SevenZipArchiveHost.TryCreateSolid7z(fileDict, targetArchivePath, onProgress))
                    CreateSharpCompressArchive(sources, targetArchivePath, "7z", onProgress, cancellationToken);
                return;
            }

            if (format is "tar" or "gz")
            {
                CreateSharpCompressArchive(sources, targetArchivePath, format, onProgress, cancellationToken);
                return;
            }

            if (format == "rar")
            {
                if (TryCreateRarViaWinRar(sources, targetArchivePath, onProgress, cancellationToken, onProcessStarted))
                    return;
                throw new NotSupportedException("RAR creation requires WinRAR (Rar.exe). Install WinRAR or use ZIP/7z.");
            }

            throw new NotSupportedException($"Archive format '{format}' is not supported.");
        }, cancellationToken).ConfigureAwait(false);
    }

    private static int ProgressAfterIndex(int done, int total) =>
        total <= 0 ? 99 : Math.Min(99, (int)(done * 99.0 / total));

    private static void CreateZipArchive(
        List<string> sources, string target,
        Action<int, string>? onProgress, CancellationToken ct)
    {
        if (File.Exists(target)) File.Delete(target);
        using var zipStream = new FileStream(target, FileMode.CreateNew);
        using var archive   = new ZipArchive(zipStream, ZipArchiveMode.Create);
        var allFiles = CollectFiles(sources);
        int i = 0;
        foreach (var (fullPath, entryName) in allFiles)
        {
            ct.ThrowIfCancellationRequested();
            onProgress?.Invoke(ProgressAfterIndex(i, allFiles.Count), entryName);
            archive.CreateEntryFromFile(fullPath, entryName, CompressionLevel.Optimal);
            i++;
            onProgress?.Invoke(ProgressAfterIndex(i, allFiles.Count), entryName);
        }
    }

    private static void CreateSharpCompressArchive(
        List<string> sources, string target, string format,
        Action<int, string>? onProgress, CancellationToken ct)
    {
        if (File.Exists(target)) File.Delete(target);
        ArchiveType archiveType = format switch
        {
            "7z"  => ArchiveType.SevenZip,
            "tar" => ArchiveType.Tar,
            "gz"  => ArchiveType.GZip,
            _     => ArchiveType.Zip
        };
        using var stream = File.Open(target, FileMode.CreateNew);
        using var writer = WriterFactory.OpenWriter(stream, archiveType, new WriterOptions(CompressionType.Deflate));
        var allFiles = CollectFiles(sources);
        int i = 0;
        foreach (var (fullPath, entryName) in allFiles)
        {
            ct.ThrowIfCancellationRequested();
            onProgress?.Invoke(ProgressAfterIndex(i, allFiles.Count), entryName);
            using var input = File.OpenRead(fullPath);
            writer.Write(entryName.Replace('\\', '/'), input, DateTime.Now);
            i++;
            onProgress?.Invoke(ProgressAfterIndex(i, allFiles.Count), entryName);
        }
    }

    // ------------------------------------------------------------ extract entry

    public void ExtractEntry(string archivePath, string entryPath, string destinationDir)
    {
        archivePath    = NormalizePath(archivePath);
        destinationDir = NormalizePath(destinationDir);
        entryPath      = entryPath.Replace('\\', '/').TrimStart('/');
        var entryNorm  = entryPath.TrimEnd('/');

        if (!File.Exists(archivePath))
            throw new FileNotFoundException("Archive not found", archivePath);

        if (!Directory.Exists(destinationDir))
            Directory.CreateDirectory(destinationDir);

        var ext = Path.GetExtension(archivePath).TrimStart('.').ToLowerInvariant();

        if (ext == "rpf")
        {
            if (!RageRpfArchiveHost.TryExtractEntry(archivePath, entryNorm, destinationDir, out var rpfErr))
                throw new InvalidOperationException(rpfErr ?? "RPF extract failed");
            return;
        }

        // ZIP: fast path
        if (ext == "zip") { ExtractZipEntry(archivePath, entryNorm, destinationDir); return; }

        // 7z / RAR: SevenZipArchiveHost (solid / RAR5 / encrypted)
        if (SevenZipArchiveHost.PreferNative(archivePath) && SevenZipArchiveHost.IsAvailable())
        {
            var outLeaf = Path.GetFileName(entryNorm);
            if (string.IsNullOrEmpty(outLeaf)) outLeaf = entryNorm.Split('/').LastOrDefault() ?? "item";

            // SevenZipArchiveHost.TryExtractEntry extracts to a temp stage preserving archive paths.
            var tempStage = Path.Combine(Path.GetTempPath(), "BNDZ", "7z-stage", Guid.NewGuid().ToString("N"));
            try
            {
                if (SevenZipArchiveHost.TryExtractEntry(archivePath, entryNorm, tempStage))
                {
                    MoveFromStage(tempStage, entryNorm, destinationDir, outLeaf);
                    return;
                }
            }
            finally
            {
                try { Directory.Delete(tempStage, recursive: true); } catch { }
            }
        }

        // SharpCompress fallback
        ExtractEntryWithSharpCompress(archivePath, entryNorm, destinationDir);
    }

    /// <summary>
    /// SevenZipSharp extracts preserving archive-relative paths in stageDir.
    /// Re-root from entryNorm to destinationDir\outLeaf.
    /// </summary>
    private static void MoveFromStage(string stageDir, string entryNorm, string destDir, string outLeaf)
    {
        var entryWin = entryNorm.Replace('/', '\\');
        var source   = Path.Combine(stageDir, entryWin);

        if (File.Exists(source))
        {
            File.Copy(source, Path.Combine(destDir, outLeaf), overwrite: true);
        }
        else if (Directory.Exists(source))
        {
            var destSub = Path.Combine(destDir, outLeaf);
            Directory.CreateDirectory(destSub);
            foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
            {
                var rel      = Path.GetRelativePath(source, file);
                var destFile = Path.Combine(destSub, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(destFile)!);
                File.Copy(file, destFile, overwrite: true);
            }
        }
        else
        {
            // SevenZipSharp may have flattened paths — copy everything in stage as-is
            foreach (var file in Directory.EnumerateFiles(stageDir, "*", SearchOption.AllDirectories))
            {
                var rel  = Path.GetRelativePath(stageDir, file);
                var dest = Path.Combine(destDir, rel);
                Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
                File.Copy(file, dest, overwrite: true);
            }
        }
    }

    private static void ExtractZipEntry(string archivePath, string entryNorm, string destinationDir)
    {
        using var zip = ZipFile.OpenRead(archivePath);
        var matches = zip.Entries
            .Where(e =>
            {
                var full    = (e.FullName ?? "").Replace('\\', '/');
                var trimmed = full.TrimEnd('/');
                return trimmed.Equals(entryNorm, StringComparison.OrdinalIgnoreCase)
                    || full.StartsWith(entryNorm + "/", StringComparison.OrdinalIgnoreCase);
            })
            .ToList();
        if (matches.Count == 0)
            throw new FileNotFoundException("Entry not found in archive", entryNorm);

        var leafName = Path.GetFileName(entryNorm);
        if (string.IsNullOrEmpty(leafName)) leafName = "item";
        bool isTree = matches.Count > 1
            || matches.Any(e => (e.FullName ?? "").Replace('\\', '/').TrimEnd('/').Length > entryNorm.Length)
            || matches.Any(e => (e.FullName ?? "").EndsWith('/') || (e.FullName ?? "").EndsWith('\\'));

        foreach (var entry in matches)
        {
            var full = (entry.FullName ?? "").Replace('\\', '/');
            string destPath;
            if (!isTree)
            {
                destPath = Path.Combine(destinationDir, leafName);
            }
            else
            {
                var rel = full.StartsWith(entryNorm, StringComparison.OrdinalIgnoreCase)
                    ? full[entryNorm.Length..].TrimStart('/')
                    : Path.GetFileName(full.TrimEnd('/'));
                destPath = string.IsNullOrEmpty(rel)
                    ? Path.Combine(destinationDir, leafName)
                    : Path.Combine(destinationDir, leafName, rel.Replace('/', Path.DirectorySeparatorChar));
            }

            if (full.EndsWith('/') || string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(destPath);
                continue;
            }

            var parent = Path.GetDirectoryName(destPath);
            if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
            entry.ExtractToFile(destPath, overwrite: true);
        }
    }

    private static void ExtractEntryWithSharpCompress(string archivePath, string entryNorm, string destinationDir)
    {
        using var archive = ArchiveFactory.OpenArchive(archivePath);
        var arcMatches = archive.Entries
            .Where(e =>
            {
                var key = (e.Key ?? "").Replace('\\', '/').TrimEnd('/');
                return key.Equals(entryNorm, StringComparison.OrdinalIgnoreCase)
                    || key.StartsWith(entryNorm + "/", StringComparison.OrdinalIgnoreCase);
            })
            .ToList();
        if (arcMatches.Count == 0)
            throw new FileNotFoundException("Entry not found in archive", entryNorm);

        var outLeaf   = Path.GetFileName(entryNorm);
        if (string.IsNullOrEmpty(outLeaf)) outLeaf = "item";
        bool isFolder = arcMatches.Count > 1
            || arcMatches.Any(e => e.IsDirectory)
            || arcMatches.Any(e => (e.Key ?? "").Replace('\\', '/').TrimEnd('/').Length > entryNorm.Length);

        if (isFolder) Directory.CreateDirectory(Path.Combine(destinationDir, outLeaf));

        foreach (var arcEntry in arcMatches)
        {
            var key     = (arcEntry.Key ?? "").Replace('\\', '/');
            var keyTrim = key.TrimEnd('/');
            if (arcEntry.IsDirectory || key.EndsWith('/'))
            {
                var relDir  = keyTrim.StartsWith(entryNorm, StringComparison.OrdinalIgnoreCase)
                    ? keyTrim[entryNorm.Length..].TrimStart('/')
                    : Path.GetFileName(keyTrim);
                var dirPath = string.IsNullOrEmpty(relDir)
                    ? Path.Combine(destinationDir, outLeaf)
                    : Path.Combine(destinationDir, outLeaf, relDir.Replace('/', Path.DirectorySeparatorChar));
                Directory.CreateDirectory(dirPath);
                continue;
            }

            string destOut;
            if (!isFolder)
            {
                destOut = Path.Combine(destinationDir, outLeaf);
            }
            else
            {
                var rel = keyTrim.StartsWith(entryNorm, StringComparison.OrdinalIgnoreCase)
                    ? keyTrim[entryNorm.Length..].TrimStart('/')
                    : Path.GetFileName(keyTrim);
                destOut = Path.Combine(destinationDir, outLeaf, rel.Replace('/', Path.DirectorySeparatorChar));
            }

            var parentOut = Path.GetDirectoryName(destOut);
            if (!string.IsNullOrEmpty(parentOut)) Directory.CreateDirectory(parentOut);
            using var stream = arcEntry.OpenEntryStream();
            using var fs     = File.Create(destOut);
            stream.CopyTo(fs);
        }
    }

    // --------------------------------------------------------- extract to temp

    public string ExtractEntryToTemp(string archivePath, string entryPath)
    {
        archivePath = NormalizePath(archivePath);
        entryPath   = entryPath.Replace('\\', '/').TrimStart('/');
        var cacheKey = $"{archivePath}|{entryPath}";
        if (_tempExtractCache.TryGetValue(cacheKey, out var cached)
            && (File.Exists(cached) || Directory.Exists(cached)))
            return cached;

        var tempDir = Path.Combine(Path.GetTempPath(), "BNDZ", "archive-extract", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        ExtractEntry(archivePath, entryPath, tempDir);

        // RAGE mesh inside RPF/ZIP: also stage sibling .ytd next to the extracted file
        // so RageModelPreviewService can texture the orbit preview.
        TryExtractRageCompanionTextures(archivePath, entryPath, tempDir);

        var fileName = Path.GetFileName(entryPath.TrimEnd('/', '\\'));
        if (string.IsNullOrEmpty(fileName))
            fileName = entryPath.TrimEnd('/').Split('/').LastOrDefault() ?? "item";

        var candidate = Path.Combine(tempDir, fileName);
        string result;
        if (File.Exists(candidate) || Directory.Exists(candidate))
            result = candidate;
        else
        {
            var files = Directory.GetFiles(tempDir, "*", SearchOption.AllDirectories);
            if (files.Length > 0) result = files[0];
            else
            {
                var dirs = Directory.GetDirectories(tempDir, "*", SearchOption.AllDirectories);
                result = dirs.Length > 0 ? dirs[0] : tempDir;
            }
        }
        _tempExtractCache[cacheKey] = result;
        return result;
    }

    /// <summary>
    /// Sibling .ytd files already staged next to a RAGE mesh temp extract (for OLE drag-out).
    /// </summary>
    public static string[] CollectRageCompanionPaths(string extractedPath)
    {
        try
        {
            if (string.IsNullOrWhiteSpace(extractedPath) || !File.Exists(extractedPath))
                return Array.Empty<string>();
            if (!RageModelPreviewService.NeedsHostConversion(Path.GetExtension(extractedPath)))
                return Array.Empty<string>();
            var dir = Path.GetDirectoryName(extractedPath);
            if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir))
                return Array.Empty<string>();
            return Directory.GetFiles(dir, "*.ytd")
                .Where(f => !string.Equals(f, extractedPath, StringComparison.OrdinalIgnoreCase))
                .OrderBy(f => f, StringComparer.OrdinalIgnoreCase)
                .ToArray();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private void TryExtractRageCompanionTextures(string archivePath, string entryPath, string tempDir)
    {
        var ext = Path.GetExtension(entryPath).TrimStart('.').ToLowerInvariant();
        if (ext is not ("ydr" or "yft" or "ydd" or "ybn")) return;

        var siblingYtd = Path.ChangeExtension(entryPath, ".ytd")?.Replace('\\', '/');
        if (!string.IsNullOrWhiteSpace(siblingYtd))
        {
            try { ExtractEntry(archivePath, siblingYtd!, tempDir); }
            catch { /* optional companion */ }
        }

        // Also pull other .ytd siblings in the same archive folder (shared dictionaries).
        try
        {
            var folder = entryPath.Contains('/') ? entryPath[..entryPath.LastIndexOf('/')] : "";
            var listing = ListContents(archivePath, 8000);
            if (listing.Entries == null) return;
            var baseName = Path.GetFileNameWithoutExtension(entryPath);
            foreach (var e in listing.Entries)
            {
                if (e.IsDirectory) continue;
                var p = (e.Path ?? "").Replace('\\', '/').TrimStart('/');
                if (!p.EndsWith(".ytd", StringComparison.OrdinalIgnoreCase)) continue;
                var dir = p.Contains('/') ? p[..p.LastIndexOf('/')] : "";
                if (!string.Equals(dir, folder, StringComparison.OrdinalIgnoreCase)) continue;
                var leaf = Path.GetFileNameWithoutExtension(p);
                // Prefer exact / prefix / contains match to the drawable name
                if (!string.Equals(leaf, baseName, StringComparison.OrdinalIgnoreCase)
                    && !leaf.StartsWith(baseName!, StringComparison.OrdinalIgnoreCase)
                    && !baseName!.StartsWith(leaf, StringComparison.OrdinalIgnoreCase))
                    continue;
                if (siblingYtd != null && string.Equals(p, siblingYtd, StringComparison.OrdinalIgnoreCase))
                    continue;
                try { ExtractEntry(archivePath, p, tempDir); }
                catch { /* best-effort */ }
            }
        }
        catch { /* listing optional */ }
    }

    // ------------------------------------------------------------ add to archive

    public void AddFilesToArchive(string archivePath, IEnumerable<string> sourcePaths, IEnumerable<string>? entryNames = null)
    {
        archivePath = NormalizePath(archivePath);
        var sources  = sourcePaths.Select(NormalizePath).Where(p => File.Exists(p) || Directory.Exists(p)).ToList();
        var names    = entryNames?.ToList();
        if (sources.Count == 0) throw new InvalidOperationException("No valid files or folders to add");

        var ext      = Path.GetExtension(archivePath).TrimStart('.').ToLowerInvariant();
        var filePairs = new List<(string fullPath, string entryName)>();

        if (names != null && names.Count == sources.Count && sources.All(File.Exists))
            for (int i = 0; i < sources.Count; i++)
                filePairs.Add((sources[i], names[i].Replace('\\', '/')));
        else
            filePairs = CollectFiles(sources);

        if (filePairs.Count == 0) throw new InvalidOperationException("No valid files to add");

        if (ext == "zip") { AddFilesToZipArchive(archivePath, filePairs); return; }
        if (ext == "7z")  { AddFilesTo7zArchive(archivePath, filePairs);  return; }
        if (ext == "rar" && TryAddToRarViaWinRar(archivePath,
                filePairs.Select(p => p.fullPath).ToList(),
                filePairs.Select(p => p.entryName).ToList()))
            return;

        throw new NotSupportedException("Drag-in is supported for ZIP, 7z, and RAR (WinRAR).");
    }

    private static void AddFilesToZipArchive(string archivePath, List<(string, string)> filePairs)
    {
        using var zip = ZipFile.Open(archivePath, ZipArchiveMode.Update);
        foreach (var (fullPath, entryName) in filePairs)
        {
            var normalized = entryName.Replace('\\', '/');
            zip.GetEntry(normalized)?.Delete();
            zip.CreateEntryFromFile(fullPath, normalized, CompressionLevel.Optimal);
        }
    }

    private static void AddFilesTo7zArchive(string archivePath, List<(string fullPath, string entryName)> filePairs)
    {
        var tempPath = archivePath + ".bndz.tmp";
        if (File.Exists(tempPath)) File.Delete(tempPath);

        using (var output = File.Open(tempPath, FileMode.CreateNew))
        using (var writer = WriterFactory.OpenWriter(output, ArchiveType.SevenZip, new WriterOptions(CompressionType.Deflate)))
        {
            if (File.Exists(archivePath))
            {
                using var existing = ArchiveFactory.OpenArchive(archivePath);
                foreach (var entry in existing.Entries.Where(e => !e.IsDirectory))
                {
                    using var stream = entry.OpenEntryStream();
                    writer.Write(entry.Key ?? "", stream, entry.LastModifiedTime ?? DateTime.Now);
                }
            }
            foreach (var (fullPath, entryName) in filePairs)
            {
                using var input = File.OpenRead(fullPath);
                writer.Write(entryName.Replace('\\', '/'), input, File.GetLastWriteTime(fullPath));
            }
        }

        File.Copy(tempPath, archivePath, overwrite: true);
        File.Delete(tempPath);
    }

    // ------------------------------------------------------------ extract all

    public async Task ExtractArchiveAsync(
        string archivePath,
        string destinationDir,
        Action<int, string>? onProgress = null,
        CancellationToken cancellationToken = default)
    {
        await Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            archivePath    = NormalizePath(archivePath);
            destinationDir = NormalizePath(destinationDir);

            if (!File.Exists(archivePath))
                throw new FileNotFoundException("Archive not found", archivePath);

            if (!Directory.Exists(destinationDir))
                Directory.CreateDirectory(destinationDir);

            var ext = Path.GetExtension(archivePath).TrimStart('.').ToLowerInvariant();

            if (ext == "zip")
            {
                ExtractZipAll(archivePath, destinationDir, onProgress, cancellationToken);
                return;
            }

            // SevenZipArchiveHost: solid / RAR5 / encrypted
            if (SevenZipArchiveHost.PreferNative(archivePath) && SevenZipArchiveHost.IsAvailable())
            {
                if (SevenZipArchiveHost.TryExtractAll(archivePath, destinationDir, onProgress))
                    return;
            }

            ExtractAllWithSharpCompress(archivePath, destinationDir, onProgress, cancellationToken);

        }, cancellationToken).ConfigureAwait(false);
    }

    private static void ExtractZipAll(
        string archivePath, string destinationDir,
        Action<int, string>? onProgress, CancellationToken ct)
    {
        using var zip = ZipFile.OpenRead(archivePath);
        var entries   = zip.Entries.Where(e => !string.IsNullOrEmpty(e.Name)).ToList();
        int i = 0;
        foreach (var entry in entries)
        {
            ct.ThrowIfCancellationRequested();
            onProgress?.Invoke(ProgressAfterIndex(i, entries.Count), entry.FullName);
            var destPath   = Path.Combine(destinationDir, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
            var destParent = Path.GetDirectoryName(destPath);
            if (!string.IsNullOrEmpty(destParent)) Directory.CreateDirectory(destParent);
            if (entry.FullName.EndsWith('/') || entry.FullName.EndsWith('\\'))
                Directory.CreateDirectory(destPath);
            else
                entry.ExtractToFile(destPath, overwrite: true);
            i++;
            onProgress?.Invoke(ProgressAfterIndex(i, entries.Count), entry.FullName);
        }
    }

    private static void ExtractAllWithSharpCompress(
        string archivePath, string destinationDir,
        Action<int, string>? onProgress, CancellationToken ct)
    {
        using var archive = ArchiveFactory.OpenArchive(archivePath);
        var arcEntries    = archive.Entries.Where(e => !e.IsDirectory).ToList();
        int n = 0;
        foreach (var entry in arcEntries)
        {
            ct.ThrowIfCancellationRequested();
            onProgress?.Invoke(ProgressAfterIndex(n, arcEntries.Count), entry.Key ?? "");
            entry.WriteToDirectory(destinationDir, new ExtractionOptions { ExtractFullPath = true, Overwrite = true });
            n++;
            onProgress?.Invoke(ProgressAfterIndex(n, arcEntries.Count), entry.Key ?? "");
        }
    }

    // ----------------------------------------------------------------- WinRAR

    private static bool TryCreateRarViaWinRar(
        List<string> sources, string target,
        Action<int, string>? onProgress, CancellationToken ct, Action<Process>? onProcessStarted)
    {
        var rarExe = FindWinRarExe();
        if (rarExe == null) return false;
        ct.ThrowIfCancellationRequested();
        if (File.Exists(target)) File.Delete(target);
        var args = $"a -ep1 -idq \"{target}\" {string.Join(" ", sources.Select(s => $"\"{s}\""))}";
        var psi  = new ProcessStartInfo { FileName = rarExe, Arguments = args, UseShellExecute = false, CreateNoWindow = true };
        using var proc = Process.Start(psi);
        if (proc == null) return false;
        onProcessStarted?.Invoke(proc);
        onProgress?.Invoke(5, target);
        while (!proc.WaitForExit(250))
        {
            if (!ct.IsCancellationRequested) { onProgress?.Invoke(50, target); continue; }
            try { proc.Kill(entireProcessTree: true); } catch { try { proc.Kill(); } catch { } }
            ct.ThrowIfCancellationRequested();
        }
        ct.ThrowIfCancellationRequested();
        onProgress?.Invoke(99, target);
        return proc.ExitCode == 0;
    }

    private static bool TryAddToRarViaWinRar(string archivePath, List<string> sources, List<string>? entryNames)
    {
        var rarExe = FindWinRarExe();
        if (rarExe == null || !File.Exists(archivePath)) return false;
        var sb = new System.Text.StringBuilder($"a -idq \"{archivePath}\"");
        for (int i = 0; i < sources.Count; i++)
        {
            var src = sources[i];
            if (!File.Exists(src)) continue;
            if (entryNames != null && i < entryNames.Count && !string.IsNullOrWhiteSpace(entryNames[i]))
                sb.Append($" -ep \"{src}\" \"{entryNames[i].Replace('/', '\\')}\"");
            else
                sb.Append($" \"{src}\"");
        }
        var psi  = new ProcessStartInfo { FileName = rarExe, Arguments = sb.ToString(), UseShellExecute = false, CreateNoWindow = true };
        using var proc = Process.Start(psi);
        proc?.WaitForExit();
        return proc?.ExitCode == 0;
    }

    private static string? FindWinRarExe()
    {
        return new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WinRAR", "Rar.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "WinRAR", "Rar.exe"),
        }.FirstOrDefault(File.Exists);
    }

    // ---------------------------------------------------------------- utils

    private static List<(string fullPath, string entryName)> CollectFiles(List<string> sources)
    {
        var result = new List<(string, string)>();
        foreach (var source in sources)
        {
            if (File.Exists(source))
            {
                result.Add((source, Path.GetFileName(source)));
            }
            else if (Directory.Exists(source))
            {
                var rootName = Path.GetFileName(source.TrimEnd('\\', '/'));
                foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
                {
                    var rel = Path.GetRelativePath(source, file).Replace('\\', '/');
                    result.Add((file, $"{rootName}/{rel}"));
                }
            }
        }
        return result;
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

    // ---------------------------------------------------------------- DTOs

    public sealed class ArchiveEntryDto
    {
        public string  Path           { get; set; } = "";
        public string  Name           { get; set; } = "";
        public long    Size           { get; set; }
        public long    CompressedSize { get; set; }
        public bool    IsDirectory    { get; set; }
        public string? Modified       { get; set; }
        public bool    Encrypted      { get; set; }
    }

    public sealed class ArchiveContentsResult
    {
        public string?              Format              { get; set; }
        public int                  EntryCount          { get; set; }
        public long                 TotalSize           { get; set; }
        public long                 TotalCompressedSize { get; set; }
        public List<ArchiveEntryDto> Entries            { get; set; } = new();
        public string?              Error               { get; set; }
        /// <summary>Set when SevenZipSharp (7z.dll) handled the operation — solid/RAR5/encrypted.</summary>
        public bool                 SevenZipBacked      { get; set; }
    }
}
