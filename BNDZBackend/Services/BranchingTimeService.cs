using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BNDZ.Services;

/// <summary>
/// Content-addressed folder time machine (Branching Time Impl B).
/// Blobs under %LocalAppData%/BNDZ/TimeMachine/blobs; named branches point at manifests.
/// </summary>
public sealed class BranchingTimeService
{
    private static readonly Lazy<BranchingTimeService> Lazy = new(() => new BranchingTimeService());
    public static BranchingTimeService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string _root;
    private readonly string _blobs;
    private readonly string _manifests;
    private readonly string _branchesDir;
    private readonly string _watchedFile;
    private readonly object _lock = new();
    private readonly HashSet<string> _watchedRoots = new(StringComparer.OrdinalIgnoreCase);

    private BranchingTimeService()
    {
        _root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "TimeMachine");
        _blobs = Path.Combine(_root, "blobs");
        _manifests = Path.Combine(_root, "manifests");
        _branchesDir = Path.Combine(_root, "branches");
        _watchedFile = Path.Combine(_root, "watched.json");
        Directory.CreateDirectory(_blobs);
        Directory.CreateDirectory(_manifests);
        Directory.CreateDirectory(_branchesDir);
        LoadWatched();
    }

    private void LoadWatched()
    {
        try
        {
            if (!File.Exists(_watchedFile)) return;
            var paths = JsonSerializer.Deserialize<string[]>(File.ReadAllText(_watchedFile), Json);
            if (paths == null) return;
            foreach (var p in paths)
            {
                if (!string.IsNullOrWhiteSpace(p) && Directory.Exists(p))
                    _watchedRoots.Add(Normalize(p));
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BranchingTime] LoadWatched: {ex.Message}");
        }
    }

    private void PersistWatched()
    {
        File.WriteAllText(_watchedFile, JsonSerializer.Serialize(_watchedRoots.ToArray(), Json));
    }

    public string[] ListWatchedRoots()
    {
        lock (_lock) return _watchedRoots.ToArray();
    }

    public void WatchRoot(string winPath)
    {
        var n = Normalize(winPath);
        if (!Directory.Exists(n))
            throw new DirectoryNotFoundException(n);
        lock (_lock)
        {
            _watchedRoots.Add(n);
            PersistWatched();
        }
    }

    public void UnwatchRoot(string winPath)
    {
        var n = Normalize(winPath);
        lock (_lock)
        {
            _watchedRoots.Remove(n);
            PersistWatched();
        }
    }

    /// <summary>Snapshot the tree under rootWinPath into a named branch tip.</summary>
    public BranchDto CreateBranch(string rootWinPath, string name, string? parentBranchId = null)
    {
        var root = Normalize(rootWinPath);
        if (!Directory.Exists(root))
            throw new DirectoryNotFoundException(root);
        if (string.IsNullOrWhiteSpace(name))
            throw new ArgumentException("Branch name required.");

        lock (_lock)
        {
            var entries = new List<ManifestEntry>();
            foreach (var file in EnumerateFilesSafe(root))
            {
                var rel = Path.GetRelativePath(root, file).Replace('/', '\\');
                var hash = HashFile(file);
                StoreBlob(hash, file);
                var info = new FileInfo(file);
                entries.Add(new ManifestEntry
                {
                    RelPath = rel,
                    ContentHash = hash,
                    Size = info.Length,
                    LastWriteUtc = info.LastWriteTimeUtc.ToString("O"),
                });
                FileLineageService.Instance.RecordContentNode(hash, file, info.Length);
            }

            var manifestId = Guid.NewGuid().ToString("N")[..16];
            var manifest = new ManifestDoc
            {
                Id = manifestId,
                RootWinPath = root,
                CreatedUtc = DateTime.UtcNow.ToString("O"),
                ParentManifestId = ResolveParentManifest(parentBranchId),
                Entries = entries,
            };
            File.WriteAllText(Path.Combine(_manifests, manifestId + ".json"), JsonSerializer.Serialize(manifest, Json));

            var branchId = Guid.NewGuid().ToString("N")[..12];
            var branch = new BranchDoc
            {
                Id = branchId,
                Name = name.Trim(),
                RootWinPath = root,
                TipManifestId = manifestId,
                CreatedUtc = DateTime.UtcNow.ToString("O"),
                ParentBranchId = parentBranchId,
            };
            File.WriteAllText(Path.Combine(_branchesDir, branchId + ".json"), JsonSerializer.Serialize(branch, Json));
            return ToDto(branch, manifest.Entries.Count);
        }
    }

    public BranchDto[] ListBranches(string? rootWinPath = null)
    {
        lock (_lock)
        {
            var list = new List<BranchDto>();
            foreach (var file in Directory.EnumerateFiles(_branchesDir, "*.json"))
            {
                try
                {
                    var doc = JsonSerializer.Deserialize<BranchDoc>(File.ReadAllText(file), Json);
                    if (doc == null) continue;
                    if (rootWinPath != null &&
                        !string.Equals(doc.RootWinPath, Normalize(rootWinPath), StringComparison.OrdinalIgnoreCase))
                        continue;
                    var count = CountManifestEntries(doc.TipManifestId);
                    list.Add(ToDto(doc, count));
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[BranchingTime] ListBranches: {ex.Message}");
                }
            }
            return list.OrderByDescending(b => b.CreatedUtc).ToArray();
        }
    }

    public ManifestPeekDto? PeekBranch(string branchId)
    {
        lock (_lock)
        {
            var branch = LoadBranch(branchId);
            if (branch == null) return null;
            var manifest = LoadManifest(branch.TipManifestId);
            if (manifest == null) return null;
            return new ManifestPeekDto
            {
                BranchId = branch.Id,
                BranchName = branch.Name,
                ManifestId = manifest.Id,
                RootWinPath = manifest.RootWinPath,
                CreatedUtc = manifest.CreatedUtc,
                FileCount = manifest.Entries?.Count ?? 0,
                TotalBytes = manifest.Entries?.Sum(e => e.Size) ?? 0,
                Entries = (manifest.Entries ?? new List<ManifestEntry>())
                    .Take(200)
                    .Select(e => new ManifestEntryDto
                    {
                        RelPath = e.RelPath,
                        ContentHash = e.ContentHash,
                        Size = e.Size,
                        LastWriteUtc = e.LastWriteUtc,
                    })
                    .ToArray(),
            };
        }
    }

    /// <summary>Restore selected relative paths (or all) from a branch tip into the live tree.</summary>
    public RestoreResultDto Restore(string branchId, string[]? relPaths = null)
    {
        lock (_lock)
        {
            var branch = LoadBranch(branchId)
                ?? throw new InvalidOperationException($"Branch '{branchId}' not found.");
            var manifest = LoadManifest(branch.TipManifestId)
                ?? throw new InvalidOperationException($"Manifest '{branch.TipManifestId}' missing.");

            var wanted = relPaths is { Length: > 0 }
                ? new HashSet<string>(relPaths.Select(NormalizeRel), StringComparer.OrdinalIgnoreCase)
                : null;

            var restored = 0;
            var skipped = 0;
            var errors = new List<string>();

            foreach (var entry in manifest.Entries ?? Enumerable.Empty<ManifestEntry>())
            {
                var rel = NormalizeRel(entry.RelPath);
                if (wanted != null && !wanted.Contains(rel)) continue;

                try
                {
                    var blob = BlobPath(entry.ContentHash);
                    if (!File.Exists(blob))
                    {
                        errors.Add($"Missing blob for {rel}");
                        skipped++;
                        continue;
                    }
                    var dest = Path.Combine(branch.RootWinPath, rel);
                    var destDir = Path.GetDirectoryName(dest);
                    if (!string.IsNullOrEmpty(destDir))
                        Directory.CreateDirectory(destDir);
                    File.Copy(blob, dest, overwrite: true);
                    restored++;
                    FileLineageService.Instance.RecordContentNode(entry.ContentHash, dest, entry.Size);
                    FileLineageService.Instance.RecordEdge(blob, dest, "branch_restore");
                }
                catch (Exception ex)
                {
                    errors.Add($"{rel}: {ex.Message}");
                    skipped++;
                }
            }

            return new RestoreResultDto
            {
                Ok = errors.Count == 0,
                Restored = restored,
                Skipped = skipped,
                Errors = errors.ToArray(),
            };
        }
    }

    public bool DeleteBranch(string branchId)
    {
        lock (_lock)
        {
            var path = Path.Combine(_branchesDir, branchId + ".json");
            if (!File.Exists(path)) return false;
            File.Delete(path);
            return true;
        }
    }

    private string? ResolveParentManifest(string? parentBranchId)
    {
        if (string.IsNullOrWhiteSpace(parentBranchId)) return null;
        return LoadBranch(parentBranchId)?.TipManifestId;
    }

    private BranchDoc? LoadBranch(string id)
    {
        var path = Path.Combine(_branchesDir, id + ".json");
        if (!File.Exists(path)) return null;
        return JsonSerializer.Deserialize<BranchDoc>(File.ReadAllText(path), Json);
    }

    private ManifestDoc? LoadManifest(string id)
    {
        var path = Path.Combine(_manifests, id + ".json");
        if (!File.Exists(path)) return null;
        return JsonSerializer.Deserialize<ManifestDoc>(File.ReadAllText(path), Json);
    }

    private int CountManifestEntries(string manifestId)
    {
        var m = LoadManifest(manifestId);
        return m?.Entries?.Count ?? 0;
    }

    private void StoreBlob(string hash, string sourceFile)
    {
        var dest = BlobPath(hash);
        if (File.Exists(dest)) return;
        var dir = Path.GetDirectoryName(dest);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.Copy(sourceFile, dest, overwrite: false);
    }

    private string BlobPath(string hash)
    {
        var prefix = hash.Length >= 2 ? hash[..2] : "00";
        return Path.Combine(_blobs, prefix, hash);
    }

    private static string HashFile(string path)
    {
        using var sha = SHA256.Create();
        using var fs = File.OpenRead(path);
        var hash = sha.ComputeHash(fs);
        var sb = new StringBuilder(hash.Length * 2);
        foreach (var b in hash) sb.Append(b.ToString("x2"));
        return sb.ToString();
    }

    private static IEnumerable<string> EnumerateFilesSafe(string root)
    {
        var stack = new Stack<string>();
        stack.Push(root);
        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            IEnumerable<string> files = Array.Empty<string>();
            IEnumerable<string> dirs = Array.Empty<string>();
            try { files = Directory.EnumerateFiles(dir); } catch { /* skip */ }
            try { dirs = Directory.EnumerateDirectories(dir); } catch { /* skip */ }
            foreach (var f in files) yield return f;
            foreach (var d in dirs)
            {
                var name = Path.GetFileName(d);
                if (name is ".git" or "node_modules" or ".vs" or "bin" or "obj") continue;
                stack.Push(d);
            }
        }
    }

    private static BranchDto ToDto(BranchDoc doc, int fileCount) => new()
    {
        Id = doc.Id,
        Name = doc.Name,
        RootWinPath = doc.RootWinPath,
        TipManifestId = doc.TipManifestId,
        CreatedUtc = doc.CreatedUtc,
        ParentBranchId = doc.ParentBranchId,
        FileCount = fileCount,
    };

    private static string Normalize(string path) =>
        Path.GetFullPath(path.Trim().TrimEnd('\\', '/'));

    private static string NormalizeRel(string rel) =>
        rel.Replace('/', '\\').TrimStart('\\');

    private sealed class BranchDoc
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string RootWinPath { get; set; } = "";
        public string TipManifestId { get; set; } = "";
        public string CreatedUtc { get; set; } = "";
        public string? ParentBranchId { get; set; }
    }

    private sealed class ManifestDoc
    {
        public string Id { get; set; } = "";
        public string RootWinPath { get; set; } = "";
        public string CreatedUtc { get; set; } = "";
        public string? ParentManifestId { get; set; }
        public List<ManifestEntry>? Entries { get; set; }
    }

    private sealed class ManifestEntry
    {
        public string RelPath { get; set; } = "";
        public string ContentHash { get; set; } = "";
        public long Size { get; set; }
        public string LastWriteUtc { get; set; } = "";
    }
}

public sealed class BranchDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string RootWinPath { get; set; } = "";
    public string TipManifestId { get; set; } = "";
    public string CreatedUtc { get; set; } = "";
    public string? ParentBranchId { get; set; }
    public int FileCount { get; set; }
}

public sealed class ManifestPeekDto
{
    public string BranchId { get; set; } = "";
    public string BranchName { get; set; } = "";
    public string ManifestId { get; set; } = "";
    public string RootWinPath { get; set; } = "";
    public string CreatedUtc { get; set; } = "";
    public int FileCount { get; set; }
    public long TotalBytes { get; set; }
    public ManifestEntryDto[] Entries { get; set; } = Array.Empty<ManifestEntryDto>();
}

public sealed class ManifestEntryDto
{
    public string RelPath { get; set; } = "";
    public string ContentHash { get; set; } = "";
    public long Size { get; set; }
    public string LastWriteUtc { get; set; } = "";
}

public sealed class RestoreResultDto
{
    public bool Ok { get; set; }
    public int Restored { get; set; }
    public int Skipped { get; set; }
    public string[] Errors { get; set; } = Array.Empty<string>();
}
