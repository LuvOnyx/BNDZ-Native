using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
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

    // PKEY_Recycle_DeletedFrom ({9b174b33-40ff-11d2-a27e-00c04fc30871}, pid 2) — "Original location".
    // Constructed directly rather than via Ole32.PROPERTYKEY.System, which does not expose every
    // shell property (this one is niche enough it may not be wrapped).
    private static readonly Ole32.PROPERTYKEY PKEY_Recycle_DeletedFrom =
        new(new Guid("9b174b33-40ff-11d2-a27e-00c04fc30871"), 2);

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

    /// <summary>
    /// Restores recycled items to their original location using the shell's own "undelete" verb —
    /// the same mechanism Explorer's Recycle Bin "Restore" context menu item uses. Matches by the
    /// same ParsingName identifier the frontend received from GetContentsAsync.
    /// </summary>
    public static (int restored, int failed) Restore(IEnumerable<string> parsingNames)
    {
        var targets = new HashSet<string>(parsingNames.Select(p => p.Replace('\\', '/')), StringComparer.OrdinalIgnoreCase);
        int restored = 0, failed = 0;
        try
        {
            foreach (var item in RecycleBin.GetItems())
            {
                using (item)
                {
                    var parsingName = (item.ParsingName ?? "").Replace('\\', '/');
                    if (!targets.Contains(parsingName)) continue;
                    try
                    {
                        item.InvokeVerb("undelete");
                        restored++;
                    }
                    catch
                    {
                        failed++;
                    }
                }
            }
        }
        catch
        {
            failed += targets.Count - restored;
        }
        return (restored, failed);
    }

    /// <summary>
    /// Restores recycled items by matching on their original pre-deletion path (PKEY_Recycle_DeletedFrom),
    /// for undoing a "move to Recycle Bin" action log entry where only the original path is known —
    /// distinct from Restore(), which matches by the Recycle Bin's own item identifier.
    /// </summary>
    public static (int restored, int failed) RestoreByOriginalPath(IEnumerable<string> originalPaths)
    {
        var targets = new HashSet<string>(originalPaths.Select(NormalizeWinPath), StringComparer.OrdinalIgnoreCase);
        int restored = 0;
        try
        {
            foreach (var item in RecycleBin.GetItems())
            {
                using (item)
                {
                    string? deletedFrom = null;
                    try
                    {
                        if (item.Properties.TryGetValue(PKEY_Recycle_DeletedFrom, out var val) && val is string s)
                            deletedFrom = s;
                    }
                    catch { /* property unavailable for this item */ }

                    if (deletedFrom == null) continue;
                    var originalFullPath = NormalizeWinPath(Path.Combine(deletedFrom, item.Name ?? ""));
                    if (!targets.Contains(originalFullPath)) continue;

                    try { item.InvokeVerb("undelete"); restored++; }
                    catch { /* leave in recycle bin, counted as not-restored below */ }
                }
            }
        }
        catch { /* best effort */ }
        return (restored, targets.Count - restored);
    }

    private static string NormalizeWinPath(string p) => p.Replace('/', '\\').TrimEnd('\\');
}
