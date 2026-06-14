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

        return nodes;
    }
}
