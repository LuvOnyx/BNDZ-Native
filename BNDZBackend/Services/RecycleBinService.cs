using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Vanara.PInvoke;
using Vanara.Windows.Shell;

namespace BNDZ.Services;

public static class RecycleBinService
{
    public const string VirtualPath = "shell:RecycleBin";
    private const string ShellParsingName = "::{645FF040-5081-101B-9F08-00AA002F954E}";

    private const uint SHERB_NOCONFIRMATION = 0x00000001;
    private const uint SHERB_NOPROGRESSUI = 0x00000002;

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHEmptyRecycleBin(IntPtr hwnd, string? pszRootPath, uint dwFlags);

    public static bool IsRecycleBinPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var p = path.Replace('\\', '/').Trim();
        while (p.StartsWith("/")) p = p[1..];
        return p.Equals(VirtualPath, StringComparison.OrdinalIgnoreCase)
            || p.Equals(ShellParsingName, StringComparison.OrdinalIgnoreCase);
    }

    public static Task<List<object>> GetContentsAsync()
    {
        return Task.Run(() =>
        {
            var results = new List<object>();
            try
            {
                foreach (var item in RecycleBin.GetItems())
                {
                    using (item)
                    {
                        var rawName = item.Name ?? "Unknown";
                        var name = rawName;
                        if (name.Contains('\\') || name.Contains('/'))
                            name = Path.GetFileName(name.TrimEnd('\\', '/'));
                        if (string.IsNullOrWhiteSpace(name))
                            name = rawName;
                        var parsingName = (item.ParsingName ?? rawName).Replace('\\', '/');
                        var isFolder = item.IsFolder;
                        long size = 0;
                        try
                        {
                            if (item.Properties.TryGetValue(Ole32.PROPERTYKEY.System.Size, out var sizeVal) && sizeVal is ulong ul)
                                size = (long)ul;
                        }
                        catch { /* optional shell property */ }

                        var modified = DateTime.UtcNow;
                        try
                        {
                            if (item.Properties.TryGetValue(Ole32.PROPERTYKEY.System.DateModified, out var modVal) && modVal is DateTime dt)
                                modified = dt.ToUniversalTime();
                        }
                        catch { }

                        results.Add(new
                        {
                            id = parsingName,
                            name,
                            type = isFolder ? "directory" : "file",
                            path = parsingName,
                            size,
                            extension = isFolder ? "" : Path.GetExtension(name).TrimStart('.').ToLowerInvariant(),
                            modified = modified.ToString("O"),
                            isRecycleItem = true,
                        });
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"RecycleBinService.GetContents: {ex.Message}");
            }

            return results;
        });
    }

    public static bool Empty(IntPtr hwnd)
    {
        try
        {
            return SHEmptyRecycleBin(hwnd, null, SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI) == 0;
        }
        catch
        {
            return false;
        }
    }
}
