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

                // Single-pass enumerate — faster than GetDirectories + GetFiles.
                var opts = new EnumerationOptions
                {
                    IgnoreInaccessible = true,
                    RecurseSubdirectories = false,
                    ReturnSpecialDirectories = false,
                    AttributesToSkip = 0,
                };
                foreach (var info in new DirectoryInfo(fsPath).EnumerateFileSystemInfos("*", opts))
                {
                    var isDir = (info.Attributes & FileAttributes.Directory) == FileAttributes.Directory;
                    results.Add(DirListingSharedBuffer.FromFileSystemInfo(info, isDir));
                }
            }
            catch { }

            return results;
        });
    }

    /// <summary>Typed fast path used by SharedBuffer IPC — no JSON round-trip.</summary>
    public async Task<List<DirListingSharedBuffer.DirEntryDto>> GetDirEntriesAsync(string path)
    {
        if (RecycleBinService.IsRecycleBinPath(path))
        {
            var raw = await RecycleBinService.GetContentsAsync().ConfigureAwait(false);
            return MapToDtos(raw);
        }

        var shellPath = ShellPathResolver.ResolveForShell(path);
        if (!string.IsNullOrEmpty(shellPath) && (
            ShellPathResolver.IsShellVirtualPath(shellPath)
            || PortableDeviceService.IsPortableDevicePath(shellPath)
            || PortableDeviceService.IsPortableDevicePath(path)))
        {
            var raw = await ShellFolderEnumerator.EnumerateAsync(shellPath).ConfigureAwait(false);
            return MapToDtos(raw);
        }

        return await Task.Run(() =>
        {
            var results = new List<DirListingSharedBuffer.DirEntryDto>();
            try
            {
                var fsPath = shellPath;
                if (string.IsNullOrEmpty(fsPath))
                    fsPath = ShellPathResolver.NormalizeIncoming(path);

                if (!Directory.Exists(fsPath)) return results;

                var opts = new EnumerationOptions
                {
                    IgnoreInaccessible = true,
                    RecurseSubdirectories = false,
                    ReturnSpecialDirectories = false,
                    AttributesToSkip = 0,
                };
                foreach (var info in new DirectoryInfo(fsPath).EnumerateFileSystemInfos("*", opts))
                {
                    var isDir = (info.Attributes & FileAttributes.Directory) == FileAttributes.Directory;
                    results.Add(DirListingSharedBuffer.FromFileSystemInfo(info, isDir));
                }
            }
            catch { }

            return results;
        }).ConfigureAwait(false);
    }

    private static List<DirListingSharedBuffer.DirEntryDto> MapToDtos(List<object> raw)
    {
        var list = new List<DirListingSharedBuffer.DirEntryDto>(raw.Count);
        foreach (var item in raw)
        {
            if (item is DirListingSharedBuffer.DirEntryDto dto)
                list.Add(dto);
            else if (item is ShellChildItem sci)
                list.Add(DirListingSharedBuffer.FromShellChild(sci));
            else
                list.Add(DirListingSharedBuffer.FromLegacyObject(item));
        }
        return list;
    }
}
