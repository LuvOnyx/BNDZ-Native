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
    private static readonly Ole32.PROPERTYKEY PKEY_Recycle_DeletedFrom =
        new(new Guid("9b174b33-40ff-11d2-a27e-00c04fc30871"), 2);

    private static readonly Ole32.PROPERTYKEY PKEY_Recycle_DateDeleted =
        new(new Guid("9b174b33-40ff-11d2-a27e-00c04fc30871"), 3);

    public static bool IsRecycleBinPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var p = path.Replace('\\', '/').Trim();
        while (p.StartsWith("/")) p = p[1..];
        return p.Equals(VirtualPath, StringComparison.OrdinalIgnoreCase)
            || p.Equals(ShellParsingName, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Typed recycle listing for SharedBuffer / backend-host JSON paths.</summary>
    public static Task<List<DirListingSharedBuffer.DirEntryDto>> GetEntriesAsync()
        => BndzShellStaThread.RunAsync(EnumerateEntries);

    public static Task<List<object>> GetContentsAsync()
        => GetEntriesAsync().ContinueWith(t => t.Result.Cast<object>().ToList(), TaskContinuationOptions.ExecuteSynchronously);

    private static List<DirListingSharedBuffer.DirEntryDto> EnumerateEntries()
    {
        var results = EnumerateFromRecycleBinApi();
        if (results.Count == 0)
        {
            try
            {
                var fallback = ShellFolderEnumerator.Enumerate(ShellPathResolver.RecycleBinClsid);
                foreach (var item in fallback)
                {
                    if (item is ShellChildItem sci)
                    {
                        var dto = DirListingSharedBuffer.FromShellChild(sci);
                        dto.IsRecycleItem = true;
                        dto.IsShellItem = true;
                        results.Add(dto);
                    }
                    else
                    {
                        results.Add(DirListingSharedBuffer.FromLegacyObject(item));
                    }
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"RecycleBinService fallback enumerate: {ex.Message}");
            }
        }

        System.Diagnostics.Debug.WriteLine($"RecycleBinService.GetContents: {results.Count} item(s)");
        return results;
    }

    private static List<DirListingSharedBuffer.DirEntryDto> EnumerateFromRecycleBinApi()
    {
        var results = new List<DirListingSharedBuffer.DirEntryDto>();
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

                    var modified = DateTimeOffset.UtcNow;
                    try
                    {
                        if (item.Properties.TryGetValue(Ole32.PROPERTYKEY.System.DateModified, out var modVal) && modVal is DateTime dt)
                            modified = dt.ToUniversalTime();
                    }
                    catch { }

                    string? originalLocation = null;
                    string? originalPath = null;
                    try
                    {
                        if (item.Properties.TryGetValue(PKEY_Recycle_DeletedFrom, out var fromVal) && fromVal is string from)
                        {
                            originalLocation = from;
                            var leaf = Path.GetFileName((item.Name ?? name).TrimEnd('\\', '/'));
                            if (string.IsNullOrWhiteSpace(leaf)) leaf = name;
                            originalPath = Path.Combine(from, leaf);
                        }
                    }
                    catch { /* optional recycle PKEY */ }

                    DateTimeOffset? dateDeleted = null;
                    try
                    {
                        if (item.Properties.TryGetValue(PKEY_Recycle_DateDeleted, out var delVal) && delVal is DateTime delDt)
                            dateDeleted = delDt.ToUniversalTime();
                    }
                    catch { }

                    results.Add(new DirListingSharedBuffer.DirEntryDto
                    {
                        Id = parsingName,
                        Name = name,
                        Type = isFolder ? "directory" : "file",
                        Path = parsingName,
                        Size = size,
                        Extension = isFolder ? "" : Path.GetExtension(name).TrimStart('.').ToLowerInvariant(),
                        ModifiedUtc = modified,
                        CreatedUtc = modified,
                        IsShellItem = true,
                        AttrBits = DirListingSharedBuffer.AttrShellItem,
                        IsRecycleItem = true,
                        OriginalLocation = originalLocation,
                        OriginalPath = originalPath,
                        DeletedUtc = dateDeleted ?? modified,
                    });
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"RecycleBinService.GetContents: {ex.Message}");
        }

        return results;
    }

    public static Task<(bool ok, string? error)> EmptyAsync(IntPtr hwnd)
    {
        return Task.Run(() =>
        {
            (bool ok, string? error) result = (false, "Unknown error");
            BndzShellStaThread.Run(() => result = EmptyOnSta(hwnd));
            return result;
        });
    }

    private static (bool ok, string? error) EmptyOnSta(IntPtr hwnd)
    {
        try
        {
            if (hwnd == IntPtr.Zero)
                hwnd = (IntPtr)User32.GetDesktopWindow();
            var hr = SHEmptyRecycleBin(hwnd, null, SHERB_NOCONFIRMATION | SHERB_NOPROGRESSUI);
            if (hr == 0) return (true, null);
            unchecked
            {
                if (hr == (int)0x8000FFFF) return (true, null); // already empty
                if (hr == (int)0x80070015) return (true, null); // nothing to empty
            }
            var msg = $"Could not empty Recycle Bin (0x{hr:X8})";
            System.Diagnostics.Debug.WriteLine($"RecycleBinService.Empty {msg}");
            return (false, msg);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"RecycleBinService.Empty: {ex.Message}");
            return (false, ex.Message);
        }
    }

    public static bool Empty(IntPtr hwnd)
        => EmptyAsync(hwnd).GetAwaiter().GetResult().ok;

    /// <summary>
    /// Restores recycled items to their original location using the shell's own "undelete" verb.
    /// </summary>
    public static (int restored, int failed) Restore(IEnumerable<string> parsingNames)
    {
        var targets = new HashSet<string>(parsingNames.Select(p => p.Replace('\\', '/')), StringComparer.OrdinalIgnoreCase);
        (int restored, int failed) result = (0, 0);
        BndzShellStaThread.Run(() => result = RestoreOnSta(targets));
        return result;
    }

    private static (int restored, int failed) RestoreOnSta(HashSet<string> targets)
    {
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
    /// Restores recycled items by matching on their original pre-deletion path (PKEY_Recycle_DeletedFrom).
    /// </summary>
    public static (int restored, int failed) RestoreByOriginalPath(IEnumerable<string> originalPaths)
    {
        var targets = new HashSet<string>(originalPaths.Select(NormalizeWinPath), StringComparer.OrdinalIgnoreCase);
        (int restored, int failed) result = (0, 0);
        BndzShellStaThread.Run(() => result = RestoreByOriginalPathOnSta(targets));
        return result;
    }

    private static (int restored, int failed) RestoreByOriginalPathOnSta(HashSet<string> targets)
    {
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
                    catch { /* leave in recycle bin */ }
                }
            }
        }
        catch { /* best effort */ }
        return (restored, targets.Count - restored);
    }

    /// <summary>Permanently delete items still in the Recycle Bin (shell parsing names from GetContents).</summary>
    public static (int purged, int failed) Purge(IEnumerable<string> parsingNames)
    {
        var targets = new HashSet<string>(parsingNames.Select(p => p.Replace('\\', '/')), StringComparer.OrdinalIgnoreCase);
        (int purged, int failed) result = (0, 0);
        BndzShellStaThread.Run(() => result = PurgeOnSta(targets));
        return result;
    }

    private static (int purged, int failed) PurgeOnSta(HashSet<string> targets)
    {
        int purged = 0, failed = 0;
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
                        item.InvokeVerb("delete");
                        purged++;
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
            failed += targets.Count - purged;
        }
        return (purged, failed);
    }

    private static string NormalizeWinPath(string p) => p.Replace('/', '\\').TrimEnd('\\');
}
