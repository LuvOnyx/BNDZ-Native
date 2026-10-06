namespace BNDZ.Services.LanShare;

public sealed class LanShareSession
{
    public required string ShareId { get; init; }
    public required string FolderPath { get; init; }
    public required string FolderName { get; init; }
    public required string Token { get; init; }
    public required string LanAddress { get; init; }
    public required int Port { get; init; }
    public required string Url { get; init; }
    public bool HasPassword { get; init; }
    public DateTime StartedUtc { get; init; } = DateTime.UtcNow;
    public bool Running { get; set; } = true;
    public string? LastError { get; set; }
    public long BytesServed { get; set; }
    public int RequestCount { get; set; }

    public object ToDto() => new
    {
        shareId = ShareId,
        folderPath = FolderPath,
        folderName = FolderName,
        token = Token,
        lanAddress = LanAddress,
        port = Port,
        url = Url,
        hasPassword = HasPassword,
        startedUtc = StartedUtc,
        running = Running,
        lastError = LastError,
        bytesServed = BytesServed,
        requestCount = RequestCount,
        readOnly = true,
        bindMode = "lan-ip",
        protocols = new[] { "http" },
    };
}
