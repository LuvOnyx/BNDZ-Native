using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Thin Fly Machines control-plane client. Buyer BYO token only — BNDZ does not
/// hold a shared landlord account. No Machine is created until a pinned image
/// digest is configured (BNDZ_CLOUD_DRIVE_IMAGE). Docker is not involved.
/// </summary>
public sealed class FlyMachinesCloudDriveProvider : ICloudDriveProvider
{
    public const string ImageEnv = "BNDZ_CLOUD_DRIVE_IMAGE";
    private const string FlyApi = "https://api.fly.io";
    private const string MachinesApi = "https://api.machines.dev";

    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(40),
    };

    private static readonly HttpClient LongHttp = new()
    {
        Timeout = TimeSpan.FromMinutes(4),
    };

    public string Id => "fly";

    public static string? PinnedImage()
    {
        var v = Environment.GetEnvironmentVariable(ImageEnv);
        return string.IsNullOrWhiteSpace(v) ? null : v.Trim();
    }

    public async Task<(bool ok, string? org, string? error)> ValidateTokenAsync(string token, CancellationToken ct)
    {
        token = token.Trim();
        if (token.Length < 8)
            return (false, null, "That Fly token is too short. Create an org token in Fly and paste it here.");

        var (status, body) = await SendAsync(HttpMethod.Get, FlyApi + "/v1/apps", token, null, ct).ConfigureAwait(false);
        if (status == 401 || status == 403)
            return (false, null, "Fly rejected that token. BNDZ did not store it.");
        if (status < 200 || status >= 300)
            return (false, null, "Fly did not accept the token (" + status + "). " + ErrorFromBody(body));

        var org = await TryOrgSlugAsync(token, ct).ConfigureAwait(false);
        return (true, org, null);
    }

    public async Task CreateAsync(CloudDriveRecord drive, CloudDriveCreateRequest request, Func<string?> readFlyToken, CancellationToken ct)
    {
        var token = readFlyToken();
        if (string.IsNullOrWhiteSpace(token))
        {
            drive.State = "error";
            drive.Message = "Paste your Fly API token first. BNDZ does not keep a shared cloud account for Cloud Drives.";
            return;
        }

        var check = await ValidateTokenAsync(token, ct).ConfigureAwait(false);
        if (!check.ok)
        {
            drive.State = "error";
            drive.Message = check.error ?? "Fly token was rejected.";
            return;
        }

        drive.FlyOrg = check.org;
        drive.Region = string.IsNullOrWhiteSpace(request.Region) ? "iad" : request.Region.Trim().ToLowerInvariant();
        var image = PinnedImage();
        if (string.IsNullOrWhiteSpace(image))
        {
            drive.State = "stopped";
            drive.Host = "";
            drive.SshNote = SshNote(drive);
            drive.Message = ImageMissingMessage(check.org);
            return;
        }

        await ProvisionAsync(drive, token, image, ct).ConfigureAwait(false);
    }

    public async Task StartAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct)
    {
        var token = readFlyToken();
        if (string.IsNullOrWhiteSpace(token))
        {
            drive.State = "error";
            drive.Message = "No Fly token is stored. Paste a BYO org token to start this drive.";
            return;
        }

        if (string.IsNullOrWhiteSpace(drive.FlyMachineId) || string.IsNullOrWhiteSpace(drive.FlyApp))
        {
            var image = PinnedImage();
            if (string.IsNullOrWhiteSpace(image))
            {
                drive.State = "error";
                drive.Message = ImageMissingMessage(drive.FlyOrg);
                drive.SshNote = SshNote(drive);
                return;
            }
            await ProvisionAsync(drive, token, image, ct).ConfigureAwait(false);
            return;
        }

        var url = $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp)}/machines/{Uri.EscapeDataString(drive.FlyMachineId)}/start";
        var (status, body) = await SendAsync(HttpMethod.Post, url, token, "{}", ct).ConfigureAwait(false);
        if (status == 401 || status == 403)
        {
            drive.State = "error";
            drive.Message = "Fly rejected the stored token while starting the machine.";
            return;
        }
        if (status < 200 || status >= 300)
        {
            drive.State = "error";
            drive.Message = "Fly could not start the machine. " + ErrorFromBody(body);
            return;
        }
        await RefreshAsync(drive, readFlyToken, ct).ConfigureAwait(false);
    }

    public async Task StopAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct)
    {
        var token = readFlyToken();
        if (string.IsNullOrWhiteSpace(drive.FlyMachineId) || string.IsNullOrWhiteSpace(drive.FlyApp))
        {
            drive.State = "stopped";
            if (string.IsNullOrWhiteSpace(drive.Message))
                drive.Message = "No Fly machine is attached yet.";
            return;
        }
        if (string.IsNullOrWhiteSpace(token))
        {
            drive.State = "error";
            drive.Message = "No Fly token is stored, so BNDZ cannot stop the machine.";
            return;
        }

        var url = $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp)}/machines/{Uri.EscapeDataString(drive.FlyMachineId)}/stop";
        var (status, body) = await SendAsync(HttpMethod.Post, url, token, "{}", ct).ConfigureAwait(false);
        if (status < 200 || status >= 300)
        {
            drive.State = "error";
            drive.Message = "Fly could not stop the machine. " + ErrorFromBody(body);
            return;
        }
        drive.State = "stopped";
        drive.Message = "Machine stopped. The volume keeps billing until you delete the drive.";
        drive.SshNote = SshNote(drive);
    }

    public async Task DeleteAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct)
    {
        var token = readFlyToken();
        if (string.IsNullOrWhiteSpace(token) || string.IsNullOrWhiteSpace(drive.FlyApp))
            return;

        if (!string.IsNullOrWhiteSpace(drive.FlyMachineId))
        {
            var url = $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp)}/machines/{Uri.EscapeDataString(drive.FlyMachineId)}?force=true";
            var (status, body) = await SendAsync(HttpMethod.Delete, url, token, null, ct).ConfigureAwait(false);
            if (status != 404 && (status < 200 || status >= 300))
                throw new InvalidOperationException("Fly could not destroy the machine. " + ErrorFromBody(body));
        }

        if (!string.IsNullOrWhiteSpace(drive.FlyVolumeId))
        {
            var url = $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp)}/volumes/{Uri.EscapeDataString(drive.FlyVolumeId)}";
            var (status, body) = await SendAsync(HttpMethod.Delete, url, token, null, ct).ConfigureAwait(false);
            if (status != 404 && (status < 200 || status >= 300))
                throw new InvalidOperationException("Fly could not destroy the volume. " + ErrorFromBody(body));
        }

        var appUrl = $"{FlyApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp)}";
        await SendAsync(HttpMethod.Delete, appUrl, token, null, ct).ConfigureAwait(false);
    }

    public async Task RefreshAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(drive.FlyApp) || string.IsNullOrWhiteSpace(drive.FlyMachineId))
        {
            drive.SshNote = SshNote(drive);
            return;
        }
        var token = readFlyToken();
        if (string.IsNullOrWhiteSpace(token))
        {
            drive.Message = "Stored Fly token is missing, so status could not be refreshed.";
            return;
        }

        var url = $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp)}/machines/{Uri.EscapeDataString(drive.FlyMachineId)}";
        var (status, body) = await SendAsync(HttpMethod.Get, url, token, null, ct).ConfigureAwait(false);
        if (status == 404)
        {
            drive.State = "error";
            drive.Message = "Fly no longer has this machine.";
            return;
        }
        if (status < 200 || status >= 300)
        {
            drive.Message = "Could not read machine status. " + ErrorFromBody(body);
            return;
        }

        ApplyMachineJson(drive, body);
        drive.SshNote = SshNote(drive);
    }

    public async Task<CloudDriveOp> CreateSnapshotAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct)
    {
        var ready = RequireVolume(drive, readFlyToken(), out var token);
        if (ready != null) return ready.Value;
        var url = VolumeSnapshotsUrl(drive);
        var (status, body) = await SendAsync(HttpMethod.Post, url, token!, "{}", ct, LongHttp).ConfigureAwait(false);
        if (status < 200 || status >= 300)
            return new CloudDriveOp(false, "Fly did not create a snapshot. " + ErrorFromBody(body));
        var created = CloudDriveSnapshots.Parse(body);
        if (created.Count == 0)
            return new CloudDriveOp(false, "Fly answered, but the snapshot id was missing.");
        var listed = await ListSnapshotsAsync(drive, readFlyToken, ct).ConfigureAwait(false);
        drive.Snapshots ??= new List<CloudDriveSnapshot>();
        if (!listed.Ok || drive.Snapshots.All(s => s.Id != created[0].Id))
            drive.Snapshots.Insert(0, created[0]);
        var snap = drive.Snapshots.First(s => s.Id == created[0].Id);
        drive.Message = "Snapshot " + snap.Id + " is " + (string.IsNullOrWhiteSpace(snap.Status) ? "saved" : snap.Status) + ". It is crash-consistent. Stop the drive first if you need a quiet disk. The volume keeps billing.";
        return new CloudDriveOp(true, null);
    }

    public async Task<CloudDriveOp> ListSnapshotsAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct)
    {
        var ready = RequireVolume(drive, readFlyToken(), out var token);
        if (ready != null) return ready.Value;
        var (status, body) = await SendAsync(HttpMethod.Get, VolumeSnapshotsUrl(drive), token!, null, ct).ConfigureAwait(false);
        if (status < 200 || status >= 300)
            return new CloudDriveOp(false, "Fly did not list snapshots. " + ErrorFromBody(body));
        drive.Snapshots = CloudDriveSnapshots.Parse(body);
        drive.Message = drive.Snapshots.Count == 0
            ? "No snapshots yet. A snapshot is a crash-consistent copy of the volume."
            : drive.Snapshots.Count + " snapshot" + (drive.Snapshots.Count == 1 ? "" : "s") + " on this volume.";
        return new CloudDriveOp(true, null);
    }

    public async Task<CloudDriveOp> RestoreSnapshotAsync(CloudDriveRecord drive, string snapshotId, Func<string?> readFlyToken, CancellationToken ct)
    {
        var idError = CloudDriveSnapshots.ValidateId(snapshotId);
        if (idError != null) return new CloudDriveOp(false, idError);
        var token = readFlyToken();
        var ready = RequireVolume(drive, token, out token);
        if (ready != null) return ready.Value;
        var image = PinnedImage();
        if (string.IsNullOrWhiteSpace(image))
            return new CloudDriveOp(false, "Restore needs the drive image (BNDZ_CLOUD_DRIVE_IMAGE) so BNDZ can attach a machine to the restored volume. The snapshot was not changed.");

        if (!string.IsNullOrWhiteSpace(drive.FlyMachineId))
        {
            await StopAsync(drive, readFlyToken, ct).ConfigureAwait(false);
            if (string.Equals(drive.State, "error", StringComparison.OrdinalIgnoreCase))
                return new CloudDriveOp(false, drive.Message ?? "Fly could not stop the machine, so the snapshot was not restored.");
        }

        var oldVolume = drive.FlyVolumeId;
        var oldMachine = drive.FlyMachineId;
        var previousHost = CloudDriveProtocols.PublicHostname(drive);
        var region = string.IsNullOrWhiteSpace(drive.Region) ? "iad" : drive.Region!;
        var volName = RestoreVolumeName(snapshotId);
        var volJson = JsonSerializer.Serialize(new { name = volName, region, snapshot_id = snapshotId.Trim() });
        var volUrl = $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp!)}/volumes";
        var (volStatus, volBody) = await SendAsync(HttpMethod.Post, volUrl, token!, volJson, ct, LongHttp).ConfigureAwait(false);
        if (volStatus < 200 || volStatus >= 300)
        {
            drive.State = "stopped";
            return new CloudDriveOp(false, "The machine was stopped. Fly did not create a volume from that snapshot. Start the drive to bring the current disk back. " + ErrorFromBody(volBody));
        }
        var newVolume = ReadVolumeId(volBody);
        if (string.IsNullOrWhiteSpace(newVolume))
        {
            drive.State = "stopped";
            return new CloudDriveOp(false, "The machine was stopped. Fly created a volume response without an id. Start the drive to bring the current disk back.");
        }

        if (!string.IsNullOrWhiteSpace(oldMachine))
        {
            var delUrl = $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp!)}/machines/{Uri.EscapeDataString(oldMachine)}?force=true";
            var (delStatus, delBody) = await SendAsync(HttpMethod.Delete, delUrl, token!, null, ct).ConfigureAwait(false);
            if (delStatus != 404 && (delStatus < 200 || delStatus >= 300))
            {
                await TryDeleteVolumeAsync(drive.FlyApp!, newVolume, token!, ct).ConfigureAwait(false);
                drive.State = "stopped";
                drive.FlyMachineId = oldMachine;
                drive.FlyVolumeId = oldVolume;
                return new CloudDriveOp(false, "Fly created a restored volume, then could not replace the machine. The extra volume was removed when Fly allowed it. The current machine is still there, stopped. " + ErrorFromBody(delBody));
            }
        }

        drive.FlyMachineId = null;
        drive.FlyVolumeId = newVolume;
        var machineBody = JsonSerializer.Serialize(BuildMachineSpec(drive, image, region));
        var machineUrl = $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp!)}/machines";
        var (mStatus, mBody) = await SendAsync(HttpMethod.Post, machineUrl, token!, machineBody, ct, LongHttp).ConfigureAwait(false);
        if (mStatus < 200 || mStatus >= 300)
        {
            drive.State = "error";
            drive.PreviousFlyVolumeId = oldVolume;
            drive.PreviousHost = previousHost;
            drive.Message = "Restored volume " + newVolume + " exists, but Fly did not create the replacement machine. The previous machine was removed. Previous volume " + oldVolume + " may still bill. " + ErrorFromBody(mBody);
            return new CloudDriveOp(false, drive.Message);
        }

        ApplyMachineJson(drive, mBody);
        if (string.IsNullOrWhiteSpace(drive.FlyMachineId))
        {
            drive.State = "error";
            drive.PreviousFlyVolumeId = oldVolume;
            drive.Message = "Restored volume " + newVolume + " exists, but the new machine response had no id. Previous volume " + oldVolume + " may still bill.";
            return new CloudDriveOp(false, drive.Message);
        }

        drive.PreviousHost = previousHost;
        drive.HostKeyChanged = true;
        drive.HostKeyNote = CloudDriveSlot.FlyHostKeyNote(drive.Fingerprint);
        drive.SshNote = SshNote(drive);
        if (!string.IsNullOrWhiteSpace(oldVolume) && !string.Equals(oldVolume, newVolume, StringComparison.Ordinal))
        {
            drive.PreviousFlyVolumeId = oldVolume;
            drive.Message = drive.HostKeyNote + " Restored snapshot " + snapshotId.Trim() + ". Previous volume " + oldVolume + " is still in your Fly account and still bills, so its other snapshots remain until you drop it.";
        }
        else
        {
            drive.Message = drive.HostKeyNote + " Restored snapshot " + snapshotId.Trim() + ".";
        }
        drive.Snapshots = new List<CloudDriveSnapshot>();
        return new CloudDriveOp(true, null);
    }

    public async Task<CloudDriveOp> DropPreviousVolumeAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct)
    {
        var token = readFlyToken();
        if (string.IsNullOrWhiteSpace(token))
            return new CloudDriveOp(false, "No Fly token is stored, so BNDZ cannot delete that volume.");
        var previous = (drive.PreviousFlyVolumeId ?? "").Trim();
        if (previous.Length == 0)
            return new CloudDriveOp(false, "There is no previous volume to delete.");
        if (string.Equals(previous, drive.FlyVolumeId, StringComparison.Ordinal))
            return new CloudDriveOp(false, "That id is the live volume. It was not deleted.");
        if (string.IsNullOrWhiteSpace(drive.FlyApp))
            return new CloudDriveOp(false, "This drive has no Fly app, so the previous volume cannot be addressed.");
        var (status, body) = await TryDeleteVolumeAsync(drive.FlyApp, previous, token, ct).ConfigureAwait(false);
        if (status != 404 && (status < 200 || status >= 300))
            return new CloudDriveOp(false, "Fly did not delete the previous volume. " + ErrorFromBody(body));
        drive.PreviousFlyVolumeId = null;
        drive.Message = "Previous volume removed from Fly. The live disk was not touched. Snapshots that belonged to that volume are gone.";
        return new CloudDriveOp(true, null);
    }

    private static CloudDriveOp? RequireVolume(CloudDriveRecord drive, string? token, out string? readyToken)
    {
        readyToken = token;
        if (string.IsNullOrWhiteSpace(drive.FlyApp) || string.IsNullOrWhiteSpace(drive.FlyVolumeId))
            return new CloudDriveOp(false, "This drive has no Fly volume yet. Set the drive image and Start once, then snapshot.");
        if (string.IsNullOrWhiteSpace(token))
            return new CloudDriveOp(false, "No Fly token is stored. Paste a BYO org token to manage snapshots.");
        return null;
    }

    private static string VolumeSnapshotsUrl(CloudDriveRecord drive) =>
        $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp!)}/volumes/{Uri.EscapeDataString(drive.FlyVolumeId!)}/snapshots";

    private static string RestoreVolumeName(string snapshotId)
    {
        var chars = snapshotId.Where(char.IsLetterOrDigit).Select(char.ToLowerInvariant).ToArray();
        var suffix = chars.Length == 0 ? "snap" : new string(chars);
        if (suffix.Length > 8) suffix = suffix[^8..];
        return "bndzr" + suffix;
    }

    private static async Task<(int status, string body)> TryDeleteVolumeAsync(string app, string volumeId, string token, CancellationToken ct)
    {
        var url = $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(app)}/volumes/{Uri.EscapeDataString(volumeId)}";
        return await SendAsync(HttpMethod.Delete, url, token, null, ct).ConfigureAwait(false);
    }

    private async Task ProvisionAsync(CloudDriveRecord drive, string token, string image, CancellationToken ct)
    {
        drive.State = "creating";
        var org = drive.FlyOrg;
        if (string.IsNullOrWhiteSpace(org))
            org = await TryOrgSlugAsync(token, ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(org))
        {
            drive.State = "error";
            drive.Message = "Fly accepted the token, but BNDZ could not read an organization slug to create the app.";
            return;
        }
        drive.FlyOrg = org;

        var region = string.IsNullOrWhiteSpace(drive.Region) ? "iad" : drive.Region!;
        if (string.IsNullOrWhiteSpace(drive.FlyApp))
            drive.FlyApp = "bndz-" + drive.Id.Replace("cd", "", StringComparison.Ordinal).ToLowerInvariant();

        var appJson = JsonSerializer.Serialize(new { app_name = drive.FlyApp, org_slug = org });
        var (appStatus, appBody) = await SendAsync(HttpMethod.Post, FlyApi + "/v1/apps", token, appJson, ct).ConfigureAwait(false);
        if (appStatus != 409 && appStatus != 422 && (appStatus < 200 || appStatus >= 300))
        {
            drive.State = "error";
            drive.FlyApp = null;
            drive.Message = "Fly could not create the app. " + ErrorFromBody(appBody);
            return;
        }

        if (string.IsNullOrWhiteSpace(drive.FlyVolumeId))
        {
            var volJson = JsonSerializer.Serialize(new { name = "bndz_data", region, size_gb = Math.Clamp(drive.SizeGb, 1, 500) });
            var volUrl = $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp)}/volumes";
            var (volStatus, volBody) = await SendAsync(HttpMethod.Post, volUrl, token, volJson, ct).ConfigureAwait(false);
            if (volStatus < 200 || volStatus >= 300)
            {
                drive.State = "error";
                drive.Message = "Fly app exists, but the volume was not created. " + ErrorFromBody(volBody);
                return;
            }
            drive.FlyVolumeId = ReadString(volBody, "id");
            if (string.IsNullOrWhiteSpace(drive.FlyVolumeId))
            {
                drive.State = "error";
                drive.Message = "Fly created a volume response without an id.";
                return;
            }
        }

        var machineBody = JsonSerializer.Serialize(BuildMachineSpec(drive, image, region));
        var machineUrl = $"{MachinesApi}/v1/apps/{Uri.EscapeDataString(drive.FlyApp)}/machines";
        var (mStatus, mBody) = await SendAsync(HttpMethod.Post, machineUrl, token, machineBody, ct).ConfigureAwait(false);
        if (mStatus < 200 || mStatus >= 300)
        {
            drive.State = "error";
            drive.Message = "Volume exists, but Fly did not create the machine. " + ErrorFromBody(mBody);
            return;
        }

        ApplyMachineJson(drive, mBody);
        if (string.IsNullOrWhiteSpace(drive.FlyMachineId))
        {
            drive.State = "error";
            drive.Message = "Fly created a machine response without an id.";
            return;
        }
        drive.SshNote = SshNote(drive);
        if (string.IsNullOrWhiteSpace(drive.Message) || drive.State is "running" or "creating" or "stopped")
        {
            var share = CloudDriveProtocols.ShareUrl(drive);
            drive.Message = CloudDriveGuestBootstrap.Enabled()
                ? (share.Length == 0
                    ? "Fly machine is up. The public address is a path on " + CloudDriveHostname.DefaultBaseDomain + ". Plain FTP is off."
                    : "Fly machine is up. Send " + share + " Plain FTP is off.")
                : "Fly machine is up. Bootstrap is off, so the image itself must serve SSH, FTPS, WebDAV, and the panel.";
        }
    }

    private static object BuildMachineSpec(CloudDriveRecord drive, string image, string region)
    {
        CloudDrivePorts.Ensure(drive);
        var env = new Dictionary<string, string> { ["BNDZ_DATA_MOUNT"] = "/data" };
        if (!string.IsNullOrWhiteSpace(drive.PublicKey))
            env["BNDZ_AUTHORIZED_KEY"] = drive.PublicKey.Trim();
        var ftp = CloudDriveSecrets.UnprotectFromBase64(drive.ProtectedFtpPassword);
        if (!string.IsNullOrWhiteSpace(ftp))
            env["BNDZ_FTP_PASSWORD"] = ftp;
        var publicHost = CloudDriveProtocols.GuestPublicHost(drive);
        if (!string.IsNullOrWhiteSpace(publicHost))
            env["BNDZ_PUBLIC_HOST"] = publicHost;
        var prefix = CloudDriveProtocols.GuestPathPrefix(drive);
        if (prefix.Length > 0)
        {
            env["BNDZ_PATH_PREFIX"] = prefix;
            env["BNDZ_ROUTE_GUARD"] = "1";
        }
        var redirects = CloudDriveProtocols.GuestRedirects(drive);
        if (redirects.Length > 0)
            env["BNDZ_SLUG_REDIRECTS"] = redirects;
        var tunnel = CloudDriveSecrets.UnprotectFromBase64(drive.ProtectedTunnelToken);
        if (!string.IsNullOrWhiteSpace(tunnel))
            env["BNDZ_TUNNEL_TOKEN"] = tunnel;
        var originSecret = (drive.GuestOriginSecret ?? "").Trim();
        if (originSecret.Length >= 16 && originSecret.All(char.IsAsciiLetterOrDigit))
            env["BNDZ_ORIGIN_SECRET"] = originSecret;

        var config = new Dictionary<string, object?>
        {
            ["image"] = image,
            ["guest"] = new { cpu_kind = "shared", cpus = 1, memory_mb = 512 },
            ["mounts"] = new[] { new { volume = drive.FlyVolumeId, path = "/data" } },
            ["metadata"] = new Dictionary<string, string> { ["bndz_drive_id"] = drive.Id },
            ["env"] = env,
            ["services"] = CloudDriveGuestBootstrap.FlyServices(drive),
        };
        if (CloudDriveGuestBootstrap.Enabled())
        {
            var files = new List<object>
            {
                new { guest_path = "/opt/bndz/bootstrap.sh", raw_value = CloudDriveGuestBootstrap.Script },
            };
            foreach (var file in CloudDrivePanelAssets.Files())
                files.Add(new { guest_path = file.GuestPath, raw_value = file.Text });
            config["files"] = files;
            config["cmd"] = new[] { "bash", "/opt/bndz/bootstrap.sh" };
        }
        return new { name = "bndz", region, config };
    }

    private static void ApplyMachineJson(CloudDriveRecord drive, string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var id = ReadProp(root, "id");
            if (!string.IsNullOrWhiteSpace(id)) drive.FlyMachineId = id;
            var privateIp = ReadProp(root, "private_ip");
            if (!string.IsNullOrWhiteSpace(privateIp)) drive.Host = privateIp;
            var state = ReadProp(root, "state");
            drive.State = MapFlyState(state);
        }
        catch
        {
            drive.Message = "Fly responded, but the machine payload could not be read.";
        }
    }

    public static string MapFlyState(string? state)
    {
        var s = (state ?? "").Trim().ToLowerInvariant();
        return s switch
        {
            "started" or "running" => "running",
            "starting" or "created" or "replacing" => "creating",
            "stopping" or "destroying" => "deleting",
            "stopped" or "destroyed" or "suspended" => "stopped",
            "" => "stopped",
            _ => "error",
        };
    }

    private static string ImageMissingMessage(string? org)
    {
        var who = string.IsNullOrWhiteSpace(org) ? "your Fly org" : "Fly org " + org;
        return "Fly accepted the token for " + who + ". No machine is created until BNDZ_CLOUD_DRIVE_IMAGE is set to the image digest or reference Fly can pull. Then Start.";
    }

    private static string SshNote(CloudDriveRecord drive)
    {
        CloudDrivePorts.Ensure(drive);
        return CloudDriveProtocols.OperatorNote(drive);
    }

    private async Task<string?> TryOrgSlugAsync(string token, CancellationToken ct)
    {
        var queries = new[]
        {
            "{\"query\":\"{ organizations { nodes { slug } } }\"}",
            "{\"query\":\"{ viewer { organizations { nodes { slug } } } }\"}",
        };
        foreach (var q in queries)
        {
            var (status, body) = await SendAsync(HttpMethod.Post, FlyApi + "/graphql", token, q, ct).ConfigureAwait(false);
            if (status < 200 || status >= 300 || string.IsNullOrWhiteSpace(body)) continue;
            var slug = FirstSlug(body);
            if (!string.IsNullOrWhiteSpace(slug)) return slug;
        }
        return null;
    }

    private static string? FirstSlug(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return WalkSlug(doc.RootElement);
        }
        catch { return null; }
    }

    private static string? WalkSlug(JsonElement el)
    {
        if (el.ValueKind == JsonValueKind.Object)
        {
            if (el.TryGetProperty("slug", out var slug) && slug.ValueKind == JsonValueKind.String)
            {
                var s = slug.GetString();
                if (!string.IsNullOrWhiteSpace(s)) return s;
            }
            foreach (var p in el.EnumerateObject())
            {
                var found = WalkSlug(p.Value);
                if (!string.IsNullOrWhiteSpace(found)) return found;
            }
        }
        else if (el.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in el.EnumerateArray())
            {
                var found = WalkSlug(item);
                if (!string.IsNullOrWhiteSpace(found)) return found;
            }
        }
        return null;
    }

    private static string? ReadString(string json, string prop)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            return ReadProp(doc.RootElement, prop);
        }
        catch { return null; }
    }

    private static string? ReadVolumeId(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var top = ReadProp(root, "id");
            if (!string.IsNullOrWhiteSpace(top)) return top;
            if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty("volume", out var vol))
                return ReadProp(vol, "id");
        }
        catch { /* not json */ }
        return null;
    }

    private static string? ReadProp(JsonElement el, string prop)
    {
        if (el.ValueKind != JsonValueKind.Object || !el.TryGetProperty(prop, out var v)) return null;
        return v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString();
    }

    private static string ErrorFromBody(string? body)
    {
        if (string.IsNullOrWhiteSpace(body)) return "No details from Fly.";
        var clipped = body.Length > 400 ? body[..400] : body;
        try
        {
            using var doc = JsonDocument.Parse(clipped);
            var root = doc.RootElement;
            foreach (var key in new[] { "error", "message", "detail" })
            {
                if (root.ValueKind == JsonValueKind.Object && root.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.String)
                {
                    var msg = v.GetString();
                    if (!string.IsNullOrWhiteSpace(msg)) return CloudDriveSecrets.Redact(msg);
                }
            }
        }
        catch { /* not json */ }
        return CloudDriveSecrets.Redact(clipped.Replace('\n', ' ').Trim());
    }

    private static async Task<(int status, string body)> SendAsync(HttpMethod method, string url, string token, string? json, CancellationToken ct, HttpClient? client = null)
    {
        using var req = new HttpRequestMessage(method, url);
        req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + token);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (json != null)
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        try
        {
            using var res = await (client ?? Http).SendAsync(req, ct).ConfigureAwait(false);
            var body = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
            if (body.Length > 200_000) body = body[..200_000];
            return ((int)res.StatusCode, body);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException)
        {
            throw new InvalidOperationException("Could not reach Fly. Nothing in that call was logged with your token.");
        }
    }
}
