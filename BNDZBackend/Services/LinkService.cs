using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace BNDZ.Services;

public sealed class LinkService
{
    private const int SYMBOLIC_LINK_FLAG_FILE = 0x0;
    private const int SYMBOLIC_LINK_FLAG_DIRECTORY = 0x1;
    /// <summary>Windows 10 Creators Update (1703) Developer Mode — allows symlinks without elevation.</summary>
    private const int SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE = 0x2;

    /// <summary>True when the process can create symlinks without elevation (SeCreateSymbolicLinkPrivilege or Dev Mode).</summary>
    private static readonly bool _canSymlinkUnprivileged = ProbeSymlinkPrivilege();

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateSymbolicLink(string lpSymlinkFileName, string lpTargetFileName, int dwFlags);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateHardLink(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateFile(
        string lpFileName,
        uint dwDesiredAccess,
        uint dwShareMode,
        IntPtr lpSecurityAttributes,
        uint dwCreationDisposition,
        uint dwFlagsAndAttributes,
        IntPtr hTemplateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(
        SafeFileHandle hDevice,
        uint dwIoControlCode,
        IntPtr lpInBuffer,
        uint nInBufferSize,
        IntPtr lpOutBuffer,
        uint nOutBufferSize,
        out uint lpBytesReturned,
        IntPtr lpOverlapped);

    private const uint GENERIC_WRITE = 0x40000000;
    private const uint OPEN_EXISTING = 3;
    private const uint FILE_FLAG_OPEN_REPARSE_POINT = 0x00200000;
    private const uint FILE_FLAG_BACKUP_SEMANTICS = 0x02000000;
    private const uint FSCTL_SET_REPARSE_POINT = 0x000900A4;
    private const uint IO_REPARSE_TAG_MOUNT_POINT = 0xA0000003;

    public LinkResult CreateLink(string linkPath, string targetPath, string linkType)
    {
        linkPath = NormalizePath(linkPath);
        targetPath = NormalizePath(targetPath);
        linkType = (linkType ?? "symlink").ToLowerInvariant();

        if (string.IsNullOrEmpty(linkPath) || string.IsNullOrEmpty(targetPath))
            return new LinkResult { Success = false, Error = "Invalid paths" };

        if (!File.Exists(targetPath) && !Directory.Exists(targetPath))
            return new LinkResult { Success = false, Error = "Target does not exist" };

        try
        {
            var linkDir = Path.GetDirectoryName(linkPath);
            if (!string.IsNullOrEmpty(linkDir) && !Directory.Exists(linkDir))
                Directory.CreateDirectory(linkDir);

            if (File.Exists(linkPath) || Directory.Exists(linkPath))
                return new LinkResult { Success = false, Error = "Link path already exists" };

            switch (linkType)
            {
                case "symlink":
                case "symbolic":
                {
                    bool isDir = Directory.Exists(targetPath);
                    int flags = isDir ? SYMBOLIC_LINK_FLAG_DIRECTORY : SYMBOLIC_LINK_FLAG_FILE;
                    // Try with ALLOW_UNPRIVILEGED_CREATE first (Dev Mode / Creators Update+).
                    // Fall back to plain flag if the OS rejects it (pre-1703 or group policy off).
                    if (!CreateSymbolicLink(linkPath, targetPath, flags | SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE))
                    {
                        if (!CreateSymbolicLink(linkPath, targetPath, flags))
                            return new LinkResult { Success = false, Error = $"CreateSymbolicLink failed: {Marshal.GetLastWin32Error()} (try enabling Developer Mode)" };
                    }
                    return new LinkResult { Success = true, LinkType = "symlink" };
                }
                case "hardlink":
                case "hard":
                {
                    if (!File.Exists(targetPath))
                        return new LinkResult { Success = false, Error = "Hard links require a file target" };
                    if (!CreateHardLink(linkPath, targetPath, IntPtr.Zero))
                        return new LinkResult { Success = false, Error = $"CreateHardLink failed: {Marshal.GetLastWin32Error()}" };
                    return new LinkResult { Success = true, LinkType = "hardlink" };
                }
                case "junction":
                {
                    if (!Directory.Exists(targetPath))
                        return new LinkResult { Success = false, Error = "Junctions require a directory target" };
                    var jErr = CreateMountPointJunction(linkPath, targetPath);
                    if (jErr != null)
                        return new LinkResult { Success = false, Error = jErr };
                    return new LinkResult { Success = true, LinkType = "junction" };
                }
                case "shortcut":
                case "lnk":
                {
                    if (!linkPath.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase))
                        linkPath += ".lnk";
                    return CreateWindowsShortcut(linkPath, targetPath);
                }
                default:
                    return new LinkResult { Success = false, Error = $"Unknown link type: {linkType}" };
            }
        }
        catch (Exception ex)
        {
            return new LinkResult { Success = false, Error = ex.Message };
        }
    }

    public static string? GetReparseKind(string path)
    {
        try
        {
            path = NormalizePath(path);
            var attrs = File.GetAttributes(path);
            if (!attrs.HasFlag(FileAttributes.ReparsePoint)) return null;

            // Distinguish junction vs symlink via ReparseTag would need DeviceIoControl;
            // heuristic: directory reparse = junction or dir symlink
            if (Directory.Exists(path)) return "junction";
            return "symlink";
        }
        catch
        {
            return null;
        }
    }

    private static LinkResult CreateWindowsShortcut(string linkPath, string targetPath)
    {
        try
        {
            var linkType = Type.GetTypeFromProgID("WScript.Shell");
            if (linkType == null)
                return new LinkResult { Success = false, Error = "WScript.Shell unavailable" };

            dynamic shell = Activator.CreateInstance(linkType)!;
            dynamic shortcut = shell.CreateShortcut(linkPath);
            shortcut.TargetPath = targetPath;
            shortcut.WorkingDirectory = Directory.Exists(targetPath)
                ? targetPath
                : (Path.GetDirectoryName(targetPath) ?? "");
            shortcut.Description = $"Shortcut to {Path.GetFileName(targetPath)}";
            shortcut.Save();
            return new LinkResult { Success = true, LinkType = "shortcut" };
        }
        catch (Exception ex)
        {
            return new LinkResult { Success = false, Error = ex.Message };
        }
    }

    public ShortcutResolveResult ResolveShortcut(string linkPath)
    {
        linkPath = NormalizePath(linkPath);
        if (string.IsNullOrEmpty(linkPath) || !File.Exists(linkPath))
            return new ShortcutResolveResult { Success = false, Error = "Shortcut not found" };

        var ext = Path.GetExtension(linkPath);
        if (ext.Equals(".url", StringComparison.OrdinalIgnoreCase))
            return ResolveInternetShortcut(linkPath);
        if (!ext.Equals(".lnk", StringComparison.OrdinalIgnoreCase))
            return new ShortcutResolveResult { Success = false, Error = "Not a shortcut" };

        try
        {
            var linkType = Type.GetTypeFromProgID("WScript.Shell");
            if (linkType == null)
                return new ShortcutResolveResult { Success = false, Error = "WScript.Shell unavailable" };

            dynamic shell = Activator.CreateInstance(linkType)!;
            dynamic shortcut = shell.CreateShortcut(linkPath);
            string target = ((string?)shortcut.TargetPath)?.Trim() ?? "";
            string workingDir = ((string?)shortcut.WorkingDirectory)?.Trim() ?? "";
            string args = ((string?)shortcut.Arguments)?.Trim() ?? "";
            string description = ((string?)shortcut.Description)?.Trim() ?? "";

            if (string.IsNullOrWhiteSpace(target))
                return new ShortcutResolveResult { Success = false, Error = "Shortcut has no target" };

            // Expand environment variables commonly stored in .lnk targets.
            try { target = Environment.ExpandEnvironmentVariables(target); } catch { }
            try { if (!string.IsNullOrEmpty(workingDir)) workingDir = Environment.ExpandEnvironmentVariables(workingDir); } catch { }

            var targetExists = File.Exists(target) || Directory.Exists(target);
            var targetIsDir = Directory.Exists(target);
            string? locationPath = null;
            if (targetExists)
            {
                locationPath = targetIsDir
                    ? target
                    : Path.GetDirectoryName(target);
            }
            else if (!string.IsNullOrEmpty(workingDir) && Directory.Exists(workingDir))
            {
                locationPath = workingDir;
            }

            return new ShortcutResolveResult
            {
                Success = true,
                LinkPath = linkPath,
                TargetPath = target,
                WorkingDirectory = workingDir,
                Arguments = args,
                Description = description,
                TargetExists = targetExists,
                TargetIsDirectory = targetIsDir,
                LocationPath = locationPath,
            };
        }
        catch (Exception ex)
        {
            return new ShortcutResolveResult { Success = false, Error = ex.Message };
        }
    }

    private static ShortcutResolveResult ResolveInternetShortcut(string urlPath)
    {
        try
        {
            string? url = null;
            foreach (var line in File.ReadLines(urlPath))
            {
                if (line.StartsWith("URL=", StringComparison.OrdinalIgnoreCase))
                {
                    url = line[4..].Trim();
                    break;
                }
            }
            if (string.IsNullOrWhiteSpace(url))
                return new ShortcutResolveResult { Success = false, Error = "Internet shortcut has no URL" };

            return new ShortcutResolveResult
            {
                Success = true,
                LinkPath = urlPath,
                TargetPath = url,
                TargetExists = false,
                TargetIsDirectory = false,
                IsUrl = true,
            };
        }
        catch (Exception ex)
        {
            return new ShortcutResolveResult { Success = false, Error = ex.Message };
        }
    }

    /// <summary>
    /// Create a true NTFS junction (IO_REPARSE_TAG_MOUNT_POINT), not a directory symlink.
    /// </summary>
    private static string? CreateMountPointJunction(string junctionPath, string targetDir)
    {
        targetDir = Path.GetFullPath(targetDir);
        if (!targetDir.EndsWith("\\", StringComparison.Ordinal))
            targetDir += "\\";

        // Substitute path form required by mount-point reparse buffers.
        var substitute = @"\??\" + targetDir;
        var printName = targetDir;

        Directory.CreateDirectory(junctionPath);

        using var handle = CreateFile(
            junctionPath,
            GENERIC_WRITE,
            0,
            IntPtr.Zero,
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            IntPtr.Zero);

        if (handle.IsInvalid)
            return $"Open junction path failed: {Marshal.GetLastWin32Error()}";

        var subBytes = System.Text.Encoding.Unicode.GetBytes(substitute);
        var printBytes = System.Text.Encoding.Unicode.GetBytes(printName);
        // REPARSE_DATA_BUFFER layout for MountPointReparseBuffer (no PathBuffer padding quirks):
        // 0: ReparseTag (u32), 4: ReparseDataLength (u16), 6: Reserved (u16),
        // 8: SubstituteNameOffset (u16), 10: SubstituteNameLength (u16),
        // 12: PrintNameOffset (u16), 14: PrintNameLength (u16), 16: PathBuffer
        var pathBufferLen = subBytes.Length + printBytes.Length;
        var reparseDataLength = (ushort)(8 + pathBufferLen);
        var totalSize = 8 + reparseDataLength;
        var buffer = Marshal.AllocHGlobal(totalSize);
        try
        {
            for (var i = 0; i < totalSize; i++)
                Marshal.WriteByte(buffer, i, 0);

            Marshal.WriteInt32(buffer, 0, unchecked((int)IO_REPARSE_TAG_MOUNT_POINT));
            Marshal.WriteInt16(buffer, 4, (short)reparseDataLength);
            Marshal.WriteInt16(buffer, 6, 0);
            Marshal.WriteInt16(buffer, 8, 0); // SubstituteNameOffset
            Marshal.WriteInt16(buffer, 10, (short)subBytes.Length);
            Marshal.WriteInt16(buffer, 12, (short)subBytes.Length); // PrintNameOffset
            Marshal.WriteInt16(buffer, 14, (short)printBytes.Length);
            Marshal.Copy(subBytes, 0, IntPtr.Add(buffer, 16), subBytes.Length);
            Marshal.Copy(printBytes, 0, IntPtr.Add(buffer, 16 + subBytes.Length), printBytes.Length);

            if (!DeviceIoControl(handle, FSCTL_SET_REPARSE_POINT, buffer, (uint)totalSize, IntPtr.Zero, 0, out _, IntPtr.Zero))
            {
                var err = Marshal.GetLastWin32Error();
                try { Directory.Delete(junctionPath); } catch { /* best-effort cleanup */ }
                return $"CreateJunction (mount point) failed: {err}";
            }
            return null;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>
    /// Probe whether unprivileged symlinks are allowed by attempting a dry-run with a null pointer
    /// (which causes CreateSymbolicLink to fail with ERROR_INVALID_PARAMETER rather than
    /// ERROR_PRIVILEGE_NOT_HELD when the flag is accepted by the OS).
    /// </summary>
    private static bool ProbeSymlinkPrivilege()
    {
        try
        {
            // ERROR_INVALID_PARAMETER (87) means the OS accepted the flags but rejected null paths — Dev Mode OK.
            // ERROR_PRIVILEGE_NOT_HELD (1314) means the flag was rejected — no Dev Mode.
            CreateSymbolicLink("", "", SYMBOLIC_LINK_FLAG_ALLOW_UNPRIVILEGED_CREATE);
            var err = Marshal.GetLastWin32Error();
            return err == 87; // ERROR_INVALID_PARAMETER
        }
        catch
        {
            return false;
        }
    }

    private static string NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        if (path.StartsWith("/")) path = path[1..];
        path = path.Replace('/', '\\');
        while (path.Contains("\\\\")) path = path.Replace("\\\\", "\\");
        return path;
    }

    public sealed class LinkResult
    {
        public bool Success { get; set; }
        public string? LinkType { get; set; }
        public string? Error { get; set; }
    }

    public sealed class ShortcutResolveResult
    {
        public bool Success { get; set; }
        public string? Error { get; set; }
        public string? LinkPath { get; set; }
        public string? TargetPath { get; set; }
        public string? WorkingDirectory { get; set; }
        public string? Arguments { get; set; }
        public string? Description { get; set; }
        public bool TargetExists { get; set; }
        public bool TargetIsDirectory { get; set; }
        /// <summary>Folder to open for "Open file location" (parent of file target, or the directory target).</summary>
        public string? LocationPath { get; set; }
        public bool IsUrl { get; set; }
    }
}
