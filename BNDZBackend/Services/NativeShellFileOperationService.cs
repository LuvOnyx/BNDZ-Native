using System;
using System.Collections.Generic;
using System.ComponentModel;
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
        Action<string, string>? onAccessDenied = null,
        IntPtr ownerHwnd = default)
    {
        // IFileOperation requires STA whether or not the Explorer progress UI is shown.
        // Running silent ops on the MTA thread-pool caused flaky cancel/progress and hung sinks.
        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var thread = new Thread(() =>
        {
            try
            {
                cancellationToken.ThrowIfCancellationRequested();
                RunOperation(operationId, action, sources, target, bypassRecycleBin, onProgress, cancellationToken, showProgress, onAccessDenied, ownerHwnd);
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
            Name = showProgress ? "BNDZ-NativeShellOp" : "BNDZ-NativeShellOp-Silent",
        };
        thread.SetApartmentState(ApartmentState.STA);
        thread.Start();
        return tcs.Task;
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
        Action<string, string>? onAccessDenied,
        IntPtr ownerHwnd)
    {
        sources = sources.Select(NormalizePath).Where(s => !string.IsNullOrEmpty(s)).ToList();
        target = NormalizePath(target);
        action = (action ?? "copy").ToLowerInvariant();
        var total = Math.Max(sources.Count, 1);
        var totalBytes = EstimateTotalBytes(sources);

        onProgress?.Invoke(operationId, 0, sources.FirstOrDefault() ?? "", 0, totalBytes, 0, 0, total);

        try
        {
            ExecuteWithVanara(operationId, action, sources, target, bypassRecycleBin, showProgress, onProgress, total, totalBytes, cancellationToken, ownerHwnd);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Win32Exception) when (cancellationToken.IsCancellationRequested)
        {
            throw new OperationCanceledException("Windows shell operation was cancelled.", cancellationToken);
        }
        catch (Exception ex)
        {
            if (cancellationToken.IsCancellationRequested)
                throw new OperationCanceledException("Windows shell operation was cancelled.", cancellationToken);
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
        onProgress?.Invoke(operationId, 100, sources.LastOrDefault() ?? target, totalBytes, totalBytes, 0, total, total);
    }

    private static void ExecuteWithVanara(
        string operationId,
        string action,
        List<string> sources,
        string target,
        bool bypassRecycleBin,
        bool showProgress,
        Action<string, int, string, long, long, double, int, int>? onProgress,
        int total,
        long totalBytes,
        CancellationToken cancellationToken,
        IntPtr ownerHwnd)
    {
        // Allow Explorer-quality conflict UI always — never silent overwrite.
        // Silent only hides the progress window; collisions still prompt.
        var flags = default(ShellFileOperations.OperationFlags);
        if (!(action == "delete" && bypassRecycleBin))
            flags |= ShellFileOperations.OperationFlags.AllowUndo;
        if (!showProgress)
        {
            flags |= ShellFileOperations.OperationFlags.Silent;
            // FOFX_SHOWSILENTPROGRESS (0x04000000) — keep IFileOperation progress sink
            // callbacks so the BNDZ transfer panel moves without an Explorer modal.
            flags |= (ShellFileOperations.OperationFlags)0x04000000;
        }

        using var op = new ShellFileOperations { Options = flags };
        if (ownerHwnd != IntPtr.Zero)
            op.OwnerWindow = ownerHwnd;
        var currentFile = sources.FirstOrDefault() ?? "";
        var itemsDone = 0;
        var lastReportMs = 0L;
        var lastShellPct = 0;
        var lastReportUtc = DateTime.UtcNow;
        long lastBytes = 0;

        void ThrowIfCanceled()
        {
            if (!cancellationToken.IsCancellationRequested) return;
            // E_FAIL from progress sink aborts IFileOperation mid-flight (Files / shell pattern).
            throw new Win32Exception(unchecked((int)0x80004005));
        }

        void Report(int pct, string? file, bool force = false)
        {
            ThrowIfCanceled();
            if (onProgress == null) return;
            var now = Environment.TickCount64;
            if (!force && now - lastReportMs < 100 && pct < 99) return;
            lastReportMs = now;
            var clamped = Math.Clamp(pct, 0, 99);
            long bytesDone = 0;
            double speed = 0;
            if (totalBytes > 0)
            {
                bytesDone = (long)(totalBytes * (clamped / 100.0));
                var elapsed = (DateTime.UtcNow - lastReportUtc).TotalSeconds;
                if (elapsed > 0.05 && bytesDone >= lastBytes)
                    speed = (bytesDone - lastBytes) / elapsed;
                lastBytes = bytesDone;
                lastReportUtc = DateTime.UtcNow;
            }
            onProgress.Invoke(
                operationId,
                clamped,
                file ?? currentFile,
                bytesDone,
                totalBytes,
                speed,
                itemsDone,
                total);
        }

        void OnPreItem(object? sender, ShellFileOperations.ShellFileOpEventArgs e)
        {
            ThrowIfCanceled();
            try
            {
                var path = TryShellItemPath(e.SourceItem);
                if (!string.IsNullOrWhiteSpace(path))
                    currentFile = path;
                // Prefer IFileOperation UpdateProgress %. Item events only fill gaps when shell % is silent.
                if (lastShellPct <= 0)
                {
                    var denom = Math.Max(total * 4, itemsDone + 4);
                    Report(Math.Min(90, Math.Max(1, (int)(itemsDone * 100.0 / denom))), currentFile, force: true);
                }
                else
                {
                    Report(lastShellPct, currentFile, force: true);
                }
            }
            catch (Win32Exception) { throw; }
            catch { /* never break shell op on progress */ }
        }

        void OnPostItem(object? sender, ShellFileOperations.ShellFileOpEventArgs e)
        {
            ThrowIfCanceled();
            itemsDone++;
            try
            {
                var path = TryShellItemPath(e.SourceItem) ?? TryShellItemPath(e.DestItem);
                if (!string.IsNullOrWhiteSpace(path))
                    currentFile = path!;
            }
            catch { /* ignore */ }
            if (lastShellPct <= 0)
            {
                var denom = Math.Max(total * 4, itemsDone + 3);
                Report(Math.Min(90, Math.Max(1, (int)(itemsDone * 100.0 / denom))), currentFile, force: true);
            }
            else
            {
                Report(lastShellPct, currentFile, force: true);
            }
        }

        void OnUpdateProgress(object? sender, ProgressChangedEventArgs e)
        {
            ThrowIfCanceled();
            lastShellPct = Convert.ToInt32(e.ProgressPercentage);
            Report(lastShellPct, currentFile);
        }

        op.UpdateProgress += OnUpdateProgress;
        op.PreCopyItem += OnPreItem;
        op.PreMoveItem += OnPreItem;
        op.PreDeleteItem += OnPreItem;
        op.PostCopyItem += OnPostItem;
        op.PostMoveItem += OnPostItem;
        op.PostDeleteItem += OnPostItem;

        try
        {
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
                    QueueCopyOrMove(op, sources, target, move: false);
                    break;

                case "move":
                    if (sources.Count == 1 && IsSameDirectoryRename(sources[0], target))
                        QueueSingleTargetMove(op, sources[0], target);
                    else
                        QueueCopyOrMove(op, sources, target, move: true);
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

            Report(1, currentFile, force: true);
            try
            {
                op.PerformOperations();
            }
            catch (Win32Exception) when (cancellationToken.IsCancellationRequested)
            {
                throw new OperationCanceledException("Windows shell operation was cancelled.", cancellationToken);
            }
            if (cancellationToken.IsCancellationRequested)
                throw new OperationCanceledException("Windows shell operation was cancelled.", cancellationToken);
            if (op.AnyOperationsAborted)
                throw new OperationCanceledException("Windows shell operation was aborted.");
        }
        finally
        {
            op.UpdateProgress -= OnUpdateProgress;
            op.PreCopyItem -= OnPreItem;
            op.PreMoveItem -= OnPreItem;
            op.PreDeleteItem -= OnPreItem;
            op.PostCopyItem -= OnPostItem;
            op.PostMoveItem -= OnPostItem;
            op.PostDeleteItem -= OnPostItem;
        }
    }

    /// <summary>
    /// Best-effort size sum so the transfer panel can show bytes/speed for native IFileOperation
    /// (the shell progress sink only exposes percent).
    /// </summary>
    private static long EstimateTotalBytes(IReadOnlyList<string> sources)
    {
        long total = 0;
        foreach (var src in sources)
        {
            try
            {
                if (File.Exists(src))
                {
                    total += new FileInfo(src).Length;
                    continue;
                }
                if (!Directory.Exists(src)) continue;
                foreach (var file in Directory.EnumerateFiles(src, "*", SearchOption.AllDirectories))
                {
                    try { total += new FileInfo(file).Length; }
                    catch { /* skip locked/unreadable */ }
                }
            }
            catch { /* skip inaccessible roots */ }
        }
        return total;
    }

    private static void QueueCopyOrMove(
        ShellFileOperations op,
        List<string> sources,
        string targetDir,
        bool move)
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
                op.QueueMoveOperation(sourceItem, destFolder);
            else
                op.QueueCopyOperation(sourceItem, destFolder);
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

    private static void QueueSingleTargetMove(ShellFileOperations op, string source, string targetPath)
    {
        using var sourceItem = new ShellItem(source);
        var destDir = ParentDirectoryPath(targetPath);
        var newName = LeafName(targetPath);
        var isShellDest = PortableDeviceService.IsPortableDevicePath(destDir)
            || ShellPathResolver.IsShellVirtualPath(destDir)
            || destDir.StartsWith("::{", StringComparison.Ordinal)
            || source.StartsWith("::{", StringComparison.Ordinal)
            || PortableDeviceService.IsPortableDevicePath(source);

        // Win32 Directory.CreateDirectory cannot create MTP / CLSID parents.
        if (!isShellDest && !string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
            Directory.CreateDirectory(destDir);

        using var destFolder = new ShellFolder(destDir);
        op.QueueMoveOperation(sourceItem, destFolder, newName);
    }

    private static string? TryShellItemPath(ShellItem? item)
    {
        if (item is null) return null;
        try
        {
            var fs = item.FileSystemPath;
            if (!string.IsNullOrWhiteSpace(fs)) return fs;
        }
        catch { /* ignore */ }
        try
        {
            var name = item.Name;
            if (!string.IsNullOrWhiteSpace(name)) return name;
        }
        catch { /* ignore */ }
        return null;
    }

    private static string ParentDirectoryPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        var trimmed = path.TrimEnd('\\', '/');
        var slash = Math.Max(trimmed.LastIndexOf('\\'), trimmed.LastIndexOf('/'));
        if (slash <= 0) return "";
        // Preserve "::{clsid}\child" parents for shell namespaces.
        return trimmed[..slash];
    }

    private static string LeafName(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        var trimmed = path.TrimEnd('\\', '/');
        var slash = Math.Max(trimmed.LastIndexOf('\\'), trimmed.LastIndexOf('/'));
        return slash < 0 ? trimmed : trimmed[(slash + 1)..];
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
        // Never FOF_NOCONFIRMATION — Explorer always confirms collisions / recycle prompts.
        var flags = (ushort)FOF_NOERRORUI;
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

        // Never FOF_NOCONFIRMATION — silent only hides progress UI.
        var flags = (ushort)(FOF_ALLOWUNDO | FOF_NOERRORUI);
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

        public static bool TryCopyOrMoveIntoDirectory(
            IReadOnlyList<string> sources,
            string destDir,
            bool move,
            IntPtr ownerHwnd = default)
        {
            try
            {
                var list = sources?.Where(s => !string.IsNullOrWhiteSpace(s)).Select(NormalizePath).ToList()
                    ?? new List<string>();
                destDir = NormalizePath(destDir);
                if (list.Count == 0 || string.IsNullOrEmpty(destDir) || !Directory.Exists(destDir))
                    return false;
                RunOperation(
                    "ole-desktop-" + Guid.NewGuid().ToString("N")[..8],
                    move ? "move" : "copy",
                    list,
                    destDir,
                    bypassRecycleBin: true,
                    onProgress: null,
                    cancellationToken: CancellationToken.None,
                    showProgress: false,
                    onAccessDenied: null,
                    ownerHwnd: ownerHwnd);
                return true;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[NativeShell] TryCopyOrMoveIntoDirectory: {ex.Message}");
                return false;
            }
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
