using BNDZ.NativeShell.Core.Models;

namespace BNDZ.NativeShell.Core.Contracts;

/// <summary>
/// Directory listing contract. Spike uses <see cref="Services.LocalFolderCatalog"/>;
/// later ports swap in BNDZBackend <c>ShellFolderEnumerator</c> / index-backed catalog
/// without rewriting the WinUI shell.
/// </summary>
public interface IFolderCatalog
{
    Task<IReadOnlyList<FileEntry>> ListAsync(string path, CancellationToken ct = default);
    bool Exists(string path);
    string? GetParent(string path);
}
