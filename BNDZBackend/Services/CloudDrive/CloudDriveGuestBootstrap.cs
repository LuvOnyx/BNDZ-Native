namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Guest contract injected into a Fly Machine only when a pinned image is set.
/// Debian/Ubuntu + apt-get. Not Docker Desktop, and not a Cloudflare Container.
/// </summary>
public static class CloudDriveGuestBootstrap
{
    public const string BootstrapEnv = "BNDZ_CLOUD_DRIVE_BOOTSTRAP";

    public static bool Enabled()
    {
        var v = Environment.GetEnvironmentVariable(BootstrapEnv);
        return !string.Equals(v?.Trim(), "0", StringComparison.Ordinal);
    }

    public static object[] FlyServices(CloudDriveRecord drive)
    {
        CloudDrivePorts.Ensure(drive);
        return new object[]
        {
            new
            {
                protocol = "tcp",
                internal_port = CloudDriveProtocols.GuestSsh,
                ports = new[] { new { port = drive.SshPort } },
            },
            new
            {
                protocol = "tcp",
                internal_port = CloudDriveProtocols.GuestFtps,
                ports = new[] { new { port = drive.FtpsPort } },
            },
            new
            {
                protocol = "tcp",
                internal_port = CloudDriveProtocols.GuestPanel,
                ports = new object[]
                {
                    new { port = 80, handlers = new[] { "http" } },
                    new { port = 443, handlers = new[] { "tls", "http" } },
                },
            },
            new
            {
                protocol = "tcp",
                internal_port = CloudDriveProtocols.GuestWebDav,
                ports = new[] { new { port = drive.WebDavPort } },
            },
        };
    }

    /// <summary>
    /// Runs as the machine command when bootstrap is enabled. If apt-get is missing,
    /// it logs and stays up instead of pretending the protocols installed.
    /// </summary>
    public const string Script = """
        #!/bin/bash
        # BNDZ Cloud Drive guest bootstrap. Expects Debian or Ubuntu.
        set -u
        log() { printf '%s\n' "[bndz] $*" >&2; }
        if ! command -v apt-get >/dev/null 2>&1; then
          log "No apt-get. SSH, FTPS, and WebDAV were not installed. Pin a Debian or Ubuntu image, or set BNDZ_CLOUD_DRIVE_BOOTSTRAP=0 and honor the contract in the image."
          exec sleep infinity
        fi
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -y || { log "apt-get update failed"; exec sleep infinity; }
        apt-get install -y openssh-server vsftpd apache2 apache2-utils openssl python3 || { log "package install failed"; exec sleep infinity; }
        id bndz >/dev/null 2>&1 || useradd --create-home --shell /bin/bash bndz
        mkdir -p /data /home/bndz/.ssh /etc/bndz /var/lib/dav /run/sshd
        chown bndz:bndz /data || true
        chmod 755 /data || true
        if [ -n "${BNDZ_AUTHORIZED_KEY:-}" ]; then
          printf '%s\n' "$BNDZ_AUTHORIZED_KEY" > /home/bndz/.ssh/authorized_keys
          chown -R bndz:bndz /home/bndz/.ssh
          chmod 700 /home/bndz/.ssh
          chmod 600 /home/bndz/.ssh/authorized_keys
        fi
        if [ -f /etc/ssh/sshd_config ]; then
          sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config || true
          sed -i 's/^#\?PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config || true
          sed -i 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' /etc/ssh/sshd_config || true
          grep -q '^Subsystem[[:space:]]\+sftp' /etc/ssh/sshd_config || printf '\nSubsystem sftp internal-sftp\n' >> /etc/ssh/sshd_config
        fi
        if [ -n "${BNDZ_FTP_PASSWORD:-}" ]; then
          printf 'bndz:%s\n' "$BNDZ_FTP_PASSWORD" | chpasswd || true
          htpasswd -bc /etc/bndz/webdav.passwd bndz "$BNDZ_FTP_PASSWORD" || true
        fi
        openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
          -keyout /etc/ssl/private/bndz-ftps.key \
          -out /etc/ssl/certs/bndz-ftps.pem \
          -subj '/CN=bndz-cloud-drive' >/dev/null 2>&1 || true
        chmod 600 /etc/ssl/private/bndz-ftps.key || true
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
        a2enmod dav dav_fs auth_basic authn_file >/dev/null 2>&1 || true
        a2dissite 000-default >/dev/null 2>&1 || true
        a2ensite bndz-webdav >/dev/null 2>&1 || true
        /usr/sbin/sshd || log "sshd did not start"
        vsftpd /etc/vsftpd.conf || log "vsftpd did not start"
        apache2ctl start || apache2 -k start || log "apache did not start"
        if [ -f /opt/bndz/panel/server.py ]; then
          python3 /opt/bndz/panel/server.py >> /var/log/bndz-panel.log 2>&1 &
          log "web panel starting on port 8080"
        else
          log "Web panel files are not on this machine. Expected /opt/bndz/panel/server.py."
        fi
        log "bootstrap finished"
        exec sleep infinity
        """;
}
