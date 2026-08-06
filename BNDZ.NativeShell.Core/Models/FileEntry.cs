namespace BNDZ.NativeShell.Core.Models;

/// <summary>One row in the native file list — Module 1 port surface.</summary>
public sealed class FileEntry
{
    public required string FullPath { get; init; }
    public required string Name { get; init; }
    public required bool IsDirectory { get; init; }
    public long SizeBytes { get; init; }
    public DateTimeOffset ModifiedUtc { get; init; }
    public string Extension { get; init; } = string.Empty;

    public string SizeDisplay =>
        IsDirectory ? string.Empty : FormatBytes(SizeBytes);

    public string ModifiedDisplay =>
        ModifiedUtc == default ? string.Empty : ModifiedUtc.LocalDateTime.ToString("g");

    public string KindDisplay =>
        IsDirectory ? "Folder" : (string.IsNullOrEmpty(Extension) ? "File" : Extension.TrimStart('.').ToUpperInvariant());

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
