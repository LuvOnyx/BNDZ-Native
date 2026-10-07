using System.Reflection;
using System.Text;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Guest web panel files embedded in BNDZ and injected onto a Fly machine.
/// The panel is what https://&lt;app&gt;.fly.dev/ serves. Local Hyper-V does not
/// boot this until a rootfs is pinned.
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
