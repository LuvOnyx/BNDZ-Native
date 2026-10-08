using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Pinned Ubuntu rootfs for This PC Cloud Drives.
/// The parent VHDX lives outside the sealed folder. Each drive gets a differencing
/// OS disk plus the sealed data VHDX. Start never recreates a data disk that exists.
/// </summary>
public static class CloudDriveLocalRootfs
{
    public const string EnvVar = "BNDZ_CLOUD_DRIVE_ROOTFS";
    public const string FileName = "ubuntu-24.04-server-cloudimg-amd64.vhdx";
    public const string ImageUrl = "https://cloud-images.ubuntu.com/releases/24.04/release/ubuntu-24.04-server-cloudimg-amd64-azure.vhd.tar.gz";
    public const string ImageSha256 = "3543723afd820d7a8a64ea7399376856a95ce15200439c38447170652a60a5f3";
    public const string FetchScript = "scripts/fetch-cloud-drive-rootfs.ps1";
    public const string SwitchName = "BNDZ-CloudDrive";
    public const string HostIp = "172.30.8.1";
    public const string NatPrefix = "172.30.8.0/24";

    public sealed class RootfsStatus
    {
        public bool Present { get; init; }
        public string Path { get; init; } = "";
        public string Message { get; init; } = "";
    }

    public static RootfsStatus Describe()
    {
        string expected;
        try
        {
            var root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            expected = Path.Combine(root, "BNDZ", "CloudDrives", "rootfs", FileName);
        }
        catch
        {
            expected = FileName;
        }
        return Describe(Environment.GetEnvironmentVariable(EnvVar), expected, File.Exists);
    }

    public static RootfsStatus Describe(string? envPath, string expectedPath, Func<string, bool> exists)
    {
        var expected = string.IsNullOrWhiteSpace(expectedPath) ? FileName : expectedPath;
        if (!string.IsNullOrWhiteSpace(envPath))
        {
            var full = envPath.Trim().Trim('"');
            if (IsVhdx(full) && exists(full))
                return Ready(full);
            if (full.EndsWith(".vhd", StringComparison.OrdinalIgnoreCase) && exists(full))
            {
                return Missing(expected, "A .vhd is at " + full + ". Start needs a .vhdx parent. Run Convert-VHD, or set " + EnvVar + " to the converted file. Docker is not used.");
            }
        }
        if (exists(expected))
            return Ready(expected);
        var extracted = Path.ChangeExtension(expected, ".vhd");
        if (!string.IsNullOrWhiteSpace(extracted) && exists(extracted))
        {
            return Missing(expected, "The Ubuntu disk extracted as a .vhd. Run Convert-VHD to " + expected + ", then Start. Docker is not used.");
        }
        return Missing(expected, "Pinned rootfs is not on this PC. Run " + FetchScript + " from an elevated PowerShell, or place the Ubuntu 24.04 VHDX at " + expected + ". Start will use it when that file is present. Docker is not used.");
    }

    public static string GuestIpFor(string? id)
    {
        var host = 10 + (Stable(id) % 200);
        return "172.30.8." + host;
    }

    public static string PickGuestIp(string? id, IEnumerable<string?>? used)
    {
        var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (used != null)
        {
            foreach (var raw in used)
            {
                var ip = (raw ?? "").Trim();
                if (ip.Length > 0) taken.Add(ip);
            }
        }
        var first = GuestIpFor(id);
        if (!taken.Contains(first)) return first;
        var start = Stable(id);
        for (var i = 1; i < 200; i++)
        {
            var host = 10 + ((start + i) % 200);
            var ip = "172.30.8." + host;
            if (!taken.Contains(ip)) return ip;
        }
        return first;
    }

    public static bool TcpOpen(string host, int port, int timeoutMs)
    {
        if (string.IsNullOrWhiteSpace(host) || port <= 0 || port > 65535) return false;
        try
        {
            using var client = new TcpClient();
            var wait = Math.Clamp(timeoutMs, 50, 2000);
            var task = client.ConnectAsync(host, port);
            if (!task.Wait(wait)) return false;
            return client.Connected;
        }
        catch
        {
            return false;
        }
    }

    public static string MetaData(string? id)
    {
        var safe = SanitizeId(id);
        return "instance-id: bndz-" + safe + "\nlocal-hostname: bndz\n";
    }

    public static string NetworkConfig(string guestIp)
    {
        var ip = RequireGuestIp(guestIp);
        return "version: 2\nethernets:\n  eth0:\n    match:\n      driver: hv_netvsc\n    dhcp4: false\n    addresses:\n      - " + ip + "/24\n    routes:\n      - to: default\n        via: " + HostIp + "\n    nameservers:\n      addresses: [1.1.1.1, 8.8.8.8]\n";
    }

    public static string BootstrapScript(string guestIp)
    {
        var ip = RequireGuestIp(guestIp);
        return BootstrapTemplate.Replace("__GUEST_IP__", ip, StringComparison.Ordinal);
    }

    public static string PanelUnit(string password, string? publicHost, string? pathPrefix = null, string? slugRedirects = null, string? originSecret = null)
    {
        var pw = RequirePassword(password);
        var host = (publicHost ?? "").Trim();
        if (host.Contains('\n') || host.Contains('\r'))
            throw new InvalidOperationException("Public hostname is not usable in the guest unit.");
        var extra = "";
        var prefix = (pathPrefix ?? "").Trim();
        if (prefix.Length > 1 && prefix.StartsWith('/') && !prefix.Contains('\n') && !prefix.Contains('\r') && prefix.IndexOf('/', 1) < 0)
        {
            extra += "Environment=BNDZ_PATH_PREFIX=" + prefix + "\n";
            extra += "Environment=BNDZ_ROUTE_GUARD=1\n";
        }
        var redirects = (slugRedirects ?? "").Trim();
        if (redirects.Length > 0 && redirects.All(c => c is (>= 'a' and <= 'z') or (>= '0' and <= '9') or '-' or ':' or ','))
            extra += "Environment=BNDZ_SLUG_REDIRECTS=" + redirects + "\n";
        var secret = (originSecret ?? "").Trim();
        if (secret.Length >= 16 && secret.Length <= 128 && secret.All(char.IsAsciiLetterOrDigit))
            extra += "Environment=BNDZ_ORIGIN_SECRET=" + secret + "\n";
        return "[Unit]\nDescription=BNDZ Cloud Drive panel\nAfter=network-online.target bndz-boot.service\n\n[Service]\nType=simple\nEnvironment=BNDZ_PANEL_USER=bndz\nEnvironment=BNDZ_FTP_PASSWORD=" + pw + "\nEnvironment=BNDZ_PUBLIC_HOST=" + host + "\n" + extra + "WorkingDirectory=/opt/bndz/panel\nExecStart=/usr/bin/python3 /opt/bndz/panel/server.py\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=multi-user.target\n";
    }

    public static string TunnelUnit(string? token)
    {
        var tok = (token ?? "").Trim();
        if (tok.Length == 0 || tok.Any(char.IsWhiteSpace) || tok.Contains('"') || tok.Contains('\\'))
            return "";
        return "[Unit]\nDescription=BNDZ Cloudflare Tunnel\nAfter=network-online.target bndz-panel.service\n\n[Service]\nType=simple\nEnvironment=TUNNEL_TOKEN=" + tok + "\nExecStart=/usr/bin/cloudflared tunnel run\nRestart=on-failure\nRestartSec=3\n\n[Install]\nWantedBy=multi-user.target\n";
    }

    public static string BootUnit() =>
        "[Unit]\nDescription=BNDZ Cloud Drive boot\nAfter=local-fs.target\nBefore=bndz-panel.service\n\n[Service]\nType=oneshot\nRemainAfterExit=yes\nExecStart=/bin/bash /usr/local/sbin/bndz-bootstrap.sh\n\n[Install]\nWantedBy=multi-user.target\n";

    public static string UserData(string? id, string guestIp, string? publicKey, string password, string? publicHost, string? pathPrefix = null, string? slugRedirects = null, string? originSecret = null)
    {
        var script = BootstrapScript(guestIp);
        var pw = RequirePassword(password);
        if (script.Contains(pw, StringComparison.Ordinal))
            throw new InvalidOperationException("Bootstrap script must not contain the drive password.");
        var key = (publicKey ?? "").Trim().Replace("\r", "").Replace("\n", "");
        var sb = new StringBuilder();
        sb.AppendLine("#cloud-config");
        sb.AppendLine("hostname: bndz");
        sb.AppendLine("fqdn: bndz.local");
        sb.AppendLine("package_update: true");
        sb.AppendLine("packages:");
        sb.AppendLine("  - openssh-server");
        sb.AppendLine("  - vsftpd");
        sb.AppendLine("  - apache2");
        sb.AppendLine("  - apache2-utils");
        sb.AppendLine("  - openssl");
        sb.AppendLine("  - python3");
        sb.AppendLine("  - e2fsprogs");
        sb.AppendLine("users:");
        sb.AppendLine("  - name: bndz");
        sb.AppendLine("    groups: [sudo]");
        sb.AppendLine("    shell: /bin/bash");
        sb.AppendLine("    sudo: ALL=(ALL) NOPASSWD:ALL");
        sb.AppendLine("    lock_passwd: false");
        if (key.Length > 0)
        {
            sb.AppendLine("    ssh_authorized_keys:");
            sb.AppendLine("      - \"" + key.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"");
        }
        sb.AppendLine("chpasswd:");
        sb.AppendLine("  expire: false");
        sb.AppendLine("  list: |");
        sb.AppendLine("    bndz:" + pw);
        sb.AppendLine("ssh_pwauth: false");
        sb.AppendLine("write_files:");
        AppendLiteral(sb, "/usr/local/sbin/bndz-bootstrap.sh", "0755", script);
        AppendLiteral(sb, "/etc/systemd/system/bndz-panel.service", "0644", PanelUnit(pw, publicHost, pathPrefix, slugRedirects, originSecret));
        AppendLiteral(sb, "/etc/systemd/system/bndz-boot.service", "0644", BootUnit());
        sb.AppendLine("runcmd:");
        sb.AppendLine("  - [bash, /usr/local/sbin/bndz-bootstrap.sh]");
        return sb.ToString();
    }

    public static void WriteSeed(
        string path,
        string? id,
        string guestIp,
        string? publicKey,
        string password,
        string? publicHost,
        IEnumerable<(string Name, string Text)>? panelFiles,
        string? tunnelToken = null,
        string? pathPrefix = null,
        string? slugRedirects = null,
        string? originSecret = null)
    {
        var files = new List<(string Name, byte[] Data)>
        {
            ("user-data", Utf8(UserData(id, guestIp, publicKey, password, publicHost, pathPrefix, slugRedirects, originSecret))),
            ("meta-data", Utf8(MetaData(id))),
            ("network-config", Utf8(NetworkConfig(guestIp))),
            ("bootstrap.sh", Utf8(BootstrapScript(guestIp))),
            ("panel.service", Utf8(PanelUnit(password, publicHost, pathPrefix, slugRedirects, originSecret))),
            ("bndz-boot.service", Utf8(BootUnit())),
            ("bndz.pub", Utf8(((publicKey ?? "").Trim()) + "\n")),
        };
        var tunnel = TunnelUnit(tunnelToken);
        if (tunnel.Length > 0)
            files.Add(("bndz-tunnel.service", Utf8(tunnel)));
        if (panelFiles != null)
        {
            foreach (var file in panelFiles)
            {
                var name = Path.GetFileName((file.Name ?? "").Replace('\\', '/'));
                if (string.IsNullOrWhiteSpace(name)) continue;
                files.Add((name, Utf8(file.Text ?? "")));
            }
        }
        CloudDriveSeedIso.Write(path, files);
    }

    private static RootfsStatus Ready(string path) => new()
    {
        Present = true,
        Path = path,
        Message = "Pinned Ubuntu 24.04 rootfs is at " + path + ". Start boots it in Hyper-V. The sealed VHDX is the data disk and is not recreated.",
    };

    private static RootfsStatus Missing(string expected, string message) => new()
    {
        Present = false,
        Path = expected,
        Message = message,
    };

    private static bool IsVhdx(string path) =>
        path.EndsWith(".vhdx", StringComparison.OrdinalIgnoreCase);

    private static string RequireGuestIp(string guestIp)
    {
        var ip = (guestIp ?? "").Trim();
        if (!GuestIpPattern.IsMatch(ip))
            throw new InvalidOperationException("Guest address is not on the Cloud Drive switch.");
        var last = int.Parse(ip.Split('.')[3]);
        if (last < 10 || last > 209)
            throw new InvalidOperationException("Guest address is outside the Cloud Drive range.");
        return ip;
    }

    private static string RequirePassword(string password)
    {
        var pw = password ?? "";
        if (pw.Length < 8 || pw.Any(c => c is '\r' or '\n' or ':' or ' ' || c > 127))
            throw new InvalidOperationException("Drive password cannot be applied to the guest.");
        return pw;
    }

    private static string SanitizeId(string? id)
    {
        var raw = id ?? "";
        var chars = raw.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_').ToArray();
        var safe = new string(chars);
        return safe.Length == 0 ? "drive" : safe;
    }

    private static int Stable(string? id)
    {
        unchecked
        {
            var h = 17;
            foreach (var c in id ?? "") h = (h * 31) + c;
            if (h == int.MinValue) return 0;
            return Math.Abs(h);
        }
    }

    private static void AppendLiteral(StringBuilder sb, string path, string mode, string content)
    {
        sb.AppendLine("  - path: " + path);
        sb.AppendLine("    permissions: '" + mode + "'");
        sb.AppendLine("    content: |");
        var text = content.Replace("\r\n", "\n").Replace('\r', '\n');
        foreach (var line in text.Split('\n'))
            sb.AppendLine("      " + line);
    }

    private static byte[] Utf8(string text) => Encoding.UTF8.GetBytes(text);

    private static readonly Regex GuestIpPattern = new(
        @"^172\.30\.8\.(?:[1-9]\d?|1\d\d|20\d)$",
        RegexOptions.Compiled);

    private const string BootstrapTemplate = """
        #!/bin/bash
        # BNDZ local Cloud Drive boot. The password is not in this file.
        set -u
        GUEST_IP="__GUEST_IP__"
        log() { printf '%s\n' "[bndz] $*" >&2; }
        export DEBIAN_FRONTEND=noninteractive

        seed=""
        mkdir -p /mnt/bndz-seed
        if mountpoint -q /mnt/bndz-seed && [ -f /mnt/bndz-seed/user-data ]; then
          seed=/mnt/bndz-seed
        else
          for dev in /dev/sr0 /dev/sr1 /dev/cdrom; do
            [ -b "$dev" ] || continue
            mount -o ro "$dev" /mnt/bndz-seed 2>/dev/null || continue
            if [ -f /mnt/bndz-seed/user-data ]; then seed=/mnt/bndz-seed; break; fi
            umount /mnt/bndz-seed 2>/dev/null || true
          done
        fi

        if [ -z "${BNDZ_BOOTSTRAP_FRESH:-}" ] && [ -n "$seed" ] && [ -f "$seed/bootstrap.sh" ]; then
          cp "$seed/bootstrap.sh" /usr/local/sbin/bndz-bootstrap.sh
          chmod 755 /usr/local/sbin/bndz-bootstrap.sh
          export BNDZ_BOOTSTRAP_FRESH=1
          exec /bin/bash /usr/local/sbin/bndz-bootstrap.sh
        fi

        mkdir -p /opt/bndz/panel /data /etc/bndz /var/lib/dav /run/sshd /home/bndz/.ssh
        if [ -n "$seed" ]; then
          for f in server.py index.html app.js app.css qrcodegen.py; do
            if [ -f "$seed/$f" ]; then cp "$seed/$f" "/opt/bndz/panel/$f"; fi
          done
          if [ -f "$seed/panel.service" ]; then cp "$seed/panel.service" /etc/systemd/system/bndz-panel.service; fi
          if [ -f "$seed/bndz-boot.service" ]; then cp "$seed/bndz-boot.service" /etc/systemd/system/bndz-boot.service; fi
          if [ -f "$seed/bndz-tunnel.service" ]; then cp "$seed/bndz-tunnel.service" /etc/systemd/system/bndz-tunnel.service; fi
          if [ -f "$seed/bndz.pub" ]; then cp "$seed/bndz.pub" /home/bndz/.ssh/authorized_keys; fi
        fi
        if [ -f /home/bndz/.ssh/authorized_keys ]; then
          chown -R bndz:bndz /home/bndz/.ssh
          chmod 700 /home/bndz/.ssh
          chmod 600 /home/bndz/.ssh/authorized_keys
        fi

        if [ -z "${BNDZ_FTP_PASSWORD:-}" ] && [ -f /etc/systemd/system/bndz-panel.service ]; then
          BNDZ_FTP_PASSWORD=$(sed -n 's/^Environment=BNDZ_FTP_PASSWORD=//p' /etc/systemd/system/bndz-panel.service | head -n 1)
          export BNDZ_FTP_PASSWORD
        fi

        root_src=$(findmnt -n -o SOURCE / 2>/dev/null || true)
        root_disk=$(lsblk -no PKNAME "$root_src" 2>/dev/null | head -n 1 || true)
        data_dev=""
        if command -v lsblk >/dev/null 2>&1; then
          for disk in $(lsblk -dnpo NAME,TYPE 2>/dev/null | awk '$2=="disk"{print $1}'); do
            base=$(basename "$disk")
            case "$base" in
              sr*|loop*|fd*) continue ;;
            esac
            if [ -n "$root_disk" ] && [ "$base" = "$root_disk" ]; then continue; fi
            data_dev="$disk"
            break
          done
        fi

        if [ -n "$data_dev" ]; then
          fs=$(blkid -o value -s TYPE "$data_dev" 2>/dev/null || true)
          if [ -z "$fs" ]; then
            mkfs.ext4 -F -L BNDZDATA "$data_dev"
          fi
          if ! grep -q 'LABEL=BNDZDATA' /etc/fstab 2>/dev/null; then
            printf '%s\n' 'LABEL=BNDZDATA /data ext4 defaults,nofail 0 2' >> /etc/fstab
          fi
          if ! mountpoint -q /data; then
            mount /data 2>/dev/null || mount "$data_dev" /data 2>/dev/null || true
          fi
        fi
        if id bndz >/dev/null 2>&1; then
          chown bndz:bndz /data 2>/dev/null || true
        fi
        chmod 755 /data 2>/dev/null || true

        if [ -n "$GUEST_IP" ]; then
          if ! ip -4 addr show 2>/dev/null | grep -q "$GUEST_IP"; then
            mkdir -p /etc/netplan
            cat > /etc/netplan/99-bndz.yaml <<EOF
        network:
          version: 2
          ethernets:
            eth0:
              match:
                driver: hv_netvsc
              dhcp4: false
              addresses:
                - ${GUEST_IP}/24
              routes:
                - to: default
                  via: 172.30.8.1
              nameservers:
                addresses: [1.1.1.1, 8.8.8.8]
        EOF
            netplan apply 2>/dev/null || true
          fi
        fi

        if ! command -v sshd >/dev/null 2>&1 && [ ! -x /usr/sbin/sshd ]; then
          apt-get update -y || log "apt-get update failed"
          apt-get install -y openssh-server vsftpd apache2 apache2-utils openssl python3 e2fsprogs || log "package install failed"
        elif ! command -v vsftpd >/dev/null 2>&1 || ! command -v htpasswd >/dev/null 2>&1; then
          apt-get update -y || log "apt-get update failed"
          apt-get install -y vsftpd apache2 apache2-utils openssl python3 e2fsprogs || log "package install failed"
        fi

        if [ -f /etc/ssh/sshd_config ]; then
          sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config || true
          sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config || true
          sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config || true
          grep -q '^Subsystem[[:space:]]\+sftp' /etc/ssh/sshd_config || printf '\nSubsystem sftp internal-sftp\n' >> /etc/ssh/sshd_config
        fi
        if [ -n "${BNDZ_FTP_PASSWORD:-}" ]; then
          printf 'bndz:%s\n' "$BNDZ_FTP_PASSWORD" | chpasswd || true
          mkdir -p /etc/bndz
          htpasswd -bc /etc/bndz/webdav.passwd bndz "$BNDZ_FTP_PASSWORD" || true
        fi
        if [ ! -f /etc/ssl/private/bndz-ftps.key ]; then
          openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
            -keyout /etc/ssl/private/bndz-ftps.key \
            -out /etc/ssl/certs/bndz-ftps.pem \
            -subj '/CN=bndz-cloud-drive' >/dev/null 2>&1 || true
          chmod 600 /etc/ssl/private/bndz-ftps.key 2>/dev/null || true
        fi
        cat > /etc/vsftpd.conf <<'EOF'
        listen=YES
        listen_ipv6=NO
        anonymous_enable=NO
        local_enable=YES
        write_enable=YES
        local_umask=022
        chroot_local_user=YES
        allow_writeable_chroot=YES
        local_root=/data
        seccomp_sandbox=NO
        ssl_enable=YES
        allow_anon_ssl=NO
        force_local_data_ssl=YES
        force_local_logins_ssl=YES
        require_ssl_reuse=NO
        ssl_tlsv1=YES
        ssl_sslv2=NO
        ssl_sslv3=NO
        implicit_ssl=YES
        listen_port=990
        rsa_cert_file=/etc/ssl/certs/bndz-ftps.pem
        rsa_private_key_file=/etc/ssl/private/bndz-ftps.key
        pasv_enable=YES
        pasv_min_port=30000
        pasv_max_port=30009
        xferlog_enable=NO
        EOF
        cat > /etc/apache2/sites-available/bndz-webdav.conf <<'EOF'
        Listen 8090
        <VirtualHost *:8090>
          DavLockDB /var/lib/dav/lockdb
          Alias / /data/
          <Directory /data>
            Options Indexes FollowSymLinks
            AllowOverride None
            Dav On
            AuthType Basic
            AuthName "BNDZ"
            AuthUserFile /etc/bndz/webdav.passwd
            Require valid-user
          </Directory>
        </VirtualHost>
        EOF
        if command -v a2enmod >/dev/null 2>&1; then
          a2enmod dav dav_fs auth_basic authn_file >/dev/null 2>&1 || true
          a2dissite 000-default >/dev/null 2>&1 || true
          a2ensite bndz-webdav >/dev/null 2>&1 || true
        fi
        systemctl enable ssh 2>/dev/null || systemctl enable sshd 2>/dev/null || true
        systemctl restart ssh 2>/dev/null || systemctl restart sshd 2>/dev/null || /usr/sbin/sshd || log "sshd did not start"
        systemctl enable vsftpd 2>/dev/null || true
        systemctl restart vsftpd 2>/dev/null || vsftpd /etc/vsftpd.conf || log "vsftpd did not start"
        systemctl enable apache2 2>/dev/null || true
        systemctl restart apache2 2>/dev/null || apache2ctl start || log "apache did not start"
        systemctl daemon-reload 2>/dev/null || true
        systemctl enable bndz-boot.service 2>/dev/null || true
        systemctl enable bndz-panel.service 2>/dev/null || true
        systemctl restart bndz-panel.service 2>/dev/null || true
        if [ -f /etc/systemd/system/bndz-tunnel.service ]; then
          if ! command -v cloudflared >/dev/null 2>&1; then
            apt-get install -y cloudflared >/dev/null 2>&1 || true
          fi
          systemctl enable bndz-tunnel.service 2>/dev/null || true
          systemctl restart bndz-tunnel.service 2>/dev/null || true
        fi
        if ! systemctl is-active --quiet bndz-panel.service 2>/dev/null; then
          if [ -f /opt/bndz/panel/server.py ]; then
            python3 /opt/bndz/panel/server.py >> /var/log/bndz-panel.log 2>&1 &
            log "web panel starting on port 8080"
          else
            log "Web panel files are not on the seed. Expected server.py."
          fi
        fi
        log "bootstrap finished"
        """;
}
