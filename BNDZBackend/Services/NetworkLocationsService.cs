using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading.Tasks;

namespace BNDZ.Services;

public sealed class NetworkLocationsService
{
    private const int ProbeTimeoutMs = 600;
    private const int WslCliMinTimeoutMs = 2200;

    /// <summary>Installed WSL distro names (CLI first, UNC fallback). Shared by nav tree + dir listing.</summary>
    public static IReadOnlyList<string> ListInstalledDistroNames(int timeoutMs = WslCliMinTimeoutMs)
        => TryListWslDistros(@"\\wsl.localhost\", Math.Max(timeoutMs, WslCliMinTimeoutMs));

    /// <summary>Strip nulls / fix common UTF-16 mis-decode artifacts from wsl.exe or UNC listing.</summary>
    public static string SanitizeDistroName(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "";
        var s = raw.Replace("\0", "").Trim().Trim('\0', ' ', '\t');
        if (s.Length == 0) return "";

        // wsl.exe mis-read as UTF-8 often looks like "U0b0u0n0t0u" (every other char is ASCII).
        if (LooksLikeUtf16MisdecodeAsUtf8(s))
        {
            var bytes = Encoding.UTF8.GetBytes(raw!);
            if (IsUtf16LeWithoutBom(bytes))
                s = Encoding.Unicode.GetString(bytes).Replace("\0", "").Trim();
        }

        // Drop non-printable control chars except normal whitespace.
        var cleaned = new char[s.Length];
        var n = 0;
        foreach (var c in s)
        {
            if (c == '\0') continue;
            if (char.IsControl(c) && c != ' ') continue;
            cleaned[n++] = c;
        }
        return n == 0 ? "" : new string(cleaned, 0, n).Trim();
    }

    private static bool IsUtf16LeWithoutBom(byte[] bytes)
    {
        if (bytes.Length < 4) return false;
        var pairs = Math.Min(bytes.Length / 2, 24);
        var match = 0;
        for (var i = 0; i < pairs; i++)
        {
            var lo = bytes[i * 2];
            var hi = bytes[i * 2 + 1];
            if (hi == 0 && lo >= 0x20 && lo < 0x7f)
                match++;
        }
        return match >= Math.Max(2, pairs * 2 / 3);
    }

    private static bool LooksLikeUtf16MisdecodeAsUtf8(string s)
    {
        if (s.Length < 4) return false;
        var oddAscii = 0;
        for (var i = 1; i < s.Length; i += 2)
        {
            var c = s[i];
            if (c >= '0' && c <= '9') oddAscii++;
            else if (c >= 'a' && c <= 'z') oddAscii++;
            else if (c >= 'A' && c <= 'Z') oddAscii++;
        }
        return oddAscii >= s.Length / 4;
    }

    public List<object> GetTreeNodes()
    {
        var nodes = new List<object>
        {
            new { name = "Network", path = "\\\\", icon = "network", kind = "network" },
        };

        // Never call DriveInfo.IsReady / VolumeLabel on the caller thread —
        // mapped network volumes hang for tens of seconds and freeze the host.
        foreach (var drive in SafeGetDrives())
        {
            try
            {
                if (drive.DriveType != DriveType.Network) continue;
                if (!TryReady(drive, ProbeTimeoutMs)) continue;
                var label = TryVolumeLabel(drive, ProbeTimeoutMs) ?? "Network Drive";
                if (string.IsNullOrWhiteSpace(label)) label = "Network Drive";
                nodes.Add(new
                {
                    name = $"{label} ({drive.Name.TrimEnd('\\')})",
                    path = drive.Name.Replace("\\", "/"),
                    icon = "network-drive",
                    kind = "mapped-drive",
                });
            }
            catch { /* skip inaccessible */ }
        }

        // Always expose the WSL root — do not Directory.Exists(\\wsl.localhost\) on this path;
        // that UNC probe hangs when WSL is offline / mid-boot.
        const string wslRoot = @"\\wsl.localhost\";
        nodes.Add(new { name = "Linux (WSL)", path = wslRoot.Replace("\\", "/"), icon = "wsl", kind = "wsl-root" });

        foreach (var distro in ListInstalledDistroNames(Math.Max(ProbeTimeoutMs, WslCliMinTimeoutMs)))
        {
            nodes.Add(new
            {
                name = distro,
                path = (wslRoot + distro).Replace("\\", "/"),
                icon = distro.Contains("kali", StringComparison.OrdinalIgnoreCase) ? "kali-linux" : "linux",
                kind = "wsl-distro",
            });
        }

        nodes.Add(new
        {
            name = "Portable Devices",
            path = PortableDeviceService.PortableDevicesClsid,
            icon = "portable-device",
            kind = "portable-root",
            isShellItem = true,
        });

        foreach (var device in TryPortableDevices(ProbeTimeoutMs * 2))
            nodes.Add(device);

        return nodes;
    }

    private static DriveInfo[] SafeGetDrives()
    {
        try { return DriveInfo.GetDrives(); }
        catch { return Array.Empty<DriveInfo>(); }
    }

    private static bool TryReady(DriveInfo d, int timeoutMs)
    {
        try
        {
            var task = Task.Run(() =>
            {
                try { return d.IsReady; }
                catch { return false; }
            });
            return task.Wait(timeoutMs) && task.Result;
        }
        catch { return false; }
    }

    private static string? TryVolumeLabel(DriveInfo d, int timeoutMs)
    {
        try
        {
            var task = Task.Run(() =>
            {
                try
                {
                    var label = d.VolumeLabel;
                    return string.IsNullOrWhiteSpace(label) ? null : label;
                }
                catch { return null; }
            });
            return task.Wait(timeoutMs) ? task.Result : null;
        }
        catch { return null; }
    }

    private static List<string> TryListWslDistros(string wslRoot, int timeoutMs)
    {
        var fromCli = TryListWslDistrosFromCli(timeoutMs);
        if (fromCli.Count > 0) return fromCli;

        var names = new List<string>();
        try
        {
            var task = Task.Run(() =>
            {
                var found = new List<string>();
                try
                {
                    if (!Directory.Exists(wslRoot)) return found;
                    foreach (var distro in Directory.GetDirectories(wslRoot))
                    {
                        var name = SanitizeDistroName(Path.GetFileName(distro.TrimEnd('\\')));
                        if (!string.IsNullOrEmpty(name)) found.Add(name);
                    }
                }
                catch { /* WSL offline */ }
                return found;
            });
            if (task.Wait(timeoutMs))
                names.AddRange(task.Result);
        }
        catch { }
        return names;
    }

    private static List<string> TryListWslDistrosFromCli(int timeoutMs)
    {
        var names = new List<string>();
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "wsl.exe",
                Arguments = "-l -q",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var proc = Process.Start(psi);
            if (proc == null) return names;
            using var ms = new MemoryStream();
            proc.StandardOutput.BaseStream.CopyTo(ms);
            if (!proc.WaitForExit(timeoutMs))
            {
                try { proc.Kill(entireProcessTree: true); } catch { }
                return names;
            }
            var bytes = ms.ToArray();
            // wsl.exe -l -q emits UTF-16 LE on Windows; reading as UTF-8 yields U0b0u0n0t0u… garbage.
            string stdout;
            if (bytes.Length >= 2 && bytes[0] == 0xFF && bytes[1] == 0xFE)
                stdout = Encoding.Unicode.GetString(bytes, 2, bytes.Length - 2);
            else if (IsUtf16LeWithoutBom(bytes))
                stdout = Encoding.Unicode.GetString(bytes);
            else if (bytes.Length >= 2 && bytes[1] == 0 && bytes[0] != 0)
                stdout = Encoding.Unicode.GetString(bytes);
            else
                stdout = Encoding.UTF8.GetString(bytes);
            foreach (var raw in stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
            {
                var line = SanitizeDistroName(raw);
                if (string.IsNullOrEmpty(line)) continue;
                if (line.StartsWith("Windows Subsystem", StringComparison.OrdinalIgnoreCase)) continue;
                if (line.Contains("docker-desktop", StringComparison.OrdinalIgnoreCase)) continue;
                names.Add(line);
            }
        }
        catch { }
        return names;
    }

    private static List<object> TryPortableDevices(int timeoutMs)
    {
        try
        {
            var task = Task.Run(() =>
            {
                try { return PortableDeviceService.GetTreeNodes(); }
                catch { return new List<object>(); }
            });
            if (task.Wait(timeoutMs))
                return task.Result ?? new List<object>();
        }
        catch { }
        return new List<object>();
    }
}
