using System.Diagnostics;
using System.IO.Compression;
using System.Text;

namespace BNDZ.Services.RamStaging;

/// <summary>
/// Installs the Arsenal Image Mounter SCSI miniport from the vendored
/// DriverSetup package (<c>external/Arsenal-Image-Mounter/DriverSetup</c>).
/// Uses the Win10_devinst layout (INF + arch folders) required by pnputil.
/// </summary>
public static class ArsenalAimInstaller
{
    public static string CacheDirectory =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "redist", "aim-driver");

    public static async Task<(bool ok, string? error)> InstallDriverAsync(CancellationToken ct = default)
    {
        try
        {
            var staging = await StageDriverPackageAsync(ct).ConfigureAwait(false);
            if (!staging.ok || string.IsNullOrWhiteSpace(staging.infDir))
                return (false, staging.error ?? "Could not stage AIM driver package.");

            var inf = Path.Combine(staging.infDir, "phdskmnt.inf");
            if (!File.Exists(inf))
                return (false, "phdskmnt.inf missing after staging.");

            // Elevated batch keeps working directory correct for relative SourceDisksFiles paths.
            var bat = Path.Combine(staging.infDir, "bndz-install-aim.cmd");
            await File.WriteAllTextAsync(bat, $"""
                @echo off
                cd /d "%~dp0"
                pnputil.exe /add-driver "%~dp0phdskmnt.inf" /install
                set ERR=%ERRORLEVEL%
                rem Soft-create the ROOT software device if the package is in the store but adapter is missing.
                pnputil.exe /scan-devices >nul 2>&1
                exit /b %ERR%
                """, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), ct).ConfigureAwait(false);

            var psi = new ProcessStartInfo
            {
                FileName = bat,
                UseShellExecute = true,
                Verb = "runas",
                WorkingDirectory = staging.infDir,
                WindowStyle = ProcessWindowStyle.Hidden,
            };

            using var proc = Process.Start(psi);
            if (proc == null)
                return (false, "Could not elevate driver install (approve the Windows admin prompt).");

            await proc.WaitForExitAsync(ct).ConfigureAwait(false);
            await Task.Delay(1200, ct).ConfigureAwait(false);

            var probe = new ArsenalAimProvider();
            if (probe.ProbeNow())
                return (true, null);

            if (proc.ExitCode == 0)
                return (true, "Driver package installed — reboot Windows if RAM mounts still fail.");

            return (false, $"Driver install exited with code {proc.ExitCode}. Approve UAC and retry.");
        }
        catch (Exception ex)
        {
            // User cancelled UAC
            if (ex is System.ComponentModel.Win32Exception w32 && w32.NativeErrorCode == 1223)
                return (false, "Driver install cancelled — admin approval is required.");
            return (false, ex.Message);
        }
    }

    private static async Task<(bool ok, string? infDir, string? error)> StageDriverPackageAsync(CancellationToken ct)
    {
        Directory.CreateDirectory(CacheDirectory);
        var infDir = Path.Combine(CacheDirectory, "Win10_devinst");
        var infPath = Path.Combine(infDir, "phdskmnt.inf");
        if (File.Exists(infPath) && Directory.Exists(Path.Combine(infDir, "x64")))
            return (true, infDir, null);

        // Prefer DriverSetup.7z (has Win10_devinst flat layout).
        var setup7z = ResolveSetup7z();
        if (setup7z != null)
        {
            try
            {
                if (Directory.Exists(infDir)) Directory.Delete(infDir, true);
                Directory.CreateDirectory(CacheDirectory);
                var psi = new ProcessStartInfo
                {
                    FileName = "tar.exe",
                    Arguments = $"-xf \"{setup7z}\" -C \"{CacheDirectory}\" Win10_devinst",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardError = true,
                    RedirectStandardOutput = true,
                };
                using var proc = Process.Start(psi);
                if (proc != null)
                {
                    await proc.WaitForExitAsync(ct).ConfigureAwait(false);
                    if (File.Exists(infPath))
                        return (true, infDir, null);
                }
            }
            catch
            {
                /* fall through to zip */
            }
        }

        // Fallback: DriverFiles.zip → Win10\ (nested layout)
        var zip = ResolveDriverZip();
        if (zip == null)
            return (false, null, "AIM DriverSetup package not found. Keep external/Arsenal-Image-Mounter checked out.");

        var extractRoot = Path.Combine(CacheDirectory, "DriverFiles");
        if (Directory.Exists(extractRoot)) Directory.Delete(extractRoot, true);
        await Task.Run(() => ZipFile.ExtractToDirectory(zip, extractRoot), ct).ConfigureAwait(false);

        var nested = Path.Combine(extractRoot, "Win10");
        if (!File.Exists(Path.Combine(nested, "phdskmnt.inf")))
            return (false, null, "phdskmnt.inf missing in DriverFiles.zip.");

        // Normalize to Win10_devinst flat layout (INF next to x64/).
        if (Directory.Exists(infDir)) Directory.Delete(infDir, true);
        Directory.CreateDirectory(infDir);
        foreach (var file in Directory.EnumerateFiles(nested))
            File.Copy(file, Path.Combine(infDir, Path.GetFileName(file)), overwrite: true);
        foreach (var dir in Directory.EnumerateDirectories(nested))
        {
            var name = Path.GetFileName(dir);
            CopyDirectory(dir, Path.Combine(infDir, name));
        }

        return File.Exists(infPath)
            ? (true, infDir, null)
            : (false, null, "Failed to normalize AIM driver package.");
    }

    private static void CopyDirectory(string src, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (var file in Directory.EnumerateFiles(src))
            File.Copy(file, Path.Combine(dest, Path.GetFileName(file)), overwrite: true);
        foreach (var dir in Directory.EnumerateDirectories(src))
            CopyDirectory(dir, Path.Combine(dest, Path.GetFileName(dir)));
    }

    private static string? ResolveSetup7z()
    {
        foreach (var root in DevRepoRoots())
        {
            var p = Path.Combine(root, "external", "Arsenal-Image-Mounter", "DriverSetup", "DriverSetup.7z");
            if (File.Exists(p)) return p;
        }
        var bundled = Path.Combine(AppContext.BaseDirectory, "Assets", "redist", "aim", "DriverSetup.7z");
        if (File.Exists(bundled)) return bundled;
        var local = Path.Combine(CacheDirectory, "DriverSetup.7z");
        return File.Exists(local) ? local : null;
    }

    private static string? ResolveDriverZip()
    {
        foreach (var root in DevRepoRoots())
        {
            var p = Path.Combine(root, "external", "Arsenal-Image-Mounter", "DriverSetup", "DriverFiles.zip");
            if (File.Exists(p)) return p;
        }

        var bundled = Path.Combine(AppContext.BaseDirectory, "Assets", "redist", "aim", "DriverFiles.zip");
        if (File.Exists(bundled)) return bundled;

        var local = Path.Combine(CacheDirectory, "DriverFiles.zip");
        return File.Exists(local) ? local : null;
    }

    private static IEnumerable<string> DevRepoRoots()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        for (var i = 0; i < 8 && dir != null; i++, dir = dir.Parent)
        {
            if (Directory.Exists(Path.Combine(dir.FullName, "external", "Arsenal-Image-Mounter"))
                || Directory.Exists(Path.Combine(dir.FullName, "BNDZBackend")))
                yield return dir.FullName;
        }
    }
}
