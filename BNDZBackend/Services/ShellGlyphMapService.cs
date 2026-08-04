using System.Collections.Concurrent;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>
/// Explorer-style shell imagelist glyphs: resolve SYSICONINDEX once per iIcon,
/// encode PNG once, share across all paths with that system icon index.
/// Builds listing-time glyph maps (unique extensions + folder default) for first paint.
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
            BndzHostCaches.Icons.AddOrUpdate(key == FolderKey ? key : key, png);
            if (BndzMediaDiskCache.Instance.CurrentPolicy.CacheIconsOnDisk)
                BndzMediaDiskCache.Instance.PutBase64(BndzMediaDiskCache.Kind.Icon, key, png);
        }
        return png;
    }

    /// <summary>
    /// Build a compact glyph map for the given listing entries (unique extensions + folder).
    /// Keys: ".pdf", "__folder__". Values: base64 PNG or bndz-media://cas/{hash}.png when CAS-warm.
    /// </summary>
    public Dictionary<string, string> BuildListingGlyphMap(
        IEnumerable<DirListingSharedBuffer.DirEntryDto> entries,
        int maxUnique = 64)
    {
        var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var folderPng = PreferCasOrBase64(FolderKey, () => GetTypeGlyphBase64(FolderKey, true));
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

            var png = PreferCasOrBase64(key, () => GetTypeGlyphBase64(key, false));
            if (!string.IsNullOrEmpty(png))
                map[key] = png;
        }

        return map;
    }

    /// <summary>
    /// Try reuse a SYSICONINDEX-cached PNG for a real path before extracting a new HICON.
    /// Returns base64 or empty when miss (caller extracts).
    /// </summary>
    public string TryResolveViaSysIconIndex(string path, bool isDirectory)
    {
        if (string.IsNullOrEmpty(path)) return "";

        var key = BndzHostCaches.IconCacheKey(path, isDirectory);
        if (!string.IsNullOrEmpty(key) && key.StartsWith('.') && _byGlyphKey.TryGetValue(key, out var typeHit))
            return typeHit;
        if (isDirectory && _byGlyphKey.TryGetValue(FolderKey, out var folderHit))
            return folderHit;

        try
        {
            var shfi = new SHFILEINFO();
            uint flags = SHGFI_SYSICONINDEX | SHGFI_LARGEICON;
            uint attrs = 0;
            bool isVirtual = ShellPathResolver.IsShellVirtualPath(path)
                || path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase);
            if (isDirectory && !isVirtual)
            {
                flags |= SHGFI_USEFILEATTRIBUTES;
                attrs = FILE_ATTRIBUTE_DIRECTORY;
            }

            SHGetFileInfo(path, attrs, ref shfi, (uint)Marshal.SizeOf(shfi), flags);
            if (shfi.iIcon >= 0 && _bySysIndex.TryGetValue(shfi.iIcon, out var cached))
            {
                if (!string.IsNullOrEmpty(key) && key.StartsWith('.'))
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
            uint flags = SHGFI_SYSICONINDEX | SHGFI_LARGEICON;
            uint attrs = 0;
            if (isDirectory)
            {
                flags |= SHGFI_USEFILEATTRIBUTES;
                attrs = FILE_ATTRIBUTE_DIRECTORY;
            }
            SHGetFileInfo(path, attrs, ref shfi, (uint)Marshal.SizeOf(shfi), flags);
            if (shfi.iIcon >= 0)
                _bySysIndex[shfi.iIcon] = base64Png;

            var key = BndzHostCaches.IconCacheKey(path, isDirectory);
            if (!string.IsNullOrEmpty(key) && (key.StartsWith('.') || isDirectory))
                _byGlyphKey[isDirectory && !key.StartsWith('.') ? FolderKey : key] = base64Png;
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
        // Prefer L2 CAS
        var fromDisk = BndzMediaDiskCache.Instance.TryGetBase64(BndzMediaDiskCache.Kind.Icon, key);
        if (!string.IsNullOrEmpty(fromDisk))
            return (-1, fromDisk);

        if (BndzHostCaches.Icons.TryGet(key, out var l1) && !string.IsNullOrEmpty(l1))
            return (-1, l1);

        try
        {
            var probe = isDirectory
                ? "C:\\Windows"
                : ("file" + (key.StartsWith('.') ? key : "." + key));
            var shfi = new SHFILEINFO();
            uint flags = SHGFI_ICON | SHGFI_LARGEICON | SHGFI_SYSICONINDEX | SHGFI_USEFILEATTRIBUTES;
            uint attrs = isDirectory ? FILE_ATTRIBUTE_DIRECTORY : FILE_ATTRIBUTE_NORMAL;
            SHGetFileInfo(probe, attrs, ref shfi, (uint)Marshal.SizeOf(shfi), flags);
            var iIcon = shfi.iIcon;
            if (iIcon >= 0 && _bySysIndex.TryGetValue(iIcon, out var cached))
            {
                if (shfi.hIcon != IntPtr.Zero) DestroyIcon(shfi.hIcon);
                return (iIcon, cached);
            }

            var png = HIconToBase64(shfi.hIcon);
            return (iIcon, png);
        }
        catch
        {
            return (-1, "");
        }
    }

    private static string PreferCasOrBase64(string cacheKey, Func<string> extract)
    {
        var url = BndzMediaDiskCache.Instance.TryGetCasUrl(BndzMediaDiskCache.Kind.Icon, cacheKey);
        if (!string.IsNullOrEmpty(url)) return url!;
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
