using System.Net.Sockets;
using System.Text;
using Renci.SshNet;

namespace BNDZ.Services.Mesh.Incus;

/// <summary>
/// Launch / track / destroy Incus ephemeral instances and register them as Mesh SSH hosts.
/// Absorbs Incus client create→wait→state.network flow into Remote Mesh (not a new plugin).
/// </summary>
public sealed class MeshEphemeralService
{
    private readonly MeshDatabase _db;
    private readonly BndzMeshOrchestrator _orchestrator;
    private readonly MeshLocalVpsFactory _localFactory;

    public MeshEphemeralService(MeshDatabase db, BndzMeshOrchestrator orchestrator)
    {
        _db = db;
        _orchestrator = orchestrator;
        _localFactory = new MeshLocalVpsFactory(db, orchestrator);
    }

    public MeshLocalVpsFactory LocalFactory => _localFactory;

    public IReadOnlyList<IncusEndpointRecord> ListEndpoints()
    {
        _localFactory.EnsureVisible();
        return _db.ListIncusEndpoints().Select(SanitizeEndpoint).ToList();
    }

    public IncusEndpointRecord UpsertEndpoint(IncusEndpointRecord endpoint)
    {
        if (string.IsNullOrWhiteSpace(endpoint.ApiUrl))
            throw new InvalidOperationException("VPS host API URL is required (https://host:8443)");
        endpoint.ApiUrl = NormalizeAndValidateApiUrl(endpoint.ApiUrl);

        if (!string.IsNullOrEmpty(endpoint.TrustTokenPlain))
        {
            endpoint.ProtectedTrustToken = MeshCredentialVault.Protect(endpoint.TrustTokenPlain);
            endpoint.TrustTokenPlain = null;
        }

        EnsureIdentityPaths(endpoint.Id);
        _db.UpsertIncusEndpoint(endpoint);
        return SanitizeEndpoint(endpoint);
    }

    /// <summary>Reject empty hosts like https:// or https://:8443 which become DNS lookup for "https".</summary>
    internal static string NormalizeAndValidateApiUrl(string raw)
    {
        var url = (raw ?? "").Trim().TrimEnd('/');
        if (string.IsNullOrWhiteSpace(url))
            throw new InvalidOperationException("VPS host API URL is required (https://192.168.1.10:8443)");
        if (!url.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            && !url.StartsWith("http://", StringComparison.OrdinalIgnoreCase))
            url = "https://" + url;

        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || (uri.Scheme != Uri.UriSchemeHttps && uri.Scheme != Uri.UriSchemeHttp))
            throw new InvalidOperationException($"Invalid VPS host URL: {raw}");

        if (string.IsNullOrWhiteSpace(uri.Host)
            || uri.Host.Equals("https", StringComparison.OrdinalIgnoreCase)
            || uri.Host.Equals("http", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException(
                "VPS host URL is missing a hostname. Example: https://192.168.1.10:8443");

        // API base is origin only (Incus listens on host:8443).
        return uri.GetLeftPart(UriPartial.Authority);
    }

    public void DeleteEndpoint(string endpointId)
    {
        var linked = _db.ListIncusEphemeral().Where(i => i.EndpointId == endpointId).ToList();
        foreach (var inst in linked)
        {
            try { DestroyAsync(inst.Id, CancellationToken.None).GetAwaiter().GetResult(); }
            catch
            {
                try { PruneEphemeralRecordAsync(inst).GetAwaiter().GetResult(); }
                catch { /* best-effort */ }
            }
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
            ?? throw new InvalidOperationException("VPS host not found");
        try { endpoint.ApiUrl = NormalizeAndValidateApiUrl(endpoint.ApiUrl); }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                $"VPS host URL is invalid ({endpoint.ApiUrl}). Edit and set https://IP-or-hostname:8443. ({ex.Message})");
        }
        var (api, info) = await OpenClientAsync(endpoint, ct).ConfigureAwait(false);
        await using (api)
        {
            endpoint.Trusted = info.Trusted;
            endpoint.LastSeenUtc = DateTime.UtcNow;
            endpoint.LastError = null;
            if (!string.IsNullOrWhiteSpace(info.Fingerprint))
                endpoint.ServerFingerprint = info.Fingerprint;
            _db.UpsertIncusEndpoint(endpoint);
            return info;
        }
    }

    /// <summary>
    /// Connect over SSH, push BNDZ client cert into the remote trust store, then verify Trusted on the HTTPS API.
    /// </summary>
    public async Task<(IncusEndpointRecord Endpoint, IncusServerInfo Info)> BootstrapTrustAsync(
        IncusBootstrapRequest req,
        CancellationToken ct = default)
    {
        if (req == null) throw new ArgumentNullException(nameof(req));

        MeshHostRecord sshHost;
        var ephemeralSsh = false;
        if (!string.IsNullOrWhiteSpace(req.MeshHostId))
        {
            sshHost = _db.GetHost(req.MeshHostId!)
                ?? throw new InvalidOperationException("Mesh SSH host not found");
            if (sshHost.Provider != MeshProviderKind.Ssh)
                throw new InvalidOperationException("Bootstrap requires an SSH Mesh host");
        }
        else
        {
            if (string.IsNullOrWhiteSpace(req.SshHostname))
                throw new InvalidOperationException("SSH hostname is required (the Linux box running the VPS API)");
            if (string.IsNullOrWhiteSpace(req.SshUsername))
                throw new InvalidOperationException("SSH username is required");

            sshHost = new MeshHostRecord
            {
                Id = $"vps-ctrl-{Guid.NewGuid():N}"[..16],
                Alias = string.IsNullOrWhiteSpace(req.Alias) ? $"VPS · {req.SshHostname}" : req.Alias!,
                Provider = MeshProviderKind.Ssh,
                Hostname = req.SshHostname!.Trim(),
                Port = req.SshPort > 0 ? req.SshPort : 22,
                Username = req.SshUsername!.Trim(),
                KeyPath = string.IsNullOrWhiteSpace(req.SshKeyPath) ? null : ExpandUserPath(req.SshKeyPath!),
                AuthKind = !string.IsNullOrEmpty(req.SshPassword) && string.IsNullOrWhiteSpace(req.SshKeyPath)
                    ? MeshAuthKind.Password
                    : (!string.IsNullOrWhiteSpace(req.SshKeyPath) ? MeshAuthKind.PrivateKey : MeshAuthKind.Agent),
                PasswordPlain = req.SshPassword,
                ShowInNavTree = req.PersistControlHost,
                Notes = "mesh-vps-control",
            };
            ephemeralSsh = !req.PersistControlHost;
            if (req.PersistControlHost)
                _orchestrator.UpsertHost(sshHost);
        }

        var apiHost = sshHost.Hostname;
        var apiUrl = !string.IsNullOrWhiteSpace(req.ApiUrl)
            ? req.ApiUrl!
            : $"https://{apiHost}:{(req.ApiPort > 0 ? req.ApiPort : 8443)}";
        apiUrl = NormalizeAndValidateApiUrl(apiUrl);

        var endpoint = !string.IsNullOrWhiteSpace(req.EndpointId)
            ? (_db.GetIncusEndpoint(req.EndpointId!) ?? new IncusEndpointRecord { Id = req.EndpointId! })
            : new IncusEndpointRecord { Id = Guid.NewGuid().ToString("N")[..12] };

        endpoint.Alias = string.IsNullOrWhiteSpace(req.Alias)
            ? (string.IsNullOrWhiteSpace(endpoint.Alias) || endpoint.Alias == "VPS host" || endpoint.Alias == "Incus"
                ? $"VPS · {apiHost}"
                : endpoint.Alias)
            : req.Alias!;
        endpoint.ApiUrl = apiUrl;
        endpoint.AllowInsecureTls = req.AllowInsecureTls;
        endpoint.DefaultSshUser = string.IsNullOrWhiteSpace(endpoint.DefaultSshUser) ? "ubuntu" : endpoint.DefaultSshUser;
        if (string.IsNullOrWhiteSpace(endpoint.DefaultSshKeyPath) && !string.IsNullOrWhiteSpace(sshHost.KeyPath))
            endpoint.DefaultSshKeyPath = sshHost.KeyPath;
        endpoint.LastError = null;
        UpsertEndpoint(endpoint);

        var (certPath, _) = EnsureIdentityPaths(endpoint.Id);
        var certPem = await File.ReadAllTextAsync(certPath, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(certPem) || !certPem.Contains("BEGIN CERTIFICATE", StringComparison.Ordinal))
            throw new InvalidOperationException("Failed to prepare BNDZ client certificate for trust bootstrap");

        SshSftpMeshProvider? ownedProvider = null;
        SshSftpMeshProvider ssh;
        try
        {
            if (!ephemeralSsh && !string.IsNullOrWhiteSpace(req.MeshHostId))
            {
                await _orchestrator.EnsureConnectedAsync(sshHost.Id, ct).ConfigureAwait(false);
                ssh = _orchestrator.GetSshProvider(sshHost.Id);
            }
            else if (req.PersistControlHost && string.IsNullOrWhiteSpace(req.MeshHostId))
            {
                await _orchestrator.EnsureConnectedAsync(sshHost.Id, ct).ConfigureAwait(false);
                ssh = _orchestrator.GetSshProvider(sshHost.Id);
            }
            else
            {
                ownedProvider = new SshSftpMeshProvider();
                await ownedProvider.ConnectAsync(sshHost, ct).ConfigureAwait(false);
                ssh = ownedProvider;
            }

            var remoteCrt = $"/tmp/bndz-mesh-{endpoint.Id}.crt";
            var pemBytes = Encoding.UTF8.GetBytes(certPem.Replace("\r\n", "\n", StringComparison.Ordinal));
            await ssh.WriteBytesAsync(remoteCrt, pemBytes, ct).ConfigureAwait(false);

            var sshClient = ssh.GetSshClient()
                ?? throw new InvalidOperationException("SSH session unavailable after connect");

            var addResult = RunRemote(sshClient,
                BuildTrustAddCertificateScript(remoteCrt),
                TimeSpan.FromSeconds(45));

            if (!addResult.Success)
            {
                // Fallback: mint a one-shot trust token on the host, then POST our cert via HTTPS API.
                var tokenResult = RunRemote(sshClient,
                    BuildTrustTokenScript(),
                    TimeSpan.FromSeconds(45));
                var token = ExtractTrustToken(tokenResult.Stdout + "\n" + tokenResult.Stderr);
                if (string.IsNullOrWhiteSpace(token))
                {
                    throw new InvalidOperationException(
                        "Could not auto-trust via SSH. Need a user that can run `incus`/`lxc` (or passwordless sudo) on the host. "
                        + "SSH worked, but trust install failed:\n"
                        + Truncate(addResult.Stdout + "\n" + addResult.Stderr + "\n" + tokenResult.Stdout + "\n" + tokenResult.Stderr, 800));
                }

                endpoint.TrustTokenPlain = token;
                UpsertEndpoint(endpoint);
            }

            // Best-effort cleanup of the uploaded cert
            try { RunRemote(sshClient, $"rm -f {ShellQuote(remoteCrt)}", TimeSpan.FromSeconds(10)); }
            catch { /* ignore */ }
        }
        finally
        {
            if (ownedProvider != null)
            {
                try { ownedProvider.Disconnect(); } catch { /* ignore */ }
                await ownedProvider.DisposeAsync().ConfigureAwait(false);
            }
        }

        IncusServerInfo info;
        try
        {
            info = await TestEndpointAsync(endpoint.Id, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            endpoint.LastError = ex.Message;
            _db.UpsertIncusEndpoint(endpoint);
            throw new InvalidOperationException(
                $"SSH trust step finished but HTTPS API probe failed ({endpoint.ApiUrl}): {ex.Message}. "
                + "Check the API is listening on that host:port and Allow insecure TLS if using a lab cert.",
                ex);
        }

        if (!info.Trusted)
        {
            endpoint.Trusted = false;
            endpoint.LastError = "Client cert was installed but API still reports untrusted — check remote group membership / firewall.";
            _db.UpsertIncusEndpoint(endpoint);
            throw new InvalidOperationException(endpoint.LastError);
        }

        return (SanitizeEndpoint(_db.GetIncusEndpoint(endpoint.Id)!), info);
    }

    private static (bool Success, string Stdout, string Stderr, int Exit) RunRemote(
        SshClient client,
        string script,
        TimeSpan timeout)
    {
        using var cmd = client.CreateCommand(script);
        cmd.CommandTimeout = timeout;
        var stdout = cmd.Execute() ?? "";
        var stderr = cmd.Error ?? "";
        var exit = cmd.ExitStatus ?? -1;
        var ok = exit == 0 || stdout.Contains("BNDZ_TRUST_OK", StringComparison.Ordinal);
        return (ok, stdout, stderr, exit);
    }

    private static string BuildTrustAddCertificateScript(string remoteCrtPath)
    {
        var crt = ShellQuote(remoteCrtPath);
        // Try Incus then LXD CLI, with and without passwordless sudo. Local unix socket auth does the trust.
        return $$"""
            set +e
            CRT={crt}
            NAME='bndz-mesh'
            try_add() {
              BIN="$1"
              if command -v "$BIN" >/dev/null 2>&1; then
                "$BIN" config trust add-certificate "$CRT" --name "$NAME" >/tmp/bndz-trust-out.txt 2>/tmp/bndz-trust-err.txt && echo BNDZ_TRUST_OK && return 0
                "$BIN" config trust add-certificate "$CRT" "$NAME" >/tmp/bndz-trust-out.txt 2>/tmp/bndz-trust-err.txt && echo BNDZ_TRUST_OK && return 0
              fi
              return 1
            }
            try_add incus && exit 0
            try_add lxc && exit 0
            if command -v sudo >/dev/null 2>&1; then
              sudo -n true >/dev/null 2>&1 || true
              if command -v incus >/dev/null 2>&1; then
                sudo -n incus config trust add-certificate "$CRT" --name "$NAME" >/tmp/bndz-trust-out.txt 2>/tmp/bndz-trust-err.txt && echo BNDZ_TRUST_OK && exit 0
              fi
              if command -v lxc >/dev/null 2>&1; then
                sudo -n lxc config trust add-certificate "$CRT" --name "$NAME" >/tmp/bndz-trust-out.txt 2>/tmp/bndz-trust-err.txt && echo BNDZ_TRUST_OK && exit 0
              fi
            fi
            echo BNDZ_TRUST_FAIL
            cat /tmp/bndz-trust-err.txt 2>/dev/null
            exit 1
            """;
    }

    private static string BuildTrustTokenScript() =>
        """
        set +e
        NAME='bndz-mesh'
        emit_token() {
          BIN="$1"
          if command -v "$BIN" >/dev/null 2>&1; then
            OUT=$("$BIN" config trust add "$NAME" 2>/tmp/bndz-token-err.txt)
            echo "$OUT"
            echo "$OUT" | tr -d '\r' | awk 'NF{line=$0} END{if(line!="") print "BNDZ_TRUST_TOKEN=" line}'
            return 0
          fi
          return 1
        }
        emit_token incus && exit 0
        emit_token lxc && exit 0
        if command -v sudo >/dev/null 2>&1; then
          if command -v incus >/dev/null 2>&1; then
            OUT=$(sudo -n incus config trust add "$NAME" 2>/tmp/bndz-token-err.txt)
            echo "$OUT"
            echo "$OUT" | tr -d '\r' | awk 'NF{line=$0} END{if(line!="") print "BNDZ_TRUST_TOKEN=" line}'
            exit 0
          fi
        fi
        cat /tmp/bndz-token-err.txt 2>/dev/null
        exit 1
        """;

    private static string? ExtractTrustToken(string blob)
    {
        if (string.IsNullOrWhiteSpace(blob)) return null;
        foreach (var line in blob.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var t = line.Trim();
            if (t.StartsWith("BNDZ_TRUST_TOKEN=", StringComparison.Ordinal))
            {
                var v = t["BNDZ_TRUST_TOKEN=".Length..].Trim();
                if (v.Length >= 16) return v;
            }
        }
        // Last non-empty line that looks like a token (base64url / long opaque)
        string? last = null;
        foreach (var line in blob.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var t = line.Trim();
            if (t.Length < 24) continue;
            if (t.Contains(' ', StringComparison.Ordinal)) continue;
            if (t.StartsWith("Error", StringComparison.OrdinalIgnoreCase)) continue;
            last = t;
        }
        return last;
    }

    private static string ShellQuote(string value) =>
        "'" + (value ?? "").Replace("'", "'\"'\"'", StringComparison.Ordinal) + "'";

    private static string Truncate(string s, int max) =>
        string.IsNullOrEmpty(s) ? "" : (s.Length <= max ? s : s[..max] + "…");

    public async Task<IReadOnlyList<IncusImageAlias>> ListImageAliasesAsync(string endpointId, CancellationToken ct = default)
    {
        var endpoint = _db.GetIncusEndpoint(endpointId)
            ?? throw new InvalidOperationException("Incus endpoint not found");
        await using var client = await OpenClientOnlyAsync(endpoint, ct).ConfigureAwait(false);
        return await client.ListImageAliasesAsync(ct).ConfigureAwait(false);
    }

    public IReadOnlyList<IncusEphemeralInstanceRecord> ListEphemeral() => _db.ListIncusEphemeral();

    /// <summary>Refresh every tracked ephemeral against live Incus state (startup reconciliation).</summary>
    public async Task<IReadOnlyList<IncusEphemeralInstanceRecord>> ReconcileAllAsync(CancellationToken ct = default)
    {
        var results = new List<IncusEphemeralInstanceRecord>();
        foreach (var record in _db.ListIncusEphemeral().ToList())
        {
            if (string.Equals(record.Status, "Error", StringComparison.OrdinalIgnoreCase))
            {
                results.Add(record);
                continue;
            }
            if (IsLocalEphemeral(record))
            {
                try { results.Add(await RefreshLocalAsync(record, ct).ConfigureAwait(false)); }
                catch (Exception ex)
                {
                    record.LastError = ex.Message;
                    _db.UpsertIncusEphemeral(record);
                    results.Add(record);
                }
                continue;
            }
            try
            {
                results.Add(await RefreshAsync(record.Id, ct).ConfigureAwait(false));
            }
            catch (IncusApiException ex) when (ex.StatusCode == 404)
            {
                await PruneEphemeralRecordAsync(record).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                record.LastError = ex.Message;
                _db.UpsertIncusEphemeral(record);
                results.Add(record);
            }
        }
        return results;
    }

    public async Task<IReadOnlyList<IncusInstanceSummary>> ListServerInstancesAsync(string endpointId, CancellationToken ct = default)
    {
        if (IsLocalEndpointId(endpointId))
            return Array.Empty<IncusInstanceSummary>();
        var endpoint = _db.GetIncusEndpoint(endpointId)
            ?? throw new InvalidOperationException("Incus endpoint not found");
        await using var client = await OpenClientOnlyAsync(endpoint, ct).ConfigureAwait(false);
        return await client.ListInstancesAsync(ct).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<IncusProfileSummary>> ListProfilesAsync(string endpointId, CancellationToken ct = default)
    {
        if (IsLocalEndpointId(endpointId))
            return Array.Empty<IncusProfileSummary>();
        var endpoint = _db.GetIncusEndpoint(endpointId)
            ?? throw new InvalidOperationException("Incus endpoint not found");
        await using var client = await OpenClientOnlyAsync(endpoint, ct).ConfigureAwait(false);
        return await client.ListProfilesAsync(ct).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<IncusNetworkSummary>> ListNetworksAsync(string endpointId, CancellationToken ct = default)
    {
        if (IsLocalEndpointId(endpointId))
            return Array.Empty<IncusNetworkSummary>();
        var endpoint = _db.GetIncusEndpoint(endpointId)
            ?? throw new InvalidOperationException("Incus endpoint not found");
        await using var client = await OpenClientOnlyAsync(endpoint, ct).ConfigureAwait(false);
        return await client.ListNetworksAsync(ct).ConfigureAwait(false);
    }

    public async Task<IncusInstanceDetail> GetInstanceDetailAsync(string ephemeralId, CancellationToken ct = default)
    {
        var (record, endpoint, client) = await OpenForEphemeralAsync(ephemeralId, ct).ConfigureAwait(false);
        await using (client)
        {
            var (detail, _) = await client.GetInstanceAsync(record.InstanceName, ct).ConfigureAwait(false);
            return detail;
        }
    }

    public async Task<IncusInstanceDetail> UpdateInstanceDetailAsync(string ephemeralId, IncusInstancePut put, string? etag = null, CancellationToken ct = default)
    {
        var (record, endpoint, client) = await OpenForEphemeralAsync(ephemeralId, ct).ConfigureAwait(false);
        await using (client)
        {
            await client.UpdateInstanceAsync(record.InstanceName, put, etag, ct).ConfigureAwait(false);
            var (detail, _) = await client.GetInstanceAsync(record.InstanceName, ct).ConfigureAwait(false);
            return detail;
        }
    }

    public async Task<IReadOnlyList<IncusSnapshotSummary>> ListSnapshotsAsync(string ephemeralId, CancellationToken ct = default)
    {
        var (record, _, client) = await OpenForEphemeralAsync(ephemeralId, ct).ConfigureAwait(false);
        await using (client)
            return await client.ListSnapshotsAsync(record.InstanceName, ct).ConfigureAwait(false);
    }

    public async Task<IReadOnlyList<IncusSnapshotSummary>> CreateSnapshotAsync(string ephemeralId, string name, bool stateful = false, CancellationToken ct = default)
    {
        var (record, _, client) = await OpenForEphemeralAsync(ephemeralId, ct).ConfigureAwait(false);
        await using (client)
        {
            var snapName = SanitizeInstanceName(name);
            await client.CreateSnapshotAsync(record.InstanceName, snapName, stateful, ct).ConfigureAwait(false);
            return await client.ListSnapshotsAsync(record.InstanceName, ct).ConfigureAwait(false);
        }
    }

    public async Task<IReadOnlyList<IncusSnapshotSummary>> DeleteSnapshotAsync(string ephemeralId, string name, CancellationToken ct = default)
    {
        var (record, _, client) = await OpenForEphemeralAsync(ephemeralId, ct).ConfigureAwait(false);
        await using (client)
        {
            await client.DeleteSnapshotAsync(record.InstanceName, name, ct).ConfigureAwait(false);
            return await client.ListSnapshotsAsync(record.InstanceName, ct).ConfigureAwait(false);
        }
    }

    public async Task RestoreSnapshotAsync(string ephemeralId, string name, bool diskOnly = false, CancellationToken ct = default)
    {
        var (record, _, client) = await OpenForEphemeralAsync(ephemeralId, ct).ConfigureAwait(false);
        await using (client)
            await client.RestoreSnapshotAsync(record.InstanceName, name, diskOnly, ct).ConfigureAwait(false);
        await RefreshAsync(ephemeralId, ct).ConfigureAwait(false);
    }

    private async Task<(IncusEphemeralInstanceRecord Record, IncusEndpointRecord Endpoint, IncusApiClient Client)> OpenForEphemeralAsync(
        string ephemeralId, CancellationToken ct)
    {
        var record = _db.GetIncusEphemeral(ephemeralId)
            ?? throw new InvalidOperationException("Ephemeral instance not found");
        var endpoint = _db.GetIncusEndpoint(record.EndpointId)
            ?? throw new InvalidOperationException("Incus endpoint not found");
        var client = await OpenClientOnlyAsync(endpoint, ct).ConfigureAwait(false);
        return (record, endpoint, client);
    }

    public async Task<IncusEphemeralInstanceRecord> SetInstanceActionAsync(string ephemeralId, string action, CancellationToken ct = default)
    {
        var record = _db.GetIncusEphemeral(ephemeralId)
            ?? throw new InvalidOperationException("Ephemeral instance not found");
        var normalized = action.Trim().ToLowerInvariant();
        if (normalized is not ("start" or "stop" or "restart" or "freeze" or "unfreeze"))
            throw new InvalidOperationException($"Unsupported Incus action: {action}");

        if (IsLocalEphemeral(record))
        {
            if (normalized is "freeze" or "unfreeze")
                throw new InvalidOperationException("Freeze is not supported for local Podman VPS");
            await _localFactory.SetLocalActionAsync(ephemeralId, normalized, ct).ConfigureAwait(false);
            return await RefreshAsync(ephemeralId, ct).ConfigureAwait(false);
        }

        var endpoint = _db.GetIncusEndpoint(record.EndpointId)
            ?? throw new InvalidOperationException("Incus endpoint not found");
        await using var client = await OpenClientOnlyAsync(endpoint, ct).ConfigureAwait(false);
        try
        {
            await client.UpdateInstanceStateAsync(record.InstanceName, normalized, force: true, timeout: 60, ct)
                .ConfigureAwait(false);
        }
        catch (IncusApiException ex) when (ex.StatusCode == 404)
        {
            await PruneEphemeralRecordAsync(record).ConfigureAwait(false);
            throw new InvalidOperationException("Instance no longer exists on Incus server");
        }
        return await RefreshAsync(ephemeralId, ct).ConfigureAwait(false);
    }

    public async Task<IncusEphemeralInstanceRecord> ImportInstanceAsync(
        string endpointId,
        string instanceName,
        string? alias = null,
        bool registerMeshHost = true,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(instanceName))
            throw new InvalidOperationException("instanceName is required");
        var endpoint = _db.GetIncusEndpoint(endpointId)
            ?? throw new InvalidOperationException("Incus endpoint not found");
        var name = SanitizeInstanceName(instanceName);

        var existing = _db.ListIncusEphemeral()
            .FirstOrDefault(i => i.EndpointId == endpointId
                && string.Equals(i.InstanceName, name, StringComparison.OrdinalIgnoreCase));
        if (existing != null)
            return await RefreshAsync(existing.Id, ct).ConfigureAwait(false);

        await using var client = await OpenClientOnlyAsync(endpoint, ct).ConfigureAwait(false);
        IncusInstanceSummary? summary;
        try
        {
            var all = await client.ListInstancesAsync(ct).ConfigureAwait(false);
            summary = all.FirstOrDefault(i => string.Equals(i.Name, name, StringComparison.OrdinalIgnoreCase))
                ?? throw new InvalidOperationException($"Instance '{name}' not found on Incus server");
        }
        catch (IncusApiException ex) when (ex.StatusCode == 404)
        {
            throw new InvalidOperationException($"Instance '{name}' not found on Incus server");
        }

        var (ipv4, ipv6, status) = await client.GetPrimaryAddressesAsync(name, ct).ConfigureAwait(false);
        var record = new IncusEphemeralInstanceRecord
        {
            EndpointId = endpointId,
            InstanceName = name,
            Status = status,
            Ipv4 = ipv4,
            Ipv6 = ipv6,
            ImageAlias = "",
            InstanceType = summary?.Type ?? "container",
            Ephemeral = summary?.Ephemeral ?? false,
            Notes = alias ?? $"Incus · {name}",
        };
        _db.UpsertIncusEphemeral(record);

        if (registerMeshHost && (!string.IsNullOrWhiteSpace(ipv4) || !string.IsNullOrWhiteSpace(ipv6)))
        {
            var meshHost = !string.IsNullOrWhiteSpace(ipv4) ? ipv4 : ipv6;
            var host = new MeshHostRecord
            {
                Id = $"incus-{record.Id}",
                Alias = string.IsNullOrWhiteSpace(alias) ? $"Incus · {name}" : alias!,
                Provider = MeshProviderKind.Ssh,
                Hostname = meshHost!,
                Port = endpoint.DefaultSshPort,
                Username = endpoint.DefaultSshUser,
                KeyPath = endpoint.DefaultSshKeyPath,
                AuthKind = string.IsNullOrWhiteSpace(endpoint.DefaultSshKeyPath) ? MeshAuthKind.Agent : MeshAuthKind.PrivateKey,
                ShowInNavTree = true,
                RemoteRootPath = "/",
                Notes = $"imported:{endpoint.Alias}:{name}",
            };
            _orchestrator.UpsertHost(host);
            record.MeshHostId = host.Id;
            _db.UpsertIncusEphemeral(record);
        }

        return await RefreshAsync(record.Id, ct).ConfigureAwait(false);
    }

    public async Task<IncusEphemeralInstanceRecord> LaunchAsync(IncusLaunchRequest req, CancellationToken ct = default)
    {
        // Default path: BNDZ is the host — create a local temporary VPS on this PC.
        var endpointId = req.EndpointId?.Trim() ?? "";
        if (string.IsNullOrWhiteSpace(endpointId)
            || string.Equals(endpointId, MeshLocalVpsFactory.LocalEndpointId, StringComparison.OrdinalIgnoreCase)
            || string.Equals(endpointId, "local", StringComparison.OrdinalIgnoreCase))
        {
            var cpus = 2;
            var memory = "2GiB";
            if (req.Config != null)
            {
                if (req.Config.TryGetValue("limits.cpu", out var cpuRaw) && int.TryParse(cpuRaw, out var c) && c > 0)
                    cpus = c;
                if (req.Config.TryGetValue("limits.memory", out var memRaw) && !string.IsNullOrWhiteSpace(memRaw))
                    memory = memRaw;
            }
            return await _localFactory.CreateAsync(
                    req.Alias,
                    string.IsNullOrWhiteSpace(req.ImageAlias) ? "lscr.io/linuxserver/openssh-server:latest" : req.ImageAlias!,
                    cpus,
                    memory,
                    req.Ephemeral,
                    ct)
                .ConfigureAwait(false);
        }

        if (string.IsNullOrWhiteSpace(req.EndpointId))
            throw new InvalidOperationException("endpointId is required");
        var endpoint = _db.GetIncusEndpoint(req.EndpointId)
            ?? throw new InvalidOperationException("VPS host not found — add and trust a host first");

        // Fail fast with a clear message instead of DNS lookup for "https".
        try { NormalizeAndValidateApiUrl(endpoint.ApiUrl); }
        catch (Exception ex)
        {
            throw new InvalidOperationException(
                $"VPS host URL is invalid ({endpoint.ApiUrl}). Edit the host and set a real address like https://192.168.1.10:8443. ({ex.Message})");
        }

        if (!endpoint.Trusted)
            throw new InvalidOperationException(
                "VPS host is not trusted yet. Use Connect & trust (SSH) — BNDZ installs its cert on the host automatically.");

        var name = string.IsNullOrWhiteSpace(req.Name)
            ? $"bndz-{DateTime.UtcNow:yyMMddHHmmss}-{Random.Shared.Next(0x1000, 0xFFFF):x}"
            : SanitizeInstanceName(req.Name!);
        var image = string.IsNullOrWhiteSpace(req.ImageAlias) ? endpoint.DefaultImage : req.ImageAlias!;
        image = PreferCloudImageAlias(image);
        var imageServer = string.IsNullOrWhiteSpace(req.ImageServer) ? endpoint.DefaultImageServer : req.ImageServer!;
        var type = string.IsNullOrWhiteSpace(req.InstanceType) ? endpoint.DefaultInstanceType : req.InstanceType!;
        var sshUser = string.IsNullOrWhiteSpace(req.SshUser) ? endpoint.DefaultSshUser : req.SshUser!;
        var sshPort = req.SshPort is > 0 ? req.SshPort.Value : endpoint.DefaultSshPort;
        var sshKey = string.IsNullOrWhiteSpace(req.SshKeyPath) ? endpoint.DefaultSshKeyPath : req.SshKeyPath;
        var cloudInit = BuildSshCloudInit(sshUser, sshKey);

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
            Dictionary<string, Dictionary<string, string>>? devices = null;
            if (!string.IsNullOrWhiteSpace(req.Network))
            {
                devices = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase)
                {
                    ["eth0"] = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
                    {
                        ["type"] = "nic",
                        ["network"] = req.Network!,
                        ["name"] = "eth0",
                    },
                };
            }
            await client.CreateInstanceAsync(
                    name, image, imageServer, type, req.Ephemeral, req.Start, cloudInit,
                    profiles: req.Profiles, devices: devices, config: req.Config, ct: ct)
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
            var meshHost = !string.IsNullOrWhiteSpace(ipv4) ? ipv4 : ipv6;

            if (req.Start && req.RegisterMeshHost && !string.IsNullOrWhiteSpace(meshHost))
            {
                var sshReady = await WaitForSshPortAsync(meshHost!, sshPort, ct, Math.Clamp(req.WaitIpSeconds, 15, 300))
                    .ConfigureAwait(false);
                if (!sshReady)
                    record.LastError = "IP assigned but SSH port not open yet — cloud-init may still be running; Refresh in a moment";
            }

            if (string.IsNullOrWhiteSpace(meshHost) && req.Start && req.RegisterMeshHost)
                record.LastError ??= "Instance started but no global IP yet — refresh or connect manually";
            else if (cloudInit == null && req.RegisterMeshHost)
                record.LastError ??= "Launched without cloud-init SSH key — set Default SSH key on the VPS host for Mesh login";

            if (req.RegisterMeshHost && !string.IsNullOrWhiteSpace(meshHost))
            {
                var host = new MeshHostRecord
                {
                    Id = $"incus-{record.Id}",
                    Alias = string.IsNullOrWhiteSpace(req.Alias) ? $"VPS · {name}" : req.Alias!,
                    Provider = MeshProviderKind.Ssh,
                    Hostname = meshHost!,
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
            PersistEndpointConnectState(endpoint, trusted: true);
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

        if (IsLocalEphemeral(record))
            return await RefreshLocalAsync(record, ct).ConfigureAwait(false);

        var endpoint = _db.GetIncusEndpoint(record.EndpointId)
            ?? throw new InvalidOperationException("Incus endpoint not found");

        await using var client = await OpenClientOnlyAsync(endpoint, ct).ConfigureAwait(false);
        try
        {
            var (ipv4, ipv6, status) = await client.GetPrimaryAddressesAsync(record.InstanceName, ct).ConfigureAwait(false);
            record.Ipv4 = ipv4;
            record.Ipv6 = ipv6;
            record.Status = status;
            record.LastError = null;
        }
        catch (IncusApiException ex) when (ex.StatusCode == 404)
        {
            await PruneEphemeralRecordAsync(record).ConfigureAwait(false);
            throw new InvalidOperationException("Instance no longer exists on Incus server");
        }

        var meshHost = !string.IsNullOrWhiteSpace(record.Ipv4) ? record.Ipv4 : record.Ipv6;
        if (!string.IsNullOrWhiteSpace(meshHost))
        {
            var sshReady = await WaitForSshPortAsync(meshHost!, endpoint.DefaultSshPort, ct, 45).ConfigureAwait(false);
            if (!sshReady)
                record.LastError = "IP assigned but SSH port not open yet — cloud-init may still be running";
        }

        if (!string.IsNullOrWhiteSpace(record.MeshHostId) && (!string.IsNullOrWhiteSpace(record.Ipv4) || !string.IsNullOrWhiteSpace(record.Ipv6)))
        {
            var host = _orchestrator.GetHost(record.MeshHostId!);
            var nextHost = !string.IsNullOrWhiteSpace(record.Ipv4) ? record.Ipv4! : record.Ipv6!;
            if (host != null && !string.Equals(host.Hostname, nextHost, StringComparison.OrdinalIgnoreCase))
            {
                host.Hostname = nextHost;
                _orchestrator.UpsertHost(host);
            }
        }
        else if (string.IsNullOrWhiteSpace(record.MeshHostId) && (!string.IsNullOrWhiteSpace(record.Ipv4) || !string.IsNullOrWhiteSpace(record.Ipv6)))
        {
            var nextHost = !string.IsNullOrWhiteSpace(record.Ipv4) ? record.Ipv4! : record.Ipv6!;
            var host = new MeshHostRecord
            {
                Id = $"incus-{record.Id}",
                Alias = string.IsNullOrWhiteSpace(record.Notes) ? $"Incus · {record.InstanceName}" : record.Notes!,
                Provider = MeshProviderKind.Ssh,
                Hostname = nextHost,
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
        PersistEndpointConnectState(endpoint, trusted: true);
        return record;
    }

    public async Task DestroyAsync(string ephemeralId, CancellationToken ct = default)
    {
        var record = _db.GetIncusEphemeral(ephemeralId)
            ?? throw new InvalidOperationException("VPS instance not found");

        // Local factory instances (Podman) — never hang on remote Incus/DNS.
        if (IsLocalEphemeral(record))
        {
            try { await _localFactory.DestroyLocalAsync(ephemeralId, ct).ConfigureAwait(false); }
            catch
            {
                try { await PruneEphemeralRecordAsync(record).ConfigureAwait(false); }
                catch { /* best-effort */ }
            }
            return;
        }

        var endpoint = _db.GetIncusEndpoint(record.EndpointId);

        if (endpoint != null)
        {
            try
            {
                using var shortCt = CancellationTokenSource.CreateLinkedTokenSource(ct);
                shortCt.CancelAfter(TimeSpan.FromSeconds(8));
                await using var client = await OpenClientOnlyAsync(endpoint, shortCt.Token).ConfigureAwait(false);
                try
                {
                    await client.UpdateInstanceStateAsync(record.InstanceName, "stop", force: true, timeout: 12, shortCt.Token)
                        .ConfigureAwait(false);
                }
                catch (IncusApiException) { /* already stopped */ }
                catch (OperationCanceledException) { /* timed out */ }

                try
                {
                    await client.DeleteInstanceAsync(record.InstanceName, force: true, shortCt.Token).ConfigureAwait(false);
                }
                catch (IncusApiException ex) when (ex.StatusCode is 404)
                {
                    /* already gone on server */
                }
                catch (OperationCanceledException) { /* timed out — prune local below */ }
            }
            catch (Exception ex)
            {
                // Remote unreachable / bad URL — still remove local Mesh tracking so Destroy always works.
                System.Diagnostics.Debug.WriteLine($"[MeshVPS] Destroy remote failed, pruning local: {ex.Message}");
            }
        }

        await PruneEphemeralRecordAsync(record).ConfigureAwait(false);
    }

    private async Task PruneEphemeralRecordAsync(IncusEphemeralInstanceRecord record)
    {
        if (!string.IsNullOrWhiteSpace(record.MeshHostId))
        {
            try { _orchestrator.DeleteHost(record.MeshHostId!); }
            catch { /* ignore */ }
        }
        _db.DeleteIncusEphemeral(record.Id);
        await Task.CompletedTask;
    }

    private async Task<(IncusApiClient Client, IncusServerInfo Info)> OpenClientAsync(IncusEndpointRecord endpoint, CancellationToken ct)
    {
        var (cert, key) = EnsureIdentityPaths(endpoint.Id);
        return await IncusApiClient.ConnectAsync(endpoint, cert, key, ct).ConfigureAwait(false);
    }

	private async Task<IncusApiClient> OpenClientOnlyAsync(IncusEndpointRecord endpoint, CancellationToken ct)
    {
        if (IsLocalEndpointId(endpoint.Id))
            throw new InvalidOperationException("Local Podman VPS does not use the Incus HTTP API");
        var (client, info) = await OpenClientAsync(endpoint, ct).ConfigureAwait(false);
        PersistEndpointConnectState(endpoint, info.Trusted, info.Fingerprint);
        return client;
    }

    private void PersistEndpointConnectState(IncusEndpointRecord endpoint, bool? trusted = null, string? fingerprint = null)
    {
        var dirty = false;
        if (trusted == true && !endpoint.Trusted)
        {
            endpoint.Trusted = true;
            dirty = true;
        }
        if (!string.IsNullOrWhiteSpace(fingerprint)
            && !string.Equals(endpoint.ServerFingerprint, fingerprint, StringComparison.OrdinalIgnoreCase))
        {
            endpoint.ServerFingerprint = fingerprint;
            dirty = true;
        }
        if (!dirty) return;
        endpoint.LastSeenUtc = DateTime.UtcNow;
        endpoint.LastError = null;
        _db.UpsertIncusEndpoint(endpoint);
    }

    private static async Task<bool> WaitForSshPortAsync(string host, int port, CancellationToken ct, int maxSeconds)
    {
        if (port <= 0) port = 22;
        var deadline = DateTime.UtcNow.AddSeconds(maxSeconds);
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            if (await TryConnectTcpAsync(host, port, ct).ConfigureAwait(false))
                return true;
            await Task.Delay(2000, ct).ConfigureAwait(false);
        }
        return false;
    }

    private static async Task<bool> TryConnectTcpAsync(string host, int port, CancellationToken ct)
    {
        try
        {
            using var tcp = new TcpClient();
            using var linked = CancellationTokenSource.CreateLinkedTokenSource(ct);
            linked.CancelAfter(TimeSpan.FromSeconds(4));
            await tcp.ConnectAsync(host, port, linked.Token).ConfigureAwait(false);
            return tcp.Connected;
        }
        catch
        {
            return false;
        }
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

    private static string PreferCloudImageAlias(string image)
    {
        var trimmed = image.Trim().TrimEnd('/');
        if (trimmed.EndsWith("/cloud", StringComparison.OrdinalIgnoreCase)) return trimmed;
        // images.linuxcontainers.org cloud-init variants use /cloud suffix
        if (trimmed.Contains("ubuntu/", StringComparison.OrdinalIgnoreCase)
            || trimmed.Contains("debian/", StringComparison.OrdinalIgnoreCase)
            || trimmed.Contains("fedora/", StringComparison.OrdinalIgnoreCase)
            || trimmed.Contains("archlinux/", StringComparison.OrdinalIgnoreCase))
            return trimmed + "/cloud";
        return trimmed;
    }

    /// <summary>Build cloud-init user-data that injects the Mesh SSH public key on first boot.</summary>
    private static string? BuildSshCloudInit(string sshUser, string? sshKeyPath)
    {
        var pub = TryReadSshPublicKey(sshKeyPath);
        if (string.IsNullOrWhiteSpace(pub)) return null;
        var user = string.IsNullOrWhiteSpace(sshUser) ? "ubuntu" : sshUser.Trim();
        var quotedPub = YamlQuote(pub.Trim());
        // YAML literal for Incus cloud-init.user-data
        return
            "#cloud-config\n" +
            "users:\n" +
            $"  - name: {user}\n" +
            "    ssh_authorized_keys:\n" +
            $"      - {quotedPub}\n" +
            "    lock_passwd: true\n" +
            "packages:\n" +
            "  - openssh-server\n" +
            "runcmd:\n" +
            "  - [ sh, -c, \"systemctl enable --now ssh || systemctl enable --now sshd || true\" ]\n";
    }

    private static string YamlQuote(string value) =>
        "\"" + value.Replace("\\", "\\\\", StringComparison.Ordinal)
            .Replace("\"", "\\\"", StringComparison.Ordinal) + "\"";

    private static string? TryReadSshPublicKey(string? keyPath)
    {
        if (string.IsNullOrWhiteSpace(keyPath)) return null;
        try
        {
            var expanded = ExpandUserPath(keyPath!);
            var pubPath = expanded.EndsWith(".pub", StringComparison.OrdinalIgnoreCase)
                ? expanded
                : expanded + ".pub";
            if (!File.Exists(pubPath)) return null;
            var line = File.ReadAllLines(pubPath)
                .Select(l => l.Trim())
                .FirstOrDefault(l => l.Length > 0 && !l.StartsWith('#')
                    && (l.StartsWith("ssh-", StringComparison.Ordinal)
                        || l.StartsWith("ecdsa-", StringComparison.Ordinal)
                        || l.StartsWith("sk-", StringComparison.Ordinal)));
            return string.IsNullOrWhiteSpace(line) ? null : line;
        }
        catch
        {
            return null;
        }
    }

    private static string ExpandUserPath(string path)
    {
        if (path.StartsWith("~/") || path.StartsWith("~\\"))
        {
            var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            return Path.Combine(home, path[2..].Replace('/', Path.DirectorySeparatorChar));
        }
        return path;
    }

    private static string SanitizeInstanceName(string name)
    {
        var cleaned = new string(name.ToLowerInvariant().Select(c =>
            char.IsLetterOrDigit(c) || c is '-' ? c : '-').ToArray()).Trim('-');
        if (cleaned.Length == 0) cleaned = "bndz-ephemeral";
        if (cleaned.Length > 63) cleaned = cleaned[..63].TrimEnd('-');
        if (char.IsDigit(cleaned[0])) cleaned = "i-" + cleaned;
        return cleaned;
    }

    private static bool IsLocalEphemeral(IncusEphemeralInstanceRecord record) =>
        string.Equals(record.EndpointId, MeshLocalVpsFactory.LocalEndpointId, StringComparison.OrdinalIgnoreCase)
        || string.Equals(record.EndpointId, "local", StringComparison.OrdinalIgnoreCase)
        || string.Equals(record.Ipv4, "127.0.0.1", StringComparison.OrdinalIgnoreCase)
        || (!string.IsNullOrWhiteSpace(record.MeshHostId)
            && record.MeshHostId.StartsWith("localvps-", StringComparison.OrdinalIgnoreCase));

    private static bool IsLocalEndpointId(string endpointId) =>
        string.Equals(endpointId, MeshLocalVpsFactory.LocalEndpointId, StringComparison.OrdinalIgnoreCase)
        || string.Equals(endpointId, "local", StringComparison.OrdinalIgnoreCase);

    private async Task<IncusEphemeralInstanceRecord> RefreshLocalAsync(
        IncusEphemeralInstanceRecord record,
        CancellationToken ct)
    {
        record.LastError = null;
        if (!string.IsNullOrWhiteSpace(record.MeshHostId))
        {
            var host = _orchestrator.GetHost(record.MeshHostId!);
            if (host != null && host.Port > 0)
            {
                var sshReady = await WaitForSshPortAsync("127.0.0.1", host.Port, ct, 8).ConfigureAwait(false);
                record.Status = sshReady ? "Running" : "Starting";
                if (!sshReady)
                    record.LastError = "SSH port not open yet — cloud-init may still be running";
            }
        }
        _db.UpsertIncusEphemeral(record);
        return record;
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
