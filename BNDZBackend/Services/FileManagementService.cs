using System.IO;

namespace BNDZ.Services;

public class FileManagementService
{
    public Task<List<object>> GetDirContentsAsync(string path)
    {
        if (RecycleBinService.IsRecycleBinPath(path))
            return RecycleBinService.GetContentsAsync();

        var shellPath = ShellPathResolver.ResolveForShell(path);
        if (!string.IsNullOrEmpty(shellPath) && (
            ShellPathResolver.IsShellVirtualPath(shellPath)
            || PortableDeviceService.IsPortableDevicePath(shellPath)
            || PortableDeviceService.IsPortableDevicePath(path)))
            return ShellFolderEnumerator.EnumerateAsync(shellPath);

        return Task.Run(() =>
        {
            var results = new List<object>();
            try
            {
                var fsPath = shellPath;
                if (string.IsNullOrEmpty(fsPath))
                {
                    fsPath = ShellPathResolver.NormalizeIncoming(path);
                }

                if (!Directory.Exists(fsPath)) return results;

                foreach (var dir in Directory.GetDirectories(fsPath))
                {
                    var di = new DirectoryInfo(dir);
                    results.Add(new
                    {
                        id = dir.Replace('\\', '/'),
                        name = di.Name,
                        type = "directory",
                        path = dir.Replace('\\', '/'),
                        size = 0L,
                        modified = di.LastWriteTimeUtc.ToString("O"),
                        created = di.CreationTimeUtc.ToString("O"),
                        attributes = GetAttributeFlags(di.Attributes)
                    });
                }

                foreach (var file in Directory.GetFiles(fsPath))
                {
                    var fi = new FileInfo(file);
                    results.Add(new
                    {
                        id = file.Replace('\\', '/'),
                        name = fi.Name,
                        type = "file",
                        path = file.Replace('\\', '/'),
                        size = fi.Length,
                        extension = fi.Extension.TrimStart('.').ToLowerInvariant(),
                        modified = fi.LastWriteTimeUtc.ToString("O"),
                        created = fi.CreationTimeUtc.ToString("O"),
                        attributes = GetAttributeFlags(fi.Attributes)
                    });
                }
            }
            catch { }

            return results;
        });
    }

    private static string[] GetAttributeFlags(FileAttributes attributes)
    {
        var flags = new List<string>();
        if (attributes.HasFlag(FileAttributes.Hidden)) flags.Add("hidden");
        if (attributes.HasFlag(FileAttributes.System)) flags.Add("system");
        if (attributes.HasFlag(FileAttributes.ReadOnly)) flags.Add("readonly");
        if (attributes.HasFlag(FileAttributes.Archive)) flags.Add("archive");
        if (attributes.HasFlag(FileAttributes.Compressed)) flags.Add("compressed");
        if (attributes.HasFlag(FileAttributes.Encrypted)) flags.Add("encrypted");
        if (attributes.HasFlag(FileAttributes.ReparsePoint)) flags.Add("reparse");
        return flags.ToArray();
    }
}
