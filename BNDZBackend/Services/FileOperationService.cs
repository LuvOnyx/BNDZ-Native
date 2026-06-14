using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace BNDZ.Services;

public class FileOperationService
{
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

    public Task ExecuteUndoAsync() => Task.CompletedTask;
    public Task ExecuteRedoAsync() => Task.CompletedTask;

    public async Task ExecuteOperationAsync(
        string operationId,
        string action,
        List<string> sources,
        string target,
        bool bypassRecycleBin,
        Action<string, int, string, long, long, double, int, int>? onProgress = null,
        Func<string, string, string, string, Task<string>>? onConflict = null)
    {
        sources = sources.Select(NormalizePath).Where(s => !string.IsNullOrEmpty(s)).ToList();
        target = NormalizePath(target);
        action = (action ?? "copy").ToLowerInvariant();

        try
        {
            switch (action)
            {
                case "create-dir":
                    if (!string.IsNullOrEmpty(target)) Directory.CreateDirectory(target);
                    else if (sources.Count > 0) Directory.CreateDirectory(sources[0]);
                    onProgress?.Invoke(operationId, 100, target, 0, 0, 0, 1, 1);
                    break;

                case "create-file":
                    var filePath = !string.IsNullOrEmpty(target) ? target : sources.FirstOrDefault() ?? "";
                    if (!string.IsNullOrEmpty(filePath))
                    {
                        var dir = Path.GetDirectoryName(filePath);
                        if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                            Directory.CreateDirectory(dir);
                        if (!File.Exists(filePath)) File.WriteAllBytes(filePath, Array.Empty<byte>());
                    }
                    onProgress?.Invoke(operationId, 100, filePath, 0, 0, 0, 1, 1);
                    break;

                case "delete":
                    await DeleteItemsAsync(operationId, sources, bypassRecycleBin, onProgress);
                    break;

                case "copy":
                    await CopyOrMoveAsync(operationId, sources, target, move: false, onProgress, onConflict);
                    break;

                case "move":
                    await CopyOrMoveAsync(operationId, sources, target, move: true, onProgress, onConflict);
                    break;

                default:
                    onProgress?.Invoke(operationId, 100, sources.FirstOrDefault() ?? "", 0, 0, 0, 1, 1);
                    break;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"FileOperation {action} failed: {ex.Message}");
            onProgress?.Invoke(operationId, 100, ex.Message, 0, 0, 0, 1, 1);
        }
    }

    private static async Task DeleteItemsAsync(
        string operationId,
        List<string> sources,
        bool bypassRecycleBin,
        Action<string, int, string, long, long, double, int, int>? onProgress)
    {
        int total = sources.Count;
        for (int i = 0; i < sources.Count; i++)
        {
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

    private static async Task CopyOrMoveAsync(
        string operationId,
        List<string> sources,
        string targetDir,
        bool move,
        Action<string, int, string, long, long, double, int, int>? onProgress,
        Func<string, string, string, string, Task<string>>? onConflict)
    {
        if (string.IsNullOrEmpty(targetDir))
            targetDir = Path.GetDirectoryName(sources.FirstOrDefault() ?? "") ?? "";

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
            }
            else if (move && Directory.Exists(src) && work.Count > 1)
            {
                // handled per-file below then remove empty dirs
            }
            else
            {
                await CopyFileBufferedAsync(src, dest).ConfigureAwait(false);
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
    }

    private static async Task CopyFileBufferedAsync(string sourceFile, string destinationFile)
    {
        const int bufferSize = 1024 * 1024;
        await using var sourceStream = new FileStream(
            sourceFile, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        await using var destinationStream = new FileStream(
            destinationFile, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        await sourceStream.CopyToAsync(destinationStream, bufferSize).ConfigureAwait(false);
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
