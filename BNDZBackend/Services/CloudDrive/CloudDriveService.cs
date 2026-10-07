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
        local.TokenConfigured = !string.IsNullOrWhiteSpace(_store.FlyTokenProtected);
        local.TokenMessage = local.TokenConfigured
            ? "A Fly token is stored with Windows DPAPI for this user. It is not shown again."
            : "No Fly token yet. Paste a bring-your-own org token. BNDZ does not host customer disks.";
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
            Port = 22,
        };
        Array.Clear(keys.PrivateKey, 0, keys.PrivateKey.Length);

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
            },
        };
    }

    private ICloudDriveProvider ProviderFor(CloudDriveRecord drive) =>
        string.Equals(drive.Placement, "local", StringComparison.OrdinalIgnoreCase) ? _local : _fly;

    private string? ReadToken() => CloudDriveSecrets.UnprotectFromBase64(_store.FlyTokenProtected);

    private CloudDriveRecord? Find(string? id) =>
        string.IsNullOrWhiteSpace(id) ? null : _store.Drives.FirstOrDefault(d => string.Equals(d.Id, id, StringComparison.Ordinal));

    private List<CloudDriveDto> Dtos() => _store.Drives.Select(d => d.ToDto()).ToList();

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
        public List<CloudDriveRecord> Drives { get; set; } = new();
    }
}
