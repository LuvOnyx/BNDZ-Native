namespace BNDZ.NativeShell.Core.Models;

/// <summary>Sidebar drive / special location — Files-like left rail, BNDZ Drives module.</summary>
public sealed class DriveEntry
{
    public required string Id { get; init; }
    public required string Label { get; init; }
    public required string Path { get; init; }
    public DriveKind Kind { get; init; }
    public long? TotalBytes { get; init; }
    public long? FreeBytes { get; init; }

    public string CapacityDisplay
    {
        get
        {
            if (TotalBytes is null || FreeBytes is null || TotalBytes <= 0)
                return string.Empty;
            var usedPct = 100.0 * (TotalBytes.Value - FreeBytes.Value) / TotalBytes.Value;
            return $"{FormatBytes(FreeBytes.Value)} free · {usedPct:0}% used";
        }
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        double value = bytes;
        string[] units = ["KB", "MB", "GB", "TB"];
        var unit = -1;
        do
        {
            value /= 1024;
            unit++;
        } while (value >= 1024 && unit < units.Length - 1);
        return $"{value:0.#} {units[unit]}";
    }
}

public enum DriveKind
{
    Fixed,
    Removable,
    Network,
    Special,
}
