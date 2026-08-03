using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace BNDZ.Services;

public sealed class LibraryHealthService : IDisposable
{
    private static readonly Lazy<LibraryHealthService> Lazy = new(() => new LibraryHealthService());
    public static LibraryHealthService Instance => Lazy.Value;

    private const int MaxDepth = 12;
    private const int BatchSize = 200;

    private readonly string _dbPath;
    private readonly object _schemaGate = new();
    private volatile bool _schemaReady;

    private LibraryHealthService()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Index");
        Directory.CreateDirectory(dir);
        _dbPath = Path.Combine(dir, "health.db");
        EnsureSchema();
    }

    public void Dispose() { }

    private void EnsureSchema()
    {
        if (_schemaReady) return;
        lock (_schemaGate)
        {
            if (_schemaReady) return;
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=NORMAL;
                PRAGMA busy_timeout=8000;
                CREATE TABLE IF NOT EXISTS problems (
                    id       TEXT PRIMARY KEY,
                    kind     TEXT NOT NULL,
                    severity TEXT NOT NULL,
                    path     TEXT NOT NULL,
                    detail   TEXT,
                    fixHint  TEXT,
                    scannedUtc TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_problems_kind ON problems(kind);
                CREATE INDEX IF NOT EXISTS idx_problems_path ON problems(path);
                CREATE INDEX IF NOT EXISTS idx_problems_severity ON problems(severity);
                """;
            cmd.ExecuteNonQuery();
            _schemaReady = true;
        }
    }

    public async Task ScanAsync(string rootWinPath, IProgress<HealthScanProgress>? progress, CancellationToken ct)
    {
        var root = Path.GetFullPath(rootWinPath);
        if (!Directory.Exists(root))
            throw new DirectoryNotFoundException($"Root path does not exist: {root}");

        var normalizedRoot = root.TrimEnd('\\', '/');
        var problems = new List<HealthProblem>();
        var scanned = 0;

        await Task.Run(() =>
        {
            WalkDirectory(normalizedRoot, root, 0, problems, ref scanned, progress, ct);
        }, ct).ConfigureAwait(false);

        ct.ThrowIfCancellationRequested();

        using var conn = OpenConnection();
        using var tx = conn.BeginTransaction();

        using (var delCmd = conn.CreateCommand())
        {
            delCmd.Transaction = tx;
            delCmd.CommandText = "DELETE FROM problems WHERE path LIKE @prefix || '%'";
            delCmd.Parameters.AddWithValue("@prefix", normalizedRoot);
            delCmd.ExecuteNonQuery();
        }

        if (problems.Count > 0)
        {
            using var ins = conn.CreateCommand();
            ins.Transaction = tx;
            ins.CommandText = """
                INSERT OR REPLACE INTO problems (id, kind, severity, path, detail, fixHint, scannedUtc)
                VALUES (@id, @kind, @severity, @path, @detail, @fixHint, @scannedUtc)
                """;
            var pId = ins.Parameters.Add("@id", SqliteType.Text);
            var pKind = ins.Parameters.Add("@kind", SqliteType.Text);
            var pSeverity = ins.Parameters.Add("@severity", SqliteType.Text);
            var pPath = ins.Parameters.Add("@path", SqliteType.Text);
            var pDetail = ins.Parameters.Add("@detail", SqliteType.Text);
            var pFixHint = ins.Parameters.Add("@fixHint", SqliteType.Text);
            var pScanned = ins.Parameters.Add("@scannedUtc", SqliteType.Text);
            ins.Prepare();

            foreach (var p in problems)
            {
                pId.Value = p.Id;
                pKind.Value = p.Kind;
                pSeverity.Value = p.Severity;
                pPath.Value = p.Path;
                pDetail.Value = (object?)p.Detail ?? DBNull.Value;
                pFixHint.Value = (object?)p.FixHint ?? DBNull.Value;
                pScanned.Value = p.ScannedUtc;
                ins.ExecuteNonQuery();
            }
        }

        tx.Commit();

        progress?.Report(new HealthScanProgress
        {
            CurrentPath = root,
            ScannedCount = scanned,
            ProblemsFound = problems.Count,
            Done = true,
        });
    }

    private void WalkDirectory(
        string dirPath,
        string root,
        int depth,
        List<HealthProblem> problems,
        ref int scanned,
        IProgress<HealthScanProgress>? progress,
        CancellationToken ct)
    {
        if (depth > MaxDepth) return;
        ct.ThrowIfCancellationRequested();

        IEnumerable<string> entries;
        try
        {
            entries = Directory.EnumerateFileSystemEntries(dirPath);
        }
        catch (UnauthorizedAccessException)
        {
            problems.Add(MakeProblem("AclDenied", "warning", dirPath,
                "Access denied during scan", "Check directory permissions or run as administrator"));
            return;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Health] Cannot enumerate {dirPath}: {ex.Message}");
            return;
        }

        var childCount = 0;

        foreach (var entry in entries)
        {
            ct.ThrowIfCancellationRequested();
            childCount++;
            scanned++;

            if (scanned % BatchSize == 0)
            {
                progress?.Report(new HealthScanProgress
                {
                    CurrentPath = entry,
                    ScannedCount = scanned,
                    ProblemsFound = problems.Count,
                    Done = false,
                });
            }

            try
            {
                var fullPath = entry;
                if (fullPath.Length > 260)
                {
                    problems.Add(MakeProblem("LongPath", "warning", fullPath,
                        $"Path length {fullPath.Length} exceeds 260 characters",
                        "Shorten directory nesting or rename with shorter names"));
                }

                var attrs = File.GetAttributes(fullPath);

                if (attrs.HasFlag(FileAttributes.ReparsePoint))
                {
                    CheckReparseTarget(fullPath, attrs, problems);
                }

                if (attrs.HasFlag(FileAttributes.Directory))
                {
                    if (!attrs.HasFlag(FileAttributes.ReparsePoint))
                        WalkDirectory(fullPath, root, depth + 1, problems, ref scanned, progress, ct);
                }
                else
                {
                    var name = Path.GetFileName(fullPath);
                    if (name.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase))
                        CheckShortcutTarget(fullPath, problems);

                    CheckOrphanSidecar(fullPath, name, problems);
                }
            }
            catch (UnauthorizedAccessException)
            {
                problems.Add(MakeProblem("AclDenied", "warning", entry,
                    "Access denied", "Check file/folder permissions"));
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Health] Error processing {entry}: {ex.Message}");
            }
        }

        if (childCount == 0 && !string.Equals(dirPath, root, StringComparison.OrdinalIgnoreCase))
        {
            problems.Add(MakeProblem("EmptyDir", "info", dirPath,
                "Directory contains no files or subdirectories",
                "Delete if unneeded, or add content"));
        }
    }

    private static void CheckReparseTarget(string fullPath, FileAttributes attrs, List<HealthProblem> problems)
    {
        try
        {
            if (attrs.HasFlag(FileAttributes.Directory))
            {
                if (!Directory.Exists(fullPath))
                {
                    problems.Add(MakeProblem("BrokenLink", "error", fullPath,
                        "Symbolic link target directory does not exist or is inaccessible",
                        "Re-create the symlink or remove it"));
                }
            }
            else
            {
                var target = TryResolveSymlinkTarget(fullPath);
                if (target != null && !File.Exists(target) && !Directory.Exists(target))
                {
                    problems.Add(MakeProblem("BrokenLink", "error", fullPath,
                        $"Symlink target missing: {target}",
                        "Re-create the symlink or remove it"));
                }
                else if (target == null && !File.Exists(fullPath))
                {
                    problems.Add(MakeProblem("BrokenLink", "error", fullPath,
                        "Reparse point target cannot be resolved",
                        "Remove or re-create the link"));
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Health] Reparse check failed for {fullPath}: {ex.Message}");
        }
    }

    private static string? TryResolveSymlinkTarget(string path)
    {
        try
        {
            var fi = new FileInfo(path);
            if (fi.LinkTarget != null) return fi.LinkTarget;
            var di = new DirectoryInfo(path);
            return di.LinkTarget;
        }
        catch
        {
            return null;
        }
    }

    private static void CheckShortcutTarget(string lnkPath, List<HealthProblem> problems)
    {
        try
        {
            var targetPath = ResolveShortcutTarget(lnkPath);
            if (targetPath != null && !File.Exists(targetPath) && !Directory.Exists(targetPath))
            {
                problems.Add(MakeProblem("BrokenLink", "error", lnkPath,
                    $"Shortcut target missing: {targetPath}",
                    "Update or delete the shortcut"));
            }
            else if (targetPath == null)
            {
                problems.Add(MakeProblem("MissingTarget", "warning", lnkPath,
                    "Could not resolve shortcut target",
                    "Open shortcut properties and verify target path"));
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Health] Shortcut check failed for {lnkPath}: {ex.Message}");
        }
    }

    private static string? ResolveShortcutTarget(string lnkPath)
    {
        try
        {
            using var stream = File.OpenRead(lnkPath);
            using var reader = new BinaryReader(stream);

            if (stream.Length < 76) return null;

            var headerSize = reader.ReadInt32();
            if (headerSize != 0x4C) return null;
            reader.ReadBytes(16); // CLSID
            var flags = reader.ReadInt32();

            reader.ReadBytes(56); // rest of header

            if ((flags & 0x01) != 0) // HasLinkTargetIDList
            {
                var idListSize = reader.ReadUInt16();
                reader.ReadBytes(idListSize);
            }

            if ((flags & 0x02) != 0) // HasLinkInfo
            {
                var linkInfoStart = stream.Position;
                var linkInfoSize = reader.ReadInt32();
                reader.ReadInt32(); // LinkInfoHeaderSize
                reader.ReadInt32(); // LinkInfoFlags
                var volIdOffset = reader.ReadInt32();
                var localBasePathOffset = reader.ReadInt32();

                if (localBasePathOffset > 0)
                {
                    stream.Position = linkInfoStart + localBasePathOffset;
                    var pathBytes = new List<byte>();
                    byte b;
                    while ((b = reader.ReadByte()) != 0)
                        pathBytes.Add(b);
                    var path = System.Text.Encoding.Default.GetString(pathBytes.ToArray());
                    if (!string.IsNullOrWhiteSpace(path)) return path;
                }
            }

            return null;
        }
        catch
        {
            return null;
        }
    }

    private static void CheckOrphanSidecar(string fullPath, string name, List<HealthProblem> problems)
    {
        if (!name.EndsWith(".bndz-tags.json", StringComparison.OrdinalIgnoreCase))
            return;

        var baseName = name[..^".bndz-tags.json".Length];
        if (string.IsNullOrEmpty(baseName)) return;

        var dir = Path.GetDirectoryName(fullPath);
        if (string.IsNullOrEmpty(dir)) return;

        var parentFile = Path.Combine(dir, baseName);
        if (!File.Exists(parentFile) && !Directory.Exists(parentFile))
        {
            problems.Add(MakeProblem("OrphanSidecar", "info", fullPath,
                $"Sidecar file has no matching parent: {baseName}",
                "Delete the orphaned sidecar or restore the parent file"));
        }
    }

    public List<HealthProblemDto> ListProblems(string? rootPrefix = null, int limit = 500)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();

        if (!string.IsNullOrEmpty(rootPrefix))
        {
            cmd.CommandText = "SELECT id, kind, severity, path, detail, fixHint, scannedUtc FROM problems WHERE path LIKE @prefix || '%' ORDER BY severity, kind LIMIT @limit";
            cmd.Parameters.AddWithValue("@prefix", rootPrefix);
        }
        else
        {
            cmd.CommandText = "SELECT id, kind, severity, path, detail, fixHint, scannedUtc FROM problems ORDER BY severity, kind LIMIT @limit";
        }
        cmd.Parameters.AddWithValue("@limit", limit);

        var list = new List<HealthProblemDto>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            list.Add(new HealthProblemDto
            {
                Id = reader.GetString(0),
                Kind = reader.GetString(1),
                Severity = reader.GetString(2),
                Path = reader.GetString(3),
                Detail = reader.IsDBNull(4) ? null : reader.GetString(4),
                FixHint = reader.IsDBNull(5) ? null : reader.GetString(5),
                ScannedUtc = reader.GetString(6),
            });
        }
        return list;
    }

    public HealthFixResult FixProblem(string problemId)
    {
        var problem = ListProblems().FirstOrDefault(p => p.Id == problemId);
        if (problem == null)
            return new HealthFixResult { Ok = false, Error = "Problem not found — it may have been cleared." };

        try
        {
            switch (problem.Kind)
            {
                case "EmptyDir":
                    if (Directory.Exists(problem.Path))
                    {
                        var children = Directory.EnumerateFileSystemEntries(problem.Path).Any();
                        if (children)
                            return new HealthFixResult { Ok = false, Error = "Directory is no longer empty." };
                        Directory.Delete(problem.Path, recursive: false);
                        RemoveProblem(problemId);
                        return new HealthFixResult { Ok = true, Action = "Deleted empty directory." };
                    }
                    RemoveProblem(problemId);
                    return new HealthFixResult { Ok = true, Action = "Directory already removed." };

                case "OrphanSidecar":
                    if (File.Exists(problem.Path))
                    {
                        File.Delete(problem.Path);
                        RemoveProblem(problemId);
                        return new HealthFixResult { Ok = true, Action = "Deleted orphaned sidecar file." };
                    }
                    RemoveProblem(problemId);
                    return new HealthFixResult { Ok = true, Action = "Sidecar already removed." };

                case "BrokenLink":
                    if (File.Exists(problem.Path))
                    {
                        File.Delete(problem.Path);
                        RemoveProblem(problemId);
                        return new HealthFixResult { Ok = true, Action = "Removed broken symlink/shortcut." };
                    }
                    else if (Directory.Exists(problem.Path))
                    {
                        Directory.Delete(problem.Path, recursive: false);
                        RemoveProblem(problemId);
                        return new HealthFixResult { Ok = true, Action = "Removed broken directory link." };
                    }
                    RemoveProblem(problemId);
                    return new HealthFixResult { Ok = true, Action = "Link already removed." };

                case "MissingTarget":
                    if (File.Exists(problem.Path))
                    {
                        File.Delete(problem.Path);
                        RemoveProblem(problemId);
                        return new HealthFixResult { Ok = true, Action = "Removed shortcut with missing target." };
                    }
                    RemoveProblem(problemId);
                    return new HealthFixResult { Ok = true, Action = "Shortcut already removed." };

                case "LongPath":
                    return new HealthFixResult { Ok = false, Error = "Long paths require manual renaming — BNDZ cannot auto-shorten." };

                case "AclDenied":
                    return new HealthFixResult { Ok = false, Error = "Permission issues require manual resolution or elevated privileges." };

                default:
                    return new HealthFixResult { Ok = false, Error = $"No auto-fix available for problem kind '{problem.Kind}'." };
            }
        }
        catch (UnauthorizedAccessException)
        {
            return new HealthFixResult { Ok = false, Error = "Access denied — run as administrator or check permissions." };
        }
        catch (Exception ex)
        {
            return new HealthFixResult { Ok = false, Error = ex.Message };
        }
    }

    private void RemoveProblem(string problemId)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM problems WHERE id = @id";
        cmd.Parameters.AddWithValue("@id", problemId);
        cmd.ExecuteNonQuery();
    }

    public void ClearProblems(string? rootPrefix = null)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();

        if (!string.IsNullOrEmpty(rootPrefix))
        {
            cmd.CommandText = "DELETE FROM problems WHERE path LIKE @prefix || '%'";
            cmd.Parameters.AddWithValue("@prefix", rootPrefix);
        }
        else
        {
            cmd.CommandText = "DELETE FROM problems";
        }
        cmd.ExecuteNonQuery();
    }

    public HealthSummaryDto GetSummary()
    {
        using var conn = OpenConnection();
        var dto = new HealthSummaryDto();

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT severity, COUNT(*) FROM problems GROUP BY severity";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
                dto.BySeverity[reader.GetString(0)] = reader.GetInt32(1);
        }

        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT kind, COUNT(*) FROM problems GROUP BY kind";
            using var reader = cmd.ExecuteReader();
            while (reader.Read())
                dto.ByKind[reader.GetString(0)] = reader.GetInt32(1);
        }

        dto.Total = dto.BySeverity.Values.Sum();
        return dto;
    }

    private SqliteConnection OpenConnection()
    {
        var conn = new SqliteConnection($"Data Source={_dbPath}");
        conn.Open();
        using var pragma = conn.CreateCommand();
        pragma.CommandText = "PRAGMA busy_timeout=8000;";
        pragma.ExecuteNonQuery();
        return conn;
    }

    private static HealthProblem MakeProblem(string kind, string severity, string path, string detail, string fixHint)
        => new()
        {
            Id = Guid.NewGuid().ToString("N")[..16],
            Kind = kind,
            Severity = severity,
            Path = path,
            Detail = detail,
            FixHint = fixHint,
            ScannedUtc = DateTime.UtcNow.ToString("O"),
        };
}

public sealed class HealthProblem
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Severity { get; set; } = "";
    public string Path { get; set; } = "";
    public string? Detail { get; set; }
    public string? FixHint { get; set; }
    public string ScannedUtc { get; set; } = "";
}

public sealed class HealthProblemDto
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Severity { get; set; } = "";
    public string Path { get; set; } = "";
    public string? Detail { get; set; }
    public string? FixHint { get; set; }
    public string ScannedUtc { get; set; } = "";
}

public sealed class HealthScanProgress
{
    public string CurrentPath { get; set; } = "";
    public int ScannedCount { get; set; }
    public int ProblemsFound { get; set; }
    public bool Done { get; set; }
}

public sealed class HealthSummaryDto
{
    public int Total { get; set; }
    public Dictionary<string, int> BySeverity { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<string, int> ByKind { get; set; } = new(StringComparer.OrdinalIgnoreCase);
}

public sealed class HealthFixResult
{
    public bool Ok { get; set; }
    public string? Action { get; set; }
    public string? Error { get; set; }
}
