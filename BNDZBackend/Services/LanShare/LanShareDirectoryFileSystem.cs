using DiskAccessLibrary.FileSystems.Abstractions;

namespace BNDZ.Services.LanShare;

/// <summary>System.IO-backed IFileSystem for SMBLibrary.Adapters.NTFileSystemAdapter.</summary>
internal sealed class LanShareDirectoryFileSystem : IFileSystem
{
    private readonly string _root;
    private readonly bool _allowWrite;

    public LanShareDirectoryFileSystem(string rootFolder, bool allowWrite)
    {
        _root = Path.GetFullPath(rootFolder);
        _allowWrite = allowWrite;
    }

    public string Name => "BNDZ";
    public long Size => new DriveInfo(Path.GetPathRoot(_root) ?? _root).TotalSize;
    public long FreeSpace => new DriveInfo(Path.GetPathRoot(_root) ?? _root).AvailableFreeSpace;
    public bool SupportsNamedStreams => false;

    public FileSystemEntry GetEntry(string path)
    {
        var full = Map(path);
        if (Directory.Exists(full))
        {
            var di = new DirectoryInfo(full);
            return new FileSystemEntry(full, di.Name, true, 0, di.CreationTimeUtc, di.LastWriteTimeUtc, di.LastAccessTimeUtc, false, false, false);
        }
        if (File.Exists(full))
        {
            var fi = new FileInfo(full);
            return new FileSystemEntry(full, fi.Name, false, (ulong)fi.Length, fi.CreationTimeUtc, fi.LastWriteTimeUtc, fi.LastAccessTimeUtc, false, fi.IsReadOnly, false);
        }
        throw new FileNotFoundException(path);
    }

    public FileSystemEntry CreateFile(string path)
    {
        EnsureWrite();
        var full = Map(path);
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        using (File.Create(full)) { }
        return GetEntry(path);
    }

    public FileSystemEntry CreateDirectory(string path)
    {
        EnsureWrite();
        var full = Map(path);
        Directory.CreateDirectory(full);
        return GetEntry(path);
    }

    public void Move(string source, string destination)
    {
        EnsureWrite();
        var a = Map(source); var b = Map(destination);
        if (Directory.Exists(a)) Directory.Move(a, b);
        else File.Move(a, b);
    }

    public void Delete(string path)
    {
        EnsureWrite();
        var full = Map(path);
        if (Directory.Exists(full)) Directory.Delete(full, recursive: false);
        else if (File.Exists(full)) File.Delete(full);
    }

    public List<FileSystemEntry> ListEntriesInDirectory(string path)
    {
        var full = Map(path);
        var list = new List<FileSystemEntry>();
        foreach (var d in Directory.EnumerateDirectories(full))
        {
            var di = new DirectoryInfo(d);
            list.Add(new FileSystemEntry(d, di.Name, true, 0, di.CreationTimeUtc, di.LastWriteTimeUtc, di.LastAccessTimeUtc, false, false, false));
        }
        foreach (var f in Directory.EnumerateFiles(full))
        {
            var fi = new FileInfo(f);
            list.Add(new FileSystemEntry(f, fi.Name, false, (ulong)fi.Length, fi.CreationTimeUtc, fi.LastWriteTimeUtc, fi.LastAccessTimeUtc, false, fi.IsReadOnly, false));
        }
        return list;
    }

    public List<KeyValuePair<string, ulong>> ListDataStreams(string path) => new();

    public Stream OpenFile(string path, FileMode mode, FileAccess access, FileShare share, FileOptions options)
    {
        if (access != FileAccess.Read) EnsureWrite();
        return new FileStream(Map(path), mode, access, share, 4096, options);
    }

    public void SetAttributes(string path, bool? isHidden, bool? isReadonly, bool? isArchived)
    {
        EnsureWrite();
        var full = Map(path);
        var attrs = File.GetAttributes(full);
        if (isReadonly == true) attrs |= FileAttributes.ReadOnly;
        if (isReadonly == false) attrs &= ~FileAttributes.ReadOnly;
        if (isHidden == true) attrs |= FileAttributes.Hidden;
        if (isHidden == false) attrs &= ~FileAttributes.Hidden;
        if (isArchived == true) attrs |= FileAttributes.Archive;
        if (isArchived == false) attrs &= ~FileAttributes.Archive;
        File.SetAttributes(full, attrs);
    }

    public void SetDates(string path, DateTime? creation, DateTime? lastWrite, DateTime? lastAccess)
    {
        EnsureWrite();
        var full = Map(path);
        if (creation.HasValue) File.SetCreationTimeUtc(full, creation.Value);
        if (lastWrite.HasValue) File.SetLastWriteTimeUtc(full, lastWrite.Value);
        if (lastAccess.HasValue) File.SetLastAccessTimeUtc(full, lastAccess.Value);
    }

    private void EnsureWrite()
    {
        if (!_allowWrite) throw new UnauthorizedAccessException("Read-only share");
    }

    private string Map(string path)
    {
        var rel = (path ?? "").Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
        if (rel.Contains("..", StringComparison.Ordinal)) throw new UnauthorizedAccessException("traversal");
        if (string.IsNullOrEmpty(rel)) return _root;
        var mapped = Path.GetFullPath(Path.Combine(_root, rel));
        var prefix = _root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!mapped.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(mapped, _root, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("outside root");
        return mapped;
    }
}
