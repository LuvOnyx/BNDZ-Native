using System;
using System.IO;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

public sealed class LinkService
{
    private const int SYMBOLIC_LINK_FLAG_FILE = 0x0;
    private const int SYMBOLIC_LINK_FLAG_DIRECTORY = 0x1;

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateSymbolicLink(string lpSymlinkFileName, string lpTargetFileName, int dwFlags);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateHardLink(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);

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
                    if (!CreateSymbolicLink(linkPath, targetPath, isDir ? SYMBOLIC_LINK_FLAG_DIRECTORY : SYMBOLIC_LINK_FLAG_FILE))
                        return new LinkResult { Success = false, Error = $"CreateSymbolicLink failed: {Marshal.GetLastWin32Error()}" };
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
                    if (!CreateSymbolicLink(linkPath, targetPath, SYMBOLIC_LINK_FLAG_DIRECTORY))
                        return new LinkResult { Success = false, Error = $"CreateJunction failed: {Marshal.GetLastWin32Error()}" };
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
}
