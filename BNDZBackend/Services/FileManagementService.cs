using System.IO;
using System.Linq;
using System.Runtime.CompilerServices;

using BNDZ.Services.Mesh;

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

        // Wave 5 — virtual disc image folders (.iso / .vhd / .vhdx)
        var fsPathForDiscObj = !string.IsNullOrEmpty(shellPath)
            ? shellPath
            : ShellPathResolver.NormalizeIncoming(path);
        if (DiscUtilsVolumeService.IsContainerPath(fsPathForDiscObj))
        {
            var discEntries = DiscUtilsVolumeService.TryList(fsPathForDiscObj);
            if (discEntries != null) return Task.FromResult<List<object>>(discEntries.Cast<object>().ToList());
        }

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
    public async Task<List<DirListingSharedBuffer.DirEntryDto>> GetDirEntriesAsync(string path, CancellationToken ct = default)
    {
        if (RecycleBinService.IsRecycleBinPath(path))
        {
            var raw = await RecycleBinService.GetContentsAsync().ConfigureAwait(false);
            return MapToDtos(raw);
        }

        if (Mesh.MeshPath.IsMeshPath(path))
        {
            return await BndzMeshOrchestratorHolder.Instance.ListPaneAsync(path, ct).ConfigureAwait(false);
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

        // Wave 5 — virtual disc image folders (.iso / .vhd / .vhdx)
        var fsPathForDisc = !string.IsNullOrEmpty(shellPath)
            ? shellPath
            : ShellPathResolver.NormalizeIncoming(path);
        if (DiscUtilsVolumeService.IsContainerPath(fsPathForDisc))
        {
            var discEntries = await Task.Run(() => DiscUtilsVolumeService.TryList(fsPathForDisc), ct).ConfigureAwait(false);
            if (discEntries != null) return discEntries;
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

    /// <summary>
    /// Yields directory entries as they are discovered — enables sub-100ms first paint for large folders.
    /// Shell/mesh/recycle paths buffer internally then yield (still faster than blocking the IPC thread).
    /// </summary>
    public async IAsyncEnumerable<DirListingSharedBuffer.DirEntryDto> EnumerateDirEntriesAsync(
        string path,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        if (RecycleBinService.IsRecycleBinPath(path)
            || Mesh.MeshPath.IsMeshPath(path)
            || IsShellVirtualPath(path))
        {
            var buffered = await GetDirEntriesAsync(path, ct).ConfigureAwait(false);
            foreach (var entry in buffered)
            {
                ct.ThrowIfCancellationRequested();
                yield return entry;
            }
            yield break;
        }

        await Task.Yield();

        var shellPath = ShellPathResolver.ResolveForShell(path);
        var fsPath = !string.IsNullOrEmpty(shellPath) ? shellPath : ShellPathResolver.NormalizeIncoming(path);

        // Wave 5 — virtual disc image folders (.iso / .vhd / .vhdx)
        if (DiscUtilsVolumeService.IsContainerPath(fsPath))
        {
            var discEntries = await Task.Run(() => DiscUtilsVolumeService.TryList(fsPath), ct).ConfigureAwait(false);
            if (discEntries != null)
            {
                foreach (var e in discEntries) { ct.ThrowIfCancellationRequested(); yield return e; }
                yield break;
            }
        }

        if (!Directory.Exists(fsPath)) yield break;

        var opts = new EnumerationOptions
        {
            IgnoreInaccessible = true,
            RecurseSubdirectories = false,
            ReturnSpecialDirectories = false,
            AttributesToSkip = 0,
        };

        foreach (var info in new DirectoryInfo(fsPath).EnumerateFileSystemInfos("*", opts))
        {
            ct.ThrowIfCancellationRequested();
            var isDir = (info.Attributes & FileAttributes.Directory) == FileAttributes.Directory;
            yield return DirListingSharedBuffer.FromFileSystemInfo(info, isDir);
        }
    }

    private static bool IsShellVirtualPath(string path)
    {
        var shellPath = ShellPathResolver.ResolveForShell(path);
        return !string.IsNullOrEmpty(shellPath) && (
            ShellPathResolver.IsShellVirtualPath(shellPath)
            || PortableDeviceService.IsPortableDevicePath(shellPath)
            || PortableDeviceService.IsPortableDevicePath(path));
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
