using System.Text.Json;

namespace BNDZ.Services.Mesh;

/// <summary>Central mesh coordinator — hosts, browsing, cache, sync, terminal, remote FS ops.</summary>
public sealed class BndzMeshOrchestrator : IDisposable
{
    private readonly MeshDatabase _db = new();
    private readonly MeshCacheService _cache = new();
    private readonly MeshSyncEngine _sync;
    private readonly MeshTerminalService _terminal;
    private readonly Dictionary<string, IMeshProvider> _providers = new();
    private readonly object _providerLock = new();

    public BndzMeshOrchestrator()
    {
        _sync = new MeshSyncEngine(_db, this);
        _terminal = new MeshTerminalService(this);
        _sync.RestoreWatchers();
    }

    public MeshTerminalService Terminal => _terminal;
    public MeshSyncEngine Sync => _sync;
    public MeshDatabase Database => _db;
    public MeshCacheService Cache => _cache;

    public void SetSyncProgressCallback(Action<MeshSyncProgress>? cb) => _sync.SetProgressCallback(cb);

    public IReadOnlyList<MeshHostRecord> ListHosts() => _db.ListHosts();

    public MeshHostRecord? GetHost(string id) => _db.GetHost(id);

    public MeshHostRecord UpsertHost(MeshHostRecord host)
    {
        if (!string.IsNullOrEmpty(host.PasswordPlain))
        {
            host.ProtectedSecret = MeshCredentialVault.Protect(host.PasswordPlain);
            if (!string.IsNullOrEmpty(host.KeyPath) && host.AuthKind == MeshAuthKind.PrivateKey)
                SshSftpMeshProvider.CacheSessionPassphrase(host.KeyPath, host.PasswordPlain);
            host.PasswordPlain = null;
        }
        _db.UpsertHost(host);
        return host;
    }

    public void DeleteHost(string id)
    {
        Disconnect(id);
        _db.DeleteHost(id);
    }

    public int ImportSshConfig()
    {
        var imported = MeshCredentialVault.ImportSshConfig();
        var count = 0;
        foreach (var h in imported)
        {
            if (_db.GetHost(h.Id) != null) continue;
            _db.UpsertHost(h);
            count++;
        }
        return count;
    }

    public async Task ConnectAsync(string hostId, CancellationToken ct = default)
    {
        var host = _db.GetHost(hostId) ?? throw new InvalidOperationException("Host not found");
        host.State = MeshConnectionState.Connecting;
        host.LastError = null;
        _db.UpsertHost(host);
        try
        {
            IMeshProvider provider;
            if (host.Provider == MeshProviderKind.Ssh
                && !string.IsNullOrWhiteSpace(host.JumpHostId)
                && !string.Equals(host.JumpHostId, hostId, StringComparison.OrdinalIgnoreCase))
            {
                await EnsureConnectedAsync(host.JumpHostId!, ct).ConfigureAwait(false);
                var jumpProvider = GetSshProvider(host.JumpHostId!);
                var jumpClient = jumpProvider.GetSshClient()
                    ?? throw new InvalidOperationException("Jump host SSH client unavailable");
                var ssh = new SshSftpMeshProvider();
                await ssh.ConnectViaJumpAsync(host, jumpClient, ct).ConfigureAwait(false);
                provider = ssh;
            }
            else
            {
                provider = CreateProvider(host);
                await provider.ConnectAsync(host, ct).ConfigureAwait(false);
            }

            lock (_providerLock) _providers[hostId] = provider;
            host.State = MeshConnectionState.Online;
            host.LastSeenUtc = DateTime.UtcNow;
        }
        catch (Exception ex)
        {
            host.State = MeshConnectionState.Error;
            host.LastError = ex.Message;
            throw;
        }
        finally
        {
            _db.UpsertHost(host);
        }
    }

    public void Disconnect(string hostId)
    {
        lock (_providerLock)
        {
            if (_providers.TryGetValue(hostId, out var p))
            {
                p.Disconnect();
                _providers.Remove(hostId);
            }
        }
        var host = _db.GetHost(hostId);
        if (host != null)
        {
            host.State = MeshConnectionState.Offline;
            _db.UpsertHost(host);
        }
    }

    public void EnsureConnected(string hostId)
    {
        EnsureConnectedAsync(hostId).GetAwaiter().GetResult();
    }

    public async Task EnsureConnectedAsync(string hostId, CancellationToken ct = default)
    {
        lock (_providerLock)
        {
            if (_providers.TryGetValue(hostId, out var p) && p.IsConnected) return;
        }
        await ConnectAsync(hostId, ct).ConfigureAwait(false);
    }

    public SshSftpMeshProvider GetSshProvider(string hostId)
    {
        lock (_providerLock)
        {
            if (_providers.TryGetValue(hostId, out var p) && p is SshSftpMeshProvider ssh)
                return ssh;
        }
        throw new InvalidOperationException("SSH provider not connected");
    }

    public IMeshProvider GetConnectedProvider(string hostId)
    {
        lock (_providerLock)
        {
            if (_providers.TryGetValue(hostId, out var p) && p.IsConnected) return p;
        }
        throw new InvalidOperationException($"Host {hostId} not connected");
    }

    private IMeshProvider GetProvider(string hostId) => GetConnectedProvider(hostId);

    private static IMeshProvider CreateProvider(MeshHostRecord host) =>
        host.Provider == MeshProviderKind.S3 ? new S3MeshProvider() : new SshSftpMeshProvider();

    public async Task<List<DirListingSharedBuffer.DirEntryDto>> ListPaneAsync(string panePath, CancellationToken ct = default)
    {
        if (!MeshPath.TryParse(panePath, out var hostId, out var remotePath))
            return [];

        if (string.IsNullOrEmpty(hostId))
        {
            return _db.ListHosts().Select(h => new DirListingSharedBuffer.DirEntryDto
            {
                Id = h.Id,
                Name = h.Alias,
                Path = MeshPath.Build(h.Id),
                Type = "directory",
                Size = 0,
                ModifiedUtc = h.LastSeenUtc ?? DateTimeOffset.UtcNow,
            }).ToList();
        }

        await EnsureConnectedAsync(hostId, ct).ConfigureAwait(false);
        var provider = GetProvider(hostId);
        var entries = await provider.ListAsync(remotePath, ct).ConfigureAwait(false);
        return entries.Select(e =>
        {
            var dto = new DirListingSharedBuffer.DirEntryDto
            {
                Id = e.Name,
                Name = e.Name,
                Path = MeshPath.Build(hostId, JoinRemote(remotePath, e.Name)),
                Type = e.IsDirectory ? "directory" : "file",
                Size = e.Size,
                ModifiedUtc = e.ModifiedUtc ?? DateTimeOffset.UtcNow,
                Extension = e.IsDirectory ? "" : Path.GetExtension(e.Name).TrimStart('.'),
                IsGhostLink = false,
                LinkType = e.IsSymlink ? "symlink" : null,
                LinkTarget = e.LinkTarget,
                AttrBits = e.IsSymlink ? DirListingSharedBuffer.AttrReparse : (byte)0,
            };
            return dto;
        }).ToList();
    }

    public async Task<string> HydrateToCacheAsync(string panePath, CancellationToken ct = default)
    {
        if (!MeshPath.TryParse(panePath, out var hostId, out var remotePath) || string.IsNullOrEmpty(hostId))
            throw new InvalidOperationException("Invalid mesh file path");
        EnsureConnected(hostId);
        var provider = GetProvider(hostId);
        return await _cache.EnsureCachedAsync(provider, hostId, remotePath, ct).ConfigureAwait(false);
    }

    public async Task UploadLocalToRemoteAsync(string hostId, string remotePath, string localFile, CancellationToken ct = default)
    {
        EnsureConnected(hostId);
        var provider = GetProvider(hostId);
        await provider.UploadAsync(localFile, remotePath, null, ct).ConfigureAwait(false);
        _cache.Invalidate(hostId, remotePath);
    }

    public async Task<MeshFileAttributes> StatAsync(string panePath, CancellationToken ct = default)
    {
        if (!MeshPath.TryParse(panePath, out var hostId, out var remotePath) || string.IsNullOrEmpty(hostId))
            throw new InvalidOperationException("Invalid mesh path");
        await EnsureConnectedAsync(hostId, ct).ConfigureAwait(false);
        return await GetProvider(hostId).GetAttributesAsync(remotePath, ct).ConfigureAwait(false);
    }

    public async Task WriteBackAsync(string panePath, string localFile, DateTimeOffset? expectedRemoteMtime, CancellationToken ct = default)
    {
        if (!MeshPath.TryParse(panePath, out var hostId, out var remotePath) || string.IsNullOrEmpty(hostId))
            throw new InvalidOperationException("Invalid mesh path");
        await EnsureConnectedAsync(hostId, ct).ConfigureAwait(false);
        var provider = GetProvider(hostId);
        if (expectedRemoteMtime.HasValue)
        {
            var attr = await provider.GetAttributesAsync(remotePath, ct).ConfigureAwait(false);
            if (attr.Exists && attr.ModifiedUtc.HasValue)
            {
                var remote = attr.ModifiedUtc.Value;
                if (Math.Abs((remote - expectedRemoteMtime.Value.UtcDateTime).TotalSeconds) > 1.5)
                    throw new InvalidOperationException(
                        $"Remote file changed since hydrate (remote mtime {remote:o}). Reload before saving.");
            }
        }
        await provider.UploadAsync(localFile, remotePath, null, ct).ConfigureAwait(false);
        _cache.Invalidate(hostId, remotePath);
    }

    public async Task WriteBytesAsync(string panePath, byte[] content, CancellationToken ct = default)
    {
        if (!MeshPath.TryParse(panePath, out var hostId, out var remotePath) || string.IsNullOrEmpty(hostId))
            throw new InvalidOperationException("Invalid mesh path");
        await EnsureConnectedAsync(hostId, ct).ConfigureAwait(false);
        await GetProvider(hostId).WriteBytesAsync(remotePath, content, ct).ConfigureAwait(false);
        _cache.Invalidate(hostId, remotePath);
    }

    /// <summary>
    /// Execute delete / move(rename) / create-dir / create-file against mesh pane paths.
    /// Paths must be /mesh/{hostId}/… form (forward slashes).
    /// </summary>
    public async Task ExecuteFsOperationAsync(
        string action,
        IReadOnlyList<string> sources,
        string? target,
        CancellationToken ct = default)
    {
        switch (action)
        {
            case "delete":
                foreach (var src in sources)
                {
                    if (!MeshPath.TryParse(src, out var hostId, out var remote) || string.IsNullOrEmpty(hostId))
                        throw new InvalidOperationException($"Not a mesh path: {src}");
                    await EnsureConnectedAsync(hostId, ct).ConfigureAwait(false);
                    var provider = GetProvider(hostId);
                    var attr = await provider.GetAttributesAsync(remote, ct).ConfigureAwait(false);
                    if (attr.IsDirectory)
                        await provider.RecursiveDeleteAsync(remote, ct).ConfigureAwait(false);
                    else
                        await provider.DeleteAsync(remote, ct).ConfigureAwait(false);
                    _cache.Invalidate(hostId, remote);
                }
                break;

            case "move":
            case "rename":
            {
                if (sources.Count != 1 || string.IsNullOrWhiteSpace(target))
                    throw new InvalidOperationException("Mesh rename requires one source and a target path");
                if (!MeshPath.TryParse(sources[0], out var fromHost, out var fromRemote) || string.IsNullOrEmpty(fromHost))
                    throw new InvalidOperationException("Invalid mesh source");
                if (!MeshPath.TryParse(target!, out var toHost, out var toRemote) || string.IsNullOrEmpty(toHost))
                    throw new InvalidOperationException("Invalid mesh target");
                if (!string.Equals(fromHost, toHost, StringComparison.OrdinalIgnoreCase))
                    throw new InvalidOperationException("Cross-host rename is not supported; use transfer instead");
                await EnsureConnectedAsync(fromHost, ct).ConfigureAwait(false);
                await GetProvider(fromHost).RenameAsync(fromRemote, toRemote, ct).ConfigureAwait(false);
                _cache.Invalidate(fromHost, fromRemote);
                _cache.Invalidate(fromHost, toRemote);
                break;
            }

            case "create-dir":
            {
                var path = sources.FirstOrDefault() ?? target;
                if (string.IsNullOrWhiteSpace(path) || !MeshPath.TryParse(path, out var hostId, out var remote) || string.IsNullOrEmpty(hostId))
                    throw new InvalidOperationException("Invalid mesh create-dir path");
                await EnsureConnectedAsync(hostId, ct).ConfigureAwait(false);
                await GetProvider(hostId).MkdirAsync(remote, ct).ConfigureAwait(false);
                break;
            }

            case "create-file":
            {
                var path = sources.FirstOrDefault() ?? target;
                if (string.IsNullOrWhiteSpace(path) || !MeshPath.TryParse(path, out var hostId, out var remote) || string.IsNullOrEmpty(hostId))
                    throw new InvalidOperationException("Invalid mesh create-file path");
                await EnsureConnectedAsync(hostId, ct).ConfigureAwait(false);
                await GetProvider(hostId).CreateFileAsync(remote, ct).ConfigureAwait(false);
                break;
            }

            default:
                throw new InvalidOperationException($"Unsupported mesh FS action: {action}");
        }
    }

    public static bool LooksLikeMeshFsPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var n = path.Replace('\\', '/');
        if (!n.StartsWith('/')) n = "/" + n;
        return MeshPath.IsMeshPath(n);
    }

    public static string ToMeshPanePath(string path)
    {
        var n = path.Replace('\\', '/');
        if (!n.StartsWith('/')) n = "/" + n;
        return MeshPath.Normalize(n);
    }

    private static string JoinRemote(string basePath, string name)
    {
        var p = basePath.TrimEnd('/');
        return p == "" || p == "/" ? "/" + name : p + "/" + name;
    }

    public void Dispose()
    {
        _sync.Dispose();
        _terminal.Dispose();
        _db.Dispose();
        lock (_providerLock)
        {
            foreach (var p in _providers.Values) p.Disconnect();
            _providers.Clear();
        }
    }
}
