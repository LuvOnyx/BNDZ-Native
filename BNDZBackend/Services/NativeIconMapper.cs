using System.IO;
using System.Reflection;

namespace BNDZ.Services;

public class NativeIconMapper
{
    public Stream? GetIconStream(string iconName)
    {
        try
        {
            var assetsDir = Path.Combine(AppContext.BaseDirectory, "Assets", "Resources", "MainFolderThumbnail");
            var iconPath = Path.Combine(assetsDir, iconName);
            if (File.Exists(iconPath)) return File.OpenRead(iconPath);

            var pngPath = Path.ChangeExtension(iconPath, ".png");
            if (File.Exists(pngPath)) return File.OpenRead(pngPath);
        }
        catch { }

        return null;
    }
}
