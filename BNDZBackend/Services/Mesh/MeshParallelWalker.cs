using System.Collections.Concurrent;

namespace BNDZ.Services.Mesh;

/// <summary>
/// Parallel remote directory walker inspired by FileSSH <c>par_dir_traversal</c>.
/// Work-stealing queue fans out directory listings across concurrent tasks on a single provider.
/// </summary>
public static class MeshParallelWalker
{
    public sealed record RemoteFileNode(string RemotePath, string RelativeName, string DisplayName, long Size);

    public static async Task<List<RemoteFileNode>> CollectFilesAsync(
        IMeshProvider provider,
        string remotePath,
        string relativePrefix,
        int maxDegreeOfParallelism = 0,
        IProgress<(int Found, string? Current)>? progress = null,
        CancellationToken ct = default)
    {
        if (maxDegreeOfParallelism <= 0)
            maxDegreeOfParallelism = Math.Clamp(Environment.ProcessorCount, 2, 8);

        var results = new ConcurrentBag<RemoteFileNode>();
        var visited = new ConcurrentDictionary<string, byte>(StringComparer.Ordinal);
        var work = new ConcurrentQueue<WorkItem>();
        work.Enqueue(new WorkItem(Normalize(remotePath), relativePrefix));

        var gate = new SemaphoreSlim(maxDegreeOfParallelism, maxDegreeOfParallelism);
        var pending = 0;
        var found = 0;

        async Task WorkerAsync()
        {
            while (true)
            {
                ct.ThrowIfCancellationRequested();
                if (!work.TryDequeue(out var item))
                {
                    if (Volatile.Read(ref pending) == 0 && work.IsEmpty) return;
                    await Task.Delay(8, ct).ConfigureAwait(false);
                    if (!work.TryDequeue(out item))
                    {
                        if (Volatile.Read(ref pending) == 0 && work.IsEmpty) return;
                        continue;
                    }
                }

                Interlocked.Increment(ref pending);
                await gate.WaitAsync(ct).ConfigureAwait(false);
                try
                {
                    await ProcessItemAsync(item).ConfigureAwait(false);
                }
                finally
                {
                    gate.Release();
                    Interlocked.Decrement(ref pending);
                }
            }
        }

        async Task ProcessItemAsync(WorkItem item)
        {
            var path = item.RemotePath;
            if (!visited.TryAdd(path, 0)) return;

            IReadOnlyList<MeshDirEntry> entries;
            try
            {
                entries = await provider.ListAsync(path, ct).ConfigureAwait(false);
            }
            catch
            {
                // Likely a file leaf — treat as single file download target.
                var leaf = path.TrimEnd('/').Split('/').LastOrDefault() ?? "download";
                var rel = string.IsNullOrEmpty(item.RelativePrefix) ? leaf : item.RelativePrefix;
                results.Add(new RemoteFileNode(path, rel.Replace('/', Path.DirectorySeparatorChar), leaf, 0));
                var n = Interlocked.Increment(ref found);
                progress?.Report((n, path));
                return;
            }

            var dirs = entries.Where(e => e.IsDirectory).ToList();
            var files = entries.Where(e => !e.IsDirectory).ToList();

            // Single-file path mistaken for directory listing of parent? Prefer explicit file.
            if (dirs.Count == 0 && files.Count == 0)
            {
                try
                {
                    var attr = await provider.GetAttributesAsync(path, ct).ConfigureAwait(false);
                    if (attr.Exists && !attr.IsDirectory)
                    {
                        var leaf = path.TrimEnd('/').Split('/').LastOrDefault() ?? "download";
                        var rel = string.IsNullOrEmpty(item.RelativePrefix) ? leaf : item.RelativePrefix;
                        results.Add(new RemoteFileNode(path, rel.Replace('/', Path.DirectorySeparatorChar), leaf, attr.Size));
                        var n = Interlocked.Increment(ref found);
                        progress?.Report((n, path));
                    }
                }
                catch { /* ignore */ }
                return;
            }

            foreach (var e in entries)
            {
                if (e.Name is "." or "..") continue;
                var childRemote = Join(path, e.Name);
                var childRel = string.IsNullOrEmpty(item.RelativePrefix) ? e.Name : item.RelativePrefix + "/" + e.Name;
                if (e.IsDirectory)
                {
                    if (e.IsSymlink) continue; // avoid symlink cycles
                    work.Enqueue(new WorkItem(childRemote, childRel));
                }
                else
                {
                    results.Add(new RemoteFileNode(
                        childRemote,
                        childRel.Replace('/', Path.DirectorySeparatorChar),
                        e.Name,
                        e.Size));
                    var n = Interlocked.Increment(ref found);
                    progress?.Report((n, childRemote));
                }
            }
        }

        var workers = Enumerable.Range(0, maxDegreeOfParallelism)
            .Select(_ => WorkerAsync())
            .ToArray();
        await Task.WhenAll(workers).ConfigureAwait(false);
        return results.ToList();
    }

    private static string Normalize(string path)
    {
        var p = path.Replace('\\', '/');
        if (!p.StartsWith('/')) p = "/" + p;
        while (p.Contains("//", StringComparison.Ordinal)) p = p.Replace("//", "/");
        if (p.Length > 1 && p.EndsWith('/')) p = p.TrimEnd('/');
        return p == "" ? "/" : p;
    }

    private static string Join(string basePath, string name)
    {
        var p = Normalize(basePath);
        return p == "/" ? "/" + name : p + "/" + name;
    }

    private readonly record struct WorkItem(string RemotePath, string RelativePrefix);
}
