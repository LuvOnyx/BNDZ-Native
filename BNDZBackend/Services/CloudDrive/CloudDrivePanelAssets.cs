using System.Reflection;
using System.Text;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Guest web panel files embedded in BNDZ. Fly injects them onto the machine.
/// This PC copies them from the cidata seed onto the pinned Ubuntu rootfs.
/// </summary>
public static class CloudDrivePanelAssets
{
    public static IReadOnlyList<(string GuestPath, string Text)> Files()
    {
        var asm = typeof(CloudDrivePanelAssets).Assembly;
        var names = new[] { "server.py", "index.html", "app.js", "app.css", "qrcodegen.py" };
        var list = new List<(string, string)>();
        foreach (var name in names)
        {
            using var stream = asm.GetManifestResourceStream("BNDZ.CloudDrive.Panel." + name);
            if (stream == null) continue;
            using var reader = new StreamReader(stream, Encoding.UTF8);
            list.Add(("/opt/bndz/panel/" + name, reader.ReadToEnd()));
        }
        return list;
    }
}
