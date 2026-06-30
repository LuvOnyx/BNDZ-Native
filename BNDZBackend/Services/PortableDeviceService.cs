using System;
using System.Collections.Generic;

namespace BNDZ.Services;

/// <summary>Windows Portable Devices / MTP shell namespace (phones, cameras, media players).</summary>
public static class PortableDeviceService
{
    public const string PortableDevicesClsid = "::{35786D3C-B076-497C-A057-7DCC04A3D85}";

    public static List<object> GetTreeNodes()
    {
        var nodes = new List<object>();
        foreach (var item in ShellFolderEnumerator.Enumerate(PortableDevicesClsid))
        {
            if (item is not ShellChildItem sci) continue;
            nodes.Add(new
            {
                name = sci.Name,
                path = sci.Path,
                icon = "portable-device",
                kind = "portable-device",
                isShellItem = true,
            });
        }
        return nodes;
    }

    public static bool IsPortableDevicePath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var normalized = path.Replace('/', '\\');
        return normalized.StartsWith(PortableDevicesClsid, StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("\\\\?\\", StringComparison.Ordinal)
            || normalized.Contains("usb#", StringComparison.OrdinalIgnoreCase)
            || normalized.Contains("wpd", StringComparison.OrdinalIgnoreCase);
    }
}
