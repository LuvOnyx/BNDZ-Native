using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>Reliable Windows file/folder Properties dialog — avoids ShellExecute "no app associated" errors.</summary>
public static class ShellPropertiesHelper
{
    private const uint SHOP_FILEPATH = 0x00000002;

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SHObjectProperties(IntPtr hwnd, uint shopObjectType, string pszObjectName, uint dwAttributes);

    public static bool ShowProperties(string rawPath, IntPtr hwnd = default)
    {
        var path = ShellPathResolver.ResolveForShell(NormalizeIncoming(rawPath));
        if (string.IsNullOrEmpty(path)) return false;

        if (!ShellPathResolver.PathExistsForShell(path))
            return false;

        try
        {
            if (SHObjectProperties(hwnd, SHOP_FILEPATH, path, 0))
                return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"SHObjectProperties failed for '{path}': {ex.Message}");
        }

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = path,
                Verb = "properties",
                UseShellExecute = true,
            };
            Process.Start(psi);
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"Process.Start properties fallback failed for '{path}': {ex.Message}");
            return false;
        }
    }

    private static string NormalizeIncoming(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        path = path.Trim();
        if (path.StartsWith("::{")) return path;
        if (path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase)) return path;
        if (path.StartsWith("/")) path = path[1..];
        path = path.Replace('/', '\\');
        while (path.Contains("\\\\")) path = path.Replace("\\\\", "\\");
        if (path.StartsWith("\\") && path.Length >= 3 && char.IsLetter(path[1]) && path[2] == ':')
            path = path.TrimStart('\\');
        if (path.Length == 2 && path[1] == ':') path += "\\";
        return path;
    }
}
