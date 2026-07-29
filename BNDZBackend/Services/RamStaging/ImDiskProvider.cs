using System.Diagnostics;

namespace BNDZ.Services.RamStaging;

/// <summary>Detect and manage ImDisk RAM volumes.</summary>
public sealed class ImDiskProvider
{
    private static readonly string[] ImDiskPaths =
    [
        @"C:\Windows\System32\imdisk.exe",
        @"C:\Program Files\ImDisk\imdisk.exe",
        @"C:\Program Files (x86)\ImDisk\imdisk.exe",
    ];

    public bool IsAvailable => FindImDisk() != null;

    public string? FindImDisk() => ImDiskPaths.FirstOrDefault(File.Exists);

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
