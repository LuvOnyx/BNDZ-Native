using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

public class FileOperationService
{
    private const long MaxVerifyHashBytes = 256L * 1024 * 1024;
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEOPSTRUCT
    {
        public IntPtr hwnd;
        public uint wFunc;
        public string pFrom;
        public string pTo;
        public ushort fFlags;
        public bool fAnyOperationsAborted;
        public IntPtr hNameMappings;
        public string lpszProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHFileOperation(ref SHFILEOPSTRUCT fileOp);

    private const uint FO_DELETE = 0x0003;
    private const ushort FOF_ALLOWUNDO = 0x0040;
    private const ushort FOF_NOCONFIRMATION = 0x0010;
    private const ushort FOF_SILENT = 0x0004;

    private BndzActionLogService? _actionLog;

    public void SetActionLog(BndzActionLogService? actionLog) => _actionLog = actionLog;

    public Task ExecuteUndoAsync() => Task.CompletedTask;
    public Task ExecuteRedoAsync() => Task.CompletedTask;

    public async Task ExecuteOperationAsync(
        string operationId,
        string action,
        List<string> sources,
        string target,
        bool bypassRecycleBin,
        Action<string, int, string, long, long, double, int, int>? onProgress = null,
        Func<string, string, string, string, Task<string>>? onConflict = null,
        bool recordActionLog = true,
        Action<string, string>? onAccessDenied = null,
        CancellationToken cancellationToken = default)
    {
        sources = sources.Select(NormalizePath).Where(s => !string.IsNullOrEmpty(s)).ToList();
        target = NormalizePath(target);
        action = (action ?? "copy").ToLowerInvariant();

        try
        {
            switch (action)
            {
                case "create-dir":
                {
                    var dir = !string.IsNullOrEmpty(target) ? target : sources.FirstOrDefault() ?? "";
                    if (!string.IsNullOrEmpty(dir))
                    {
                        var existed = Directory.Exists(dir);
                        Directory.CreateDirectory(dir);
                        if (!existed && recordActionLog) _actionLog?.Record(BndzActionLogService.ForCreateDir(dir));
                    }
                    onProgress?.Invoke(operationId, 100, dir, 0, 0, 0, 1, 1);
                    break;
                }

                case "create-file":
                {
                    var filePath = !string.IsNullOrEmpty(target) ? target : sources.FirstOrDefault() ?? "";
                    if (!string.IsNullOrEmpty(filePath))
                    {
                        var dir = Path.GetDirectoryName(filePath);
                        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                            Directory.CreateDirectory(dir);
                        var existed = File.Exists(filePath);
                        if (!existed) File.WriteAllBytes(filePath, Array.Empty<byte>());
                        if (!existed && recordActionLog) _actionLog?.Record(BndzActionLogService.ForCreateFile(filePath));
                    }
                    onProgress?.Invoke(operationId, 100, filePath, 0, 0, 0, 1, 1);
                    break;
                }

                case "delete":
                    await DeleteItemsAsync(operationId, sources, bypassRecycleBin, onProgress, cancellationToken);
                    if (sources.Count > 0 && recordActionLog)
                        _actionLog?.Record(BndzActionLogService.ForDelete(sources, !bypassRecycleBin));
                    break;

                case "copy":
                {
                    var created = await CopyOrMoveAsync(operationId, sources, target, move: false, onProgress, onConflict, cancellationToken).ConfigureAwait(false);
                    if (created.Count > 0 && recordActionLog)
                        _actionLog?.Record(BndzActionLogService.ForCopy(sources, created));
                    break;
                }

                case "move":
                {
                    var movedTo = await CopyOrMoveAsync(operationId, sources, target, move: true, onProgress, onConflict, cancellationToken).ConfigureAwait(false);
                    if (movedTo.Count > 0 && recordActionLog)
                        _actionLog?.Record(BndzActionLogService.ForMove(sources, movedTo));
                    break;
                }

                default:
                    onProgress?.Invoke(operationId, 100, sources.FirstOrDefault() ?? "", 0, 0, 0, 1, 1);
                    break;
            }
        }
        catch (UnauthorizedAccessException ex)
        {
            onAccessDenied?.Invoke(operationId, ex.Message);
            onProgress?.Invoke(operationId, 100, ex.Message, 0, 0, 0, 1, 1);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"FileOperation {action} failed: {ex.Message}");
            onProgress?.Invoke(operationId, 100, ex.Message, 0, 0, 0, 1, 1);
        }
    }

    public async Task<BatchRenameResult> ExecuteBatchRenameAsync(
        string operationId,
        IReadOnlyList<(string Source, string Target)> renames,
        bool recordActionLog = true,
        Action<string, int, string, long, long, double, int, int>? onProgress = null,
        CancellationToken cancellationToken = default)
    {
        var appliedSources = new List<string>();
        var appliedTargets = new List<string>();
        var skipped = 0;
        var total = renames.Count;

        for (int i = 0; i < renames.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var (source, target) = renames[i];
            source = NormalizePath(source);
            target = NormalizePath(target);

            if (string.IsNullOrEmpty(source) || string.IsNullOrEmpty(target))
            {
                skipped++;
                continue;
            }

            if (string.Equals(source, target, StringComparison.OrdinalIgnoreCase))
            {
                skipped++;
                continue;
            }

            if (!File.Exists(source) && !Directory.Exists(source))
                throw new FileNotFoundException($"Source not found: {source}");

            if (File.Exists(target) || Directory.Exists(target))
                throw new IOException($"Target already exists: {target}");

            await ExecuteOperationAsync(
                $"{operationId}-{i}",
                "move",
                new List<string> { source },
                target,
                bypassRecycleBin: true,
                onProgress: onProgress,
                recordActionLog: false,
                cancellationToken: cancellationToken).ConfigureAwait(false);

            appliedSources.Add(source);
            appliedTargets.Add(target);
            onProgress?.Invoke(operationId, (int)((i + 1) * 100.0 / Math.Max(total, 1)), target, 0, 0, 0, i + 1, total);
        }

        if (appliedSources.Count > 0 && recordActionLog)
            _actionLog?.Record(BndzActionLogService.ForBatchRename(appliedSources, appliedTargets));

        return new BatchRenameResult
        {
            Renamed = appliedSources.Count,
            Skipped = skipped,
            Failed = 0,
        };
    }

    private static async Task DeleteItemsAsync(
        string operationId,
        List<string> sources,
        bool bypassRecycleBin,
        Action<string, int, string, long, long, double, int, int>? onProgress,
        CancellationToken cancellationToken)
    {
        int total = sources.Count;
        for (int i = 0; i < sources.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var src = sources[i];
            try
            {
                if (bypassRecycleBin)
                {
                    if (File.Exists(src)) File.Delete(src);
                    else if (Directory.Exists(src)) Directory.Delete(src, true);
                }
                else
                {
                    DeleteToRecycleBin(src);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Delete failed {src}: {ex.Message}");
            }
            onProgress?.Invoke(operationId, (int)((i + 1) * 100.0 / total), src, 0, 0, 0, i + 1, total);
            await Task.Yield();
        }
    }

    private static void DeleteToRecycleBin(string path)
    {
        var from = path + "\0\0";
        var fileop = new SHFILEOPSTRUCT
        {
            wFunc = FO_DELETE,
            pFrom = from,
            pTo = "",
            fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT,
        };
        SHFileOperation(ref fileop);
    }

    private static async Task<List<string>> CopyOrMoveAsync(
        string operationId,
        List<string> sources,
        string targetDir,
        bool move,
        Action<string, int, string, long, long, double, int, int>? onProgress,
        Func<string, string, string, string, Task<string>>? onConflict,
        CancellationToken cancellationToken)
    {
        var createdPaths = new List<string>();
        if (string.IsNullOrEmpty(targetDir))
            targetDir = Path.GetDirectoryName(sources.FirstOrDefault() ?? "") ?? "";

        if (move && sources.Count == 1 && !string.IsNullOrEmpty(targetDir))
        {
            var singleSrc = sources[0];
            if (File.Exists(singleSrc) && !Directory.Exists(targetDir))
            {
                var destFile = targetDir;
                if (!destFile.EndsWith(Path.GetFileName(singleSrc), StringComparison.OrdinalIgnoreCase)
                    && !File.Exists(destFile))
                    destFile = Path.Combine(targetDir, Path.GetFileName(singleSrc));
                if (File.Exists(destFile) && onConflict != null)
                {
                    var resolution = await onConflict(operationId, Path.GetFileName(destFile), singleSrc, destFile);
                    if (resolution == "skip") return createdPaths;
                    if (resolution == "keepboth") destFile = GetUniquePath(destFile);
                }
                var destDir = Path.GetDirectoryName(destFile);
                if (!string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
                    Directory.CreateDirectory(destDir);
                File.Move(singleSrc, destFile, overwrite: true);
                createdPaths.Add(destFile);
                onProgress?.Invoke(operationId, 100, singleSrc, 0, 0, 0, 1, 1);
                return createdPaths;
            }
        }

        if (!Directory.Exists(targetDir))
            Directory.CreateDirectory(targetDir);

        var work = new List<(string src, string dest, long size)>();
        foreach (var src in sources)
        {
            if (File.Exists(src))
            {
                var dest = Path.Combine(targetDir, Path.GetFileName(src));
                work.Add((src, dest, new FileInfo(src).Length));
            }
            else if (Directory.Exists(src))
            {
                var destRoot = Path.Combine(targetDir, Path.GetFileName(src.TrimEnd('\\', '/')));
                foreach (var file in Directory.EnumerateFiles(src, "*", SearchOption.AllDirectories))
                {
                    var rel = Path.GetRelativePath(src, file);
                    var dest = Path.Combine(destRoot, rel);
                    work.Add((file, dest, new FileInfo(file).Length));
                }
            }
        }

        long totalBytes = work.Sum(w => w.size);
        long transferred = 0;
        var sw = Stopwatch.StartNew();

        for (int i = 0; i < work.Count; i++)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var (src, dest, size) = work[i];
            var destDir = Path.GetDirectoryName(dest);
            if (!string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
                Directory.CreateDirectory(destDir);

            if (File.Exists(dest) && onConflict != null)
            {
                var resolution = await onConflict(operationId, Path.GetFileName(dest), src, dest);
                if (resolution == "skip") continue;
                if (resolution == "keepboth")
                    dest = GetUniquePath(dest);
            }

            if (move && i == 0 && work.Count == 1 && File.Exists(src) && !File.Exists(dest))
            {
                File.Move(src, dest, overwrite: true);
                createdPaths.Add(dest);
            }
            else if (move && Directory.Exists(src) && work.Count > 1)
            {
                // handled per-file below then remove empty dirs
            }
            else
            {
                await CopyFileBufferedAsync(src, dest, cancellationToken).ConfigureAwait(false);
                if (!await VerifyCopyAsync(src, dest).ConfigureAwait(false))
                    throw new IOException($"Copy verification failed for {Path.GetFileName(src)}");
                createdPaths.Add(dest);
                if (move) try { File.Delete(src); } catch { /* best effort */ }
            }

            transferred += size;
            double speed = sw.Elapsed.TotalSeconds > 0 ? transferred / sw.Elapsed.TotalSeconds : 0;
            int pct = totalBytes > 0 ? (int)(transferred * 100 / totalBytes) : (int)((i + 1) * 100.0 / work.Count);
            onProgress?.Invoke(operationId, pct, src, transferred, totalBytes, speed, i + 1, work.Count);
            await Task.Yield();
        }

        if (move)
        {
            foreach (var src in sources.Where(Directory.Exists))
            {
                try
                {
                    if (!Directory.EnumerateFileSystemEntries(src).Any())
                        Directory.Delete(src, false);
                    else
                        Directory.Delete(src, true);
                }
                catch { }
            }
        }

        onProgress?.Invoke(operationId, 100, sources.LastOrDefault() ?? "", transferred, totalBytes, 0, work.Count, work.Count);
        return createdPaths;
    }

    private static async Task CopyFileBufferedAsync(string sourceFile, string destinationFile, CancellationToken cancellationToken = default)
    {
        const int bufferSize = 1024 * 1024;
        await using var sourceStream = new FileStream(
            sourceFile, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        await using var destinationStream = new FileStream(
            destinationFile, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var buffer = new byte[bufferSize];
        int read;
        while ((read = await sourceStream.ReadAsync(buffer.AsMemory(0, bufferSize), cancellationToken).ConfigureAwait(false)) > 0)
        {
            cancellationToken.ThrowIfCancellationRequested();
            await destinationStream.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);
        }
        await destinationStream.FlushAsync(cancellationToken).ConfigureAwait(false);
    }

    private static async Task<bool> VerifyCopyAsync(string sourceFile, string destinationFile)
    {
        try
        {
            var srcInfo = new FileInfo(sourceFile);
            var dstInfo = new FileInfo(destinationFile);
            if (!srcInfo.Exists || !dstInfo.Exists) return false;
            if (srcInfo.Length != dstInfo.Length) return false;
            if (srcInfo.Length == 0) return true;
            if (srcInfo.Length > MaxVerifyHashBytes) return true;

            static async Task<byte[]> HashFileAsync(string path)
            {
                await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
                using var sha = SHA256.Create();
                return await sha.ComputeHashAsync(stream).ConfigureAwait(false);
            }

            var srcHash = await HashFileAsync(sourceFile).ConfigureAwait(false);
            var dstHash = await HashFileAsync(destinationFile).ConfigureAwait(false);
            return srcHash.AsSpan().SequenceEqual(dstHash);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Copy verify failed: {ex.Message}");
            return false;
        }
    }

    private static string GetUniquePath(string path)
    {
        if (!File.Exists(path) && !Directory.Exists(path)) return path;
        var dir = Path.GetDirectoryName(path) ?? "";
        var name = Path.GetFileNameWithoutExtension(path);
        var ext = Path.GetExtension(path);
        int n = 1;
        string candidate;
        do
        {
            candidate = Path.Combine(dir, $"{name} ({n}){ext}");
            n++;
        } while (File.Exists(candidate) || Directory.Exists(candidate));
        return candidate;
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

public sealed class BatchRenameResult
{
    public int Renamed { get; init; }
    public int Skipped { get; init; }
    public int Failed { get; init; }
}
