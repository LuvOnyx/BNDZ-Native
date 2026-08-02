using System.Diagnostics;

namespace BNDZ.Services.RamStaging;

/// <summary>
/// Manages the bundled ImDisk driver binaries that ship inside BNDZ's Assets\redist\imdisk\ folder.
/// No network download ever occurs — the x64 binaries (imdisk.exe, imdisk.sys, imdsksvc.exe, etc.)
/// are staged at build time and copied to the output directory by the .csproj content glob.
/// A one-time admin UAC prompt (install.cmd) installs the kernel driver on first use.
/// </summary>
public static class ImDiskInstaller
{
    public static string CacheDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "redist");

    // Not used for download anymore but kept for status reporting.
    public static string CachedSetupPath => Path.Combine(CacheDirectory, "ImDiskTk-x64.zip");

    /// <summary>Bundled redist directory that ships with BNDZ.exe.</summary>
    public static string? BundledRedistDirectory()
    {
        var baseDir = AppContext.BaseDirectory.TrimEnd('\\', '/');
        var candidates = new[]
        {
            Path.Combine(baseDir, "redist", "imdisk"),
            Path.Combine(baseDir, "Assets", "redist", "imdisk"),
        };
        foreach (var c in candidates)
        {
            if (Directory.Exists(c) && File.Exists(Path.Combine(c, "imdisk.exe")))
                return c;
        }
        return null;
    }

    /// <summary>True when the bundled redist has imdisk.exe ready to use.</summary>
    public static bool CachedInstallerPresent() => BundledRedistDirectory() is not null;

    /// <summary>
    /// No-download implementation — BNDZ ships imdisk binaries directly.
    /// Returns success if bundled redist is intact, or a clear error if the bundle is missing.
    /// </summary>
    public static Task<(bool ok, string? error)> DownloadInstallerAsync(
        IProgress<double>? progress = null, CancellationToken ct = default)
    {
        var bundled = BundledRedistDirectory();
        if (bundled != null)
        {
            progress?.Report(1.0);
            return Task.FromResult<(bool, string?)>((true, null));
        }
        return Task.FromResult<(bool, string?)>((false,
            "ImDisk driver binaries not found in the BNDZ app bundle. " +
            "Please reinstall BNDZ to restore the bundled redist files."));
    }

    /// <summary>
    /// Runs the bundled install.cmd elevated (one-time UAC prompt) to register the ImDisk
    /// kernel driver with Windows SCM. After this completes imdisk.exe can mount RAM disks.
    /// </summary>
    public static async Task<(bool ok, string? error)> InstallCachedAsync(CancellationToken ct = default)
    {
        try
        {
            var bundled = BundledRedistDirectory();
            if (bundled == null)
                return (false, "ImDisk redist bundle not found — please reinstall BNDZ.");

            // If driver is already installed (imdisk.exe works), skip reinstall.
            // ImDiskProvider.FindImDisk() probes PATH + known locations — if it finds one
            // in the bundled dir that also means the service is registered.
            var imdiskExe = Path.Combine(bundled, "imdisk.exe");
            if (!File.Exists(imdiskExe))
                return (false, "imdisk.exe not found in bundled redist.");

            var installCmd = Path.Combine(bundled, "install.cmd");
            if (!File.Exists(installCmd))
                return (false, "install.cmd not found in bundled redist.");

            // Run install.cmd elevated — this installs imdisk.sys + imdsksvc.exe as Windows services.
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c \"{installCmd}\"",
                WorkingDirectory = bundled,
                UseShellExecute = true,
                Verb = "runas",
                CreateNoWindow = false, // visible so user sees install progress
            };

            using var proc = Process.Start(psi);
            if (proc == null)
                return (false, "Could not start ImDisk installer — admin approval is required.");

            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(60));
            await proc.WaitForExitAsync(cts.Token).ConfigureAwait(false);

            if (proc.ExitCode != 0)
                return (false, $"ImDisk install.cmd exited with code {proc.ExitCode}. " +
                    "Try running install.cmd as administrator manually from the BNDZ redist folder.");

            // Short settle delay for SCM to register the new services.
            await Task.Delay(1500, ct).ConfigureAwait(false);
            return (true, null);
        }
        catch (OperationCanceledException)
        {
            return (false, "ImDisk driver install cancelled by user.");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    /// <summary>Installs the bundled ImDisk driver. No download required.</summary>
    public static Task<(bool ok, string? error)> DownloadAndInstallAsync(
        IProgress<double>? progress = null, CancellationToken ct = default)
        => InstallCachedAsync(ct);
}
