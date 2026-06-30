using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace BNDZ.Services;

public sealed class NetworkLocationsService
{
    public List<object> GetTreeNodes()
    {
        var nodes = new List<object>
        {
            new { name = "Network", path = "\\\\", icon = "network", kind = "network" },
        };

        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (drive.DriveType != DriveType.Network || !drive.IsReady) continue;
                var label = string.IsNullOrWhiteSpace(drive.VolumeLabel) ? "Network Drive" : drive.VolumeLabel;
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

        const string wslRoot = @"\\wsl.localhost\";
        nodes.Add(new { name = "Linux (WSL)", path = wslRoot.Replace("\\", "/"), icon = "wsl", kind = "wsl-root" });
        try
        {
            if (Directory.Exists(wslRoot))
            {
                foreach (var distro in Directory.GetDirectories(wslRoot))
                {
                    var name = Path.GetFileName(distro.TrimEnd('\\'));
                    if (string.IsNullOrEmpty(name)) continue;
                    nodes.Add(new
                    {
                        name,
                        path = distro.Replace("\\", "/"),
                        icon = name.Contains("kali", StringComparison.OrdinalIgnoreCase) ? "kali-linux" : "linux",
                        kind = "wsl-distro",
                    });
                }
            }
        }
        catch { /* WSL offline */ }

        const string wslLegacy = @"\\wsl$\";
        if (Directory.Exists(wslLegacy))
        {
            nodes.Add(new { name = "WSL (legacy)", path = wslLegacy.Replace("\\", "/"), icon = "wsl", kind = "wsl-legacy" });
        }

        nodes.Add(new
        {
            name = "Portable Devices",
            path = PortableDeviceService.PortableDevicesClsid,
            icon = "portable-device",
            kind = "portable-root",
            isShellItem = true,
        });
        foreach (var device in PortableDeviceService.GetTreeNodes())
            nodes.Add(device);

        return nodes;
    }
}
