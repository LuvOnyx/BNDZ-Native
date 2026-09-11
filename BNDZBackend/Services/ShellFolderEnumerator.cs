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
        => BndzShellStaThread.RunAsync(() => Enumerate(shellParsingName).Cast<object>().ToList());

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
                    var name = ResolveDisplayName(item);
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

    /// <summary>
    /// Library/.library-ms children often return null for <see cref="ShellItem.Name"/>.
    /// Fall back through shell properties, then parsing-name stem.
    /// </summary>
    private static string ResolveDisplayName(ShellItem item)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(item.Name) && !IsPlaceholderName(item.Name))
                return item.Name.Trim();
        }
        catch { }

        try
        {
            if (item.Properties.TryGetValue(Ole32.PROPERTYKEY.System.ItemNameDisplay, out var disp)
                && disp is string s
                && !string.IsNullOrWhiteSpace(s)
                && !IsPlaceholderName(s))
            {
                return s.Trim();
            }
        }
        catch { }

        try
        {
            if (item.Properties.TryGetValue(Ole32.PROPERTYKEY.System.FileName, out var fn)
                && fn is string fileName
                && !string.IsNullOrWhiteSpace(fileName))
            {
                var stem = Path.GetFileNameWithoutExtension(fileName.Replace('/', '\\'));
                if (!string.IsNullOrWhiteSpace(stem))
                {
                    if (stem.EndsWith(".library-ms", StringComparison.OrdinalIgnoreCase))
                        stem = stem[..^".library-ms".Length];
                    if (!string.IsNullOrWhiteSpace(stem) && !IsPlaceholderName(stem))
                        return stem;
                }
            }
        }
        catch { }

        try
        {
            var parsing = item.ParsingName;
            if (!string.IsNullOrWhiteSpace(parsing))
            {
                var leaf = Path.GetFileName(parsing.Replace('/', '\\').TrimEnd('\\'));
                if (!string.IsNullOrWhiteSpace(leaf))
                {
                    if (leaf.EndsWith(".library-ms", StringComparison.OrdinalIgnoreCase))
                        leaf = leaf[..^".library-ms".Length];
                    if (!string.IsNullOrWhiteSpace(leaf) && !IsPlaceholderName(leaf))
                        return leaf;
                }
            }
        }
        catch { }

        return "Unknown";
    }

    private static bool IsPlaceholderName(string? name)
    {
        if (string.IsNullOrWhiteSpace(name)) return true;
        var n = name.Trim();
        return n.Equals("Unknown", StringComparison.OrdinalIgnoreCase)
            || n.Equals("(null)", StringComparison.OrdinalIgnoreCase);
    }
}
