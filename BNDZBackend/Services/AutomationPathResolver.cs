using System;
using System.IO;

namespace BNDZ.Services;

/// <summary>Expands %ENV% and known-folder tokens so Automation recipes arm and run.</summary>
public static class AutomationPathResolver
{
    public static string Expand(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var path = raw.Trim();
        try
        {
            path = Environment.ExpandEnvironmentVariables(path);
        }
        catch { /* keep partial */ }

        // Common recipe placeholders that ExpandEnvironmentVariables already covers,
        // plus a few folder aliases authors use in templates.
        path = ReplaceFolderToken(path, "%DOWNLOADS%", Environment.SpecialFolder.UserProfile, "Downloads");
        path = ReplaceFolderToken(path, "%DESKTOP%", Environment.SpecialFolder.DesktopDirectory);
        path = ReplaceFolderToken(path, "%DOCUMENTS%", Environment.SpecialFolder.MyDocuments);
        path = ReplaceFolderToken(path, "%PICTURES%", Environment.SpecialFolder.MyPictures);
        path = ReplaceFolderToken(path, "%MUSIC%", Environment.SpecialFolder.MyMusic);
        path = ReplaceFolderToken(path, "%VIDEOS%", Environment.SpecialFolder.MyVideos);

        return path.Trim();
    }

    private static string ReplaceFolderToken(string path, string token, Environment.SpecialFolder folder, string? child = null)
    {
        if (path.IndexOf(token, StringComparison.OrdinalIgnoreCase) < 0) return path;
        try
        {
            var root = Environment.GetFolderPath(folder);
            if (string.IsNullOrEmpty(root)) return path;
            var resolved = string.IsNullOrEmpty(child) ? root : Path.Combine(root, child);
            return path.Replace(token, resolved, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return path;
        }
    }
}
