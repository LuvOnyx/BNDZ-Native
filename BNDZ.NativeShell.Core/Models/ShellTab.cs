namespace BNDZ.NativeShell.Core.Models;

/// <summary>One shell tab — path + display title (Files TabBar pattern, BNDZ tab semantics).</summary>
public sealed class ShellTab
{
    public Guid Id { get; } = Guid.NewGuid();
    public required string Path { get; set; }
    public string Title { get; set; } = "Home";
}
