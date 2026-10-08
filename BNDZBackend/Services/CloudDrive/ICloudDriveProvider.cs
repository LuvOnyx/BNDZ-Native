namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Control-plane adapter for one Cloud Drive placement.
/// File bytes stay on the microVM disk — this interface does not proxy uploads.
/// </summary>
public interface ICloudDriveProvider
{
    /// <summary>fly | local-microvm</summary>
    string Id { get; }

    Task CreateAsync(CloudDriveRecord drive, CloudDriveCreateRequest request, Func<string?> readFlyToken, CancellationToken ct);
    Task StartAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct);
    Task StopAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct);
    Task DeleteAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct);
    Task RefreshAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct);
    Task<CloudDriveOp> CreateSnapshotAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct);
    Task<CloudDriveOp> ListSnapshotsAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct);
    Task<CloudDriveOp> RestoreSnapshotAsync(CloudDriveRecord drive, string snapshotId, Func<string?> readFlyToken, CancellationToken ct);
    Task<CloudDriveOp> DropPreviousVolumeAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct);
}

/// <summary>Result of a snapshot or move call. Ok false does not by itself mean the drive is broken.</summary>
public readonly record struct CloudDriveOp(bool Ok, string? Error);
