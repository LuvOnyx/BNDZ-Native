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
            var provider = _mesh.GetSshProvider(hostId);
            var destRoot = NormalizeRemoteDir(remoteDestDir);

            foreach (var item in work)
            {
                ct.ThrowIfCancellationRequested();
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
                    _queue.UpdateProgress(operationId, pct, item.LocalPath, completed, work.Count,
                        transferred + bytes, totalBytes, speed);
                });

                await provider.UploadAsync(item.LocalPath, remotePath, fileProgress, ct).ConfigureAwait(false);
                transferred += item.Size;
                completed++;
                var speedNow = sw.Elapsed.TotalSeconds > 0.1 ? transferred / sw.Elapsed.TotalSeconds : 0;
                var pctDone = totalBytes > 0
                    ? (int)Math.Clamp(transferred * 100 / totalBytes, 0, 99)
                    : (int)Math.Clamp(completed * 100.0 / work.Count, 0, 99);
                _queue.UpdateProgress(operationId, pctDone, item.LocalPath, completed, work.Count, transferred, totalBytes, speedNow);
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

    public async Task DownloadAsync(
        string operationId,
        string hostId,
        IReadOnlyList<string> meshPanePaths,
        string localDestDir,
        CancellationToken ct = default)
    {
        var work = new List<RemoteFileWork>();
        foreach (var pane in meshPanePaths)
        {
            if (!MeshPath.TryParse(pane, out var hid, out var remotePath) || string.IsNullOrEmpty(hid))
                continue;
            if (!string.Equals(hid, hostId, StringComparison.OrdinalIgnoreCase)) continue;
            var leaf = remotePath.TrimEnd('/').Split('/').LastOrDefault() ?? "download";
            await CollectRemoteFilesAsync(hid, remotePath, leaf, work, ct).ConfigureAwait(false);
        }

        if (work.Count == 0) throw new InvalidOperationException("No remote files to download");

        Directory.CreateDirectory(localDestDir);
        long totalBytes = work.Sum(w => w.Size);
        _queue.RegisterJob(operationId, "mesh-download", BuildLabel(work.Select(w => w.DisplayName).ToList()), "sftp", work.Count, "mesh", FileTransferPriority.High, localDestDir);
        _queue.UpdateProgress(operationId, 0, work[0].DisplayName, 0, work.Count, 0, totalBytes);

        var sw = Stopwatch.StartNew();
        long transferred = 0;
        int completed = 0;

        try
        {
            _mesh.EnsureConnected(hostId);
            var provider = _mesh.GetSshProvider(hostId);

            foreach (var item in work)
            {
                ct.ThrowIfCancellationRequested();
                var localFile = Path.Combine(localDestDir, item.RelativeName);
                var localDir = Path.GetDirectoryName(localFile);
                if (!string.IsNullOrEmpty(localDir)) Directory.CreateDirectory(localDir);

                var fileProgress = new Progress<long>(bytes =>
                {
                    var speed = sw.Elapsed.TotalSeconds > 0.1 ? transferred / sw.Elapsed.TotalSeconds : 0;
                    var pct = totalBytes > 0
                        ? (int)Math.Clamp((transferred + bytes) * 100 / totalBytes, 0, 99)
                        : (int)Math.Clamp((completed * 100.0) / work.Count, 0, 99);
                    _queue.UpdateProgress(operationId, pct, item.DisplayName, completed, work.Count,
                        transferred + bytes, totalBytes, speed);
                });

                await provider.DownloadAsync(item.RemotePath, localFile, fileProgress, ct).ConfigureAwait(false);
                transferred += item.Size > 0 ? item.Size : new FileInfo(localFile).Length;
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

    public async Task ReplicateRemoteAsync(
        string operationId,
        string hostId,
        IReadOnlyList<string> meshPanePaths,
        string remoteDestDir,
        bool move,
        CancellationToken ct = default)
    {
        var work = new List<RemoteFileWork>();
        foreach (var pane in meshPanePaths)
        {
            if (!MeshPath.TryParse(pane, out var hid, out var remotePath) || string.IsNullOrEmpty(hid)) continue;
            if (!string.Equals(hid, hostId, StringComparison.OrdinalIgnoreCase)) continue;
            var leaf = remotePath.TrimEnd('/').Split('/').LastOrDefault() ?? "item";
            await CollectRemoteFilesAsync(hid, remotePath, leaf, work, ct).ConfigureAwait(false);
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
            _mesh.EnsureConnected(hostId);
            var provider = _mesh.GetSshProvider(hostId);

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
                var provider = _mesh.GetSshProvider(srcHostId);
                var work = new List<RemoteFileWork>();
                foreach (var pane in meshPanePaths)
                {
                    if (!MeshPath.TryParse(pane, out var hid, out var remotePath) || string.IsNullOrEmpty(hid)) continue;
                    if (!string.Equals(hid, srcHostId, StringComparison.OrdinalIgnoreCase)) continue;
                    var leaf = remotePath.TrimEnd('/').Split('/').LastOrDefault() ?? "item";
                    await CollectRemoteFilesAsync(hid, remotePath, leaf, work, ct).ConfigureAwait(false);
                }
                foreach (var item in work)
                    await provider.DeleteAsync(item.RemotePath, ct).ConfigureAwait(false);
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

    private async Task CollectRemoteFilesAsync(string hostId, string remotePath, string relPrefix, List<RemoteFileWork> acc, CancellationToken ct)
    {
        _mesh.EnsureConnected(hostId);
        var provider = _mesh.GetSshProvider(hostId);
        IReadOnlyList<MeshDirEntry> entries;
        try
        {
            entries = await provider.ListAsync(remotePath, ct).ConfigureAwait(false);
        }
        catch
        {
            var leaf = Path.GetFileName(remotePath.Replace('/', '\\'));
            var rel = string.IsNullOrEmpty(relPrefix) ? leaf : relPrefix;
            acc.Add(new RemoteFileWork(remotePath, rel, leaf, 0));
            return;
        }

        var dirs = entries.Where(e => e.IsDirectory).ToList();
        var files = entries.Where(e => !e.IsDirectory).ToList();

        if (dirs.Count == 0 && files.Count == 1 && remotePath != "/")
        {
            var f = files[0];
            var rel = string.IsNullOrEmpty(relPrefix) ? f.Name : relPrefix;
            acc.Add(new RemoteFileWork(
                remotePath.TrimEnd('/') + "/" + f.Name,
                rel,
                f.Name,
                f.Size));
            return;
        }

        foreach (var e in entries)
        {
            if (e.Name is "." or "..") continue;
            var childRemote = remotePath.TrimEnd('/') + "/" + e.Name;
            var childRel = string.IsNullOrEmpty(relPrefix) ? e.Name : relPrefix + "/" + e.Name;
            if (e.IsDirectory)
                await CollectRemoteFilesAsync(hostId, childRemote, childRel, acc, ct).ConfigureAwait(false);
            else
                acc.Add(new RemoteFileWork(childRemote, childRel.Replace('/', Path.DirectorySeparatorChar), e.Name, e.Size));
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
    private sealed record RemoteFileWork(string RemotePath, string RelativeName, string DisplayName, long Size);
}
