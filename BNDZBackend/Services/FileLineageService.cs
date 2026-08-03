using System;
using System.Buffers;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Hashing;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace BNDZ.Services;

public sealed class LineageEdge
{
    public string Id { get; set; } = "";
    public string FromPath { get; set; } = "";
    public string ToPath { get; set; } = "";
    public string Op { get; set; } = "";
    public string Actor { get; set; } = "bndz";
    public string Utc { get; set; } = "";
    public string? MetaJson { get; set; }
}

public sealed class ContentNode
{
    public string Hash { get; set; } = "";
    public long Size { get; set; }
    public string FirstSeenUtc { get; set; } = "";
    public List<string> Paths { get; set; } = new();
}

public sealed class ContentDagEdge
{
    public string Id { get; set; } = "";
    public string ParentHash { get; set; } = "";
    public string ChildHash { get; set; } = "";
    public string Op { get; set; } = "";
    public string Utc { get; set; } = "";
    public string? FromPath { get; set; }
    public string? ToPath { get; set; }
}

public sealed class ContentDagResult
{
    public string FocusHash { get; set; } = "";
    public List<ContentNode> Nodes { get; set; } = new();
    public List<ContentDagEdge> Edges { get; set; } = new();
}

public sealed class LineageResult
{
    public string Path { get; set; } = "";
    public List<LineageEdge> Inbound { get; set; } = new();
    public List<LineageEdge> Outbound { get; set; } = new();
    public List<LineageEdge> Timeline { get; set; } = new();
    public ContentDagResult? ContentDag { get; set; }
}

public sealed class FileLineageService : IDisposable
{
    private static readonly Lazy<FileLineageService> Lazy = new(() => new FileLineageService());
    public static FileLineageService Instance => Lazy.Value;

    private readonly string _dbPath;
    private readonly object _schemaGate = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private volatile bool _schemaReady;

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = false,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private FileLineageService()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Lineage");
        Directory.CreateDirectory(dir);
        _dbPath = Path.Combine(dir, "lineage.db");
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
                CREATE TABLE IF NOT EXISTS edges (
                    id      TEXT PRIMARY KEY,
                    fromPath TEXT NOT NULL,
                    toPath   TEXT NOT NULL,
                    op       TEXT NOT NULL,
                    actor    TEXT NOT NULL DEFAULT 'bndz',
                    utc      TEXT NOT NULL,
                    metaJson TEXT
                );
                CREATE INDEX IF NOT EXISTS ix_to   ON edges(toPath);
                CREATE INDEX IF NOT EXISTS ix_from ON edges(fromPath);

                CREATE TABLE IF NOT EXISTS content_nodes (
                    hash      TEXT NOT NULL,
                    path      TEXT NOT NULL,
                    size      INTEGER NOT NULL,
                    firstSeenUtc TEXT NOT NULL,
                    PRIMARY KEY (hash, path)
                );
                CREATE INDEX IF NOT EXISTS ix_cn_path ON content_nodes(path);
                CREATE INDEX IF NOT EXISTS ix_cn_hash ON content_nodes(hash);

                CREATE TABLE IF NOT EXISTS content_dag_edges (
                    id         TEXT PRIMARY KEY,
                    parentHash TEXT NOT NULL,
                    childHash  TEXT NOT NULL,
                    op         TEXT NOT NULL,
                    utc        TEXT NOT NULL,
                    fromPath   TEXT,
                    toPath     TEXT
                );
                CREATE INDEX IF NOT EXISTS ix_cde_parent ON content_dag_edges(parentHash);
                CREATE INDEX IF NOT EXISTS ix_cde_child  ON content_dag_edges(childHash);
                """;
            cmd.ExecuteNonQuery();
            _schemaReady = true;
        }
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

    private static string NormKey(string path) =>
        Path.GetFullPath(path).Replace('/', '\\').ToLowerInvariant();

    public void RecordEdge(string fromPath, string toPath, string op, string? actor = "bndz", object? meta = null)
    {
        var edge = new LineageEdge
        {
            Id = Guid.NewGuid().ToString("N"),
            FromPath = fromPath,
            ToPath = toPath,
            Op = op,
            Actor = actor ?? "bndz",
            Utc = DateTime.UtcNow.ToString("o"),
            MetaJson = meta is not null ? JsonSerializer.Serialize(meta, JsonOpts) : null
        };
        InsertEdge(edge);
    }

    public void RecordEdges(IEnumerable<(string from, string to, string op, string? actor, object? meta)> batch)
    {
        var utc = DateTime.UtcNow.ToString("o");
        var edges = batch.Select(b => new LineageEdge
        {
            Id = Guid.NewGuid().ToString("N"),
            FromPath = b.from,
            ToPath = b.to,
            Op = b.op,
            Actor = b.actor ?? "bndz",
            Utc = utc,
            MetaJson = b.meta is not null ? JsonSerializer.Serialize(b.meta, JsonOpts) : null
        }).ToList();

        InsertEdges(edges);
    }

    private void InsertEdge(LineageEdge e)
    {
        _writeLock.Wait();
        try
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT OR REPLACE INTO edges (id, fromPath, toPath, op, actor, utc, metaJson)
                VALUES ($id, $from, $to, $op, $actor, $utc, $meta)
                """;
            BindEdge(cmd, e);
            cmd.ExecuteNonQuery();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Lineage] InsertEdge failed: {ex.Message}");
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private void InsertEdges(List<LineageEdge> edges)
    {
        if (edges.Count == 0) return;
        _writeLock.Wait();
        try
        {
            using var conn = OpenConnection();
            using var tx = conn.BeginTransaction();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT OR REPLACE INTO edges (id, fromPath, toPath, op, actor, utc, metaJson)
                VALUES ($id, $from, $to, $op, $actor, $utc, $meta)
                """;
            cmd.Parameters.Add("$id", SqliteType.Text);
            cmd.Parameters.Add("$from", SqliteType.Text);
            cmd.Parameters.Add("$to", SqliteType.Text);
            cmd.Parameters.Add("$op", SqliteType.Text);
            cmd.Parameters.Add("$actor", SqliteType.Text);
            cmd.Parameters.Add("$utc", SqliteType.Text);
            cmd.Parameters.Add("$meta", SqliteType.Text);

            foreach (var e in edges)
            {
                cmd.Parameters["$id"].Value = e.Id;
                cmd.Parameters["$from"].Value = NormKey(e.FromPath);
                cmd.Parameters["$to"].Value = NormKey(e.ToPath);
                cmd.Parameters["$op"].Value = e.Op;
                cmd.Parameters["$actor"].Value = e.Actor;
                cmd.Parameters["$utc"].Value = e.Utc;
                cmd.Parameters["$meta"].Value = (object?)e.MetaJson ?? DBNull.Value;
                cmd.ExecuteNonQuery();
            }
            tx.Commit();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Lineage] InsertEdges batch failed: {ex.Message}");
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private static void BindEdge(SqliteCommand cmd, LineageEdge e)
    {
        cmd.Parameters.AddWithValue("$id", e.Id);
        cmd.Parameters.AddWithValue("$from", NormKey(e.FromPath));
        cmd.Parameters.AddWithValue("$to", NormKey(e.ToPath));
        cmd.Parameters.AddWithValue("$op", e.Op);
        cmd.Parameters.AddWithValue("$actor", e.Actor);
        cmd.Parameters.AddWithValue("$utc", e.Utc);
        cmd.Parameters.AddWithValue("$meta", (object?)e.MetaJson ?? DBNull.Value);
    }

    public LineageResult GetLineage(string path, int depth = 8)
    {
        var result = new LineageResult { Path = path };
        depth = Math.Clamp(depth, 1, 32);
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        using var conn = OpenConnection();
        CollectLineage(conn, NormKey(path), depth, visited, result);

        result.Timeline = result.Inbound
            .Concat(result.Outbound)
            .GroupBy(e => e.Id)
            .Select(g => g.First())
            .OrderByDescending(e => e.Utc)
            .ToList();

        return result;
    }

    private void CollectLineage(SqliteConnection conn, string normPath, int remaining,
        HashSet<string> visited, LineageResult result)
    {
        if (remaining <= 0 || !visited.Add(normPath)) return;

        var inbound = QueryEdges(conn, "toPath", normPath);
        var outbound = QueryEdges(conn, "fromPath", normPath);

        foreach (var e in inbound)
            if (!result.Inbound.Any(x => x.Id == e.Id))
                result.Inbound.Add(e);

        foreach (var e in outbound)
            if (!result.Outbound.Any(x => x.Id == e.Id))
                result.Outbound.Add(e);

        foreach (var e in inbound)
            CollectLineage(conn, NormKey(e.FromPath), remaining - 1, visited, result);

        foreach (var e in outbound)
            CollectLineage(conn, NormKey(e.ToPath), remaining - 1, visited, result);
    }

    private static List<LineageEdge> QueryEdges(SqliteConnection conn, string column, string normPath)
    {
        var edges = new List<LineageEdge>();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT id, fromPath, toPath, op, actor, utc, metaJson FROM edges WHERE {column} = $p COLLATE NOCASE";
        cmd.Parameters.AddWithValue("$p", normPath);
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            edges.Add(new LineageEdge
            {
                Id = r.GetString(0),
                FromPath = r.GetString(1),
                ToPath = r.GetString(2),
                Op = r.GetString(3),
                Actor = r.GetString(4),
                Utc = r.GetString(5),
                MetaJson = r.IsDBNull(6) ? null : r.GetString(6)
            });
        }
        return edges;
    }

    public List<LineageEdge> GetRecent(int limit = 50)
    {
        limit = Math.Clamp(limit, 1, 500);
        var edges = new List<LineageEdge>();
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT id, fromPath, toPath, op, actor, utc, metaJson FROM edges ORDER BY utc DESC LIMIT $lim";
        cmd.Parameters.AddWithValue("$lim", limit);
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            edges.Add(new LineageEdge
            {
                Id = r.GetString(0),
                FromPath = r.GetString(1),
                ToPath = r.GetString(2),
                Op = r.GetString(3),
                Actor = r.GetString(4),
                Utc = r.GetString(5),
                MetaJson = r.IsDBNull(6) ? null : r.GetString(6)
            });
        }
        return edges;
    }

    // ═══════════════════════════════════════════════════════
    //  Content-Identity DAG — hash genealogy
    // ═══════════════════════════════════════════════════════

    public async Task<string?> ComputeContentHashAsync(string filePath, CancellationToken ct = default)
    {
        try
        {
            if (!File.Exists(filePath)) return null;
            var fi = new FileInfo(filePath);
            if (fi.Length == 0 || fi.Length > 4L * 1024 * 1024 * 1024) return null;

            await using var stream = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.Read, 81920, true);
            using var sha = SHA256.Create();
            var hash = await sha.ComputeHashAsync(stream, ct).ConfigureAwait(false);
            return BitConverter.ToString(hash).Replace("-", "").ToLowerInvariant();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Lineage] ContentHash failed for {filePath}: {ex.Message}");
            return null;
        }
    }

    public void RecordContentNode(string hash, string filePath, long size)
    {
        _writeLock.Wait();
        try
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT OR IGNORE INTO content_nodes (hash, path, size, firstSeenUtc)
                VALUES ($hash, $path, $size, $utc)
                """;
            cmd.Parameters.AddWithValue("$hash", hash);
            cmd.Parameters.AddWithValue("$path", NormKey(filePath));
            cmd.Parameters.AddWithValue("$size", size);
            cmd.Parameters.AddWithValue("$utc", DateTime.UtcNow.ToString("o"));
            cmd.ExecuteNonQuery();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Lineage] RecordContentNode failed: {ex.Message}");
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public void RecordContentDagEdge(string parentHash, string childHash, string op, string? fromPath = null, string? toPath = null)
    {
        if (string.Equals(parentHash, childHash, StringComparison.OrdinalIgnoreCase)) return;
        _writeLock.Wait();
        try
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT OR IGNORE INTO content_dag_edges (id, parentHash, childHash, op, utc, fromPath, toPath)
                VALUES ($id, $ph, $ch, $op, $utc, $from, $to)
                """;
            cmd.Parameters.AddWithValue("$id", Guid.NewGuid().ToString("N"));
            cmd.Parameters.AddWithValue("$ph", parentHash);
            cmd.Parameters.AddWithValue("$ch", childHash);
            cmd.Parameters.AddWithValue("$op", op);
            cmd.Parameters.AddWithValue("$utc", DateTime.UtcNow.ToString("o"));
            cmd.Parameters.AddWithValue("$from", (object?)fromPath ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$to", (object?)toPath ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Lineage] RecordContentDagEdge failed: {ex.Message}");
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public async Task RecordContentLineageOnCopyAsync(string sourcePath, string destPath, string op, CancellationToken ct = default)
    {
        try
        {
            var srcHash = await ComputeContentHashAsync(sourcePath, ct).ConfigureAwait(false);
            if (string.IsNullOrEmpty(srcHash)) return;

            var srcSize = new FileInfo(sourcePath).Length;
            RecordContentNode(srcHash, sourcePath, srcSize);

            var dstHash = await ComputeContentHashAsync(destPath, ct).ConfigureAwait(false);
            if (string.IsNullOrEmpty(dstHash)) return;

            var dstSize = File.Exists(destPath) ? new FileInfo(destPath).Length : srcSize;
            RecordContentNode(dstHash, destPath, dstSize);

            if (!string.Equals(srcHash, dstHash, StringComparison.OrdinalIgnoreCase))
            {
                RecordContentDagEdge(srcHash, dstHash, op, sourcePath, destPath);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Lineage] RecordContentLineageOnCopy failed: {ex.Message}");
        }
    }

    public ContentDagResult GetContentDag(string filePath, int depth = 4)
    {
        depth = Math.Clamp(depth, 1, 16);
        var result = new ContentDagResult();
        var normPath = NormKey(filePath);

        using var conn = OpenConnection();

        var focusHash = GetHashForPath(conn, normPath);
        if (string.IsNullOrEmpty(focusHash)) return result;

        result.FocusHash = focusHash;
        var visitedHashes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        CollectContentDag(conn, focusHash, depth, visitedHashes, result);

        return result;
    }

    private static string? GetHashForPath(SqliteConnection conn, string normPath)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT hash FROM content_nodes WHERE path = $p COLLATE NOCASE ORDER BY firstSeenUtc DESC LIMIT 1";
        cmd.Parameters.AddWithValue("$p", normPath);
        return cmd.ExecuteScalar() as string;
    }

    private void CollectContentDag(SqliteConnection conn, string hash, int remaining,
        HashSet<string> visited, ContentDagResult result)
    {
        if (remaining <= 0 || !visited.Add(hash)) return;

        var node = GetContentNode(conn, hash);
        if (node is not null)
            result.Nodes.Add(node);

        var parentEdges = QueryDagEdges(conn, "childHash", hash);
        var childEdges = QueryDagEdges(conn, "parentHash", hash);

        foreach (var e in parentEdges)
        {
            if (!result.Edges.Any(x => x.Id == e.Id))
                result.Edges.Add(e);
            CollectContentDag(conn, e.ParentHash, remaining - 1, visited, result);
        }

        foreach (var e in childEdges)
        {
            if (!result.Edges.Any(x => x.Id == e.Id))
                result.Edges.Add(e);
            CollectContentDag(conn, e.ChildHash, remaining - 1, visited, result);
        }
    }

    private static ContentNode? GetContentNode(SqliteConnection conn, string hash)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT path, size, firstSeenUtc FROM content_nodes WHERE hash = $h COLLATE NOCASE";
        cmd.Parameters.AddWithValue("$h", hash);
        using var r = cmd.ExecuteReader();
        ContentNode? node = null;
        while (r.Read())
        {
            if (node is null)
            {
                node = new ContentNode
                {
                    Hash = hash,
                    Size = r.GetInt64(1),
                    FirstSeenUtc = r.GetString(2),
                    Paths = new List<string> { r.GetString(0) }
                };
            }
            else
            {
                node.Paths.Add(r.GetString(0));
            }
        }
        return node;
    }

    private static List<ContentDagEdge> QueryDagEdges(SqliteConnection conn, string column, string hash)
    {
        var edges = new List<ContentDagEdge>();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"SELECT id, parentHash, childHash, op, utc, fromPath, toPath FROM content_dag_edges WHERE {column} = $h COLLATE NOCASE";
        cmd.Parameters.AddWithValue("$h", hash);
        using var r = cmd.ExecuteReader();
        while (r.Read())
        {
            edges.Add(new ContentDagEdge
            {
                Id = r.GetString(0),
                ParentHash = r.GetString(1),
                ChildHash = r.GetString(2),
                Op = r.GetString(3),
                Utc = r.GetString(4),
                FromPath = r.IsDBNull(5) ? null : r.GetString(5),
                ToPath = r.IsDBNull(6) ? null : r.GetString(6)
            });
        }
        return edges;
    }

    public string? GetHashForFile(string filePath)
    {
        using var conn = OpenConnection();
        return GetHashForPath(conn, NormKey(filePath));
    }
}
