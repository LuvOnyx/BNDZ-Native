namespace BNDZ.Services.RamStaging;

public enum RamZoneKind
{
    RamDisk,
    FastStaging,
}

public enum RamZoneState
{
    Mounting,
    Ready,
    Dirty,
    Flushing,
    Unmounted,
    Error,
}

public sealed class RamStagingZone
{
    public required string Id { get; init; }
    public string Name { get; set; } = "Staging Zone";
    public RamZoneKind Kind { get; set; } = RamZoneKind.FastStaging;
    public RamZoneState State { get; set; } = RamZoneState.Mounting;
    public string MountPath { get; set; } = "";
    public string? DriveLetter { get; set; }
    public long SizeBudgetMb { get; set; } = 4096;
    public long UsedBytes { get; set; }
    public bool IsDirty { get; set; }
    public int StagedFileCount { get; set; }
    public DateTime CreatedUtc { get; init; } = DateTime.UtcNow;
    public string? Error { get; set; }

    public object ToDto() => new
    {
        id = Id,
        name = Name,
        kind = Kind.ToString().ToLowerInvariant(),
        state = State.ToString().ToLowerInvariant(),
        mountPath = MountPath,
        driveLetter = DriveLetter,
        sizeBudgetMb = SizeBudgetMb,
        usedBytes = UsedBytes,
        isDirty = IsDirty,
        stagedFileCount = StagedFileCount,
        createdUtc = CreatedUtc,
        error = Error,
    };
}

public sealed class RamZoneMapping
{
    public required string StagedPath { get; init; }
    public required string SourcePath { get; init; }
}
