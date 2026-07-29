namespace BNDZ.Services.MeshDrop;

public enum MeshDropSessionRole
{
    Host,
    Receiver,
}

public enum MeshDropSessionState
{
    Created,
    WaitingForAnswer,
    Connecting,
    Connected,
    Transferring,
    Completed,
    Failed,
    Cancelled,
}

public sealed class MeshDropSession
{
    public required string SessionId { get; init; }
    public MeshDropSessionRole Role { get; set; }
    public MeshDropSessionState State { get; set; } = MeshDropSessionState.Created;
    public string? Label { get; set; }
    public string? PeerLabel { get; set; }
    public string? Error { get; set; }
    public long TotalBytes { get; set; }
    public long TransferredBytes { get; set; }
    public double SpeedBytesPerSecond { get; set; }
    public int FileCount { get; set; }
    public int FilesCompleted { get; set; }
    public DateTime CreatedUtc { get; init; } = DateTime.UtcNow;
    public DateTime? CompletedUtc { get; set; }

    public object ToDto() => new
    {
        sessionId = SessionId,
        role = Role.ToString().ToLowerInvariant(),
        state = State.ToString().ToLowerInvariant(),
        label = Label,
        peerLabel = PeerLabel,
        error = Error,
        totalBytes = TotalBytes,
        transferredBytes = TransferredBytes,
        speedBytesPerSecond = SpeedBytesPerSecond,
        fileCount = FileCount,
        filesCompleted = FilesCompleted,
        createdUtc = CreatedUtc,
        completedUtc = CompletedUtc,
    };
}

public sealed class MeshDropFileEntry
{
    public required string RelativePath { get; init; }
    public long Size { get; init; }
    public required string Sha256 { get; init; }
    public bool IsDirectory { get; init; }
}

public sealed class MeshDropManifest
{
    public required string SessionId { get; init; }
    public required string HostName { get; init; }
    public required List<MeshDropFileEntry> Files { get; init; }
    public long TotalBytes => Files.Where(f => !f.IsDirectory).Sum(f => f.Size);
}

public sealed class MeshDropLanPeer
{
    public required string DisplayName { get; init; }
    public required string HostName { get; init; }
    public required string Address { get; init; }
    public int Port { get; init; }
    public string? SessionHint { get; init; }
}
