using System.Diagnostics;
using System.Text.Json;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Cloud Drive control plane for BNDZ-Native. Registry lives under
/// %LocalAppData%\BNDZ\CloudDrives. Fly tokens and private keys are DPAPI blobs.
/// </summary>
public sealed class CloudDriveService
{
    public static CloudDriveService Shared { get; } = new();

    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly FlyMachinesCloudDriveProvider _fly = new();
    private readonly LocalMicroVmCloudDriveProvider _local = new();
    private readonly string _dir;
    private readonly string _registryPath;
    private Store _store = new();

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    public CloudDriveService()
    {
        var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (string.IsNullOrWhiteSpace(root)) root = Path.GetTempPath();
        _dir = Path.Combine(root, "BNDZ", "CloudDrives");
        _registryPath = Path.Combine(_dir, "registry.json");
        Load();
    }

    public async Task<object> HandleAsync(string type, JsonElement payload, CancellationToken ct = default)
    {
        await _gate.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            return type switch
            {
                "CLOUD_DRIVE_PROBE" => ProbePayload(includeTokenCheck: false),
                "CLOUD_DRIVE_LIST" => new { ok = true, drives = Dtos(), probe = ProbeSnapshot() },
                "CLOUD_DRIVE_SET_TOKEN" => await SetTokenAsync(Str(payload, "token") ?? Str(payload, "flyToken"), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_CLEAR_TOKEN" => ClearToken(),
                "CLOUD_DRIVE_CREATE" => await CreateAsync(payload, ct).ConfigureAwait(false),
                "CLOUD_DRIVE_START" => await MutateAsync(Str(payload, "id"), (d, token) => ProviderFor(d).StartAsync(d, token, ct), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_STOP" => await MutateAsync(Str(payload, "id"), (d, token) => ProviderFor(d).StopAsync(d, token, ct), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_REFRESH" => await MutateAsync(Str(payload, "id"), (d, token) => ProviderFor(d).RefreshAsync(d, token, ct), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_DELETE" => await DeleteAsync(Str(payload, "id"), Str(payload, "confirmName"), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_CONNECTION" => Connection(Str(payload, "id")),
                "CLOUD_DRIVE_SET_TUNNEL_TOKEN" => SetTunnelToken(Str(payload, "id"), Str(payload, "tunnelToken") ?? Str(payload, "token")),
                "CLOUD_DRIVE_CLEAR_TUNNEL_TOKEN" => ClearTunnelToken(Str(payload, "id")),
                "CLOUD_DRIVE_TUNNEL_START" => StartTunnel(Str(payload, "id")),
                "CLOUD_DRIVE_TUNNEL_STOP" => StopTunnel(Str(payload, "id")),
                "CLOUD_DRIVE_SET_TUNNEL_HOSTNAME" => SetTunnelHostname(Str(payload, "id"), Str(payload, "hostname")),
                "CLOUD_DRIVE_SET_PUBLIC_DOMAIN" => await SetPublicDomainAsync(Str(payload, "domain") ?? Str(payload, "publicBaseDomain"), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_SET_CLOUDFLARE_TOKEN" => await SetCloudflareTokenAsync(Str(payload, "token") ?? Str(payload, "cloudflareToken"), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_CLEAR_CLOUDFLARE_TOKEN" => ClearCloudflareToken(),
                "CLOUD_DRIVE_PUBLISH" => await PublishOneAsync(Str(payload, "id"), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_SET_PLACEMENT_PREF" => SetPlacementPref(Str(payload, "placement")),
                "CLOUD_DRIVE_ENABLE_LOCAL" => EnableLocal(),
                "CLOUD_DRIVE_REVEAL_FTP_PASSWORD" => RevealFtpPassword(Str(payload, "id")),
                "CLOUD_DRIVE_SNAPSHOT_CREATE" => await SnapshotAsync(Str(payload, "id"), (d, token) => ProviderFor(d).CreateSnapshotAsync(d, token, ct), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_SNAPSHOT_LIST" => await SnapshotAsync(Str(payload, "id"), (d, token) => ProviderFor(d).ListSnapshotsAsync(d, token, ct), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_SNAPSHOT_RESTORE" => await SnapshotAsync(Str(payload, "id"), (d, token) => ProviderFor(d).RestoreSnapshotAsync(d, Str(payload, "snapshotId") ?? "", token, ct), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_DROP_PREVIOUS_VOLUME" => await SnapshotAsync(Str(payload, "id"), (d, token) => ProviderFor(d).DropPreviousVolumeAsync(d, token, ct), ct).ConfigureAwait(false),
                "CLOUD_DRIVE_EXPORT" => ExportLocal(Str(payload, "id"), Str(payload, "destPath"), ct),
                "CLOUD_DRIVE_OPEN_EXISTING" => OpenExisting(Str(payload, "diskPath")),
                _ => new { ok = false, error = "Unknown Cloud Drive request." },
            };
        }
        catch (Exception ex)
        {
            return new { ok = false, error = CloudDriveSecrets.Redact(ex.Message) };
        }
        finally
        {
            _gate.Release();
        }
    }

    private object ProbePayload(bool includeTokenCheck) => new { ok = true, probe = ProbeSnapshot() };

    private CloudDriveProbe ProbeSnapshot()
    {
        var local = _local.Probe();
        var cloudflared = CloudDriveTunnel.FindCloudflared();
        local.CloudflaredPresent = cloudflared != null;
        local.CloudflaredMessage = cloudflared != null
            ? "cloudflared is installed. Away access for This PC drives can start a Cloudflare Tunnel. Cloudflare Containers are not used."
            : "Install cloudflared (Cloudflare Tunnel) to publish a This PC drive off this network. Not Docker, and not Cloudflare Containers.";
        local.TokenConfigured = !string.IsNullOrWhiteSpace(_store.FlyTokenProtected);
        local.TokenMessage = local.TokenConfigured
            ? "A Fly token is stored with Windows DPAPI for this user. It is not shown again."
            : "No Fly token yet. Paste a bring-your-own org token. BNDZ does not host customer disks.";
        local.CloudflaredMessage = "cloudflared runs inside the drive. A copy on this PC is optional.";
        var backend = CloudDriveLocalBackend.Choose(local.HyperV, local.WslVersion);
        local.LocalBackend = backend;
        local.LocalBackendMessage = CloudDriveLocalBackend.Explain(backend, local.Elevated);
        local.Preferred = backend;
        local.EnableLocalHowTo = CloudDriveLocalBackend.EnableHowTo;
        local.PublicBaseDomain = BaseDomain();
        local.LandingUrl = CloudDriveHostname.LandingUrl(local.PublicBaseDomain);
        local.CloudflareTokenConfigured = !string.IsNullOrWhiteSpace(_store.CloudflareTokenProtected);
        local.CloudflareMessage = local.CloudflareTokenConfigured
            ? "A Cloudflare API token is stored for this Windows user. It is not shown again. " + CloudDriveCloudflare.RequiredScopes
            : "No Cloudflare API token yet. Addresses are still reserved. " + CloudDriveCloudflare.RequiredScopes;
        local.LastPlacement = _store.LastPlacement is "cloud" or "local" ? _store.LastPlacement : null;
        return local;
    }

    private async Task<object> SetTokenAsync(string? token, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(token))
            return new { ok = false, error = "Paste a Fly API token." };
        var trimmed = token.Trim();
        var check = await _fly.ValidateTokenAsync(trimmed, ct).ConfigureAwait(false);
        if (!check.ok)
            return new { ok = false, error = check.error ?? "Fly rejected that token." };
        _store.FlyTokenProtected = CloudDriveSecrets.ProtectToBase64(trimmed);
        Save();
        return new
        {
            ok = true,
            tokenConfigured = true,
            orgSlug = check.org,
            probe = ProbeSnapshot(),
        };
    }

    private object ClearToken()
    {
        _store.FlyTokenProtected = null;
        Save();
        return new { ok = true, tokenConfigured = false, probe = ProbeSnapshot() };
    }

    private async Task<object> CreateAsync(JsonElement payload, CancellationToken ct)
    {
        var name = (Str(payload, "name") ?? "").Trim();
        if (name.Length == 0 || name.Length > 64)
            return new { ok = false, error = "Name the drive (1–64 characters)." };
        if (name.Any(char.IsControl))
            return new { ok = false, error = "Drive name cannot include control characters." };

        var placement = (Str(payload, "placement") ?? "").Trim().ToLowerInvariant();
        if (placement is not ("cloud" or "local"))
            return new { ok = false, error = "Choose where this drive lives: Cloud, or This PC on a separate drive." };

        var size = IntOf(payload, "sizeGb", 20);
        if (size < 1 || size > 500)
            return new { ok = false, error = "Size must be between 1 and 500 GB." };

        var region = (Str(payload, "region") ?? "iad").Trim().ToLowerInvariant();
        if (placement == "cloud" && (region.Length != 3 || region.Any(c => c is < 'a' or > 'z')))
            return new { ok = false, error = "Region must be a 3-letter Fly region code, for example iad." };

        var diskPath = LocalMicroVmCloudDriveProvider.NormalizePath(Str(payload, "diskPath"));
        if (placement == "local")
        {
            var pathError = LocalMicroVmCloudDriveProvider.ValidateDiskPath(diskPath);
            if (pathError != null) return new { ok = false, error = pathError };
        }

        var oneShot = Str(payload, "flyToken");
        if (!string.IsNullOrWhiteSpace(oneShot))
        {
            var saved = await SetTokenAsync(oneShot, ct).ConfigureAwait(false);
            var savedJson = JsonSerializer.Serialize(saved);
            using var savedDoc = JsonDocument.Parse(savedJson);
            if (savedDoc.RootElement.TryGetProperty("ok", out var okEl) && okEl.ValueKind == JsonValueKind.False)
                return saved;
        }

        if (placement == "cloud" && string.IsNullOrWhiteSpace(ReadToken()))
            return new { ok = false, error = "Paste your Fly API token first. BNDZ does not keep a shared cloud account for Cloud Drives." };

        CloudDriveKeyMaterial keys;
        try { keys = CloudDriveKeys.Create(); }
        catch (Exception ex)
        {
            return new { ok = false, error = "Could not generate a per-drive SSH key. " + CloudDriveSecrets.Redact(ex.Message) };
        }

        var now = DateTime.UtcNow.ToString("o");
        var drive = new CloudDriveRecord
        {
            Id = "cd" + Guid.NewGuid().ToString("N")[..12],
            Name = name,
            Placement = placement,
            Provider = placement == "cloud" ? _fly.Id : _local.Id,
            State = "creating",
            SizeGb = size,
            Region = placement == "cloud" ? region : null,
            KeyType = keys.KeyType,
            PublicKey = keys.PublicKey,
            Fingerprint = keys.Fingerprint,
            ProtectedPrivateKey = Convert.ToBase64String(MeshProtect(keys.PrivateKey)),
            CreatedUtc = now,
            UpdatedUtc = now,
            User = "bndz",
        };
        CloudDrivePorts.Assign(drive);
        drive.ProtectedFtpPassword = CloudDriveSecrets.ProtectToBase64(CloudDriveSecrets.NewPassword());
        Array.Clear(keys.PrivateKey, 0, keys.PrivateKey.Length);
        _store.LastPlacement = placement;
        EnsurePublicAddress(drive);

        var req = new CloudDriveCreateRequest
        {
            Name = name,
            Placement = placement,
            SizeGb = size,
            Region = region,
            DiskPath = diskPath,
        };

        _store.Drives.Add(drive);
        Save();
        try
        {
            await PublishDriveAsync(drive, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            drive.PublishMode = "dry-run";
            drive.PublishMessage = CloudDriveSecrets.Redact(ex.Message);
        }
        try
        {
            await ProviderFor(drive).CreateAsync(drive, req, ReadToken, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            drive.State = "error";
            drive.Message = CloudDriveSecrets.Redact(ex.Message);
        }
        drive.Message = CloudDriveSecrets.Redact(drive.Message);
        Touch(drive);
        Save();
        var failed = drive.State == "error";
        return new { ok = !failed, error = failed ? drive.Message : null, drive = drive.ToDto(), drives = Dtos() };
    }

    private async Task<object> MutateAsync(string? id, Func<CloudDriveRecord, Func<string?>, Task> op, CancellationToken ct)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        EnsureProtocolMaterial(drive);
        if (string.Equals(drive.Placement, "local", StringComparison.OrdinalIgnoreCase)
            && string.IsNullOrWhiteSpace(drive.LocalGuestIp))
        {
            var used = _store.Drives
                .Where(d => !string.Equals(d.Id, drive.Id, StringComparison.Ordinal))
                .Select(d => d.LocalGuestIp);
            drive.LocalGuestIp = CloudDriveLocalRootfs.PickGuestIp(drive.Id, used);
        }
        try
        {
            await op(drive, ReadToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            drive.State = "error";
            drive.Message = CloudDriveSecrets.Redact(ex.Message);
        }
        drive.Message = CloudDriveSecrets.Redact(drive.Message);
        Touch(drive);
        Save();
        var failed = drive.State == "error";
        return new { ok = !failed, error = failed ? drive.Message : null, drive = drive.ToDto(), drives = Dtos() };
    }

    private async Task<object> DeleteAsync(string? id, string? confirmName, CancellationToken ct)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        if (!string.Equals((confirmName ?? "").Trim(), drive.Name, StringComparison.Ordinal))
            return new { ok = false, error = "Type the drive name to confirm delete." };

        drive.State = "deleting";
        Touch(drive);
        Save();
        CloudDriveTunnel.Stop(drive.Id);
        try
        {
            await ProviderFor(drive).DeleteAsync(drive, ReadToken, ct).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            drive.State = "error";
            drive.Message = CloudDriveSecrets.Redact(ex.Message);
            Touch(drive);
            Save();
            return new { ok = false, error = drive.Message, drive = drive.ToDto(), drives = Dtos() };
        }
        _store.Drives.Remove(drive);
        Save();
        return new { ok = true, drives = Dtos() };
    }

    private object Connection(string? id)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        var dto = drive.ToDto();
        return new
        {
            ok = true,
            drive = dto,
            connection = new
            {
                sshCommand = dto.SshCommand,
                fingerprint = dto.Fingerprint,
                publicKey = dto.PublicKey,
                sshNote = dto.SshNote,
                host = dto.Host,
                port = dto.Port,
                user = dto.User,
                endpoints = dto.Endpoints,
                tunnelHostname = dto.TunnelHostname,
            },
        };
    }

    private object SetTunnelToken(string? id, string? token)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        if (!string.Equals(drive.Placement, "local", StringComparison.OrdinalIgnoreCase))
            return new { ok = false, error = "The tunnel for a Cloud placement drive runs inside that machine.", drive = drive.ToDto(), drives = Dtos() };
        var trimmed = (token ?? "").Trim();
        if (trimmed.Length < 20 || trimmed.Any(char.IsWhiteSpace))
            return new { ok = false, error = "That tunnel token does not look usable. Paste the install token from Cloudflare, with no spaces." };
        drive.ProtectedTunnelToken = CloudDriveSecrets.ProtectToBase64(trimmed);
        drive.TunnelState = "stopped";
        drive.TunnelMessage = "Token stored. Start away access when cloudflared is installed.";
        Touch(drive);
        Save();
        return new { ok = true, drive = drive.ToDto(), drives = Dtos() };
    }

    private object ClearTunnelToken(string? id)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        CloudDriveTunnel.Stop(drive.Id);
        drive.ProtectedTunnelToken = null;
        drive.TunnelState = "token-needed";
        drive.TunnelMessage = "Tunnel token removed from this Windows user store.";
        Touch(drive);
        Save();
        return new { ok = true, drive = drive.ToDto(), drives = Dtos() };
    }

    private object StartTunnel(string? id)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        if (!string.Equals(drive.Placement, "local", StringComparison.OrdinalIgnoreCase))
            return new { ok = false, error = "The tunnel for a Cloud placement drive runs inside that machine.", drive = drive.ToDto(), drives = Dtos() };
        var token = CloudDriveSecrets.UnprotectFromBase64(drive.ProtectedTunnelToken);
        if (string.IsNullOrWhiteSpace(token))
            return new { ok = false, error = "Paste a Cloudflare Tunnel token first.", drive = drive.ToDto(), drives = Dtos() };
        var started = CloudDriveTunnel.Start(drive, token);
        token = null;
        drive.TunnelMessage = CloudDriveSecrets.Redact(drive.TunnelMessage);
        Touch(drive);
        Save();
        return new { ok = started.ok, error = started.ok ? null : drive.TunnelMessage, drive = drive.ToDto(), drives = Dtos() };
    }

    private object StopTunnel(string? id)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        CloudDriveTunnel.Stop(drive.Id);
        drive.TunnelState = string.IsNullOrWhiteSpace(drive.ProtectedTunnelToken) ? "token-needed" : "stopped";
        drive.TunnelMessage = "Away access stopped. The sealed disk is unchanged.";
        Touch(drive);
        Save();
        return new { ok = true, drive = drive.ToDto(), drives = Dtos() };
    }

    private object SetTunnelHostname(string? id, string? hostname)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        _ = hostname;
        EnsurePublicAddress(drive);
        drive.SshNote = CloudDriveProtocols.OperatorNote(drive);
        Touch(drive);
        Save();
        return new { ok = true, drive = drive.ToDto(), drives = Dtos(), hostname = drive.TunnelHostname };
    }

    private object RevealFtpPassword(string? id)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        EnsureProtocolMaterial(drive);
        Save();
        var password = CloudDriveSecrets.UnprotectFromBase64(drive.ProtectedFtpPassword);
        if (string.IsNullOrWhiteSpace(password))
            return new { ok = false, error = "No FTPS password is stored for this drive." };
        return new { ok = true, password };
    }

    private async Task<object> SnapshotAsync(string? id, Func<CloudDriveRecord, Func<string?>, Task<CloudDriveOp>> op, CancellationToken ct)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        EnsureProtocolMaterial(drive);
        CloudDriveOp result;
        try
        {
            result = await op(drive, ReadToken).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            result = new CloudDriveOp(false, CloudDriveSecrets.Redact(ex.Message));
        }
        if (!result.Ok && !string.IsNullOrWhiteSpace(result.Error))
            drive.Message = result.Error;
        drive.Message = CloudDriveSecrets.Redact(drive.Message);
        Touch(drive);
        Save();
        return new
        {
            ok = result.Ok,
            error = result.Ok ? null : CloudDriveSecrets.Redact(result.Error),
            drive = drive.ToDto(),
            drives = Dtos(),
        };
    }

    private object ExportLocal(string? id, string? destPath, CancellationToken ct)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        if (!string.Equals(drive.Placement, "local", StringComparison.OrdinalIgnoreCase))
            return new { ok = false, error = "Cloud drives move by snapshot, or by the data archive in the web panel. There is no sealed VHDX on this PC.", drive = drive.ToDto(), drives = Dtos() };
        if (drive.State is "running" or "creating" or "deleting")
            return new { ok = false, error = "Stop the drive before copying the sealed folder.", drive = drive.ToDto(), drives = Dtos() };
        if (string.IsNullOrWhiteSpace(drive.DiskPath) || !Directory.Exists(drive.DiskPath))
            return new { ok = false, error = "The sealed folder is missing.", drive = drive.ToDto(), drives = Dtos() };

        var dest = LocalMicroVmCloudDriveProvider.NormalizePath(destPath);
        var pathError = LocalMicroVmCloudDriveProvider.ValidateDiskPath(dest);
        if (pathError != null) return new { ok = false, error = pathError, drive = drive.ToDto(), drives = Dtos() };
        var plan = CloudDriveSlot.ExportPlanError(drive.DiskPath, dest, drive.Id);
        if (plan != null) return new { ok = false, error = plan, drive = drive.ToDto(), drives = Dtos() };

        var slot = CloudDriveSlot.DestinationSlot(dest, drive.Id);
        try
        {
            CloudDriveSlot.CopyInto(drive.DiskPath, slot, ct);
            CloudDrivePorts.Ensure(drive);
            CloudDriveSlot.Write(slot, LocalMicroVmCloudDriveProvider.ManifestFrom(drive));
        }
        catch (Exception ex)
        {
            try
            {
                if (Directory.Exists(slot)) Directory.Delete(slot, recursive: true);
            }
            catch { /* leave the partial copy if the disk is locked */ }
            var msg = ex is OperationCanceledException
                ? "Copy cancelled."
                : "Could not copy the sealed folder. " + ex.Message;
            if (msg.Contains("being used", StringComparison.OrdinalIgnoreCase) || msg.Contains("used by another", StringComparison.OrdinalIgnoreCase))
                msg = "Could not copy the sealed folder. The disk file is in use. Stop the VM and try again.";
            return new { ok = false, error = CloudDriveSecrets.Redact(msg), drive = drive.ToDto(), drives = Dtos() };
        }

        var hasVhdx = File.Exists(Path.Combine(slot, "disk.vhdx"));
        drive.Message = hasVhdx
            ? "Copied the sealed folder to " + slot + ". Open that folder here, or on another PC, to start the same disk. The original folder is unchanged."
            : "Copied the slot notes to " + slot + ". disk.vhdx was not in the folder, so this copy has no disk image yet.";
        Touch(drive);
        Save();
        return new { ok = true, exportedPath = slot, drive = drive.ToDto(), drives = Dtos() };
    }

    private object OpenExisting(string? diskPath)
    {
        var path = LocalMicroVmCloudDriveProvider.NormalizePath(diskPath);
        var pathError = LocalMicroVmCloudDriveProvider.ValidateDiskPath(path);
        if (pathError != null) return new { ok = false, error = pathError, drives = Dtos() };

        CloudDriveSlotManifest manifest;
        try
        {
            manifest = CloudDriveSlot.Read(path);
        }
        catch (Exception ex)
        {
            return new { ok = false, error = CloudDriveSecrets.Redact(ex.Message), drives = Dtos() };
        }

        var existing = Find(manifest.Id);
        if (existing != null)
        {
            if (!string.Equals(existing.Placement, "local", StringComparison.OrdinalIgnoreCase))
                return new { ok = false, error = "That id belongs to a Cloud placement drive. Open existing is for a sealed folder on This PC.", drive = existing.ToDto(), drives = Dtos() };
            if (existing.State is "running" or "creating" or "deleting")
                return new { ok = false, error = "Stop the drive before pointing it at another folder.", drive = existing.ToDto(), drives = Dtos() };

            var mismatch = !string.IsNullOrWhiteSpace(manifest.Fingerprint)
                && !string.IsNullOrWhiteSpace(existing.Fingerprint)
                && !string.Equals(manifest.Fingerprint, existing.Fingerprint, StringComparison.Ordinal);
            existing.DiskPath = path;
            existing.VhdxPath = Path.Combine(path, "disk.vhdx");
            if (!string.IsNullOrWhiteSpace(manifest.VmName)) existing.VmName = manifest.VmName;
            if (manifest.SizeGb > 0) existing.SizeGb = manifest.SizeGb;
            existing.State = "stopped";
            existing.Host = "127.0.0.1";
            existing.HostKeyChanged = false;
            existing.Hypervisor = _local.Probe().Preferred;
            var hasKey = !string.IsNullOrWhiteSpace(existing.ProtectedPrivateKey);
            if (!string.IsNullOrWhiteSpace(manifest.PublicSlug)) existing.PublicSlug = manifest.PublicSlug;
            EnsurePublicAddress(existing);
            existing.HostKeyNote = CloudDriveSlot.LocalMoveNote(hasKey, mismatch, existing.Fingerprint);
            var vhdx = File.Exists(existing.VhdxPath);
            existing.Message = existing.HostKeyNote + (vhdx ? "" : " disk.vhdx is not in that folder yet.");
            if (!mismatch)
                CloudDriveSlot.Write(path, LocalMicroVmCloudDriveProvider.ManifestFrom(existing));
            Touch(existing);
            Save();
            return new { ok = true, drive = existing.ToDto(), drives = Dtos() };
        }

        var now = DateTime.UtcNow.ToString("o");
        var drive = new CloudDriveRecord
        {
            Id = manifest.Id,
            Name = manifest.Name,
            Placement = "local",
            Provider = _local.Id,
            State = "stopped",
            SizeGb = manifest.SizeGb > 0 ? manifest.SizeGb : 20,
            DiskPath = path,
            VhdxPath = Path.Combine(path, "disk.vhdx"),
            VmName = string.IsNullOrWhiteSpace(manifest.VmName) ? "BNDZ-" + manifest.Id : manifest.VmName,
            Host = "127.0.0.1",
            User = string.IsNullOrWhiteSpace(manifest.User) ? "bndz" : manifest.User,
            PublicKey = manifest.PublicKey,
            Fingerprint = manifest.Fingerprint,
            SshPort = manifest.SshPort,
            FtpsPort = manifest.FtpsPort,
            WebDavPort = manifest.WebDavPort,
            Hypervisor = _local.Probe().Preferred,
            PublicSlug = manifest.PublicSlug,
            CreatedUtc = now,
            UpdatedUtc = now,
        };
        CloudDrivePorts.Ensure(drive);
        EnsurePublicAddress(drive);
        drive.Port = drive.SshPort;
        drive.HostKeyChanged = false;
        drive.HostKeyNote = CloudDriveSlot.LocalMoveNote(false, false, drive.Fingerprint);
        var importedVhdx = File.Exists(drive.VhdxPath);
        drive.Message = drive.HostKeyNote + (importedVhdx ? "" : " disk.vhdx is not in that folder yet.");
        drive.SshNote = "Private key stays in Windows secure storage. This PC does not have the key for this imported disk.";
        _store.Drives.Add(drive);
        Save();
        return new { ok = true, drive = drive.ToDto(), drives = Dtos() };
    }

    private static void EnsureProtocolMaterial(CloudDriveRecord drive)
    {
        CloudDrivePorts.Ensure(drive);
        if (string.IsNullOrWhiteSpace(drive.ProtectedFtpPassword))
            drive.ProtectedFtpPassword = CloudDriveSecrets.ProtectToBase64(CloudDriveSecrets.NewPassword());
    }

    private ICloudDriveProvider ProviderFor(CloudDriveRecord drive) =>
        string.Equals(drive.Placement, "local", StringComparison.OrdinalIgnoreCase) ? _local : _fly;

    private string? ReadToken() => CloudDriveSecrets.UnprotectFromBase64(_store.FlyTokenProtected);

    private CloudDriveRecord? Find(string? id) =>
        string.IsNullOrWhiteSpace(id) ? null : _store.Drives.FirstOrDefault(d => string.Equals(d.Id, id, StringComparison.Ordinal));

    private List<CloudDriveDto> Dtos()
    {
        var changed = false;
        foreach (var drive in _store.Drives)
            changed |= EnsurePublicAddress(drive);
        if (changed) Save();
        return _store.Drives.Select(d => d.ToDto()).ToList();
    }

    private string BaseDomain() => CloudDriveHostname.NormalizeBase(_store.PublicBaseDomain);

    private bool EnsurePublicAddress(CloudDriveRecord drive)
    {
        var beforeSlug = drive.PublicSlug;
        var beforeHost = drive.TunnelHostname;
        if (string.IsNullOrWhiteSpace(drive.PublicSlug))
        {
            drive.PublicSlug = CloudDriveHostname.Slug(
                drive.Name,
                drive.Id,
                _store.Drives.Where(d => !ReferenceEquals(d, drive)).Select(d => d.PublicSlug));
        }
        var host = CloudDriveHostname.DriveHost(BaseDomain(), drive.PublicSlug);
        if (CloudDriveHostname.IsPublicHost(host))
            drive.TunnelHostname = host;
        return !string.Equals(beforeSlug, drive.PublicSlug, StringComparison.Ordinal)
            || !string.Equals(beforeHost, drive.TunnelHostname, StringComparison.Ordinal);
    }

    private async Task PublishDriveAsync(CloudDriveRecord drive, CancellationToken ct)
    {
        EnsurePublicAddress(drive);
        var token = CloudDriveSecrets.UnprotectFromBase64(_store.CloudflareTokenProtected);
        var plan = await CloudDriveCloudflare.PublishAsync(token, BaseDomain(), drive.PublicSlug, null, ct).ConfigureAwait(false);
        drive.PublishMode = plan.Mode;
        drive.PublishMessage = CloudDriveSecrets.Redact(plan.Message);
        if (!string.IsNullOrWhiteSpace(plan.ConnectorToken))
            drive.ProtectedTunnelToken = CloudDriveSecrets.ProtectToBase64(plan.ConnectorToken);
    }

    private async Task<object> SetPublicDomainAsync(string? raw, CancellationToken ct)
    {
        var entered = (raw ?? "").Trim();
        var stripped = entered;
        if (stripped.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) stripped = stripped[8..];
        else if (stripped.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) stripped = stripped[7..];
        var slash = stripped.IndexOf('/');
        if (slash >= 0) stripped = stripped[..slash];
        stripped = stripped.Trim().TrimEnd('.').ToLowerInvariant();
        var host = entered.Length == 0 ? CloudDriveHostname.DefaultBaseDomain : CloudDriveHostname.NormalizeBase(stripped);
        if (entered.Length > 0 && (!CloudDriveHostname.IsPublicHost(host) || !string.Equals(host, stripped, StringComparison.Ordinal)))
            return new { ok = false, error = "Enter a public base domain such as cloud.bndz.org." };
        _store.PublicBaseDomain = host;
        foreach (var drive in _store.Drives) EnsurePublicAddress(drive);
        Save();
        foreach (var drive in _store.Drives)
            await PublishDriveAsync(drive, ct).ConfigureAwait(false);
        Save();
        return new { ok = true, probe = ProbeSnapshot(), drives = Dtos() };
    }

    private async Task<object> SetCloudflareTokenAsync(string? token, CancellationToken ct)
    {
        var trimmed = (token ?? "").Trim();
        if (trimmed.Length < 20 || trimmed.Any(char.IsWhiteSpace))
            return new { ok = false, error = "Paste a Cloudflare API token with no spaces." };
        _store.CloudflareTokenProtected = CloudDriveSecrets.ProtectToBase64(trimmed);
        Save();
        foreach (var drive in _store.Drives)
            await PublishDriveAsync(drive, ct).ConfigureAwait(false);
        Save();
        return new { ok = true, probe = ProbeSnapshot(), drives = Dtos() };
    }

    private object ClearCloudflareToken()
    {
        _store.CloudflareTokenProtected = null;
        Save();
        return new { ok = true, probe = ProbeSnapshot(), drives = Dtos() };
    }

    private async Task<object> PublishOneAsync(string? id, CancellationToken ct)
    {
        var drive = Find(id);
        if (drive == null) return new { ok = false, error = "That Cloud Drive is not in the local registry." };
        await PublishDriveAsync(drive, ct).ConfigureAwait(false);
        Touch(drive);
        Save();
        return new { ok = true, drive = drive.ToDto(), drives = Dtos() };
    }

    private object SetPlacementPref(string? placement)
    {
        var value = (placement ?? "").Trim().ToLowerInvariant();
        if (value is not ("cloud" or "local"))
            return new { ok = false, error = "Choose Cloud or This PC." };
        _store.LastPlacement = value;
        Save();
        return new { ok = true, probe = ProbeSnapshot() };
    }

    private static object EnableLocal()
    {
        var how = CloudDriveLocalBackend.EnableHowTo;
        if (!OperatingSystem.IsWindows())
            return new { ok = true, started = false, message = how };
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -WindowStyle Hidden -Command \"Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile -Command Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All'\"",
                UseShellExecute = true,
            });
            return new { ok = true, started = true, message = how };
        }
        catch
        {
            return new { ok = true, started = false, message = how };
        }
    }

    private static void Touch(CloudDriveRecord drive) => drive.UpdatedUtc = DateTime.UtcNow.ToString("o");

    private static byte[] MeshProtect(byte[] privateKey)
    {
        var text = Convert.ToBase64String(privateKey);
        return BNDZ.Services.Mesh.MeshCredentialVault.Protect(text);
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_registryPath)) return;
            var json = File.ReadAllText(_registryPath);
            _store = JsonSerializer.Deserialize<Store>(json, JsonOpts) ?? new Store();
            _store.Drives ??= new List<CloudDriveRecord>();
        }
        catch
        {
            _store = new Store();
        }
    }

    private void Save()
    {
        Directory.CreateDirectory(_dir);
        var json = JsonSerializer.Serialize(_store, JsonOpts);
        var tmp = _registryPath + ".tmp";
        File.WriteAllText(tmp, json);
        File.Move(tmp, _registryPath, overwrite: true);
    }

    private static string? Str(JsonElement payload, string name)
    {
        if (payload.ValueKind != JsonValueKind.Object || !payload.TryGetProperty(name, out var el)) return null;
        return el.ValueKind == JsonValueKind.String ? el.GetString() : el.ToString();
    }

    private static int IntOf(JsonElement payload, string name, int fallback)
    {
        if (payload.ValueKind != JsonValueKind.Object || !payload.TryGetProperty(name, out var el)) return fallback;
        if (el.ValueKind == JsonValueKind.Number && el.TryGetInt32(out var n)) return n;
        if (el.ValueKind == JsonValueKind.String && int.TryParse(el.GetString(), out var p)) return p;
        return fallback;
    }

    private sealed class Store
    {
        public string? FlyTokenProtected { get; set; }
        public string? PublicBaseDomain { get; set; }
        public string? CloudflareTokenProtected { get; set; }
        public string? LastPlacement { get; set; }
        public List<CloudDriveRecord> Drives { get; set; } = new();
    }
}
