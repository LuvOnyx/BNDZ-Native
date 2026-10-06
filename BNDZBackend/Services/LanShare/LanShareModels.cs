namespace BNDZ.Services.LanShare;

/// <summary>Which daemons to start. Dangerous ones default OFF and must be opted in.</summary>
public sealed class LanShareProtocolOptions
{
    public bool Http { get; init; } = true;
    public bool WebDav { get; init; } = true;
    public bool Ftp { get; init; }
    public bool Ftps { get; init; }
    public bool Sftp { get; init; }
    public bool SshShell { get; init; }
    public bool Tftp { get; init; }
    /// <summary>Opt-in only. SMB is high-risk; LGPL SMBLibrary; binds LAN only.</summary>
    public bool Smb { get; init; }

    public int HttpPort { get; init; } = 3923;
    public int FtpPort { get; init; } = 3921;
    public int FtpsPort { get; init; } = 3990;
    public int SshPort { get; init; } = 3922;
    public int TftpPort { get; init; } = 3969;
    public int SmbPort { get; init; } = 3945;
}

public sealed class LanShareStartOptions
{
    public string? Password { get; init; }
    public string? Username { get; init; }
    public string? Slug { get; init; }
    public string? Label { get; init; }
    public int? ExpiryMinutes { get; init; }
    public bool AllowWrite { get; init; }
    public LanShareProtocolOptions Protocols { get; init; } = new();
}

public sealed class LanShareSession
{
    public required string ShareId { get; init; }
    public required string FolderPath { get; init; }
    public required string FolderName { get; init; }
    public required string Token { get; init; }
    public required string LanAddress { get; init; }
    public required int HttpPort { get; init; }
    public required string Url { get; init; }
    public string? HubUrl { get; init; }
    public string? Label { get; init; }
    public string Username { get; init; } = "bndz";
    public bool HasPassword { get; init; }
    public bool AllowWrite { get; init; }
    public DateTime? ExpiresUtc { get; init; }
    public DateTime StartedUtc { get; init; } = DateTime.UtcNow;
    public bool Running { get; set; } = true;
    public string? LastError { get; set; }
    public long BytesServed { get; set; }
    public int RequestCount { get; set; }
    public LanShareProtocolStatus Protocols { get; set; } = new();
    public Dictionary<string, string> ConnectionHints { get; set; } = new(StringComparer.OrdinalIgnoreCase);

    public bool IsExpired => ExpiresUtc is DateTime exp && DateTime.UtcNow >= exp;

    public object ToDto() => new
    {
        shareId = ShareId,
        folderPath = FolderPath,
        folderName = FolderName,
        token = Token,
        slug = Token,
        lanAddress = LanAddress,
        port = HttpPort,
        httpPort = HttpPort,
        url = Url,
        hubUrl = HubUrl ?? $"http://{LanAddress}:{HttpPort}/",
        label = Label ?? FolderName,
        username = Username,
        hasPassword = HasPassword,
        allowWrite = AllowWrite,
        expiresUtc = ExpiresUtc,
        startedUtc = StartedUtc,
        running = Running && !IsExpired,
        expired = IsExpired,
        lastError = LastError,
        bytesServed = BytesServed,
        requestCount = RequestCount,
        readOnly = !AllowWrite,
        bindMode = "lan-ip",
        protocols = Protocols.ToDto(),
        connectionHints = ConnectionHints,
    };
}

public sealed class LanShareProtocolStatus
{
    public bool Http { get; set; }
    public bool WebDav { get; set; }
    public bool Ftp { get; set; }
    public bool Ftps { get; set; }
    public bool Sftp { get; set; }
    public bool SshShell { get; set; }
    public bool Tftp { get; set; }
    public bool Smb { get; set; }
    public string? FtpNote { get; set; }
    public string? FtpsNote { get; set; }
    public string? SshNote { get; set; }
    public string? TftpNote { get; set; }
    public string? SmbNote { get; set; }

    public object ToDto() => new
    {
        http = Http,
        webdav = WebDav,
        ftp = Ftp,
        ftps = Ftps,
        sftp = Sftp,
        sshShell = SshShell,
        tftp = Tftp,
        smb = Smb,
        ftpNote = FtpNote,
        ftpsNote = FtpsNote,
        sshNote = SshNote,
        tftpNote = TftpNote,
        smbNote = SmbNote,
    };
}
