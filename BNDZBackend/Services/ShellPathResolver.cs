using System;
using System.IO;

namespace BNDZ.Services;

/// <summary>Maps BNDZ virtual pane paths to Windows shell parsing names.</summary>
public static class ShellPathResolver
{
    public const string RecycleBinClsid = "::{645FF040-5081-101B-9F08-00AA002F954E}";
    public const string ThisPcClsid = "::{20D04FE0-3AEA-1069-A2D8-08002B30309D}";
    public const string NetworkClsid = "::{F02C1A0D-BE21-4350-88B0-7367FC96EF3C}";
    public const string LibrariesClsid = "::{031E4825-7B94-4DC3-B131-E946B44C8DD5}";
    public const string PortableDevicesClsid = PortableDeviceService.PortableDevicesClsid;

    public static string NormalizeIncoming(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        path = path.Trim();

        // Preserve network root before generic slash normalization
        if (path is "//" or "\\\\" or "/\\\\") return "\\\\";

        // UNC paths: \\server\share — keep the leading double separator
        var slashed = path.Replace('\\', '/');
        if (slashed.StartsWith("//"))
        {
            var body = slashed.TrimStart('/');
            while (body.Contains("//")) body = body.Replace("//", "/");
            return "\\\\" + body.Replace('/', '\\');
        }

        if (path.StartsWith("/")) path = path[1..];
        path = path.Replace("/", "\\");
        while (path.Contains("\\\\")) path = path.Replace("\\\\", "\\");
        if (path.StartsWith("\\") && path.Length >= 3 && char.IsLetter(path[1]) && path[2] == ':')
            path = path.TrimStart('\\');
        return path;
    }

    public static string ResolveForShell(string? rawPath)
    {
        if (string.IsNullOrWhiteSpace(rawPath)) return "";
        var trimmed = rawPath.Trim();
        if (trimmed is "/" or "\\") return ThisPcClsid;
        if (trimmed is "//" or "\\\\" or "/\\\\") return NetworkClsid;
        if (trimmed.StartsWith("/shell:", StringComparison.OrdinalIgnoreCase))
            trimmed = trimmed.TrimStart('/');

        if (trimmed.StartsWith("shell:", StringComparison.OrdinalIgnoreCase))
        {
            var shellLower = trimmed.ToLowerInvariant();
            if (shellLower == "shell:recyclebin") return RecycleBinClsid;
            if (shellLower == "shell:libraries") return LibrariesClsid;
            if (shellLower is "shell:mycomputerfolder" or "shell:thispcfolder") return ThisPcClsid;
            if (shellLower == "shell:networkplacesfolder") return NetworkClsid;
            if (shellLower is "shell:portabledevices" or "shell:portable devices") return PortableDevicesClsid;
            return MapShellKnownFolder(trimmed) ?? trimmed;
        }

        var path = NormalizeIncoming(rawPath);
        if (string.IsNullOrEmpty(path)) return "";

        if (path is "/" or "\\") return ThisPcClsid;
        if (path is "\\\\" or "//") return NetworkClsid;

        if (path.EndsWith(":") && path.Length == 2)
            return path + "\\";

        if (path.StartsWith("::{")) return path;
        if (path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase))
        {
            var mapped = MapShellKnownFolder(path);
            return mapped ?? path;
        }

        return path;
    }

    /// <summary>Resolve common shell: known-folder names to real filesystem paths so both
    /// SHGetFileInfo and directory enumeration work. Returns null for virtual-only names.</summary>
    public static string? MapShellKnownFolder(string shellName)
    {
        var key = shellName.Trim().ToLowerInvariant();
        string? real = key switch
        {
            "shell:desktop" => Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
            "shell:personal" => Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
            "shell:my pictures" => Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
            "shell:my music" => Environment.GetFolderPath(Environment.SpecialFolder.MyMusic),
            "shell:my video" => Environment.GetFolderPath(Environment.SpecialFolder.MyVideos),
            "shell:profile" => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "shell:home" => Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            "shell:pictureslibrary" => Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
            "shell:downloads" => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"),
            _ => null,
        };
        return string.IsNullOrEmpty(real) || !Directory.Exists(real) ? null : real;
    }

    public static bool IsShellVirtualPath(string resolved)
    {
        if (string.IsNullOrEmpty(resolved)) return false;
        return resolved.StartsWith("::{", StringComparison.Ordinal)
            || resolved.StartsWith("shell:", StringComparison.OrdinalIgnoreCase);
    }

    public static bool PathExistsForShell(string resolved)
    {
        if (string.IsNullOrEmpty(resolved)) return false;
        if (IsShellVirtualPath(resolved)) return true;
        return File.Exists(resolved) || Directory.Exists(resolved);
    }
}
