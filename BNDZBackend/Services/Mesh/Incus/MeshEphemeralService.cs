namespace BNDZ.Services.Mesh.Incus;

/// <summary>
/// Launch / track / destroy Incus ephemeral instances and register them as Mesh SSH hosts.
/// Absorbs Incus client create→wait→state.network flow into Remote Mesh (not a new plugin).
/// </summary>
public sealed class MeshEphemeralService
{
    private readonly MeshDatabase _db;
    private readonly BndzMeshOrchestrator _orchestrator;

    public MeshEphemeralService(MeshDatabase db, BndzMeshOrchestrator orchestrator)
    {
        _db = db;
        _orchestrator = orchestrator;
    }

    public IReadOnlyList<IncusEndpointRecord> ListEndpoints() =>
        _db.ListIncusEndpoints().Select(SanitizeEndpoint).ToList();

    public IncusEndpointRecord UpsertEndpoint(IncusEndpointRecord endpoint)
    {
        if (string.IsNullOrWhiteSpace(endpoint.ApiUrl))
            throw new InvalidOperationException("Incus API URL is required (https://host:8443)");
        endpoint.ApiUrl = endpoint.ApiUrl.Trim().TrimEnd('/');
        if (!endpoint.ApiUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            && !endpoint.ApiUrl.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
            endpoint.ApiUrl = "https://" + endpoint.ApiUrl;

        if (!string.IsNullOrEmpty(endpoint.TrustTokenPlain))
        {
            endpoint.ProtectedTrustToken = MeshCredentialVault.Protect(endpoint.TrustTokenPlain);
            endpoint.TrustTokenPlain = null;
        }

        EnsureIdentityPaths(endpoint.Id);
        _db.UpsertIncusEndpoint(endpoint);
        return SanitizeEndpoint(endpoint);
    }

    public void DeleteEndpoint(string endpointId)
    {
        var linked = _db.ListIncusEphemeral().Where(i => i.EndpointId == endpointId).ToList();
        foreach (var inst in linked)
        {
            try { DestroyAsync(inst.Id, CancellationToken.None).GetAwaiter().GetResult(); }
            catch { /* best-effort cleanup */ }
        }
        _db.DeleteIncusEndpoint(endpointId);
        try
        {
            var dir = IdentityDir(endpointId);
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
        catch { /* ignore */ }
    }

    public async Task<IncusServerInfo> TestEndpointAsync(string endpointId, CancellationToken ct = default)
    {
        var endpoint = _db.GetIncusEndpoint(endpointId)
            ?? throw new InvalidOperationException("Incus endpoint not found");
        var (api, info) = await OpenClientAsync(endpoint, ct).ConfigureAwait(false);
        await using (api)
        {
            endpoint.Trusted = info.Trusted;
            endpoint.LastSeenUtc = DateTime.UtcNow;
            endpoint.LastError = null;
            if (!string.IsNullOrWhiteSpace(info.Fingerprint) && string.IsNullOrWhiteSpace(endpoint.ServerFingerprint))
                endpoint.ServerFingerprint = info.Fingerprint;
            _db.UpsertIncusEndpoint(endpoint);
            return info;
        }
    }

    public IReadOnlyList<IncusEphemeralInstanceRecord> ListEphemeral() => _db.ListIncusEphemeral();

    public async Task<IncusEphemeralInstanceRecord> LaunchAsync(IncusLaunchRequest req, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(req.EndpointId))
            throw new InvalidOperationException("endpointId is required");
        var endpoint = _db.GetIncusEndpoint(req.EndpointId)
            ?? throw new InvalidOperationException("Incus endpoint not found");

        var name = string.IsNullOrWhiteSpace(req.Name)
            ? $"bndz-{DateTime.UtcNow:yyMMddHHmmss}-{Random.Shared.Next(0x1000, 0xFFFF):x}"
            : SanitizeInstanceName(req.Name!);
        var image = string.IsNullOrWhiteSpace(req.ImageAlias) ? endpoint.DefaultImage : req.ImageAlias!;
        var imageServer = string.IsNullOrWhiteSpace(req.ImageServer) ? endpoint.DefaultImageServer : req.ImageServer!;
        var type = string.IsNullOrWhiteSpace(req.InstanceType) ? endpoint.DefaultInstanceType : req.InstanceType!;
        var sshUser = string.IsNullOrWhiteSpace(req.SshUser) ? endpoint.DefaultSshUser : req.SshUser!;
        var sshPort = req.SshPort is > 0 ? req.SshPort.Value : endpoint.DefaultSshPort;
        var sshKey = string.IsNullOrWhiteSpace(req.SshKeyPath) ? endpoint.DefaultSshKeyPath : req.SshKeyPath;

        var record = new IncusEphemeralInstanceRecord
        {
            EndpointId = endpoint.Id,
            InstanceName = name,
            Status = "Creating",
            ImageAlias = image,
            InstanceType = type,
            Ephemeral = req.Ephemeral,
            CreatedUtc = DateTime.UtcNow,
            Notes = req.Alias,
        };
        _db.UpsertIncusEphemeral(record);

        try
        {
            await using var client = await OpenClientOnlyAsync(endpoint, ct).ConfigureAwait(false);
            await client.CreateInstanceAsync(name, image, imageServer, type, req.Ephemeral, req.Start, ct)
                .ConfigureAwait(false);

            string? ipv4 = null;
            string? ipv6 = null;
            var status = "Unknown";
            if (req.Start)
            {
                var deadline = DateTime.UtcNow.AddSeconds(Math.Clamp(req.WaitIpSeconds, 15, 300));
                while (DateTime.UtcNow < deadline)
                {
                    ct.ThrowIfCancellationRequested();
                    (ipv4, ipv6, status) = await client.GetPrimaryAddressesAsync(name, ct).ConfigureAwait(false);
                    if (!string.IsNullOrWhiteSpace(ipv4) || !string.IsNullOrWhiteSpace(ipv6))
                        break;
                    await Task.Delay(2000, ct).ConfigureAwait(false);
                }
            }
            else
            {
                var state = await client.GetPrimaryAddressesAsync(name, ct).ConfigureAwait(false);
                status = state.Status;
            }

            record.Ipv4 = ipv4;
            record.Ipv6 = ipv6;
            record.Status = status;
            record.LastError = string.IsNullOrWhiteSpace(ipv4) && req.Start && req.RegisterMeshHost
                ? "Instance started but no global IPv4 yet — refresh or connect manually"
                : null;

            if (req.RegisterMeshHost && !string.IsNullOrWhiteSpace(ipv4))
            {
                var host = new MeshHostRecord
                {
                    Id = $"incus-{record.Id}",
                    Alias = string.IsNullOrWhiteSpace(req.Alias) ? $"Incus · {name}" : req.Alias!,
                    Provider = MeshProviderKind.Ssh,
                    Hostname = ipv4!,
                    Port = sshPort,
                    Username = sshUser,
                    KeyPath = sshKey,
                    AuthKind = string.IsNullOrWhiteSpace(sshKey) ? MeshAuthKind.Agent : MeshAuthKind.PrivateKey,
                    ShowInNavTree = true,
                    RemoteRootPath = "/",
                    Notes = $"ephemeral:{endpoint.Alias}:{name}",
                };
                _orchestrator.UpsertHost(host);
                record.MeshHostId = host.Id;
            }

            _db.UpsertIncusEphemeral(record);
            endpoint.LastSeenUtc = DateTime.UtcNow;
            endpoint.LastError = null;
            _db.UpsertIncusEndpoint(endpoint);
            return record;
        }
        catch (Exception ex)
        {
            record.Status = "Error";
            record.LastError = ex.Message;
            _db.UpsertIncusEphemeral(record);
            endpoint.LastError = ex.Message;
            _db.UpsertIncusEndpoint(endpoint);
            throw;
        }
    }

    public async Task<IncusEphemeralInstanceRecord> RefreshAsync(string ephemeralId, CancellationToken ct = default)
    {
        var record = _db.GetIncusEphemeral(ephemeralId)
            ?? throw new InvalidOperationException("Ephemeral instance not found");
        var endpoint = _db.GetIncusEndpoint(record.EndpointId)
            ?? throw new InvalidOperationException("Incus endpoint not found");

        await using var client = await OpenClientOnlyAsync(endpoint, ct).ConfigureAwait(false);
        var (ipv4, ipv6, status) = await client.GetPrimaryAddressesAsync(record.InstanceName, ct).ConfigureAwait(false);
        record.Ipv4 = ipv4;
        record.Ipv6 = ipv6;
        record.Status = status;
        record.LastError = null;

        if (!string.IsNullOrWhiteSpace(record.MeshHostId) && !string.IsNullOrWhiteSpace(ipv4))
        {
            var host = _orchestrator.GetHost(record.MeshHostId!);
            if (host != null && !string.Equals(host.Hostname, ipv4, StringComparison.OrdinalIgnoreCase))
            {
                host.Hostname = ipv4!;
                _orchestrator.UpsertHost(host);
            }
        }
        else if (string.IsNullOrWhiteSpace(record.MeshHostId) && !string.IsNullOrWhiteSpace(ipv4))
        {
            var host = new MeshHostRecord
            {
                Id = $"incus-{record.Id}",
                Alias = string.IsNullOrWhiteSpace(record.Notes) ? $"Incus · {record.InstanceName}" : record.Notes!,
                Provider = MeshProviderKind.Ssh,
                Hostname = ipv4!,
                Port = endpoint.DefaultSshPort,
                Username = endpoint.DefaultSshUser,
                KeyPath = endpoint.DefaultSshKeyPath,
                AuthKind = string.IsNullOrWhiteSpace(endpoint.DefaultSshKeyPath) ? MeshAuthKind.Agent : MeshAuthKind.PrivateKey,
                ShowInNavTree = true,
                Notes = $"ephemeral:{endpoint.Alias}:{record.InstanceName}",
            };
            _orchestrator.UpsertHost(host);
            record.MeshHostId = host.Id;
        }

        _db.UpsertIncusEphemeral(record);
        return record;
    }

    public async Task DestroyAsync(string ephemeralId, CancellationToken ct = default)
    {
        var record = _db.GetIncusEphemeral(ephemeralId)
            ?? throw new InvalidOperationException("Ephemeral instance not found");
        var endpoint = _db.GetIncusEndpoint(record.EndpointId);

        if (endpoint != null)
        {
            try
            {
                await using var client = await OpenClientOnlyAsync(endpoint, ct).ConfigureAwait(false);
                try
                {
                    await client.UpdateInstanceStateAsync(record.InstanceName, "stop", force: true, timeout: 20, ct)
                        .ConfigureAwait(false);
                }
                catch (IncusApiException) { /* already stopped */ }
                try
                {
                    await client.DeleteInstanceAsync(record.InstanceName, force: true, ct).ConfigureAwait(false);
                }
                catch (IncusApiException ex) when (ex.StatusCode is 404) { /* gone */ }
            }
            catch (Exception ex)
            {
                record.LastError = ex.Message;
                _db.UpsertIncusEphemeral(record);
            }
        }

        if (!string.IsNullOrWhiteSpace(record.MeshHostId))
        {
            try { _orchestrator.DeleteHost(record.MeshHostId!); }
            catch { /* ignore */ }
        }

        _db.DeleteIncusEphemeral(ephemeralId);
    }

    private async Task<(IncusApiClient Client, IncusServerInfo Info)> OpenClientAsync(IncusEndpointRecord endpoint, CancellationToken ct)
    {
        var (cert, key) = EnsureIdentityPaths(endpoint.Id);
        return await IncusApiClient.ConnectAsync(endpoint, cert, key, ct).ConfigureAwait(false);
    }

    private async Task<IncusApiClient> OpenClientOnlyAsync(IncusEndpointRecord endpoint, CancellationToken ct)
    {
        var (client, _) = await OpenClientAsync(endpoint, ct).ConfigureAwait(false);
        return client;
    }

    private static (string CertPath, string KeyPath) EnsureIdentityPaths(string endpointId)
    {
        var dir = IdentityDir(endpointId);
        Directory.CreateDirectory(dir);
        var cert = Path.Combine(dir, "client.crt");
        var key = Path.Combine(dir, "client.key");
        IncusApiClient.EnsureClientIdentity(cert, key, out var loaded);
        loaded.Dispose();
        return (cert, key);
    }

    private static string IdentityDir(string endpointId) =>
        Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Mesh", "Incus", endpointId);

    private static string SanitizeInstanceName(string name)
    {
        var cleaned = new string(name.ToLowerInvariant().Select(c =>
            char.IsLetterOrDigit(c) || c is '-' ? c : '-').ToArray()).Trim('-');
        if (cleaned.Length == 0) cleaned = "bndz-ephemeral";
        if (cleaned.Length > 63) cleaned = cleaned[..63].TrimEnd('-');
        if (char.IsDigit(cleaned[0])) cleaned = "i-" + cleaned;
        return cleaned;
    }

    private static IncusEndpointRecord SanitizeEndpoint(IncusEndpointRecord e) => new()
    {
        Id = e.Id,
        Alias = e.Alias,
        ApiUrl = e.ApiUrl,
        ServerFingerprint = e.ServerFingerprint,
        Project = e.Project,
        DefaultImage = e.DefaultImage,
        DefaultImageServer = e.DefaultImageServer,
        DefaultInstanceType = e.DefaultInstanceType,
        DefaultSshUser = e.DefaultSshUser,
        DefaultSshPort = e.DefaultSshPort,
        DefaultSshKeyPath = e.DefaultSshKeyPath,
        AllowInsecureTls = e.AllowInsecureTls,
        Notes = e.Notes,
        LastError = e.LastError,
        LastSeenUtc = e.LastSeenUtc,
        Trusted = e.Trusted,
        TrustTokenPlain = null,
        ProtectedTrustToken = null,
    };
}
