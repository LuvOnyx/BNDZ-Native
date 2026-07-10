using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>
/// Windows shell file operations via SHFileOperation — Explorer progress UI and shell undo integration.
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
        bool showProgress = true)
    {
        return Task.Run(() =>
        {
            cancellationToken.ThrowIfCancellationRequested();
            sources = sources.Select(NormalizePath).Where(s => !string.IsNullOrEmpty(s)).ToList();
            target = NormalizePath(target);
            action = (action ?? "copy").ToLowerInvariant();
            var total = Math.Max(sources.Count, 1);

            onProgress?.Invoke(operationId, 0, sources.FirstOrDefault() ?? "", 0, 0, 0, 0, total);

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
                default:
                    break;
            }

            onProgress?.Invoke(operationId, 100, sources.LastOrDefault() ?? target, 0, 0, 0, total, total);
        }, cancellationToken);
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

        // Explorer progress UI unless silent mode requested.
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
