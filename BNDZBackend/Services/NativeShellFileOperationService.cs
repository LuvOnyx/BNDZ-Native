using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Vanara.Windows.Shell;

namespace BNDZ.Services;

/// <summary>
/// Windows shell file operations via Vanara IFileOperation (ShellFileOperations) — Explorer progress UI and shell undo.
/// </summary>
public sealed class NativeShellFileOperationService
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

    private const uint FO_MOVE = 0x0001;
    private const uint FO_COPY = 0x0002;
    private const uint FO_DELETE = 0x0003;
    private const ushort FOF_ALLOWUNDO = 0x0040;
    private const ushort FOF_NOCONFIRMATION = 0x0010;
    private const ushort FOF_SILENT = 0x0004;
    private const ushort FOF_NOERRORUI = 0x0400;

    public Task ExecuteOperationAsync(
        string operationId,
        string action,
        List<string> sources,
        string target,
        bool bypassRecycleBin,
        Action<string, int, string, long, long, double, int, int>? onProgress = null,
        CancellationToken cancellationToken = default,
        bool showProgress = true,
        Action<string, string>? onAccessDenied = null)
    {
        // IFileOperation / Explorer progress UI require STA. Never run progress UI on MTA thread-pool.
        if (showProgress)
        {
            var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var thread = new Thread(() =>
            {
                try
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    RunOperation(operationId, action, sources, target, bypassRecycleBin, onProgress, cancellationToken, showProgress: true, onAccessDenied);
                    tcs.TrySetResult();
                }
                catch (OperationCanceledException oce)
                {
                    tcs.TrySetCanceled(oce.CancellationToken);
                }
                catch (Exception ex)
                {
                    tcs.TrySetException(ex);
                }
            })
            {
                IsBackground = true,
                Name = "BNDZ-NativeShellOp",
            };
            thread.SetApartmentState(ApartmentState.STA);
            thread.Start();
            return tcs.Task;
        }

        return Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            RunOperation(operationId, action, sources, target, bypassRecycleBin, onProgress, cancellationToken, showProgress: false, onAccessDenied);
        }, cancellationToken);
    }

    private static void RunOperation(
        string operationId,
        string action,
        List<string> sources,
        string target,
        bool bypassRecycleBin,
        Action<string, int, string, long, long, double, int, int>? onProgress,
        CancellationToken cancellationToken,
        bool showProgress,
        Action<string, string>? onAccessDenied)
    {
        sources = sources.Select(NormalizePath).Where(s => !string.IsNullOrEmpty(s)).ToList();
        target = NormalizePath(target);
        action = (action ?? "copy").ToLowerInvariant();
        var total = Math.Max(sources.Count, 1);

        onProgress?.Invoke(operationId, 0, sources.FirstOrDefault() ?? "", 0, 0, 0, 0, total);

        try
        {
            ExecuteWithVanara(operationId, action, sources, target, bypassRecycleBin, showProgress, onProgress, total);
        }
        catch (Exception ex)
        {
            var classified = PrivilegePolicyService.Classify(ex, "This file operation");
            if (classified.NeedsElevation)
            {
                onAccessDenied?.Invoke(operationId, classified.Message);
                throw;
            }
            Debug.WriteLine($"[NativeShell] Vanara IFileOperation failed, falling back to SHFileOperation: {ex.Message}");
            try
            {
                ExecuteWithLegacyShell(action, sources, target, bypassRecycleBin, showProgress);
            }
            catch (Exception legacyEx)
            {
                var legacyClassified = PrivilegePolicyService.Classify(legacyEx, "This file operation");
                if (legacyClassified.NeedsElevation)
                    onAccessDenied?.Invoke(operationId, legacyClassified.Message);
                throw;
            }
        }

        cancellationToken.ThrowIfCancellationRequested();
        onProgress?.Invoke(operationId, 100, sources.LastOrDefault() ?? target, 0, 0, 0, total, total);
    }

    private static void ExecuteWithVanara(
        string operationId,
        string action,
        List<string> sources,
        string target,
        bool bypassRecycleBin,
        bool showProgress,
        Action<string, int, string, long, long, double, int, int>? onProgress,
        int total)
    {
        // Allow Explorer-quality conflict UI (replace/skip/rename) — never silent overwrite.
        var flags = default(ShellFileOperations.OperationFlags);
        if (!(action == "delete" && bypassRecycleBin))
            flags |= ShellFileOperations.OperationFlags.AllowUndo;
        if (!showProgress)
            flags |= ShellFileOperations.OperationFlags.Silent | ShellFileOperations.OperationFlags.NoConfirmation;

        using var op = new ShellFileOperations { Options = flags };
        var completed = 0;

        void Bump(string? current)
        {
            completed = Math.Min(completed + 1, total);
            var pct = total > 0 ? (int)(completed * 100.0 / total) : 100;
            onProgress?.Invoke(operationId, pct, current ?? "", 0, 0, 0, completed, total);
        }

        switch (action)
        {
            case "delete":
                foreach (var src in sources)
                {
                    using var item = new ShellItem(src);
                    op.QueueDeleteOperation(item);
                }
                break;

            case "copy":
                QueueCopyOrMove(op, sources, target, move: false, Bump);
                break;

            case "move":
                if (sources.Count == 1 && IsSameDirectoryRename(sources[0], target))
                    QueueSingleTargetMove(op, sources[0], target, Bump);
                else
                    QueueCopyOrMove(op, sources, target, move: true, Bump);
                break;

            case "create-dir":
                if (!string.IsNullOrEmpty(target)) Directory.CreateDirectory(target);
                else if (sources.Count > 0) Directory.CreateDirectory(sources[0]);
                return;

            case "create-file":
            {
                var filePath = !string.IsNullOrEmpty(target) ? target : sources.FirstOrDefault() ?? "";
                if (!string.IsNullOrEmpty(filePath))
                {
                    var dir = Path.GetDirectoryName(filePath);
                    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                        Directory.CreateDirectory(dir);
                    if (!File.Exists(filePath)) File.WriteAllBytes(filePath, Array.Empty<byte>());
                }
                return;
            }

            default:
                return;
        }

        op.PerformOperations();
        if (op.AnyOperationsAborted)
            throw new OperationCanceledException("Windows shell operation was aborted.");
    }

    private static void QueueCopyOrMove(
        ShellFileOperations op,
        List<string> sources,
        string targetDir,
        bool move,
        Action<string?> bump)
    {
        if (sources.Count == 0) return;
        var dest = targetDir.TrimEnd('\\');
        var isShellDest = PortableDeviceService.IsPortableDevicePath(dest)
            || ShellPathResolver.IsShellVirtualPath(dest)
            || dest.StartsWith("::{", StringComparison.Ordinal);

        if (!isShellDest)
        {
            if (!Directory.Exists(dest) && sources.Count == 1 && File.Exists(sources[0]))
                dest = Path.GetDirectoryName(dest) ?? dest;
            Directory.CreateDirectory(dest);
        }

        using var destFolder = new ShellFolder(dest);

        foreach (var src in sources)
        {
            using var sourceItem = new ShellItem(src);
            if (move)
            {
                op.QueueMoveOperation(sourceItem, destFolder);
                bump(src);
            }
            else
            {
                op.QueueCopyOperation(sourceItem, destFolder);
                bump(src);
            }
        }
    }

    /// <summary>Copy filesystem sources into a shell/MTP destination folder (phones, etc.).</summary>
    public static void CopyToShellDestination(IEnumerable<string> sources, string shellDestFolder)
    {
        var list = sources.Select(NormalizePath).Where(s => !string.IsNullOrEmpty(s)).ToList();
        if (list.Count == 0 || string.IsNullOrWhiteSpace(shellDestFolder))
            throw new ArgumentException("Missing sources or destination.");

        using var op = new ShellFileOperations();
        op.Options = ShellFileOperations.OperationFlags.AllowUndo
            | ShellFileOperations.OperationFlags.NoConfirmMkDir;
        using var destFolder = new ShellFolder(shellDestFolder);
        foreach (var src in list)
        {
            using var sourceItem = new ShellItem(src);
            op.QueueCopyOperation(sourceItem, destFolder);
        }
        op.PerformOperations();
        if (op.AnyOperationsAborted)
            throw new OperationCanceledException("Copy to device was aborted.");
    }

    private static void QueueSingleTargetMove(ShellFileOperations op, string source, string targetPath, Action<string?> bump)
    {
        using var sourceItem = new ShellItem(source);
        var destDir = Path.GetDirectoryName(targetPath) ?? "";
        if (!string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
            Directory.CreateDirectory(destDir);
        using var destFolder = new ShellFolder(destDir);
        op.QueueMoveOperation(sourceItem, destFolder, Path.GetFileName(targetPath));
        bump(targetPath);
    }

    private static void ExecuteWithLegacyShell(string action, List<string> sources, string target, bool bypassRecycleBin, bool showProgress)
    {
        switch (action)
        {
            case "delete":
                ShellDelete(sources, bypassRecycleBin, showProgress);
                break;
            case "copy":
                ShellCopyOrMove(sources, target, move: false, showProgress: showProgress);
                break;
            case "move":
                if (sources.Count == 1 && IsSameDirectoryRename(sources[0], target))
                    ShellCopyOrMove(sources, target, move: true, singleTargetFile: true, showProgress: showProgress);
                else
                    ShellCopyOrMove(sources, target, move: true, showProgress: showProgress);
                break;
            case "create-dir":
                if (!string.IsNullOrEmpty(target)) Directory.CreateDirectory(target);
                else if (sources.Count > 0) Directory.CreateDirectory(sources[0]);
                break;
            case "create-file":
            {
                var filePath = !string.IsNullOrEmpty(target) ? target : sources.FirstOrDefault() ?? "";
                if (!string.IsNullOrEmpty(filePath))
                {
                    var dir = Path.GetDirectoryName(filePath);
                    if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                        Directory.CreateDirectory(dir);
                    if (!File.Exists(filePath)) File.WriteAllBytes(filePath, Array.Empty<byte>());
                }
                break;
            }
        }
    }

    private static void ShellDelete(List<string> sources, bool bypassRecycleBin, bool showProgress)
    {
        var from = string.Join('\0', sources) + "\0\0";
        var flags = (ushort)(FOF_NOCONFIRMATION | FOF_NOERRORUI);
        if (!bypassRecycleBin) flags |= FOF_ALLOWUNDO;
        if (!showProgress) flags |= FOF_SILENT;

        var fileop = new SHFILEOPSTRUCT
        {
            wFunc = FO_DELETE,
            pFrom = from,
            pTo = "",
            fFlags = flags,
        };
        var result = SHFileOperation(ref fileop);
        if (result != 0 || fileop.fAnyOperationsAborted)
            throw new IOException($"Windows delete operation failed (code {result}).");
    }

    private static void ShellCopyOrMove(List<string> sources, string targetDir, bool move, bool singleTargetFile = false, bool showProgress = true)
    {
        if (sources.Count == 0) return;

        var from = string.Join('\0', sources) + "\0\0";
        string to;
        if (singleTargetFile)
        {
            to = targetDir + "\0\0";
        }
        else
        {
            var dest = targetDir.TrimEnd('\\');
            if (!Directory.Exists(dest) && sources.Count == 1 && File.Exists(sources[0]))
                dest = Path.GetDirectoryName(dest) ?? dest;
            to = dest + "\0\0";
        }

        var flags = (ushort)(FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI);
        if (!showProgress) flags |= FOF_SILENT;
        var fileop = new SHFILEOPSTRUCT
        {
            wFunc = move ? FO_MOVE : FO_COPY,
            pFrom = from,
            pTo = to,
            fFlags = flags,
        };
        var result = SHFileOperation(ref fileop);
        if (result != 0 || fileop.fAnyOperationsAborted)
            throw new IOException($"Windows {(move ? "move" : "copy")} operation failed (code {result}).");
    }

    private static bool IsSameDirectoryRename(string source, string target)
    {
        var srcDir = Path.GetDirectoryName(source);
        var destDir = Path.GetDirectoryName(target);
        return !string.IsNullOrEmpty(srcDir)
            && !string.IsNullOrEmpty(destDir)
            && string.Equals(srcDir, destDir, StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        return path.Replace('/', '\\').Trim();
    }
}
