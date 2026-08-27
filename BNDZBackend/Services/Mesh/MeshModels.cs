namespace BNDZ.Services.Mesh;

public enum MeshProviderKind { Ssh = 0, S3 = 1 }

public enum MeshConnectionState { Offline = 0, Connecting = 1, Online = 2, Degraded = 3, Error = 4 }

public enum MeshAuthKind { Agent = 0, PrivateKey = 1, Password = 2 }

public sealed class MeshHostRecord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..12];
    public string Alias { get; set; } = "";
    public MeshProviderKind Provider { get; set; } = MeshProviderKind.Ssh;
    public string Hostname { get; set; } = "";
    public int Port { get; set; } = 22;
    public string Username { get; set; } = "";
    public string? KeyPath { get; set; }
    /// <summary>Optional OpenSSH certificate path (CertificateFile).</summary>
    public string? CertificatePath { get; set; }
    /// <summary>ProxyJump hostname[:port] from ssh config (applied when JumpHostId is empty).</summary>
    public string? ProxyJump { get; set; }
    public MeshAuthKind AuthKind { get; set; } = MeshAuthKind.Agent;
    public string? JumpHostId { get; set; }
    public string? HostKeyFingerprint { get; set; }
    public string? S3Bucket { get; set; }
    public string? S3Region { get; set; }
    public string? S3Endpoint { get; set; }
    public string? S3AccessKeyId { get; set; }
    public byte[]? ProtectedSecret { get; set; }
    public MeshConnectionState State { get; set; } = MeshConnectionState.Offline;
    public DateTime? LastSeenUtc { get; set; }
    public string? LastError { get; set; }
    public long CacheQuotaBytes { get; set; } = 2L * 1024 * 1024 * 1024;
    public bool ShowInNavTree { get; set; } = true;
    public string RemoteRootPath { get; set; } = "/";
    public string? Notes { get; set; }
    [System.Text.Json.Serialization.JsonIgnore(Condition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingDefault)]
    public string? PasswordPlain { get; set; }
}

public sealed class MeshSyncRuleRecord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "Mirror";
    public string LocalPath { get; set; } = "";
    public string RemoteHostId { get; set; } = "";
    public string RemotePath { get; set; } = "/";
    public bool PushOnSave { get; set; } = true;
    public int DebounceMs { get; set; } = 800;
    public bool Enabled { get; set; } = true;
    public string? IncludeGlob { get; set; }
    public string? ExcludeGlob { get; set; }
    public DateTime? LastSyncUtc { get; set; }
    public string LastStatus { get; set; } = "idle";
    public string? LastError { get; set; }
}

public sealed class MeshDirEntry
{
    public string Name { get; set; } = "";
    public bool IsDirectory { get; set; }
    public long Size { get; set; }
    public DateTime? ModifiedUtc { get; set; }
    public bool IsSymlink { get; set; }
    public string? LinkTarget { get; set; }
    public int? Mode { get; set; }
    public uint? Uid { get; set; }
    public uint? Gid { get; set; }
    public string? Owner { get; set; }
    public string? Group { get; set; }
}

public sealed class MeshFileAttributes
{
    public string Path { get; set; } = "";
    public bool Exists { get; set; }
    public bool IsDirectory { get; set; }
    public bool IsSymlink { get; set; }
    public long Size { get; set; }
    public DateTime? ModifiedUtc { get; set; }
    public int? Mode { get; set; }
    public uint? Uid { get; set; }
    public uint? Gid { get; set; }
    public string? Owner { get; set; }
    public string? Group { get; set; }
    public string? LinkTarget { get; set; }
}

public sealed class MeshSyncProgress
{
    public string RuleId { get; set; } = "";
    public string Status { get; set; } = "";
    public int Percent { get; set; }
    public string? CurrentFile { get; set; }
    public string? Message { get; set; }
}

public sealed class MeshTerminalSessionInfo
{
    public string Id { get; set; } = "";
    public string HostId { get; set; } = "";
    public string? RemoteCwd { get; set; }
    public bool IsLocal { get; set; }
}
