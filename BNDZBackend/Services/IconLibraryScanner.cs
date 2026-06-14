using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;

namespace BNDZ.Services;

public class IconLibraryScanner
{
    private static readonly string[] SupportedExtensions = { ".ico", ".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif" };

    public List<object> ScanFolder(string folderPath, bool autoConvert = true)
    {
        var results = new List<object>();
        if (string.IsNullOrEmpty(folderPath) || !Directory.Exists(folderPath)) return results;

        foreach (var file in Directory.EnumerateFiles(folderPath).OrderBy(f => f))
        {
            var ext = Path.GetExtension(file).ToLowerInvariant();
            if (!SupportedExtensions.Contains(ext)) continue;

            try
            {
                string iconPath = file;
                if (ext != ".ico" && autoConvert)
                {
                    iconPath = ConvertToIco(file) ?? file;
                }

                results.Add(new
                {
                    name = Path.GetFileNameWithoutExtension(file),
                    icoStr = iconPath.Replace("\\", "/")
                });
            }
            catch { }
        }

        return results;
    }

    public string? ConvertToIco(string imagePath)
    {
        if (!File.Exists(imagePath)) return null;
        if (imagePath.EndsWith(".ico", StringComparison.OrdinalIgnoreCase)) return imagePath;

        try
        {
            // Use LocalAppData cache — writing beside user files (e.g. Desktop) can hang or fail
            string cacheDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ64", "icon-cache");
            Directory.CreateDirectory(cacheDir);
            string name = Path.GetFileNameWithoutExtension(imagePath);
            string hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(imagePath.ToLowerInvariant())))[..12];
            string icoPath = Path.Combine(cacheDir, $"{name}_{hash}.ico");
            if (File.Exists(icoPath)) return icoPath;

            using var readStream = new FileStream(imagePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var src = Image.FromStream(readStream);
            int w = Math.Min(256, Math.Max(16, src.Width));
            int h = Math.Min(256, Math.Max(16, src.Height));
            using var bmp = new Bitmap(w, h);
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                g.DrawImage(src, 0, 0, w, h);
            }
            using var fs = new FileStream(icoPath, FileMode.Create, FileAccess.Write, FileShare.Read);
            SaveAsIco(bmp, fs);
            return icoPath;
        }
        catch
        {
            return null;
        }
    }

    private static void SaveAsIco(Bitmap bmp, Stream output)
    {
        // Minimal valid ICO: single 32x32 PNG embedded
        int size = Math.Min(256, Math.Max(bmp.Width, bmp.Height));
        using var resized = new Bitmap(size, size);
        using (var g = Graphics.FromImage(resized))
        {
            g.Clear(Color.Transparent);
            g.DrawImage(bmp, 0, 0, size, size);
        }
        using var pngStream = new MemoryStream();
        resized.Save(pngStream, System.Drawing.Imaging.ImageFormat.Png);
        var pngBytes = pngStream.ToArray();

        using var bw = new BinaryWriter(output);
        bw.Write((short)0);  // reserved
        bw.Write((short)1);  // type = icon
        bw.Write((short)1);  // count
        bw.Write((byte)size);
        bw.Write((byte)size);
        bw.Write((byte)0);
        bw.Write((byte)0);
        bw.Write((short)0);
        bw.Write((short)32); // bpp
        bw.Write(pngBytes.Length);
        bw.Write(22);        // offset
        bw.Write(pngBytes);
    }
}
