#if BNDZ_HAS_CODEWALKER
using CodeWalker.GameFiles;
#endif

namespace BNDZ.Services;

/// <summary>
/// Lists / extracts Rockstar RPF archives via CodeWalker so Archive preview can browse
/// drawable meshes inside packs (above-and-beyond FiveM fidelity).
/// </summary>
public static class RageRpfArchiveHost
{
    public static bool IsRpfPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        return Path.GetExtension(path).Equals(".rpf", StringComparison.OrdinalIgnoreCase);
    }

#if !BNDZ_HAS_CODEWALKER
    public static ArchiveService.ArchiveContentsResult? TryListContents(string path, int limit = 5000) =>
        new()
        {
            Format = "rpf",
            Error = "RPF browse requires CodeWalker.Core under external/CodeWalker (run scripts/build-bndz-native.ps1).",
        };

    public static bool TryExtractEntry(string archivePath, string entryPath, string destinationDir, out string? error)
    {
        error = "RPF extract requires CodeWalker.Core.";
        return false;
    }
#else
    public static ArchiveService.ArchiveContentsResult? TryListContents(string path, int limit = 5000)
    {
        try
        {
            if (!File.Exists(path))
                return new ArchiveService.ArchiveContentsResult { Format = "rpf", Error = "File not found" };

            var rpf = new RpfFile(path, Path.GetFileName(path));
            rpf.ScanStructure(_ => { }, _ => { });
            var entries = new List<ArchiveService.ArchiveEntryDto>();
            long total = 0;
            if (rpf.AllEntries != null)
            {
                foreach (var e in rpf.AllEntries)
                {
                    if (entries.Count >= limit) break;
                    if (e is RpfDirectoryEntry)
                    {
                        var dirPath = NormalizeEntryPath(e.Path);
                        if (string.IsNullOrEmpty(dirPath)) continue;
                        entries.Add(new ArchiveService.ArchiveEntryDto
                        {
                            Path = dirPath.EndsWith('/') ? dirPath : dirPath + "/",
                            Name = e.Name,
                            Size = 0,
                            CompressedSize = 0,
                            IsDirectory = true,
                        });
                        continue;
                    }
                    if (e is not RpfFileEntry file) continue;
                    var filePath = NormalizeEntryPath(file.Path);
                    if (string.IsNullOrEmpty(filePath)) continue;
                    var size = file.GetFileSize();
                    entries.Add(new ArchiveService.ArchiveEntryDto
                    {
                        Path = filePath,
                        Name = file.Name,
                        Size = size,
                        CompressedSize = size,
                        IsDirectory = false,
                    });
                    total += size;
                }
            }

            return new ArchiveService.ArchiveContentsResult
            {
                Format = "rpf",
                EntryCount = entries.Count,
                TotalSize = total,
                TotalCompressedSize = total,
                Entries = entries.OrderBy(x => x.Path, StringComparer.OrdinalIgnoreCase).ToList(),
            };
        }
        catch (Exception ex)
        {
            return new ArchiveService.ArchiveContentsResult { Format = "rpf", Error = ex.Message };
        }
    }

    public static bool TryExtractEntry(string archivePath, string entryPath, string destinationDir, out string? error)
    {
        error = null;
        try
        {
            if (!File.Exists(archivePath))
            {
                error = "RPF not found";
                return false;
            }
            var want = NormalizeEntryPath(entryPath);
            var rpf = new RpfFile(archivePath, Path.GetFileName(archivePath));
            rpf.ScanStructure(_ => { }, _ => { });
            RpfFileEntry? match = null;
            if (rpf.AllEntries != null)
            {
                foreach (var e in rpf.AllEntries)
                {
                    if (e is not RpfFileEntry file) continue;
                    var p = NormalizeEntryPath(file.Path);
                    if (string.Equals(p, want, StringComparison.OrdinalIgnoreCase)
                        || string.Equals(file.Name, Path.GetFileName(want), StringComparison.OrdinalIgnoreCase)
                           && p.EndsWith("/" + want, StringComparison.OrdinalIgnoreCase))
                    {
                        match = file;
                        break;
                    }
                }
            }
            if (match == null)
            {
                error = "Entry not found in RPF";
                return false;
            }

            var bytes = rpf.ExtractFile(match);
            if (bytes == null || bytes.Length == 0)
            {
                error = "Could not extract RPF entry (encrypted or empty)";
                return false;
            }

            Directory.CreateDirectory(destinationDir);
            var leaf = Path.GetFileName(want);
            if (string.IsNullOrEmpty(leaf)) leaf = match.Name;
            var dest = Path.Combine(destinationDir, leaf);
            File.WriteAllBytes(dest, bytes);
            return true;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }

    private static string NormalizeEntryPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        return path.Replace('\\', '/').Trim().TrimStart('/');
    }
#endif
}
