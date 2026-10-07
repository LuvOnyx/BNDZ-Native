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

        var machineBody = JsonSerializer.Serialize(new
        {
            name = "bndz",
            region,
            config = new
            {
                image,
                guest = new { cpu_kind = "shared", cpus = 1, memory_mb = 512 },
                mounts = new[] { new { volume = drive.FlyVolumeId, path = "/data" } },
                metadata = new Dictionary<string, string> { ["bndz_drive_id"] = drive.Id },
                env = new Dictionary<string, string> { ["BNDZ_DATA_MOUNT"] = "/data" },
            },
        });
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
        if (string.IsNullOrWhiteSpace(drive.Message))
            drive.Message = "Fly machine and volume exist. SSH/SFTP publish with the pinned image; this build does not open port 22 by itself.";
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
        return "Token accepted for " + who + ". No Machine was created — this build has no pinned drive image. Set BNDZ_CLOUD_DRIVE_IMAGE to a digest, then Start. BNDZ does not host the disk.";
    }

    private static string SshNote(CloudDriveRecord drive)
    {
        if (!string.IsNullOrWhiteSpace(drive.FlyMachineId))
            return "Private key stays in the Windows secure store. Public SSH/SFTP is not published until the drive image exposes port 22. Machine " + drive.FlyMachineId + " on app " + (drive.FlyApp ?? "—") + ".";
        return "Private key stays in the Windows secure store. Copy SSH is a placeholder until the machine exists and port 22 is published.";
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

    private static async Task<(int status, string body)> SendAsync(HttpMethod method, string url, string token, string? json, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, url);
        req.Headers.TryAddWithoutValidation("Authorization", "Bearer " + token);
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        if (json != null)
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        try
        {
            using var res = await Http.SendAsync(req, ct).ConfigureAwait(false);
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
