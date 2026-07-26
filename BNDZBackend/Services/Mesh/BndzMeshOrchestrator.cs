namespace BNDZ.Services.Mesh;

/// <summary>Central mesh coordinator — hosts, browsing, cache, sync, terminal.</summary>
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

    public void SetSyncProgressCallback(Action<MeshSyncProgress>? cb) => _sync.SetProgressCallback(cb);

    public IReadOnlyList<MeshHostRecord> ListHosts() => _db.ListHosts();

    public MeshHostRecord? GetHost(string id) => _db.GetHost(id);

    public MeshHostRecord UpsertHost(MeshHostRecord host)
    {
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
            var provider = CreateProvider(host);
            await provider.ConnectAsync(host, ct).ConfigureAwait(false);
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

    private IMeshProvider GetProvider(string hostId)
    {
        lock (_providerLock)
        {
            if (_providers.TryGetValue(hostId, out var p) && p.IsConnected) return p;
        }
        throw new InvalidOperationException($"Host {hostId} not connected");
    }

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
        return entries.Select(e => new DirListingSharedBuffer.DirEntryDto
        {
            Id = e.Name,
            Name = e.Name,
            Path = MeshPath.Build(hostId, JoinRemote(remotePath, e.Name)),
            Type = e.IsDirectory ? "directory" : "file",
            Size = e.Size,
            ModifiedUtc = e.ModifiedUtc ?? DateTimeOffset.UtcNow,
            Extension = e.IsDirectory ? "" : Path.GetExtension(e.Name).TrimStart('.'),
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
