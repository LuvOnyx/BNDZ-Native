using System.Text.Json;
using Microsoft.Data.Sqlite;

namespace BNDZ.Services.GhostLink;

public sealed class GhostLinkRule
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public bool Enabled { get; set; } = true;
    public string SourceRoots { get; set; } = ""; // semicolon-separated
    public string PathGlob { get; set; } = "**/*";
    public string Extensions { get; set; } = ""; // comma-separated
    public long MinSizeBytes { get; set; } = 50 * 1024 * 1024;
    public int IdleDays { get; set; } = 30;
    public string ColdStorageRoot { get; set; } = "";
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

public sealed class GhostLinkRecord
{
    public string Id { get; set; } = "";
    public string OriginalPath { get; set; } = "";
    public string OffloadPath { get; set; } = "";
    public long BytesSaved { get; set; }
    public string RuleId { get; set; } = "";
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

public sealed class GhostLinkStats
{
    public int RuleCount { get; set; }
    public int GhostCount { get; set; }
    public long BytesReclaimed { get; set; }
}

public sealed class GhostLinkDatabase : IDisposable
{
    private readonly string _dbPath;
    private readonly object _lock = new();

    public GhostLinkDatabase()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "GhostLink");
        Directory.CreateDirectory(dir);
        _dbPath = Path.Combine(dir, "ghostlink.db");
        EnsureSchema();
    }

    private void EnsureSchema()
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                CREATE TABLE IF NOT EXISTS rules(
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  enabled INTEGER NOT NULL DEFAULT 1,
                  source_roots TEXT,
                  path_glob TEXT,
                  extensions TEXT,
                  min_size_bytes INTEGER,
                  idle_days INTEGER,
                  cold_storage_root TEXT,
                  created_utc INTEGER
                );
                CREATE TABLE IF NOT EXISTS ghosts(
                  id TEXT PRIMARY KEY,
                  original_path TEXT NOT NULL UNIQUE,
                  offload_path TEXT NOT NULL,
                  bytes_saved INTEGER,
                  rule_id TEXT,
                  created_utc INTEGER
                );
                """;
            cmd.ExecuteNonQuery();
        }
    }

    public List<GhostLinkRule> GetRules()
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT * FROM rules ORDER BY created_utc DESC";
            using var r = cmd.ExecuteReader();
            var list = new List<GhostLinkRule>();
            while (r.Read()) list.Add(ReadRule(r));
            return list;
        }
    }

    public void SaveRules(IEnumerable<GhostLinkRule> rules)
    {
        lock (_lock)
        {
            using var conn = Open();
            using var tx = conn.BeginTransaction();
            using (var del = conn.CreateCommand())
            {
                del.CommandText = "DELETE FROM rules";
                del.ExecuteNonQuery();
            }
            foreach (var rule in rules)
            {
                using var cmd = conn.CreateCommand();
                cmd.CommandText = """
                    INSERT INTO rules(id,name,enabled,source_roots,path_glob,extensions,min_size_bytes,idle_days,cold_storage_root,created_utc)
                    VALUES($id,$name,$en,$sr,$pg,$ext,$min,$idle,$cold,$cu)
                    """;
                cmd.Parameters.AddWithValue("$id", rule.Id);
                cmd.Parameters.AddWithValue("$name", rule.Name);
                cmd.Parameters.AddWithValue("$en", rule.Enabled ? 1 : 0);
                cmd.Parameters.AddWithValue("$sr", rule.SourceRoots);
                cmd.Parameters.AddWithValue("$pg", rule.PathGlob);
                cmd.Parameters.AddWithValue("$ext", rule.Extensions);
                cmd.Parameters.AddWithValue("$min", rule.MinSizeBytes);
                cmd.Parameters.AddWithValue("$idle", rule.IdleDays);
                cmd.Parameters.AddWithValue("$cold", rule.ColdStorageRoot);
                cmd.Parameters.AddWithValue("$cu", new DateTimeOffset(rule.CreatedUtc).ToUnixTimeMilliseconds());
                cmd.ExecuteNonQuery();
            }
            tx.Commit();
        }
    }

    public void InsertGhost(GhostLinkRecord record)
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT OR REPLACE INTO ghosts(id,original_path,offload_path,bytes_saved,rule_id,created_utc)
                VALUES($id,$op,$off,$bs,$rid,$cu)
                """;
            cmd.Parameters.AddWithValue("$id", record.Id);
            cmd.Parameters.AddWithValue("$op", record.OriginalPath);
            cmd.Parameters.AddWithValue("$off", record.OffloadPath);
            cmd.Parameters.AddWithValue("$bs", record.BytesSaved);
            cmd.Parameters.AddWithValue("$rid", record.RuleId);
            cmd.Parameters.AddWithValue("$cu", new DateTimeOffset(record.CreatedUtc).ToUnixTimeMilliseconds());
            cmd.ExecuteNonQuery();
        }
    }

    public void RemoveGhost(string originalPath)
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM ghosts WHERE original_path=$p";
            cmd.Parameters.AddWithValue("$p", originalPath);
            cmd.ExecuteNonQuery();
        }
    }

    public GhostLinkRecord? GetGhost(string originalPath)
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT * FROM ghosts WHERE original_path=$p LIMIT 1";
            cmd.Parameters.AddWithValue("$p", originalPath);
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadGhost(r) : null;
        }
    }

    public List<GhostLinkRecord> ListGhosts(int limit = 500)
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"SELECT * FROM ghosts ORDER BY created_utc DESC LIMIT {limit}";
            using var r = cmd.ExecuteReader();
            var list = new List<GhostLinkRecord>();
            while (r.Read()) list.Add(ReadGhost(r));
            return list;
        }
    }

    public GhostLinkStats GetStats()
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                SELECT (SELECT COUNT(*) FROM rules),(SELECT COUNT(*) FROM ghosts),(SELECT COALESCE(SUM(bytes_saved),0) FROM ghosts)
                """;
            using var r = cmd.ExecuteReader();
            r.Read();
            return new GhostLinkStats
            {
                RuleCount = r.GetInt32(0),
                GhostCount = r.GetInt32(1),
                BytesReclaimed = r.GetInt64(2),
            };
        }
    }

    private SqliteConnection Open()
    {
        var conn = new SqliteConnection($"Data Source={_dbPath}");
        conn.Open();
        return conn;
    }

    private static GhostLinkRule ReadRule(SqliteDataReader r) => new()
    {
        Id = r.GetString(0),
        Name = r.GetString(1),
        Enabled = r.GetInt64(2) != 0,
        SourceRoots = r.IsDBNull(3) ? "" : r.GetString(3),
        PathGlob = r.IsDBNull(4) ? "**/*" : r.GetString(4),
        Extensions = r.IsDBNull(5) ? "" : r.GetString(5),
        MinSizeBytes = r.IsDBNull(6) ? 0 : r.GetInt64(6),
        IdleDays = r.IsDBNull(7) ? 30 : (int)r.GetInt64(7),
        ColdStorageRoot = r.IsDBNull(8) ? "" : r.GetString(8),
        CreatedUtc = DateTimeOffset.FromUnixTimeMilliseconds(r.GetInt64(9)).UtcDateTime,
    };

    private static GhostLinkRecord ReadGhost(SqliteDataReader r) => new()
    {
        Id = r.GetString(0),
        OriginalPath = r.GetString(1),
        OffloadPath = r.GetString(2),
        BytesSaved = r.GetInt64(3),
        RuleId = r.IsDBNull(4) ? "" : r.GetString(4),
        CreatedUtc = DateTimeOffset.FromUnixTimeMilliseconds(r.GetInt64(5)).UtcDateTime,
    };

    public void Dispose() { }
}
