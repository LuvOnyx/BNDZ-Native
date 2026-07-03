using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;
using Vanara.PInvoke;
using Vanara.Windows.Shell;

namespace BNDZ.Services;

/// <summary>Child item of a shell namespace folder. Serializes camelCase for the frontend.</summary>
public sealed record ShellChildItem(
    string Id,
    string Name,
    string Type,
    string Path,
    long Size,
    string Extension,
    string Modified,
    bool IsShellItem);

/// <summary>Enumerate children of Windows shell namespace folders (Network, This PC, Libraries, etc.).</summary>
public static class ShellFolderEnumerator
{
    public static Task<List<object>> EnumerateAsync(string shellParsingName)
    {
        return Task.Run(() => Enumerate(shellParsingName));
    }

    public static List<object> Enumerate(string shellParsingName)
    {
        var results = new List<object>();
        if (string.IsNullOrWhiteSpace(shellParsingName)) return results;

        try
        {
            using var folder = new ShellFolder(shellParsingName);
            foreach (ShellItem item in folder)
            {
                using (item)
                {
                    var name = item.Name ?? "Unknown";
                    var parsingName = (item.ParsingName ?? name).Replace('\\', '/');
                    var isFolder = item.IsFolder;
                    long size = 0;
                    try
                    {
                        if (item.Properties.TryGetValue(Ole32.PROPERTYKEY.System.Size, out var sizeVal) && sizeVal is ulong ul)
                            size = (long)ul;
                    }
                    catch { }

                    var modified = DateTime.UtcNow;
                    try
                    {
                        if (item.Properties.TryGetValue(Ole32.PROPERTYKEY.System.DateModified, out var modVal) && modVal is DateTime dt)
                            modified = dt.ToUniversalTime();
                    }
                    catch { }

                    results.Add(new ShellChildItem(
                        Id: parsingName,
                        Name: name,
                        Type: isFolder ? "directory" : "file",
                        Path: parsingName,
                        Size: size,
                        Extension: isFolder ? "" : Path.GetExtension(name).TrimStart('.').ToLowerInvariant(),
                        Modified: modified.ToString("O"),
                        IsShellItem: true));
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"ShellFolderEnumerator: {shellParsingName} — {ex.Message}");
        }

        return results;
    }
}
