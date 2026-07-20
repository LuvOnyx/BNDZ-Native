using System;
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

public sealed class ArchiveService
{
    private static readonly HashSet<string> ArchiveExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "cab", "iso", "jar", "war"
    };

    public static bool IsArchivePath(string path)
    {
        var ext = Path.GetExtension(path).TrimStart('.');
        return ArchiveExtensions.Contains(ext);
    }

    public ArchiveContentsResult ListContents(string path, int limit = 5000)
    {
        path = NormalizePath(path);
        if (!File.Exists(path))
            return new ArchiveContentsResult { Error = "File not found" };

        var ext = Path.GetExtension(path).TrimStart('.').ToLowerInvariant();
        try
        {
            if (ext == "zip")
                return ListZipContents(path, limit);

            using var archive = ArchiveFactory.OpenArchive(path);
            var entries = new List<ArchiveEntryDto>();
            long totalSize = 0;
            long totalCompressed = 0;

            foreach (var entry in archive.Entries.Where(e => !e.IsDirectory).Take(limit))
            {
                entries.Add(new ArchiveEntryDto
                {
                    Path = entry.Key ?? "",
                    Name = Path.GetFileName(entry.Key ?? "") ?? entry.Key ?? "",
                    Size = entry.Size,
                    CompressedSize = entry.CompressedSize,
                    IsDirectory = entry.IsDirectory,
                    Modified = entry.LastModifiedTime?.ToString("O")
                });
                totalSize += entry.Size;
                totalCompressed += entry.CompressedSize;
            }

            foreach (var entry in archive.Entries.Where(e => e.IsDirectory).Take(Math.Max(0, limit - entries.Count)))
            {
                entries.Add(new ArchiveEntryDto
                {
                    Path = entry.Key ?? "",
                    Name = Path.GetFileName(entry.Key?.TrimEnd('/', '\\') ?? "") ?? entry.Key ?? "",
                    Size = 0,
                    CompressedSize = 0,
                    IsDirectory = true,
                    Modified = entry.LastModifiedTime?.ToString("O")
                });
            }

            return new ArchiveContentsResult
            {
                Format = ext,
                EntryCount = entries.Count,
                TotalSize = totalSize,
                TotalCompressedSize = totalCompressed,
                Entries = entries.OrderBy(e => e.Path).ToList()
            };
        }
        catch (Exception ex)
        {
            return new ArchiveContentsResult { Error = ex.Message, Format = ext };
        }
    }

    private static ArchiveContentsResult ListZipContents(string path, int limit)
    {
        var entries = new List<ArchiveEntryDto>();
        long totalSize = 0;
        long totalCompressed = 0;

        using var zip = ZipFile.OpenRead(path);
        foreach (var entry in zip.Entries.Take(limit))
        {
            entries.Add(new ArchiveEntryDto
            {
                Path = entry.FullName,
                Name = entry.Name,
                Size = entry.Length,
                CompressedSize = entry.CompressedLength,
                IsDirectory = entry.FullName.EndsWith('/') || string.IsNullOrEmpty(entry.Name),
                Modified = entry.LastWriteTime.ToString("O")
            });
            if (!entry.FullName.EndsWith('/'))
            {
                totalSize += entry.Length;
                totalCompressed += entry.CompressedLength;
            }
        }

        return new ArchiveContentsResult
        {
            Format = "zip",
            EntryCount = entries.Count,
            TotalSize = totalSize,
            TotalCompressedSize = totalCompressed,
            Entries = entries.OrderBy(e => e.Path).ToList()
        };
    }

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
            var sources = sourcePaths.Select(NormalizePath).Where(p => File.Exists(p) || Directory.Exists(p)).ToList();
            targetArchivePath = NormalizePath(targetArchivePath);
            format = (format ?? "zip").ToLowerInvariant();

            if (sources.Count == 0)
                throw new InvalidOperationException("No valid source paths");

            var targetDir = Path.GetDirectoryName(targetArchivePath);
            if (!string.IsNullOrEmpty(targetDir) && !Directory.Exists(targetDir))
                Directory.CreateDirectory(targetDir);

            if (format == "zip")
            {
                CreateZipArchive(sources, targetArchivePath, onProgress, cancellationToken);
                return;
            }

            if (format is "7z" or "tar" or "gz")
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

            throw new NotSupportedException($"Archive format '{format}' is not supported for creation. Use zip, 7z, or rar (WinRAR).");
        }, cancellationToken).ConfigureAwait(false);
    }

    /// <summary>Progress after each file; capped at 99 until the caller marks the job complete.</summary>
    private static int ProgressAfterIndex(int completedCount, int totalCount)
    {
        if (totalCount <= 0) return 99;
        return Math.Min(99, (int)(completedCount * 99.0 / totalCount));
    }

    private static void CreateZipArchive(
        List<string> sources,
        string target,
        Action<int, string>? onProgress,
        CancellationToken cancellationToken)
    {
        if (File.Exists(target)) File.Delete(target);

        using var zipStream = new FileStream(target, FileMode.CreateNew);
        using var archive = new ZipArchive(zipStream, ZipArchiveMode.Create);

        var allFiles = CollectFiles(sources);
        int i = 0;
        foreach (var (fullPath, entryName) in allFiles)
        {
            cancellationToken.ThrowIfCancellationRequested();
            onProgress?.Invoke(ProgressAfterIndex(i, allFiles.Count), entryName);
            archive.CreateEntryFromFile(fullPath, entryName, CompressionLevel.Optimal);
            i++;
            onProgress?.Invoke(ProgressAfterIndex(i, allFiles.Count), entryName);
        }
    }

    private static void CreateSharpCompressArchive(
        List<string> sources,
        string target,
        string format,
        Action<int, string>? onProgress,
        CancellationToken cancellationToken)
    {
        if (File.Exists(target)) File.Delete(target);

        ArchiveType archiveType = format switch
        {
            "7z" => ArchiveType.SevenZip,
            "tar" => ArchiveType.Tar,
            "gz" => ArchiveType.GZip,
            _ => ArchiveType.Zip
        };

        using var stream = File.Open(target, FileMode.CreateNew);
        using var writer = WriterFactory.OpenWriter(stream, archiveType, new WriterOptions(CompressionType.Deflate));

        var allFiles = CollectFiles(sources);
        int i = 0;
        foreach (var (fullPath, entryName) in allFiles)
        {
            cancellationToken.ThrowIfCancellationRequested();
            onProgress?.Invoke(ProgressAfterIndex(i, allFiles.Count), entryName);
            using var input = File.OpenRead(fullPath);
            writer.Write(entryName.Replace('\\', '/'), input, DateTime.Now);
            i++;
            onProgress?.Invoke(ProgressAfterIndex(i, allFiles.Count), entryName);
        }
    }

    public void ExtractEntry(string archivePath, string entryPath, string destinationDir)
    {
        archivePath = NormalizePath(archivePath);
        destinationDir = NormalizePath(destinationDir);
        entryPath = entryPath.Replace('\\', '/').TrimStart('/');

        if (!File.Exists(archivePath))
            throw new FileNotFoundException("Archive not found", archivePath);

        if (!Directory.Exists(destinationDir))
            Directory.CreateDirectory(destinationDir);

        var ext = Path.GetExtension(archivePath).TrimStart('.').ToLowerInvariant();
        if (ext == "zip")
        {
            using var zip = ZipFile.OpenRead(archivePath);
            var entry = zip.GetEntry(entryPath) ?? zip.Entries.FirstOrDefault(e =>
                e.FullName.Equals(entryPath, StringComparison.OrdinalIgnoreCase) ||
                e.FullName.TrimEnd('/').Equals(entryPath, StringComparison.OrdinalIgnoreCase));
            if (entry == null) throw new FileNotFoundException("Entry not found in archive", entryPath);
            string destFile = Path.Combine(destinationDir, Path.GetFileName(entryPath.TrimEnd('/')));
            entry.ExtractToFile(destFile, overwrite: true);
            return;
        }

        using var archive = ArchiveFactory.OpenArchive(archivePath);
        var arcEntry = archive.Entries.FirstOrDefault(e =>
            (e.Key ?? "").Replace('\\', '/').TrimEnd('/').Equals(entryPath, StringComparison.OrdinalIgnoreCase));
        if (arcEntry == null) throw new FileNotFoundException("Entry not found in archive", entryPath);
        if (arcEntry.IsDirectory)
        {
            string dir = Path.Combine(destinationDir, Path.GetFileName(entryPath.TrimEnd('/')));
            Directory.CreateDirectory(dir);
            return;
        }
        using var stream = arcEntry.OpenEntryStream();
        string destOut = Path.Combine(destinationDir, Path.GetFileName(entryPath.TrimEnd('/', '\\')));
        using var fs = File.Create(destOut);
        stream.CopyTo(fs);
    }

    /// <summary>Extract a single entry to a temp folder for drag-out / preview. Returns absolute path to extracted file or folder.</summary>
    public string ExtractEntryToTemp(string archivePath, string entryPath)
    {
        archivePath = NormalizePath(archivePath);
        entryPath = entryPath.Replace('\\', '/').TrimStart('/');
        var tempDir = Path.Combine(Path.GetTempPath(), "BNDZ", "archive-extract", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempDir);
        ExtractEntry(archivePath, entryPath, tempDir);
        var fileName = Path.GetFileName(entryPath.TrimEnd('/', '\\'));
        if (string.IsNullOrEmpty(fileName))
            fileName = entryPath.TrimEnd('/').Split('/').LastOrDefault() ?? "item";
        var candidate = Path.Combine(tempDir, fileName);
        if (File.Exists(candidate) || Directory.Exists(candidate))
            return candidate;
        // SharpCompress may preserve subpaths — find first extracted item
        var files = Directory.GetFiles(tempDir, "*", SearchOption.AllDirectories);
        if (files.Length > 0) return files[0];
        var dirs = Directory.GetDirectories(tempDir, "*", SearchOption.AllDirectories);
        if (dirs.Length > 0) return dirs[0];
        return tempDir;
    }

    public void AddFilesToArchive(string archivePath, IEnumerable<string> sourcePaths, IEnumerable<string>? entryNames = null)
    {
        archivePath = NormalizePath(archivePath);
        var sources = sourcePaths.Select(NormalizePath).Where(p => File.Exists(p) || Directory.Exists(p)).ToList();
        var names = entryNames?.ToList();
        if (sources.Count == 0) throw new InvalidOperationException("No valid files or folders to add");

        var ext = Path.GetExtension(archivePath).TrimStart('.').ToLowerInvariant();
        var filePairs = new List<(string fullPath, string entryName)>();

        if (names != null && names.Count == sources.Count && sources.All(File.Exists))
        {
            for (int i = 0; i < sources.Count; i++)
                filePairs.Add((sources[i], names[i].Replace('\\', '/')));
        }
        else
        {
            filePairs = CollectFiles(sources);
        }

        if (filePairs.Count == 0) throw new InvalidOperationException("No valid files to add");

        if (ext == "zip")
        {
            AddFilesToZipArchive(archivePath, filePairs);
            return;
        }

        if (ext == "7z")
        {
            AddFilesTo7zArchive(archivePath, filePairs);
            return;
        }

        if (ext == "rar" && TryAddToRarViaWinRar(archivePath, filePairs.Select(p => p.fullPath).ToList(), filePairs.Select(p => p.entryName).ToList()))
            return;

        throw new NotSupportedException("Drag-in is supported for ZIP, 7z, and RAR (WinRAR). Extract and re-pack for other formats.");
    }

    private static void AddFilesToZipArchive(string archivePath, List<(string fullPath, string entryName)> filePairs)
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

    public async Task ExtractArchiveAsync(
        string archivePath,
        string destinationDir,
        Action<int, string>? onProgress = null,
        CancellationToken cancellationToken = default)
    {
        await Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            archivePath = NormalizePath(archivePath);
            destinationDir = NormalizePath(destinationDir);

            if (!File.Exists(archivePath))
                throw new FileNotFoundException("Archive not found", archivePath);

            if (!Directory.Exists(destinationDir))
                Directory.CreateDirectory(destinationDir);

            var ext = Path.GetExtension(archivePath).TrimStart('.').ToLowerInvariant();
            if (ext == "zip")
            {
                using var zip = ZipFile.OpenRead(archivePath);
                var entries = zip.Entries.Where(e => !string.IsNullOrEmpty(e.Name)).ToList();
                int i = 0;
                foreach (var entry in entries)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    onProgress?.Invoke(ProgressAfterIndex(i, entries.Count), entry.FullName);
                    var destPath = Path.Combine(destinationDir, entry.FullName.Replace('/', Path.DirectorySeparatorChar));
                    var destParent = Path.GetDirectoryName(destPath);
                    if (!string.IsNullOrEmpty(destParent))
                        Directory.CreateDirectory(destParent);
                    if (entry.FullName.EndsWith('/') || entry.FullName.EndsWith('\\'))
                    {
                        Directory.CreateDirectory(destPath);
                    }
                    else
                    {
                        entry.ExtractToFile(destPath, overwrite: true);
                    }
                    i++;
                    onProgress?.Invoke(ProgressAfterIndex(i, entries.Count), entry.FullName);
                }
                return;
            }

            using var archive = ArchiveFactory.OpenArchive(archivePath);
            var arcEntries = archive.Entries.Where(e => !e.IsDirectory).ToList();
            int n = 0;
            foreach (var entry in arcEntries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                onProgress?.Invoke(ProgressAfterIndex(n, arcEntries.Count), entry.Key ?? "");
                entry.WriteToDirectory(destinationDir, new ExtractionOptions { ExtractFullPath = true, Overwrite = true });
                n++;
                onProgress?.Invoke(ProgressAfterIndex(n, arcEntries.Count), entry.Key ?? "");
            }
        }, cancellationToken).ConfigureAwait(false);
    }

    private static bool TryCreateRarViaWinRar(
        List<string> sources,
        string target,
        Action<int, string>? onProgress,
        CancellationToken cancellationToken,
        Action<Process>? onProcessStarted)
    {
        var rarExe = FindWinRarExe();
        if (rarExe == null) return false;

        cancellationToken.ThrowIfCancellationRequested();
        if (File.Exists(target)) File.Delete(target);
        var args = $"a -ep1 -idq \"{target}\" {string.Join(" ", sources.Select(s => $"\"{s}\""))}";
        var psi = new ProcessStartInfo
        {
            FileName = rarExe,
            Arguments = args,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using var proc = Process.Start(psi);
        if (proc == null) return false;
        onProcessStarted?.Invoke(proc);
        onProgress?.Invoke(5, target);

        while (!proc.WaitForExit(250))
        {
            if (cancellationToken.IsCancellationRequested)
            {
                try { proc.Kill(entireProcessTree: true); } catch { try { proc.Kill(); } catch { /* ignore */ } }
                cancellationToken.ThrowIfCancellationRequested();
            }
            onProgress?.Invoke(50, target);
        }

        if (cancellationToken.IsCancellationRequested)
            cancellationToken.ThrowIfCancellationRequested();

        onProgress?.Invoke(99, target);
        return proc.ExitCode == 0;
    }

    private static bool TryAddToRarViaWinRar(string archivePath, List<string> sources, List<string>? entryNames)
    {
        var rarExe = FindWinRarExe();
        if (rarExe == null) return false;
        if (!File.Exists(archivePath)) return false;

        var args = new System.Text.StringBuilder($"a -idq \"{archivePath}\"");
        for (int i = 0; i < sources.Count; i++)
        {
            var src = sources[i];
            if (!File.Exists(src)) continue;
            if (entryNames != null && i < entryNames.Count && !string.IsNullOrWhiteSpace(entryNames[i]))
            {
                var entry = entryNames[i].Replace('/', '\\');
                args.Append($" -ep \"{src}\" \"{entry}\"");
            }
            else
            {
                args.Append($" \"{src}\"");
            }
        }

        var psi = new ProcessStartInfo
        {
            FileName = rarExe,
            Arguments = args.ToString(),
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        using var proc = Process.Start(psi);
        proc?.WaitForExit();
        return proc?.ExitCode == 0;
    }

    private static string? FindWinRarExe()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WinRAR", "Rar.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "WinRAR", "Rar.exe"),
        };
        return candidates.FirstOrDefault(File.Exists);
    }

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

    public sealed class ArchiveEntryDto
    {
        public string Path { get; set; } = "";
        public string Name { get; set; } = "";
        public long Size { get; set; }
        public long CompressedSize { get; set; }
        public bool IsDirectory { get; set; }
        public string? Modified { get; set; }
    }

    public sealed class ArchiveContentsResult
    {
        public string? Format { get; set; }
        public int EntryCount { get; set; }
        public long TotalSize { get; set; }
        public long TotalCompressedSize { get; set; }
        public List<ArchiveEntryDto> Entries { get; set; } = new();
        public string? Error { get; set; }
    }
}
