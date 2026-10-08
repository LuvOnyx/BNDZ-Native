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
        var host = PublicHostname(drive);
        var user = string.IsNullOrWhiteSpace(drive.User) ? "bndz" : drive.User.Trim();
        var haveHost = host.Length > 0;
        var imagePinned = !string.IsNullOrWhiteSpace(FlyMachinesCloudDriveProvider.PinnedImage());
        var rootfs = local && CloudDriveLocalRootfs.Describe().Present;
        var listening = local && running && rootfs && CloudDriveLocalRootfs.TcpOpen("127.0.0.1", drive.SshPort, 400);
        var ready = local ? listening : running && haveHost && imagePinned;
        var listen = ListenNote(local, running, imagePinned, rootfs, listening);
        var share = ShareUrl(drive);
        var ssh = haveHost ? $"ssh {user}@{host}" : "";
        var sftp = haveHost ? $"sftp {user}@{host}" : "";
        var ftps = haveHost ? $"ftps://{user}@{host}/" : "";
        var web = haveHost ? "https://" + host + "/dav/" : "";
        var note = haveHost
            ? "Uses " + host + ". " + listen
            : "The address is assigned on " + CloudDriveHostname.DefaultBaseDomain + " when the drive is created.";

        return new List<CloudDriveEndpoint>
        {
            Row("ssh", "SSH", ssh, ready, haveHost, note),
            Row("sftp", "SFTP", sftp, ready, haveHost, haveHost ? "Same name as SSH. " + listen : note),
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
                ? "Same name as the panel. Sign-in password stays hidden. Use Copy FTPS password."
                : note),
            Row("webdav", "WebDAV", web, ready && web.Length > 0, web.Length > 0,
                web.Length == 0 ? note : "Same name as the panel, under /dav/. User bndz, same hidden password. " + listen),
            new CloudDriveEndpoint
            {
                Id = "panel",
                Label = "Send this",
                CopyText = share,
                State = share.Length == 0 ? "unavailable" : (ready ? "ready" : "pending"),
                CanCopy = share.Length > 0,
                Note = share.Length == 0
                    ? note
                    : "This is the link you send. Sign in, then open Settings for your name and password. " + listen,
            },
        };
    }

    /// <summary>Assigned public hostname. Never a machine origin.</summary>
    public static string PublicHostname(CloudDriveRecord drive)
    {
        var host = (drive.TunnelHostname ?? "").Trim().TrimEnd('.').ToLowerInvariant();
        return CloudDriveHostname.IsPublicHost(host) ? host : "";
    }

    /// <summary>https URL people send.</summary>
    public static string ShareUrl(CloudDriveRecord drive)
    {
        var host = PublicHostname(drive);
        return host.Length == 0 ? "" : "https://" + host + "/";
    }

    /// <summary>Internal origin. Not copied into the UI.</summary>
    public static string MachineHost(CloudDriveRecord drive) => "";

    public static string AddressGuide(CloudDriveRecord drive)
    {
        var share = ShareUrl(drive);
        var host = PublicHostname(drive);
        var dot = host.IndexOf('.');
        var baseDomain = dot > 0 ? host[(dot + 1)..] : CloudDriveHostname.DefaultBaseDomain;
        var landing = CloudDriveHostname.LandingUrl(baseDomain);
        if (share.Length == 0)
            return "Every drive gets a name on " + CloudDriveHostname.DefaultBaseDomain + ". " + landing + " is the account page.";
        return "Send " + share + " Share links use that name plus /s/ and a token. " + landing + " is the account page. The tunnel runs inside the drive.";
    }

    public static string OperatorNote(CloudDriveRecord drive)
    {
        var share = ShareUrl(drive);
        if (share.Length > 0)
            return "Private key stays in Windows secure storage. Send " + share;
        if (IsLocal(drive) && !CloudDriveLocalRootfs.Describe().Present)
            return "Private key stays in Windows secure storage. The address is on " + CloudDriveHostname.DefaultBaseDomain + ". Nothing answers on this PC until the rootfs is pinned.";
        if (IsLocal(drive))
            return "Private key stays in Windows secure storage. Start boots the pinned rootfs. The sealed VHDX is only the data disk.";
        return "Private key stays in Windows secure storage. The address is a name on " + CloudDriveHostname.DefaultBaseDomain + ".";
    }

    public static string PublicHost(CloudDriveRecord drive) => PublicHostname(drive);

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

    private static string ListenNote(bool local, bool running, bool imagePinned, bool rootfs, bool listening)
    {
        if (!local)
        {
            if (imagePinned)
                return "Open it when the machine is running. This PC cannot prove the port is open.";
            return "No machine yet. Set the drive image, then Start.";
        }
        if (!rootfs)
            return "Nothing is listening. Pin the local rootfs, then Start.";
        if (!running)
            return "Start the drive. The pinned rootfs boots in Hyper-V. The sealed VHDX is the data disk and is not recreated.";
        if (listening)
            return "The SSH port on this PC accepted a connection.";
        return "The VM may be up. The SSH port is not accepting connections yet. First boot installs packages and can take several minutes.";
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
