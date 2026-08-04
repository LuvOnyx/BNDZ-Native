using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>
/// Explorer-style shell imagelist glyphs: resolve SYSICONINDEX once per iIcon,
/// encode PNG once, share across all paths with that system icon index.
/// Builds listing-time glyph maps (unique extensions + folder default) for first paint.
///
/// CRITICAL: <see cref="FolderKey"/> is ONLY the generic directory glyph (USEFILEATTRIBUTES probe).
/// Never write Desktop/Downloads/Documents (or any per-path extract) into FolderKey — that
/// poisons every folder in the tree and list with the wrong special-folder icon.
/// </summary>
public sealed class ShellGlyphMapService
{
    public const string FolderKey = "__folder__";

    private static readonly Lazy<ShellGlyphMapService> Lazy = new(() => new ShellGlyphMapService());
    public static ShellGlyphMapService Instance => Lazy.Value;

    private const uint SHGFI_ICON = 0x000000100;
    private const uint SHGFI_LARGEICON = 0x000000000;
    private const uint SHGFI_SMALLICON = 0x000000001;
    private const uint SHGFI_SYSICONINDEX = 0x000004000;
    private const uint SHGFI_USEFILEATTRIBUTES = 0x000000010;
    private const uint FILE_ATTRIBUTE_DIRECTORY = 0x10;
    private const uint FILE_ATTRIBUTE_NORMAL = 0x80;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct SHFILEINFO
    {
        public IntPtr hIcon;
        public int iIcon;
        public uint dwAttributes;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
        public string szDisplayName;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
        public string szTypeName;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr SHGetFileInfo(
        string pszPath,
        uint dwFileAttributes,
        ref SHFILEINFO psfi,
        uint cbFileInfo,
        uint uFlags);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIcon(IntPtr hIcon);

    /// <summary>iIcon → base64 PNG (no data: prefix).</summary>
    private readonly ConcurrentDictionary<int, string> _bySysIndex = new();

    /// <summary>Extension (".pdf") / FolderKey → base64 PNG.</summary>
    private readonly ConcurrentDictionary<string, string> _byGlyphKey =
        new(StringComparer.OrdinalIgnoreCase);

    public string? TryGetBySysIndex(int iIcon) =>
        _bySysIndex.TryGetValue(iIcon, out var png) ? png : null;

    public void PutSysIndex(int iIcon, string base64Png)
    {
        if (iIcon < 0 || string.IsNullOrEmpty(base64Png)) return;
        _bySysIndex[iIcon] = base64Png;
    }

    /// <summary>Drop in-memory glyph maps (after durable poison purge).</summary>
    public void ClearMemory()
    {
        _bySysIndex.Clear();
        _byGlyphKey.Clear();
    }

    /// <summary>
    /// Resolve a type glyph using SYSICONINDEX encode-once. Returns base64 PNG or empty.
    /// </summary>
    public string GetTypeGlyphBase64(string extensionOrFolderKey, bool isDirectory)
    {
        var key = NormalizeGlyphKey(extensionOrFolderKey, isDirectory);
        if (_byGlyphKey.TryGetValue(key, out var hit) && !string.IsNullOrEmpty(hit))
            return hit;

        var (iIcon, png) = ExtractGlyph(key, isDirectory || key == FolderKey);
        if (!string.IsNullOrEmpty(png))
        {
            if (iIcon >= 0)
                _bySysIndex[iIcon] = png;
            _byGlyphKey[key] = png;
            BndzHostCaches.Icons.AddOrUpdate(key, png);
            if (BndzMediaDiskCache.Instance.CurrentPolicy.CacheIconsOnDisk)
                BndzMediaDiskCache.Instance.PutBase64(BndzMediaDiskCache.Kind.Icon, key, png);
        }
        return png;
    }

    /// <summary>
    /// Build a compact glyph map for the given listing entries (unique extensions + folder).
    /// Keys: ".pdf", "__folder__". Values: base64 PNG only (never bndz-media:// — avoids list blanking).
    /// </summary>
    public Dictionary<string, string> BuildListingGlyphMap(
        IEnumerable<DirListingSharedBuffer.DirEntryDto> entries,
        int maxUnique = 64)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        // Always rebuild generic folder via GetTypeGlyphBase64 (probe) — PreferDisk alone can be poisoned.
        var folderPng = GetTypeGlyphBase64(FolderKey, true);
        if (!string.IsNullOrEmpty(folderPng))
            map[FolderKey] = folderPng;

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var e in entries)
        {
            if (map.Count >= maxUnique + 1) break;
            if (string.Equals(e.Type, "directory", StringComparison.OrdinalIgnoreCase))
                continue;

            var ext = e.Extension?.Trim() ?? "";
            if (string.IsNullOrEmpty(ext) && !string.IsNullOrEmpty(e.Name))
            {
                var dot = e.Name.LastIndexOf('.');
                if (dot > 0 && dot < e.Name.Length - 1)
                    ext = e.Name[(dot + 1)..];
            }
            if (string.IsNullOrEmpty(ext)) continue;
            if (ext.Equals("exe", StringComparison.OrdinalIgnoreCase)
                || ext.Equals("lnk", StringComparison.OrdinalIgnoreCase)
                || ext.Equals("ico", StringComparison.OrdinalIgnoreCase)
                || ext.Equals("msi", StringComparison.OrdinalIgnoreCase))
                continue; // per-file icons — not type glyphs

            var key = ext.StartsWith('.') ? ext.ToLowerInvariant() : ("." + ext.ToLowerInvariant());
            if (!seen.Add(key)) continue;

            var png = PreferDiskBase64(key, () => GetTypeGlyphBase64(key, false));
            if (!string.IsNullOrEmpty(png))
                map[key] = png;
        }

        return map;
    }

    /// <summary>
    /// Try reuse a SYSICONINDEX-cached PNG for a real path before extracting a new HICON.
    /// Returns base64 or empty when miss (caller extracts).
    /// Never returns FolderKey for every directory — special folders (Downloads, Desktop, …)
    /// have unique indices and must not share a poisoned generic glyph.
    /// </summary>
    public string TryResolveViaSysIconIndex(string path, bool isDirectory)
    {
        if (string.IsNullOrEmpty(path)) return "";

        var key = BndzHostCaches.IconCacheKey(path, isDirectory);
        // Type glyphs for files by extension only.
        if (!isDirectory && !string.IsNullOrEmpty(key) && key.StartsWith('.')
            && _byGlyphKey.TryGetValue(key, out var typeHit))
            return typeHit;

        try
        {
            var shfi = new SHFILEINFO();
            // Real path index — NO USEFILEATTRIBUTES. That flag forces the generic folder
            // index for every directory and made RememberExtractedIcon map Downloads PNG → generic iIcon.
            uint flags = SHGFI_SYSICONINDEX | SHGFI_LARGEICON;
            SHGetFileInfo(path, 0, ref shfi, (uint)Marshal.SizeOf(shfi), flags);
            if (shfi.iIcon >= 0 && _bySysIndex.TryGetValue(shfi.iIcon, out var cached))
            {
                if (!isDirectory && !string.IsNullOrEmpty(key) && key.StartsWith('.'))
                    _byGlyphKey.TryAdd(key, cached);
                return cached;
            }
        }
        catch { /* fall through */ }

        return "";
    }

    /// <summary>After a full icon extract, remember the SYSICONINDEX → PNG association.</summary>
    public void RememberExtractedIcon(string path, bool isDirectory, string base64Png)
    {
        if (string.IsNullOrEmpty(path) || string.IsNullOrEmpty(base64Png)) return;
        try
        {
            var shfi = new SHFILEINFO();
            // Bind PNG to the REAL path's SYSICONINDEX (no USEFILEATTRIBUTES).
            uint flags = SHGFI_SYSICONINDEX | SHGFI_LARGEICON;
            SHGetFileInfo(path, 0, ref shfi, (uint)Marshal.SizeOf(shfi), flags);
            if (shfi.iIcon >= 0)
                _bySysIndex[shfi.iIcon] = base64Png;

            var key = BndzHostCaches.IconCacheKey(path, isDirectory);
            // Extension type glyphs only — NEVER write per-path directories into FolderKey.
            if (!isDirectory && !string.IsNullOrEmpty(key) && key.StartsWith('.'))
                _byGlyphKey[key] = base64Png;
        }
        catch { /* ignore */ }
    }

    private static string NormalizeGlyphKey(string extensionOrFolderKey, bool isDirectory)
    {
        if (isDirectory || string.Equals(extensionOrFolderKey, FolderKey, StringComparison.OrdinalIgnoreCase))
            return FolderKey;
        var e = (extensionOrFolderKey ?? "").Trim().ToLowerInvariant();
        if (string.IsNullOrEmpty(e)) return FolderKey;
        return e.StartsWith('.') ? e : "." + e;
    }

    private (int iIcon, string png) ExtractGlyph(string key, bool isDirectory)
    {
        // Prefer L2 CAS — but FolderKey may have been poisoned (Downloads PNG). When key is
        // FolderKey, always re-probe via USEFILEATTRIBUTES and overwrite durable store.
        if (key != FolderKey)
        {
            var fromDisk = BndzMediaDiskCache.Instance.TryGetBase64(BndzMediaDiskCache.Kind.Icon, key);
            if (!string.IsNullOrEmpty(fromDisk))
                return (-1, fromDisk);

            if (BndzHostCaches.Icons.TryGet(key, out var l1) && !string.IsNullOrEmpty(l1))
                return (-1, l1);
        }

        try
        {
            var probe = isDirectory || key == FolderKey
                ? "folder"
                : ("file" + (key.StartsWith('.') ? key : "." + key));
            var shfi = new SHFILEINFO();
            uint flags = SHGFI_ICON | SHGFI_LARGEICON | SHGFI_SYSICONINDEX | SHGFI_USEFILEATTRIBUTES;
            uint attrs = (isDirectory || key == FolderKey) ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_NORMAL;
            SHGetFileInfo(probe, attrs, ref shfi, (uint)Marshal.SizeOf(shfi), flags);
            var iIcon = shfi.iIcon;
            // For FolderKey, never trust a prior _bySysIndex entry — it may hold Downloads PNG
            // under the generic folder index from the old USEFILEATTRIBUTES bug.
            if (key != FolderKey && iIcon >= 0 && _bySysIndex.TryGetValue(iIcon, out var cached))
            {
                if (shfi.hIcon != IntPtr.Zero) DestroyIcon(shfi.hIcon);
                return (iIcon, cached);
            }

            var png = HIconToBase64(shfi.hIcon);
            if (key == FolderKey && !string.IsNullOrEmpty(png) && iIcon >= 0)
            {
                // Overwrite whatever poison was under the generic index.
                _bySysIndex[iIcon] = png;
            }
            return (iIcon, png);
        }
        catch
        {
            return (-1, "");
        }
    }

    private static string PreferDiskBase64(string cacheKey, Func<string> extract)
    {
        var fromDisk = BndzMediaDiskCache.Instance.TryGetBase64(BndzMediaDiskCache.Kind.Icon, cacheKey);
        if (!string.IsNullOrEmpty(fromDisk)) return fromDisk!;
        return extract() ?? "";
    }

    private static string HIconToBase64(IntPtr hIcon)
    {
        if (hIcon == IntPtr.Zero) return "";
        try
        {
            using var icon = Icon.FromHandle(hIcon);
            using var bitmap = icon.ToBitmap();
            using var ms = new MemoryStream();
            bitmap.MakeTransparent();
            bitmap.Save(ms, ImageFormat.Png);
            return Convert.ToBase64String(ms.ToArray());
        }
        catch
        {
            return "";
        }
        finally
        {
            DestroyIcon(hIcon);
        }
    }
}
