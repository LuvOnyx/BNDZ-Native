using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>
/// Fan-out shell-icon / thumbnail batch extracts. Sequential foreach on one
/// Task.Run used to stall a whole listing chunk behind one cold SHGetFileInfo.
/// </summary>
internal static class BndzIconBatchWork
{
    public readonly record struct ShellItem(string Path, bool IsDirectory, int Size);

    public static async Task<Dictionary<string, string?>> ResolveShellIconsAsync(
        IReadOnlyList<ShellItem> items,
        NativeShellService native)
    {
        var results = new ConcurrentDictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        if (items.Count == 0)
            return new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);

        await Parallel.ForEachAsync(
            items,
            new ParallelOptions { MaxDegreeOfParallelism = 8 },
            async (item, ct) =>
            {
                await BndzIpcWorkQueue.RunShellIconAsync(() =>
                {
                    try
                    {
                        var extracted = BndzHostCaches.ResolveIconBase64(
                            item.Path,
                            item.IsDirectory,
                            () => native.GetNativeShellIconBase64(item.Path, item.IsDirectory, item.Size) ?? "",
                            item.Size);
                        results[item.Path] = string.IsNullOrEmpty(extracted) ? null : extracted;
                    }
                    catch
                    {
                        results[item.Path] = null;
                    }
                    return Task.CompletedTask;
                }, ct).ConfigureAwait(false);
            }).ConfigureAwait(false);

        return new Dictionary<string, string?>(results, StringComparer.OrdinalIgnoreCase);
    }

    public static async Task<Dictionary<string, string?>> ResolveThumbnailsAsync(
        IReadOnlyList<string> paths,
        int size,
        NativeShellService native)
    {
        var results = new ConcurrentDictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
        if (paths.Count == 0)
            return new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);

        await Parallel.ForEachAsync(
            paths,
            new ParallelOptions { MaxDegreeOfParallelism = 6 },
            async (path, ct) =>
            {
                await BndzIpcWorkQueue.RunThumbnailAsync(() =>
                {
                    try
                    {
                        var b64 = BndzHostCaches.ResolveThumbnailDelivery(
                            path,
                            size,
                            () => native.GetNativeThumbnailBase64(path, size) ?? "");
                        results[path] = string.IsNullOrEmpty(b64) ? null : b64;
                    }
                    catch
                    {
                        results[path] = null;
                    }
                    return Task.CompletedTask;
                }, ct).ConfigureAwait(false);
            }).ConfigureAwait(false);

        return new Dictionary<string, string?>(results, StringComparer.OrdinalIgnoreCase);
    }
}
