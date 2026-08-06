namespace BNDZ.NativeShell.Core.Models;

/// <summary>Right preview column payload — Module 3 port surface.</summary>
public sealed class PreviewSnapshot
{
    public static PreviewSnapshot Empty { get; } = new()
    {
        Title = "No selection",
        Subtitle = "Select a file or folder to inspect.",
        Facts = [],
    };

    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public IReadOnlyList<PreviewFact> Facts { get; init; } = [];
    public string? FullPath { get; init; }
    public bool IsDirectory { get; init; }
}

public sealed class PreviewFact
{
    public required string Label { get; init; }
    public required string Value { get; init; }
}
