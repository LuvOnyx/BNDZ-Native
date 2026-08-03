using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Vanara.PInvoke;
using Vanara.Windows.Shell;

namespace BNDZ.Services;

/// <summary>
/// Reconstructs original folder trees from Recycle Bin metadata and restores whole branches.
/// </summary>
public sealed class RecycleArchaeologyService
{
    private static readonly Lazy<RecycleArchaeologyService> Lazy = new(() => new RecycleArchaeologyService());
    public static RecycleArchaeologyService Instance => Lazy.Value;

    private static readonly Ole32.PROPERTYKEY PKEY_Recycle_DeletedFrom =
        new(new Guid("9b174b33-40ff-11d2-a27e-00c04fc30871"), 2);

    public sealed class RecycleArchItem
    {
        public string ParsingName { get; init; } = "";
        public string Name { get; init; } = "";
        public string OriginalParent { get; init; } = "";
        public string OriginalFullPath { get; init; } = "";
        public bool IsFolder { get; init; }
        public long Size { get; init; }
        public DateTime DeletedUtc { get; init; }
    }

    public sealed class RecycleArchBranch
    {
        public string ParentPath { get; init; } = "";
        public int ItemCount { get; init; }
        public long TotalBytes { get; init; }
        public DateTime? LatestDeletedUtc { get; init; }
        public List<RecycleArchItem> Items { get; init; } = new();
        public List<RecycleArchBranch> Children { get; init; } = new();
    }

    public Task<List<RecycleArchBranch>> ListBranchesAsync()
    {
        return Task.Run(() =>
        {
            var items = EnumerateItems();
            var byParent = items
                .GroupBy(i => NormalizeWinPath(i.OriginalParent), StringComparer.OrdinalIgnoreCase)
                .Where(g => !string.IsNullOrWhiteSpace(g.Key))
                .OrderByDescending(g => g.Max(x => x.DeletedUtc))
                .Select(g => new RecycleArchBranch
                {
                    ParentPath = g.Key,
                    ItemCount = g.Count(),
                    TotalBytes = g.Sum(x => x.Size),
                    LatestDeletedUtc = g.Max(x => x.DeletedUtc),
                    Items = g.OrderByDescending(x => x.DeletedUtc).ToList(),
                })
                .ToList();

            return BuildTree(byParent);
        });
    }

    public (int restored, int failed) RestoreBranch(string parentPath)
    {
        var normParent = NormalizeWinPath(parentPath);
        var items = EnumerateItems()
            .Where(i => string.Equals(NormalizeWinPath(i.OriginalParent), normParent, StringComparison.OrdinalIgnoreCase))
            .ToList();
        if (items.Count == 0) return (0, 0);

        var parsingNames = items.Select(i => i.ParsingName).ToList();
        return RecycleBinService.Restore(parsingNames);
    }

    private static List<RecycleArchBranch> BuildTree(List<RecycleArchBranch> flat)
    {
        var map = flat.ToDictionary(b => b.ParentPath, StringComparer.OrdinalIgnoreCase);
        var roots = new List<RecycleArchBranch>();
        foreach (var branch in flat)
        {
            var parentDir = Path.GetDirectoryName(branch.ParentPath.TrimEnd('\\'));
            if (string.IsNullOrWhiteSpace(parentDir)
                || !map.TryGetValue(NormalizeWinPath(parentDir), out var parent))
            {
                roots.Add(branch);
                continue;
            }
            parent.Children.Add(branch);
        }
        return roots.OrderByDescending(r => r.LatestDeletedUtc).ToList();
    }

    private List<RecycleArchItem> EnumerateItems()
    {
        var results = new List<RecycleArchItem>();
        try
        {
            foreach (var item in RecycleBin.GetItems())
            {
                using (item)
                {
                    var parsingName = (item.ParsingName ?? "").Replace('\\', '/');
                    var name = item.Name ?? "Unknown";
                    if (name.Contains('\\') || name.Contains('/'))
                        name = Path.GetFileName(name.TrimEnd('\\', '/'));

                    string? deletedFrom = null;
                    try
                    {
                        if (item.Properties.TryGetValue(PKEY_Recycle_DeletedFrom, out var val) && val is string s)
                            deletedFrom = s;
                    }
                    catch { /* optional */ }

                    if (string.IsNullOrWhiteSpace(deletedFrom))
                        deletedFrom = TryParseOriginalPathFromInfoFile(parsingName, name);

                    if (string.IsNullOrWhiteSpace(deletedFrom)) continue;

                    long size = 0;
                    try
                    {
                        if (item.Properties.TryGetValue(Ole32.PROPERTYKEY.System.Size, out var sizeVal) && sizeVal is ulong ul)
                            size = (long)ul;
                    }
                    catch { }

                    var deleted = DateTime.UtcNow;
                    try
                    {
                        if (item.Properties.TryGetValue(Ole32.PROPERTYKEY.System.DateModified, out var modVal) && modVal is DateTime dt)
                            deleted = dt.ToUniversalTime();
                    }
                    catch { }

                    var parent = NormalizeWinPath(deletedFrom);
                    var full = NormalizeWinPath(Path.Combine(parent, name));

                    results.Add(new RecycleArchItem
                    {
                        ParsingName = parsingName,
                        Name = name,
                        OriginalParent = parent,
                        OriginalFullPath = full,
                        IsFolder = item.IsFolder,
                        Size = size,
                        DeletedUtc = deleted,
                    });
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[RecycleArchaeology] Shell enumerate failed: {ex.Message}");
            results.AddRange(EnumerateFromRecycleBinFolders());
        }

        if (results.Count == 0)
            results.AddRange(EnumerateFromRecycleBinFolders());

        return results;
    }

  private static List<RecycleArchItem> EnumerateFromRecycleBinFolders()
    {
        var results = new List<RecycleArchItem>();
        try
        {
            var drives = DriveInfo.GetDrives().Where(d => d.DriveType == DriveType.Fixed || d.DriveType == DriveType.Removable);
            foreach (var drive in drives)
            {
                var binRoot = Path.Combine(drive.Name, "$Recycle.Bin");
                if (!Directory.Exists(binRoot)) continue;
                foreach (var sidDir in Directory.EnumerateDirectories(binRoot))
                {
                    foreach (var infoFile in Directory.EnumerateFiles(sidDir, "$I*"))
                    {
                        try
                        {
                            var parsed = ParseInfo2File(infoFile);
                            if (parsed is null) continue;
                            var parsedItem = parsed.Value;
                            var rFile = infoFile.Replace("$I", "$R", StringComparison.OrdinalIgnoreCase);
                            var name = Path.GetFileName(parsedItem.OriginalFullPath);
                            var parent = Path.GetDirectoryName(parsedItem.OriginalFullPath) ?? "";
                            results.Add(new RecycleArchItem
                            {
                                ParsingName = rFile.Replace('\\', '/'),
                                Name = name,
                                OriginalParent = NormalizeWinPath(parent),
                                OriginalFullPath = NormalizeWinPath(parsedItem.OriginalFullPath),
                                IsFolder = parsedItem.IsFolder,
                                Size = parsedItem.Size,
                                DeletedUtc = parsedItem.DeletedUtc,
                            });
                        }
                        catch { /* skip corrupt entry */ }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[RecycleArchaeology] $I fallback failed: {ex.Message}");
        }
        return results;
    }

    private static (string OriginalFullPath, long Size, bool IsFolder, DateTime DeletedUtc)? ParseInfo2File(string infoPath)
    {
        using var fs = File.OpenRead(infoPath);
        using var br = new BinaryReader(fs);
        if (fs.Length < 28) return null;
        var version = br.ReadUInt32();
        if (version != 1 && version != 2) return null;
        var size = (long)br.ReadUInt64();
        var fileTime = br.ReadInt64();
        var pathLen = version == 1 ? br.ReadUInt32() : br.ReadUInt32() * 2;
        if (pathLen <= 0 || pathLen > 32768) return null;
        var bytes = br.ReadBytes((int)Math.Min(pathLen, fs.Length - fs.Position));
        var originalPath = version == 1
            ? Encoding.Default.GetString(bytes).TrimEnd('\0')
            : Encoding.Unicode.GetString(bytes).TrimEnd('\0');
        if (string.IsNullOrWhiteSpace(originalPath)) return null;
        var deleted = DateTime.FromFileTimeUtc(fileTime);
        var isFolder = Directory.Exists(infoPath.Replace("$I", "$R", StringComparison.OrdinalIgnoreCase));
        return (originalPath, size, isFolder, deleted);
    }

    private static string? TryParseOriginalPathFromInfoFile(string parsingName, string name)
    {
        try
        {
            var winPath = parsingName.Replace('/', '\\');
            if (!winPath.Contains("$Recycle.Bin", StringComparison.OrdinalIgnoreCase)) return null;
            var dir = Path.GetDirectoryName(winPath);
            if (string.IsNullOrEmpty(dir)) return null;
            var baseName = Path.GetFileName(winPath);
            if (!baseName.StartsWith("$R", StringComparison.OrdinalIgnoreCase)) return null;
            var infoFile = Path.Combine(dir, "$I" + baseName[2..]);
            if (!File.Exists(infoFile)) return null;
            var parsed = ParseInfo2File(infoFile);
            if (parsed == null) return null;
            return Path.GetDirectoryName(parsed.Value.OriginalFullPath);
        }
        catch { return null; }
    }

    private static string NormalizeWinPath(string p) => p.Replace('/', '\\').TrimEnd('\\');
}
