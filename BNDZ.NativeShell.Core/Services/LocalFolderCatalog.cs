using BNDZ.NativeShell.Core.Contracts;
using BNDZ.NativeShell.Core.Models;

namespace BNDZ.NativeShell.Core.Services;

/// <summary>System.IO-backed catalog for the spike. Replace with shell enumerator when porting Module 4+.</summary>
public sealed class LocalFolderCatalog : IFolderCatalog
{
    public bool Exists(string path) =>
        !string.IsNullOrWhiteSpace(path) && (Directory.Exists(path) || File.Exists(path));

    public string? GetParent(string path)
    {
        try
        {
            var full = Path.GetFullPath(path);
            var parent = Directory.GetParent(full);
            return parent?.FullName;
        }
        catch
        {
            return null;
        }
    }

    public Task<IReadOnlyList<FileEntry>> ListAsync(string path, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
            return Task.FromResult<IReadOnlyList<FileEntry>>(Array.Empty<FileEntry>());

        var entries = new List<FileEntry>();
        try
        {
            foreach (var dir in Directory.EnumerateDirectories(path))
            {
                ct.ThrowIfCancellationRequested();
                entries.Add(FromDirectory(dir));
            }

            foreach (var file in Directory.EnumerateFiles(path))
            {
                ct.ThrowIfCancellationRequested();
                entries.Add(FromFile(file));
            }
        }
        catch (UnauthorizedAccessException)
        {
            return Task.FromResult<IReadOnlyList<FileEntry>>(Array.Empty<FileEntry>());
        }
        catch (IOException)
        {
            return Task.FromResult<IReadOnlyList<FileEntry>>(Array.Empty<FileEntry>());
        }

        entries.Sort(static (a, b) =>
        {
            var byKind = b.IsDirectory.CompareTo(a.IsDirectory);
            return byKind != 0
                ? byKind
                : string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase);
        });

        return Task.FromResult<IReadOnlyList<FileEntry>>(entries);
    }

    private static FileEntry FromDirectory(string path)
    {
        var info = new DirectoryInfo(path);
        return new FileEntry
        {
            FullPath = info.FullName,
            Name = info.Name,
            IsDirectory = true,
            ModifiedUtc = info.LastWriteTimeUtc,
        };
    }

    private static FileEntry FromFile(string path)
    {
        var info = new FileInfo(path);
        return new FileEntry
        {
            FullPath = info.FullName,
            Name = info.Name,
            IsDirectory = false,
            SizeBytes = info.Length,
            ModifiedUtc = info.LastWriteTimeUtc,
            Extension = info.Extension,
        };
    }
}
