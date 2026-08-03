using System;
using System.Collections.Generic;
using System.IO;
using System.Threading.Tasks;

namespace BNDZ.Services;

public sealed class NetworkLocationsService
{
    private const int ProbeTimeoutMs = 600;

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

        foreach (var distro in TryListWslDistros(wslRoot, ProbeTimeoutMs))
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
                        var name = Path.GetFileName(distro.TrimEnd('\\'));
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
