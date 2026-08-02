using System.ComponentModel;
using System.Diagnostics;
using System.Text.RegularExpressions;

namespace BNDZ.Services.RamStaging;

/// <summary>
/// Arsenal Image Mounter RAM disks via <c>aim_cli --ramdisk</c>.
/// Never Process.Start a broken CLI — Windows SxS shows "could not be started" dialogs
/// that SoftenRamError cannot hide. Gate every launch on a successful probe, and permanently
/// skip AIM for the process lifetime after a loader/Win32 failure.
/// </summary>
public sealed class ArsenalAimProvider
{
    private bool _availCached;
    private bool _availValue;
    private long _availTicks;
    /// <summary>CLI present but cannot be started (missing deps / SxS). Never probe again.</summary>
    private bool _cliBroken;

    public bool IsAvailable
    {
        get
        {
            if (_cliBroken) return false;
            var now = Environment.TickCount64;
            if (_availCached && now - _availTicks < 30_000)
                return _availValue;
            // Do NOT auto-start aim_cli here — GetStatus / plugin refresh must stay silent.
            // Call ProbeNow() only from CreateZone / Remount when ImDisk already failed.
            return false;
        }
    }

    /// <summary>True when a prior ProbeNow succeeded within the cache window.</summary>
    public bool IsKnownAvailable => !_cliBroken && _availCached && _availValue;

    /// <summary>File exists only — never starts the process (safe for status UI).</summary>
    public bool CliPresentOnDisk => !_cliBroken && FindAimCliRaw() != null;

    /// <summary>True when AIM was marked unusable after a failed Process.Start / loader error.</summary>
    public bool IsCliBroken => _cliBroken;

    /// <summary>One-shot probe. Returns false and latches broken on loader failure.</summary>
    public bool ProbeNow()
    {
        if (_cliBroken) return false;
        var now = Environment.TickCount64;
        if (_availCached && now - _availTicks < 30_000)
            return _availValue;
        _availValue = FindAimCliRaw() != null && ProbeDriver();
        _availCached = true;
        _availTicks = now;
        return _availValue;
    }

    public void InvalidateAvailabilityCache()
    {
        // Keep broken latch — restarting a dead EXE just reopens the Windows dialog.
        if (_cliBroken) return;
        _availCached = false;
        _availTicks = 0;
    }

    public void MarkCliBroken()
    {
        _cliBroken = true;
        _availValue = false;
        _availCached = true;
        _availTicks = Environment.TickCount64;
    }

    public string? FindAimCli()
    {
        if (_cliBroken) return null;
        return FindAimCliRaw();
    }

    private string? FindAimCliRaw()
    {
        foreach (var path in CandidateAimPaths())
        {
            try
            {
                if (File.Exists(path)) return path;
            }
            catch { /* skip */ }
        }
        return null;
    }

    private static IEnumerable<string> CandidateAimPaths()
    {
        var baseDir = AppContext.BaseDirectory.TrimEnd('\\', '/');
        yield return Path.Combine(baseDir, "redist", "aim", "aim_cli.exe");
        yield return Path.Combine(baseDir, "Assets", "redist", "aim", "aim_cli.exe");
        yield return Path.Combine(CacheDirectory(), "aim_cli.exe");

        foreach (var root in DevRepoRoots())
        {
            yield return Path.Combine(root, "external", "Arsenal-Image-Mounter", "Command line applications", "aim_cli.exe");
            yield return Path.Combine(root, "BNDZBackend", "Assets", "redist", "aim", "aim_cli.exe");
        }

        yield return @"C:\Program Files\Arsenal Image Mounter\aim_cli.exe";
        yield return @"C:\Program Files (x86)\Arsenal Image Mounter\aim_cli.exe";
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

    private static string CacheDirectory() =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "redist", "aim");

    private bool ProbeDriver()
    {
        if (_cliBroken) return false;
        var cli = FindAimCli();
        if (cli == null) return false;
        try
        {
            using var proc = Process.Start(new ProcessStartInfo(cli, "--list")
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            });
            if (proc == null)
            {
                MarkCliBroken();
                return false;
            }
            proc.WaitForExit(4000);
            return proc.ExitCode == 0;
        }
        catch (Win32Exception)
        {
            // Loader / SxS failure — Windows may have already shown a dialog; never retry.
            MarkCliBroken();
            return false;
        }
        catch
        {
            MarkCliBroken();
            return false;
        }
    }

    public async Task<(string mountPath, string? driveLetter, string? deviceId)> CreateRamVolumeAsync(
        long sizeMb,
        CancellationToken ct = default)
    {
        if (_cliBroken || !IsKnownAvailable)
            throw new InvalidOperationException("RAM disk driver is not available on this machine.");

        var cli = FindAimCli()
            ?? throw new InvalidOperationException("RAM disk driver is not available on this machine.");

        var before = SnapshotDriveLetters();
        var sizeArg = sizeMb >= 1024 && sizeMb % 1024 == 0
            ? $"{sizeMb / 1024}G"
            : $"{sizeMb}M";

        var psi = new ProcessStartInfo(cli, $"--ramdisk --disksize={sizeArg}")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };

        Process? proc;
        try
        {
            proc = Process.Start(psi);
        }
        catch (Win32Exception)
        {
            MarkCliBroken();
            throw new InvalidOperationException("RAM disk driver could not start — using Fast Staging.");
        }

        if (proc == null)
        {
            MarkCliBroken();
            throw new InvalidOperationException("RAM disk driver could not start — using Fast Staging.");
        }

        using (proc)
        {
            var stdout = await proc.StandardOutput.ReadToEndAsync(ct).ConfigureAwait(false);
            var stderr = await proc.StandardError.ReadToEndAsync(ct).ConfigureAwait(false);
            await proc.WaitForExitAsync(ct).ConfigureAwait(false);
            if (proc.ExitCode != 0)
                throw new InvalidOperationException(
                    $"RAM disk failed (exit {proc.ExitCode}): {(string.IsNullOrWhiteSpace(stderr) ? stdout : stderr).Trim()}");

            string? letter = null;
            for (var i = 0; i < 40; i++)
            {
                ct.ThrowIfCancellationRequested();
                await Task.Delay(250, ct).ConfigureAwait(false);
                letter = SnapshotDriveLetters().Except(before, StringComparer.OrdinalIgnoreCase).FirstOrDefault();
                if (letter != null) break;
            }

            letter ??= ParseLetterFromOutput(stdout + "\n" + stderr);
            if (letter == null)
                throw new InvalidOperationException("RAM disk mounted but no drive letter appeared.");

            var mountPath = $"{letter.TrimEnd(':')}:\\";
            var deviceId = ParseDeviceId(stdout + "\n" + stderr);
            await EnsureNtfsAsync(mountPath, ct).ConfigureAwait(false);
            return (mountPath, letter.TrimEnd(':'), deviceId);
        }
    }

    public async Task DismountAsync(string? driveLetter, string? deviceId, CancellationToken ct = default)
    {
        if (_cliBroken) return;
        var cli = FindAimCli();
        if (cli == null) return;

        var arg = !string.IsNullOrWhiteSpace(deviceId)
            ? $"--dismount={deviceId.Trim()}"
            : "--dismount";
        var psi = new ProcessStartInfo(cli, arg)
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        try
        {
            using var proc = Process.Start(psi);
            if (proc == null) return;
            await proc.WaitForExitAsync(ct).ConfigureAwait(false);
        }
        catch (Win32Exception)
        {
            MarkCliBroken();
        }
        catch
        {
            /* best effort */
        }

        if (!string.IsNullOrWhiteSpace(driveLetter) && !_cliBroken)
        {
            try
            {
                var list = await RunCaptureAsync(cli, "--list", ct).ConfigureAwait(false);
                var match = Regex.Match(list, $@"(?i)Device\s*[#:]?\s*([0-9A-Fa-f]{{6}}).*?{Regex.Escape(driveLetter.TrimEnd(':'))}:");
                if (match.Success)
                {
                    using var proc = Process.Start(new ProcessStartInfo(cli, $"--dismount={match.Groups[1].Value}")
                    {
                        CreateNoWindow = true,
                        UseShellExecute = false,
                    });
                    if (proc != null) await proc.WaitForExitAsync(ct).ConfigureAwait(false);
                }
            }
            catch (Win32Exception)
            {
                MarkCliBroken();
            }
            catch { /* ignore */ }
        }
    }

    private static async Task EnsureNtfsAsync(string mountPath, CancellationToken ct)
    {
        try
        {
            Directory.CreateDirectory(Path.Combine(mountPath, ".bndz-probe"));
            Directory.Delete(Path.Combine(mountPath, ".bndz-probe"));
            return;
        }
        catch
        {
            /* need format */
        }

        var letter = mountPath.TrimEnd('\\', '/')[0];
        var psi = new ProcessStartInfo("format.com", $"{letter}: /fs:ntfs /q /y")
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        try
        {
            using var proc = Process.Start(psi);
            if (proc != null) await proc.WaitForExitAsync(ct).ConfigureAwait(false);
        }
        catch { /* best effort */ }
    }

    private static HashSet<string> SnapshotDriveLetters()
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (d.IsReady)
                    set.Add(d.Name.TrimEnd('\\', '/'));
            }
            catch { /* skip */ }
        }
        return set;
    }

    private static string? ParseLetterFromOutput(string text)
    {
        var m = Regex.Match(text, @"(?i)(?:mounted|drive|letter)\s*[:=]?\s*([A-Z]):");
        return m.Success ? m.Groups[1].Value : null;
    }

    private static string? ParseDeviceId(string text)
    {
        var m = Regex.Match(text, @"(?i)Device\s*[#:]?\s*([0-9A-Fa-f]{6})");
        return m.Success ? m.Groups[1].Value : null;
    }

    private async Task<string> RunCaptureAsync(string cli, string args, CancellationToken ct)
    {
        if (_cliBroken)
            return string.Empty;
        try
        {
            using var proc = Process.Start(new ProcessStartInfo(cli, args)
            {
                CreateNoWindow = true,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            });
            if (proc == null) return string.Empty;
            var stdout = await proc.StandardOutput.ReadToEndAsync(ct).ConfigureAwait(false);
            await proc.WaitForExitAsync(ct).ConfigureAwait(false);
            return stdout;
        }
        catch (Win32Exception)
        {
            MarkCliBroken();
            return string.Empty;
        }
    }

    public static Task EnsureCliPresentAsync(CancellationToken ct = default) => Task.CompletedTask;
}
