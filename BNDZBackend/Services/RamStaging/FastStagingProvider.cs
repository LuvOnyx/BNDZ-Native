using System.Diagnostics;

namespace BNDZ.Services.RamStaging;

/// <summary>NVMe-backed fast staging fallback when ImDisk is unavailable.</summary>
public sealed class FastStagingProvider
{
    private readonly string _root;

    public FastStagingProvider()
    {
        var baseDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "FastStaging");
        Directory.CreateDirectory(baseDir);
        _root = baseDir;
    }

    public string CreateZone(string zoneId) => Path.Combine(_root, zoneId);

    public void DeleteZone(string zoneId)
    {
        var path = Path.Combine(_root, zoneId);
        if (Directory.Exists(path))
            Directory.Delete(path, true);
    }

    public static string FindFastestDrive()
    {
        try
        {
            var drives = DriveInfo.GetDrives()
                .Where(d => d.IsReady && d.DriveType == DriveType.Fixed)
                .OrderByDescending(d => d.AvailableFreeSpace)
                .ToList();
            return drives.FirstOrDefault()?.RootDirectory.FullName
                ?? Path.GetPathRoot(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)) ?? "C:\\";
        }
        catch
        {
            return "C:\\";
        }
    }
}
