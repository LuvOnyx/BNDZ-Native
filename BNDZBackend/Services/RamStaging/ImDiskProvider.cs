using System.Diagnostics;

namespace BNDZ.Services.RamStaging;

/// <summary>Detect and manage ImDisk RAM volumes.</summary>
public sealed class ImDiskProvider
{
    public bool IsAvailable
    {
        get
        {
            var now = Environment.TickCount64;
            if (_availCached && now - _availTicks < 30_000)
                return _availValue;
            _availValue = FindImDisk() != null;
            _availCached = true;
            _availTicks = now;
            return _availValue;
        }
    }

    public void InvalidateAvailabilityCache()
    {
        _availCached = false;
        _availTicks = 0;
    }

    private bool _availCached;
    private bool _availValue;
    private long _availTicks;

    public string? FindImDisk()
    {
        foreach (var path in CandidateImDiskPaths())
        {
            try
            {
                if (File.Exists(path)) return path;
            }
            catch
            {
                /* skip inaccessible path */
            }
        }
        return null;
    }

    private static IEnumerable<string> CandidateImDiskPaths()
    {
        var baseDir = AppContext.BaseDirectory.TrimEnd('\\', '/');
        yield return Path.Combine(baseDir, "redist", "imdisk", "imdisk.exe");
        yield return Path.Combine(baseDir, "redist", "imdisk", "x64", "imdisk.exe");
        yield return Path.Combine(baseDir, "redist", "imdisk", "cli", "imdisk.exe");
        yield return Path.Combine(baseDir, "Assets", "redist", "imdisk", "imdisk.exe");
        yield return Path.Combine(CacheDirectoryFallback(), "imdisk.exe");

        // Vendored LTRData/ImDisk source tree build outputs (dev)
        foreach (var root in DevRepoRoots())
        {
            yield return Path.Combine(root, "external", "ImDisk", "cli", "x64", "fre", "imdisk.exe");
            yield return Path.Combine(root, "external", "ImDisk", "cli", "amd64", "imdisk.exe");
        }

        yield return @"C:\Windows\System32\imdisk.exe";
        yield return @"C:\Program Files\ImDisk\imdisk.exe";
        yield return @"C:\Program Files (x86)\ImDisk\imdisk.exe";
        yield return @"C:\Program Files\ImDisk Toolkit\imdisk.exe";
    }

    private static IEnumerable<string> DevRepoRoots()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 8 && dir != null; i++, dir = dir.Parent)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "external", "ImDisk"))
                || Directory.Exists(Path.Combine(dir.FullName, "BNDZBackend")))
                yield return dir.FullName;
        }
    }

    private static string CacheDirectoryFallback() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "redist", "ImDiskTk-extract");

    public async Task<(string mountPath, string? driveLetter)> CreateRamVolumeAsync(
        long sizeMb,
        string? preferredLetter = null,
        CancellationToken ct = default)
    {
        var imdisk = FindImDisk()
            ?? throw new InvalidOperationException("ImDisk not installed. Use Fast Staging or install ImDisk.");

        var letter = preferredLetter ?? FindFreeDriveLetter()
            ?? throw new InvalidOperationException("No free drive letter for RAM disk");

        var mountPath = $"{letter}:\\";
        var args = $"-a -s {sizeMb}M -m {letter}: -p \"/fs:ntfs /q /y\" -o rw";

        var psi = new ProcessStartInfo(imdisk, args)
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        using var proc = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start ImDisk");
        await proc.WaitForExitAsync(ct).ConfigureAwait(false);
        if (proc.ExitCode != 0)
            throw new InvalidOperationException($"ImDisk failed (exit {proc.ExitCode})");

        return (mountPath, letter);
    }

    public async Task DismountAsync(string driveLetter, CancellationToken ct = default)
    {
        var imdisk = FindImDisk();
        if (imdisk == null) return;

        var letter = driveLetter.TrimEnd(':');
        var psi = new ProcessStartInfo(imdisk, $"-d -m {letter}:")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
        };
        using var proc = Process.Start(psi);
        if (proc != null) await proc.WaitForExitAsync(ct).ConfigureAwait(false);
    }

    private static string? FindFreeDriveLetter()
    {
        var used = DriveInfo.GetDrives().Select(d => d.Name[0]).ToHashSet();
        for (char c = 'R'; c >= 'D'; c--)
        {
            if (!used.Contains(c)) return c.ToString();
        }
        return null;
    }
}
