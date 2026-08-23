using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using DiscUtils;
using DiscUtils.Iso9660;
using DiscUtils.Udf;
using DiscUtils.Vhd;
using DiscUtils.Vhdx;
using DiscUtils.Streams;

namespace BNDZ.Services;

/// <summary>
/// Navigate into ISO / VHD / VHDX as virtual folders in the React list (Wave 5).
///
/// Path shape:
///   C:\images\win.iso                → root directory of the ISO/UDF image
///   C:\images\win.iso\sources        → "sources" folder inside the ISO
///   C:\machines\base.vhd             → root of the first readable filesystem partition
///   C:\machines\base.vhd\Windows     → Windows folder inside the VHD
///
/// VHD/VHDX browsing requires a readable NTFS or FAT filesystem partition.
/// DiscUtils.Ntfs and DiscUtils.Fat are registered at first use via SetupHelper.
/// </summary>
public static class DiscUtilsVolumeService
{
    private static readonly string[] ContainerExts = [".iso", ".vhd", ".vhdx"];

    // ----------------------------------------------------------------- setup

    private static readonly object _setupLock = new();
    private static bool _setupDone;

    private static void EnsureRegistered()
    {
        if (_setupDone) return;
        lock (_setupLock)
        {
            if (_setupDone) return;
            SafeRegister(typeof(CDReader).Assembly);
            SafeRegister(typeof(UdfReader).Assembly);
            SafeRegister(typeof(DiscUtils.Vhd.Disk).Assembly);
            SafeRegister(typeof(DiscUtils.Vhdx.Disk).Assembly);
            SafeRegister(typeof(DiscUtils.Ntfs.NtfsFileSystem).Assembly);
            SafeRegister(typeof(DiscUtils.Fat.FatFileSystem).Assembly);
            _setupDone = true;
        }
    }

    private static void SafeRegister(System.Reflection.Assembly asm)
    {
        try { DiscUtils.Setup.SetupHelper.RegisterAssembly(asm); } catch { }
    }

    // --------------------------------------------------------------- path split

    /// <summary>
    /// Splits rawPath into (containerPath, innerPath) at the image-file boundary.
    /// Returns false when no image file segment is found.
    /// </summary>
    public static bool TrySplitContainerPath(string rawPath, out string containerPath, out string innerPath)
    {
        containerPath = "";
        innerPath     = "";
        if (string.IsNullOrWhiteSpace(rawPath)) return false;

        var normalized = rawPath.Replace('/', '\\').Trim();
        foreach (var ext in ContainerExts)
        {
            // Case 1: path contains "ext\" (navigated inside the image)
            var marker = ext + "\\";
            var idx    = normalized.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
            if (idx >= 0)
            {
                var candidate = normalized[..(idx + ext.Length)];
                if (File.Exists(candidate))
                {
                    containerPath = candidate;
                    innerPath     = normalized[(idx + ext.Length + 1)..];  // strip the leading backslash
                    return true;
                }
            }

            // Case 2: path ends with the extension (root of the image)
            if (normalized.EndsWith(ext, StringComparison.OrdinalIgnoreCase) && File.Exists(normalized))
            {
                containerPath = normalized;
                innerPath     = "";
                return true;
            }
        }
        return false;
    }

    public static bool IsContainerPath(string path) => TrySplitContainerPath(path, out _, out _);

    // --------------------------------------------------------------- listing

    /// <summary>Synchronous list — kept for callers that cannot await.</summary>
    public static List<DirListingSharedBuffer.DirEntryDto>? TryList(string rawPath)
    {
        if (!TrySplitContainerPath(rawPath, out var container, out var inner)) return null;
        EnsureRegistered();
        try
        {
            using var fs  = File.Open(container, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var disc = OpenDisc(container, fs);
            if (disc == null) return null;
            return ListEntries(disc, container, inner);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[DiscUtils] List failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>Async list — preferred by FileManagementService streaming path.</summary>
    public static Task<List<DirListingSharedBuffer.DirEntryDto>?> TryListAsync(
        string rawPath, CancellationToken ct = default)
    {
        return Task.Run(() =>
        {
            ct.ThrowIfCancellationRequested();
            return TryList(rawPath);
        }, ct);
    }

    private static List<DirListingSharedBuffer.DirEntryDto>? ListEntries(
        DiscFileSystem disc, string container, string inner)
    {
        var dirPath = string.IsNullOrEmpty(inner)
            ? "\\"
            : "\\" + inner.Replace('/', '\\').TrimStart('\\');

        if (!disc.DirectoryExists(dirPath)) return new List<DirListingSharedBuffer.DirEntryDto>();

        var results = new List<DirListingSharedBuffer.DirEntryDto>();

        // Directories
        foreach (var name in disc.GetDirectories(dirPath))
        {
            var leaf = Path.GetFileName(name.TrimEnd('\\'));
            if (string.IsNullOrEmpty(leaf)) continue;
            var panePath = BuildPanePath(container, inner, leaf);

            DateTimeOffset modified = DateTimeOffset.UtcNow;
            DateTimeOffset created  = DateTimeOffset.UtcNow;
            try { modified = created = new DateTimeOffset(disc.GetLastWriteTimeUtc(name), TimeSpan.Zero); } catch { }
            try { created = new DateTimeOffset(disc.GetCreationTimeUtc(name), TimeSpan.Zero); } catch { }

            results.Add(new DirListingSharedBuffer.DirEntryDto
            {
                Id          = panePath,
                Name        = leaf,
                Type        = "directory",
                Path        = panePath,
                Extension   = "",
                Size        = 0,
                ModifiedUtc = modified,
                CreatedUtc  = created,
            });
        }

        // Files
        foreach (var name in disc.GetFiles(dirPath))
        {
            var leaf = Path.GetFileName(name);
            if (string.IsNullOrEmpty(leaf)) continue;
            var panePath = BuildPanePath(container, inner, leaf);
            var ext      = Path.GetExtension(leaf).TrimStart('.').ToLowerInvariant();

            long size = 0;
            DateTimeOffset modified = DateTimeOffset.UtcNow;
            DateTimeOffset created  = DateTimeOffset.UtcNow;
            try { size = disc.GetFileLength(name); } catch { }
            try { modified = created = new DateTimeOffset(disc.GetLastWriteTimeUtc(name), TimeSpan.Zero); } catch { }
            try { created = new DateTimeOffset(disc.GetCreationTimeUtc(name), TimeSpan.Zero); } catch { }

            results.Add(new DirListingSharedBuffer.DirEntryDto
            {
                Id          = panePath,
                Name        = leaf,
                Type        = "file",
                Path        = panePath,
                Extension   = ext,
                Size        = size,
                ModifiedUtc = modified,
                CreatedUtc  = created,
            });
        }

        return results;
    }

    private static string BuildPanePath(string container, string inner, string leaf)
    {
        var rel = string.IsNullOrEmpty(inner)
            ? leaf
            : inner.TrimEnd('\\') + "\\" + leaf;
        return (container + "\\" + rel).Replace('\\', '/');
    }

    // ----------------------------------------------------------- open helpers

    private static DiscFileSystem? OpenDisc(string container, Stream stream)
    {
        var ext = Path.GetExtension(container).ToLowerInvariant();
        try
        {
            switch (ext)
            {
                case ".iso":
                    // Try UDF first (Blu-ray, newer software ISOs); fall back to ISO 9660/Joliet
                    try
                    {
                        return new UdfReader(stream);
                    }
                    catch
                    {
                        stream.Position = 0;
                        return new CDReader(stream, joliet: true, hideVersions: true);
                    }

                case ".vhd":
                {
                    // Disk wraps the stream without owning it (Ownership.None), so the
                    // outer using(fs) correctly closes the file.
                    var disk = new DiscUtils.Vhd.Disk(stream, Ownership.None);
                    var fs   = OpenFirstFs(disk);
                    if (fs == null) disk.Dispose();
                    return fs;
                }

                case ".vhdx":
                {
                    var disk = new DiscUtils.Vhdx.Disk(stream, Ownership.None);
                    var fs   = OpenFirstFs(disk);
                    if (fs == null) disk.Dispose();
                    return fs;
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[DiscUtils] OpenDisc ({ext}): {ex.Message}");
        }
        return null;
    }

    /// <summary>
    /// Find the first readable filesystem partition on a virtual disk.
    /// Uses FileSystemManager.DetectFileSystems (requires NTFS/FAT assemblies registered above).
    /// </summary>
    private static DiscFileSystem? OpenFirstFs(VirtualDisk disk)
    {
        // Partitioned disk: enumerate logical volumes and detect the first one.
        try
        {
            var manager = new VolumeManager(disk);
            foreach (var vol in manager.GetLogicalVolumes())
            {
                try
                {
                    // Open the volume stream once and reuse — do NOT call vol.Open() twice.
                    using var volStream = vol.Open();
                    var infos = FileSystemManager.DetectFileSystems(volStream);
                    if (!infos.Any()) continue;
                    // Reopen a fresh stream for the filesystem (DetectFileSystems consumed it).
                    return infos[0].Open(vol.Open());
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[DiscUtils] Volume open failed: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[DiscUtils] VolumeManager failed: {ex.Message}");
        }

        // Unpartitioned disk (raw filesystem at sector 0)
        try
        {
            var infos = FileSystemManager.DetectFileSystems(disk.Content);
            if (infos.Any())
                return infos[0].Open(disk.Content);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[DiscUtils] Raw FS detect failed: {ex.Message}");
        }

        return null;
    }
}
