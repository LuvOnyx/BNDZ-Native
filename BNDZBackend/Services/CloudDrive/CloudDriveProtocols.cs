using System.Text.RegularExpressions;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Published protocol origins for a Cloud Drive. Plain anonymous FTP is never offered.
/// Guest listeners exist only after a pinned image boots; these rows stay honest about that.
/// </summary>
public static class CloudDrivePorts
{
    public static void Assign(CloudDriveRecord drive) => Fill(drive, force: true);

    public static void Ensure(CloudDriveRecord drive) => Fill(drive, force: false);

    private static void Fill(CloudDriveRecord drive, bool force)
    {
        var n = Stable(drive.Id);
        if (force || drive.SshPort <= 0 || drive.SshPort == 22)
            drive.SshPort = 22000 + (n % 800);
        if (force || drive.FtpsPort <= 0)
            drive.FtpsPort = 21000 + ((n / 3) % 800);
        if (force || drive.WebDavPort <= 0)
            drive.WebDavPort = 18080 + ((n / 7) % 700);
        drive.Port = drive.SshPort;
    }

    private static int Stable(string? id)
    {
        var s = id ?? "";
        unchecked
        {
            var h = 17;
            foreach (var c in s) h = (h * 31) + c;
            return h == int.MinValue ? 0 : Math.Abs(h);
        }
    }
}

public sealed class CloudDriveEndpoint
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public string CopyText { get; set; } = "";
    public string State { get; set; } = "pending";
    public string Note { get; set; } = "";
    public bool CanCopy { get; set; }
}

public static class CloudDriveProtocols
{
    public const int GuestSsh = 22;
    public const int GuestFtps = 990;
    public const int GuestPanel = 8080;
    public const int GuestWebDav = 8090;

    public static List<CloudDriveEndpoint> For(CloudDriveRecord drive)
    {
        CloudDrivePorts.Ensure(drive);
        var local = IsLocal(drive);
        var running = string.Equals(drive.State, "running", StringComparison.OrdinalIgnoreCase);
        var host = PublicHost(drive);
        var user = string.IsNullOrWhiteSpace(drive.User) ? "bndz" : drive.User.Trim();
        var haveHost = !string.IsNullOrWhiteSpace(host);
        var imagePinned = !string.IsNullOrWhiteSpace(FlyMachinesCloudDriveProvider.PinnedImage());
        var ready = running && haveHost && !local && imagePinned;
        var listen = ListenNote(local, imagePinned);

        var ssh = haveHost ? $"ssh -p {drive.SshPort} {user}@{host}" : "";
        var sftp = haveHost ? $"sftp -P {drive.SshPort} {user}@{host}" : "";
        var ftps = haveHost ? $"ftps://{user}@{host}:{drive.FtpsPort}/" : "";
        var web = WebDavUrl(drive, host);
        var panel = PanelUrl(drive);

        var hostNote = haveHost
            ? listen
            : "The public host appears after the Fly app exists. Nothing is copied until then.";

        return new List<CloudDriveEndpoint>
        {
            Row("ssh", "SSH", ssh, ready, haveHost, haveHost ? listen : hostNote),
            Row("sftp", "SFTP", sftp, ready, haveHost, haveHost ? "Same port as SSH. The client flag is a capital P." : hostNote),
            new CloudDriveEndpoint
            {
                Id = "ftp",
                Label = "FTP",
                CopyText = "",
                State = "unavailable",
                CanCopy = false,
                Note = "Plain FTP is off, including anonymous login. Use FTPS.",
            },
            Row("ftps", "FTPS", ftps, ready, haveHost, haveHost
                ? "Sign-in password stays hidden. Use Copy FTPS password. Passive data ports are not published."
                : hostNote),
            Row("webdav", "WebDAV", web, ready && !string.IsNullOrWhiteSpace(web), !string.IsNullOrWhiteSpace(web),
                string.IsNullOrWhiteSpace(web)
                    ? "WebDAV appears after the drive has a host."
                    : "Separate from the web panel. User bndz, same hidden password. " + listen),
            new CloudDriveEndpoint
            {
                Id = "panel",
                Label = "Panel URL",
                CopyText = panel,
                State = string.IsNullOrWhiteSpace(panel) ? "unavailable" : (ready ? "ready" : "pending"),
                CanCopy = !string.IsNullOrWhiteSpace(panel),
                Note = string.IsNullOrWhiteSpace(panel)
                    ? "The panel URL appears when the Fly app exists, or after you save a Cloudflare hostname."
                    : "Browser login for files and share links. User bndz, same password as FTPS. " + listen,
            },
        };
    }

    public static string PublicHost(CloudDriveRecord drive)
    {
        if (IsLocal(drive))
            return string.IsNullOrWhiteSpace(drive.Host) ? "127.0.0.1" : drive.Host.Trim();
        if (!string.IsNullOrWhiteSpace(drive.FlyApp))
            return drive.FlyApp.Trim() + ".fly.dev";
        var host = (drive.Host ?? "").Trim();
        if (host.Length == 0) return "";
        if (host.StartsWith("fdaa:", StringComparison.OrdinalIgnoreCase)) return "";
        if (host.StartsWith("10.", StringComparison.Ordinal) || host.StartsWith("192.168.", StringComparison.Ordinal))
            return "";
        return host;
    }

    public static string? NormalizeHostname(string? raw, out string? error)
    {
        var s = (raw ?? "").Trim();
        if (s.Length == 0)
        {
            error = null;
            return "";
        }
        if (s.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) s = s[8..];
        else if (s.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) s = s[7..];
        var slash = s.IndexOf('/');
        if (slash >= 0) s = s[..slash];
        s = s.Trim().TrimEnd('.').ToLowerInvariant();
        if (s is "localhost" or "127.0.0.1" or "::1")
        {
            error = "Away access needs a public hostname, not localhost.";
            return null;
        }
        if (s.Length > 253 || !Hostname.IsMatch(s) || !s.Contains('.'))
        {
            error = "Enter a public hostname such as drive.example.com, without a path.";
            return null;
        }
        error = null;
        return s;
    }

    private static string WebDavUrl(CloudDriveRecord drive, string host)
    {
        if (!IsLocal(drive) && !string.IsNullOrWhiteSpace(drive.FlyApp))
            return "http://" + drive.FlyApp.Trim() + ".fly.dev:" + drive.WebDavPort + "/";
        if (IsLocal(drive) && host.Length > 0)
            return $"http://{host}:{drive.WebDavPort + 1}/";
        return "";
    }

    private static string PanelUrl(CloudDriveRecord drive)
    {
        var tun = (drive.TunnelHostname ?? "").Trim();
        if (tun.Length > 0) return "https://" + tun + "/";
        if (!IsLocal(drive) && !string.IsNullOrWhiteSpace(drive.FlyApp))
            return "https://" + drive.FlyApp.Trim() + ".fly.dev/";
        var host = PublicHost(drive);
        if (IsLocal(drive) && host.Length > 0)
            return $"http://{host}:{drive.WebDavPort}/";
        return "";
    }

    private static string ListenNote(bool local, bool imagePinned)
    {
        if (local)
            return "Nothing is listening yet — this PC has no guest image installed.";
        if (imagePinned)
            return "Open it when the machine is running. This PC cannot prove the port is open.";
        return "No machine yet. Set the drive image, then Start.";
    }

    private static CloudDriveEndpoint Row(string id, string label, string copy, bool ready, bool canCopy, string note) => new()
    {
        Id = id,
        Label = label,
        CopyText = copy,
        State = !canCopy ? "pending" : ready ? "ready" : "pending",
        CanCopy = canCopy && copy.Length > 0,
        Note = note,
    };

    private static bool IsLocal(CloudDriveRecord drive) =>
        string.Equals(drive.Placement, "local", StringComparison.OrdinalIgnoreCase);

    private static readonly Regex Hostname = new(
        @"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);
}
