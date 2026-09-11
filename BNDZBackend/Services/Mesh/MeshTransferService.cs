using System.Diagnostics;

namespace BNDZ.Services.Mesh;

/// <summary>Upload/download between local FS and mesh remote paths with transfer-queue progress.</summary>
public sealed class MeshTransferService
{
    private readonly BndzMeshOrchestrator _mesh;
    private readonly FileTransferQueueService _queue;

    public MeshTransferService(BndzMeshOrchestrator mesh, FileTransferQueueService queue)
    {
        _mesh = mesh;
        _queue = queue;
    }

    public async Task UploadAsync(
        string operationId,
        string hostId,
        IReadOnlyList<string> localPaths,
        string remoteDestDir,
        CancellationToken ct = default)
    {
        var work = CollectLocalFiles(localPaths);
        if (work.Count == 0) throw new InvalidOperationException("No files to upload");

        long totalBytes = work.Sum(w => w.Size);
        _queue.RegisterJob(operationId, "mesh-upload", BuildLabel(work), "sftp", work.Count, "mesh", FileTransferPriority.High, remoteDestDir);
        _queue.UpdateProgress(operationId, 0, work[0].LocalPath, 0, work.Count, 0, totalBytes);

        var sw = Stopwatch.StartNew();
        long transferred = 0;
        int completed = 0;

        try
        {
            _mesh.EnsureConnected(hostId);
            var provider = _mesh.GetConnectedProvider(hostId);
            var destRoot = NormalizeRemoteDir(remoteDestDir);
            var degree = Math.Clamp(Environment.ProcessorCount / 2, 2, 6);
            using var gate = new SemaphoreSlim(degree, degree);
            var tasks = new List<Task>();
            var lockObj = new object();

            foreach (var item in work)
            {
                await gate.WaitAsync(ct).ConfigureAwait(false);
                tasks.Add(Task.Run(async () =>
                {
                    try
                    {
                        ct.ThrowIfCancellationRequested();
                        var rel = item.RelativeName.Replace('\\', '/');
                        var remotePath = destRoot == "/" ? "/" + rel : destRoot + "/" + rel;
                        var remoteDir = remotePath.Contains('/') ? remotePath[..remotePath.LastIndexOf('/')] : "/";
                        if (!string.IsNullOrEmpty(remoteDir)) await provider.MkdirAsync(remoteDir, ct).ConfigureAwait(false);

                        var fileProgress = new Progress<long>(bytes =>
                        {
                            lock (lockObj)
                            {
                                var speed = sw.Elapsed.TotalSeconds > 0.1 ? transferred / sw.Elapsed.TotalSeconds : 0;
                                var pct = totalBytes > 0
                                    ? (int)Math.Clamp((transferred + bytes) * 100 / totalBytes, 0, 99)
                                    : (int)Math.Clamp((completed * 100.0) / work.Count, 0, 99);
                                _queue.UpdateProgress(operationId, pct, item.LocalPath, completed, work.Count,
                                    transferred + bytes, totalBytes, speed);
                            }
                        });

                        await provider.UploadAsync(item.LocalPath, remotePath, fileProgress, ct).ConfigureAwait(false);
                        lock (lockObj)
                        {
                            transferred += item.Size;
                            completed++;
                            var speedNow = sw.Elapsed.TotalSeconds > 0.1 ? transferred / sw.Elapsed.TotalSeconds : 0;
                            var pctDone = totalBytes > 0
                                ? (int)Math.Clamp(transferred * 100 / totalBytes, 0, 99)
                                : (int)Math.Clamp(completed * 100.0 / work.Count, 0, 99);
                            _queue.UpdateProgress(operationId, pctDone, item.LocalPath, completed, work.Count, transferred, totalBytes, speedNow);
                        }
                    }
                    finally
                    {
                        gate.Release();
                    }
                }, ct));
            }

            await Task.WhenAll(tasks).ConfigureAwait(false);
            _queue.MarkCompleted(operationId);
        }
        catch (OperationCanceledException)
        {
            _queue.MarkCancelled(operationId);
            throw;
        }
        catch (Exception ex)
        {
            _queue.MarkFailed(operationId, ex.Message);
            throw;
        }
    }

    public async Task DownloadAsync(
        string operationId,
        string hostId,
        IReadOnlyList<string> meshPanePaths,
        string localDestDir,
        CancellationToken ct = default)
    {
        _mesh.EnsureConnected(hostId);
        var provider = _mesh.GetConnectedProvider(hostId);

        var walkProgress = new Progress<(int Found, string? Current)>(p =>
        {
            _queue.UpdateProgress(operationId, 0, p.Current ?? "Scanning…", 0, Math.Max(p.Found, 1), 0, 0);
        });

        // Register early so UI shows scanning state
        _queue.RegisterJob(operationId, "mesh-download", "Scanning remote…", "sftp", 1, "mesh", FileTransferPriority.High, localDestDir);

        var work = new List<MeshParallelWalker.RemoteFileNode>();
        foreach (var pane in meshPanePaths)
        {
            if (!MeshPath.TryParse(pane, out var hid, out var remotePath) || string.IsNullOrEmpty(hid))
                continue;
            if (!string.Equals(hid, hostId, StringComparison.OrdinalIgnoreCase)) continue;
            var leaf = remotePath.TrimEnd('/').Split('/').LastOrDefault() ?? "download";
            var nodes = await MeshParallelWalker.CollectFilesAsync(provider, remotePath, leaf, 0, walkProgress, ct)
                .ConfigureAwait(false);
            work.AddRange(nodes);
        }

        if (work.Count == 0) throw new InvalidOperationException("No remote files to download");

        Directory.CreateDirectory(localDestDir);
        long totalBytes = work.Sum(w => w.Size);
        _queue.UpdateProgress(operationId, 0, work[0].DisplayName, 0, work.Count, 0, totalBytes);

        var sw = Stopwatch.StartNew();
        long transferred = 0;
        int completed = 0;
        var degree = Math.Clamp(Environment.ProcessorCount / 2, 2, 6);
        using var gate = new SemaphoreSlim(degree, degree);
        var lockObj = new object();

        try
        {
            var tasks = work.Select(item => Task.Run(async () =>
            {
                await gate.WaitAsync(ct).ConfigureAwait(false);
                try
                {
                    ct.ThrowIfCancellationRequested();
                    var localFile = Path.Combine(localDestDir, item.RelativeName);
                    var localDir = Path.GetDirectoryName(localFile);
                    if (!string.IsNullOrEmpty(localDir)) Directory.CreateDirectory(localDir);

                    var fileProgress = new Progress<long>(bytes =>
                    {
                        lock (lockObj)
                        {
                            var speed = sw.Elapsed.TotalSeconds > 0.1 ? transferred / sw.Elapsed.TotalSeconds : 0;
                            var pct = totalBytes > 0
                                ? (int)Math.Clamp((transferred + bytes) * 100 / totalBytes, 0, 99)
                                : (int)Math.Clamp((completed * 100.0) / work.Count, 0, 99);
                            _queue.UpdateProgress(operationId, pct, item.DisplayName, completed, work.Count,
                                transferred + bytes, totalBytes, speed);
                        }
                    });

                    await provider.DownloadAsync(item.RemotePath, localFile, fileProgress, ct).ConfigureAwait(false);
                    lock (lockObj)
                    {
                        transferred += item.Size > 0 ? item.Size : new FileInfo(localFile).Length;
                        completed++;
                        var speedNow = sw.Elapsed.TotalSeconds > 0.1 ? transferred / sw.Elapsed.TotalSeconds : 0;
                        var pctDone = totalBytes > 0
                            ? (int)Math.Clamp(transferred * 100 / totalBytes, 0, 99)
                            : (int)Math.Clamp(completed * 100.0 / work.Count, 0, 99);
                        _queue.UpdateProgress(operationId, pctDone, item.DisplayName, completed, work.Count, transferred, totalBytes, speedNow);
                    }
                }
                finally
                {
                    gate.Release();
                }
            }, ct)).ToArray();

            await Task.WhenAll(tasks).ConfigureAwait(false);
            _queue.MarkCompleted(operationId);
        }
        catch (OperationCanceledException)
        {
            _queue.MarkCancelled(operationId);
            throw;
        }
        catch (Exception ex)
        {
            _queue.MarkFailed(operationId, ex.Message);
            throw;
        }
    }

    public async Task ReplicateRemoteAsync(
        string operationId,
        string hostId,
        IReadOnlyList<string> meshPanePaths,
        string remoteDestDir,
        bool move,
        CancellationToken ct = default)
    {
        _mesh.EnsureConnected(hostId);
        var provider = _mesh.GetConnectedProvider(hostId);
        var work = new List<MeshParallelWalker.RemoteFileNode>();
        foreach (var pane in meshPanePaths)
        {
            if (!MeshPath.TryParse(pane, out var hid, out var remotePath) || string.IsNullOrEmpty(hid)) continue;
            if (!string.Equals(hid, hostId, StringComparison.OrdinalIgnoreCase)) continue;
            var leaf = remotePath.TrimEnd('/').Split('/').LastOrDefault() ?? "item";
            var nodes = await MeshParallelWalker.CollectFilesAsync(provider, remotePath, leaf, 0, null, ct).ConfigureAwait(false);
            work.AddRange(nodes);
        }
        if (work.Count == 0) throw new InvalidOperationException("No remote files to replicate");

        long totalBytes = work.Sum(w => w.Size);
        var action = move ? "mesh-move" : "mesh-copy";
        _queue.RegisterJob(operationId, action, BuildLabel(work.Select(w => w.DisplayName).ToList()), "sftp", work.Count, "mesh", FileTransferPriority.High, remoteDestDir);
        _queue.UpdateProgress(operationId, 0, work[0].DisplayName, 0, work.Count, 0, totalBytes);

        var sw = Stopwatch.StartNew();
        long transferred = 0;
        int completed = 0;
        var destRoot = NormalizeRemoteDir(remoteDestDir);

        try
        {
            foreach (var item in work)
            {
                ct.ThrowIfCancellationRequested();
                var localTemp = await _mesh.HydrateToCacheAsync(MeshPath.Build(hostId, item.RemotePath), ct).ConfigureAwait(false);
                var rel = item.RelativeName.Replace('\\', '/');
                var remotePath = destRoot == "/" ? "/" + rel : destRoot + "/" + rel;
                var remoteDir = remotePath.Contains('/') ? remotePath[..remotePath.LastIndexOf('/')] : "/";
                if (!string.IsNullOrEmpty(remoteDir)) await provider.MkdirAsync(remoteDir, ct).ConfigureAwait(false);

                var fileProgress = new Progress<long>(bytes =>
                {
                    var speed = sw.Elapsed.TotalSeconds > 0.1 ? transferred / sw.Elapsed.TotalSeconds : 0;
                    var pct = totalBytes > 0
                        ? (int)Math.Clamp((transferred + bytes) * 100 / totalBytes, 0, 99)
                        : (int)Math.Clamp((completed * 100.0) / work.Count, 0, 99);
                    _queue.UpdateProgress(operationId, pct, item.DisplayName, completed, work.Count,
                        transferred + bytes, totalBytes, speed);
                });

                await provider.UploadAsync(localTemp, remotePath, fileProgress, ct).ConfigureAwait(false);
                if (move) await provider.DeleteAsync(item.RemotePath, ct).ConfigureAwait(false);

                transferred += item.Size > 0 ? item.Size : new FileInfo(localTemp).Length;
                completed++;
                var speedNow = sw.Elapsed.TotalSeconds > 0.1 ? transferred / sw.Elapsed.TotalSeconds : 0;
                var pctDone = totalBytes > 0
                    ? (int)Math.Clamp(transferred * 100 / totalBytes, 0, 99)
                    : (int)Math.Clamp(completed * 100.0 / work.Count, 0, 99);
                _queue.UpdateProgress(operationId, pctDone, item.DisplayName, completed, work.Count, transferred, totalBytes, speedNow);
            }

            _queue.MarkCompleted(operationId);
        }
        catch (OperationCanceledException)
        {
            _queue.MarkCancelled(operationId);
            throw;
        }
        catch (Exception ex)
        {
            _queue.MarkFailed(operationId, ex.Message);
            throw;
        }
    }

    public async Task RelayAsync(
        string operationId,
        string srcHostId,
        string destHostId,
        IReadOnlyList<string> meshPanePaths,
        string remoteDestDir,
        bool move,
        CancellationToken ct = default)
    {
        var staging = Path.Combine(Path.GetTempPath(), "BNDZ", "mesh-relay", operationId);
        try
        {
            await DownloadAsync($"{operationId}-stage", srcHostId, meshPanePaths, staging, ct).ConfigureAwait(false);
            var localFiles = Directory.Exists(staging)
                ? Directory.EnumerateFiles(staging, "*", SearchOption.AllDirectories).ToList()
                : new List<string>();
            if (localFiles.Count == 0) throw new InvalidOperationException("Relay staging produced no files");
            await UploadAsync(operationId, destHostId, localFiles, remoteDestDir, ct).ConfigureAwait(false);
            if (move)
            {
                _mesh.EnsureConnected(srcHostId);
                var provider = _mesh.GetConnectedProvider(srcHostId);
                foreach (var pane in meshPanePaths)
                {
                    if (!MeshPath.TryParse(pane, out var hid, out var remotePath) || string.IsNullOrEmpty(hid)) continue;
                    if (!string.Equals(hid, srcHostId, StringComparison.OrdinalIgnoreCase)) continue;
                    var attr = await provider.GetAttributesAsync(remotePath, ct).ConfigureAwait(false);
                    if (attr.IsDirectory)
                        await provider.RecursiveDeleteAsync(remotePath, ct).ConfigureAwait(false);
                    else
                        await provider.DeleteAsync(remotePath, ct).ConfigureAwait(false);
                }
            }
        }
        finally
        {
            try
            {
                if (Directory.Exists(staging)) Directory.Delete(staging, true);
            }
            catch { /* best effort */ }
        }
    }

    private static List<LocalFileWork> CollectLocalFiles(IReadOnlyList<string> localPaths)
    {
        var result = new List<LocalFileWork>();
        foreach (var raw in localPaths)
        {
            var path = raw.Trim();
            if (string.IsNullOrEmpty(path)) continue;
            if (Directory.Exists(path))
            {
                var rootName = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
                foreach (var file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
                {
                    var rel = Path.GetRelativePath(path, file);
                    result.Add(new LocalFileWork(file, rootName + "/" + rel.Replace('\\', '/'), new FileInfo(file).Length));
                }
            }
            else if (File.Exists(path))
            {
                result.Add(new LocalFileWork(path, Path.GetFileName(path), new FileInfo(path).Length));
            }
        }
        return result;
    }

    private static string NormalizeRemoteDir(string remotePath)
    {
        var p = remotePath.Replace('\\', '/');
        if (!p.StartsWith('/')) p = "/" + p;
        if (p.Length > 1 && p.EndsWith('/')) p = p.TrimEnd('/');
        return p;
    }

    private static string BuildLabel(IReadOnlyList<LocalFileWork> work) =>
        work.Count == 1 ? Path.GetFileName(work[0].LocalPath) : $"{work.Count} items";

    private static string BuildLabel(IReadOnlyList<string> names) =>
        names.Count == 1 ? names[0] : $"{names.Count} items";

    private sealed record LocalFileWork(string LocalPath, string RelativeName, long Size);
}
