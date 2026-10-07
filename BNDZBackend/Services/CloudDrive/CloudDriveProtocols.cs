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
        var share = ShareUrl(drive);
        var machine = MachineHost(drive);

        var ssh = haveHost ? $"ssh -p {drive.SshPort} {user}@{host}" : "";
        var sftp = haveHost ? $"sftp -P {drive.SshPort} {user}@{host}" : "";
        var ftps = haveHost ? $"ftps://{user}@{host}:{drive.FtpsPort}/" : "";
        var web = WebDavUrl(drive, host);
        var send = share.Length > 0 ? share : (local ? LoopbackPanel(drive) : "");
        var sendLabel = share.Length > 0 ? "Send this" : "On this PC";

        var hostNote = haveHost
            ? "Uses the machine address. Not the link you send. " + listen
            : "The machine address appears after the Fly app exists. SSH is not copied until then.";

        var rows = new List<CloudDriveEndpoint>
        {
            Row("ssh", "SSH", ssh, ready, haveHost, haveHost ? hostNote : "SSH uses the machine address. " + hostNote),
            Row("sftp", "SFTP", sftp, ready, haveHost, haveHost ? "Same port as SSH. The client flag is a capital P. " + hostNote : hostNote),
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
                ? "On the machine address. Sign-in password stays hidden. Use Copy FTPS password. Passive data ports are not published."
                : hostNote),
            Row("webdav", "WebDAV", web, ready && !string.IsNullOrWhiteSpace(web), !string.IsNullOrWhiteSpace(web),
                string.IsNullOrWhiteSpace(web)
                    ? "WebDAV appears with the machine address."
                    : "On the machine address, separate from the link you send. User bndz, same hidden password. " + listen),
            new CloudDriveEndpoint
            {
                Id = "panel",
                Label = sendLabel,
                CopyText = send,
                State = string.IsNullOrWhiteSpace(send) ? "unavailable" : (share.Length > 0 && ready ? "ready" : "pending"),
                CanCopy = !string.IsNullOrWhiteSpace(send),
                Note = string.IsNullOrWhiteSpace(send)
                    ? "Save a hostname you control. The Fly machine address is not the link you send."
                    : (share.Length > 0
                        ? "This is the link you send. Sign in, then open Settings for your name and password. " + listen
                        : "On this PC only. Save a hostname you control before you send a link. " + listen),
            },
        };
        if (machine.Length > 0 && (share.Length > 0 || !local))
        {
            var machineCopy = local ? LoopbackPanel(drive) : "https://" + machine + "/";
            rows.Add(new CloudDriveEndpoint
            {
                Id = "machine",
                Label = "Machine",
                CopyText = machineCopy,
                State = "pending",
                CanCopy = true,
                Note = local
                    ? "Loopback on this PC. Away access uses the hostname above."
                    : "Fly machine address for SSH and FTPS. Do not send this.",
            });
        }
        return rows;
    }

    /// <summary>Hostname the owner chose. Never a *.fly.dev machine address.</summary>
    public static string PublicHostname(CloudDriveRecord drive)
    {
        var host = (drive.TunnelHostname ?? "").Trim().TrimEnd('.').ToLowerInvariant();
        if (host.Length == 0 || host.EndsWith(".fly.dev", StringComparison.Ordinal)) return "";
        return host;
    }

    /// <summary>https URL people send. Empty until a hostname you control is saved.</summary>
    public static string ShareUrl(CloudDriveRecord drive)
    {
        var host = PublicHostname(drive);
        return host.Length == 0 ? "" : "https://" + host + "/";
    }

    /// <summary>Fly app host, or 127.0.0.1 for This PC. Not the link you send.</summary>
    public static string MachineHost(CloudDriveRecord drive)
    {
        if (IsLocal(drive))
            return string.IsNullOrWhiteSpace(drive.Host) ? "127.0.0.1" : drive.Host.Trim();
        if (!string.IsNullOrWhiteSpace(drive.FlyApp))
            return drive.FlyApp.Trim() + ".fly.dev";
        return "";
    }

    public static string AddressGuide(CloudDriveRecord drive)
    {
        CloudDrivePorts.Ensure(drive);
        if (IsLocal(drive))
        {
            return "The link you send is a hostname you own. In Cloudflare Tunnel, point an HTTP public hostname at http://127.0.0.1:"
                + drive.WebDavPort + "/ for the panel, and a second hostname at ssh://127.0.0.1:"
                + drive.SshPort + " if you want SSH from away. BNDZ does not mint a public name.";
        }
        var app = string.IsNullOrWhiteSpace(drive.FlyApp) ? "your-app" : drive.FlyApp.Trim();
        return "Save a hostname you control, such as files.example.com. In Cloudflare DNS add a CNAME to "
            + app + ".fly.dev, then add the certificate on the Fly app: fly certs add files.example.com -a " + app
            + ". The panel and share links use that name. SSH, SFTP, and FTPS stay on " + app
            + ".fly.dev. BNDZ does not mint a branded subdomain, and it does not offer the machine address as the link you send.";
    }

    public static string OperatorNote(CloudDriveRecord drive)
    {
        var share = ShareUrl(drive);
        if (share.Length > 0)
            return "Private key stays in Windows secure storage. Send " + share + " SSH uses the machine address.";
        if (!IsLocal(drive) && !string.IsNullOrWhiteSpace(drive.FlyApp))
            return "Private key stays in Windows secure storage. Save a hostname you control before you send the panel. SSH uses " + drive.FlyApp.Trim() + ".fly.dev.";
        if (IsLocal(drive))
            return "Private key stays in Windows secure storage. Nothing answers on this PC until the guest rootfs is pinned. Away links use the hostname you save.";
        return "Private key stays in Windows secure storage. Save a hostname you control before you send the panel.";
    }

    public static string PublicHost(CloudDriveRecord drive) => MachineHost(drive) is { Length: > 0 } host && !IsPrivate(host) ? host : "";

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
        if (s.EndsWith(".fly.dev", StringComparison.Ordinal))
        {
            error = "That is the Fly machine address. Save a hostname you control, such as files.example.com.";
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

    private static string LoopbackPanel(CloudDriveRecord drive)
    {
        var host = string.IsNullOrWhiteSpace(drive.Host) ? "127.0.0.1" : drive.Host.Trim();
        return $"http://{host}:{drive.WebDavPort}/";
    }

    private static string WebDavUrl(CloudDriveRecord drive, string host)
    {
        if (!IsLocal(drive) && !string.IsNullOrWhiteSpace(drive.FlyApp))
            return "http://" + drive.FlyApp.Trim() + ".fly.dev:" + drive.WebDavPort + "/";
        if (IsLocal(drive) && host.Length > 0)
            return $"http://{host}:{drive.WebDavPort + 1}/";
        return "";
    }

    private static bool IsPrivate(string host)
    {
        if (host.StartsWith("fdaa:", StringComparison.OrdinalIgnoreCase)) return true;
        if (host.StartsWith("10.", StringComparison.Ordinal) || host.StartsWith("192.168.", StringComparison.Ordinal))
            return true;
        return false;
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
