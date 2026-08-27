using Microsoft.Data.Sqlite;

namespace BNDZ.Services.Mesh;

/// <summary>SQLite persistence for mesh hosts, sync rules, and cache metadata.</summary>
public sealed partial class MeshDatabase : IDisposable
{
    private readonly string _dbPath;
    private readonly object _lock = new();

    public MeshDatabase()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Mesh");
        Directory.CreateDirectory(dir);
        _dbPath = Path.Combine(dir, "mesh.db");
        EnsureSchema();
    }

    private void EnsureSchema()
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                CREATE TABLE IF NOT EXISTS mesh_hosts (
                  id TEXT PRIMARY KEY,
                  alias TEXT NOT NULL,
                  provider INTEGER NOT NULL,
                  hostname TEXT NOT NULL,
                  port INTEGER NOT NULL,
                  username TEXT NOT NULL,
                  key_path TEXT,
                  auth_kind INTEGER NOT NULL,
                  jump_host_id TEXT,
                  host_key_fp TEXT,
                  s3_bucket TEXT,
                  s3_region TEXT,
                  s3_endpoint TEXT,
                  s3_access_key TEXT,
                  protected_secret BLOB,
                  state INTEGER NOT NULL,
                  last_seen_utc TEXT,
                  last_error TEXT,
                  cache_quota_bytes INTEGER NOT NULL,
                  show_in_nav_tree INTEGER NOT NULL DEFAULT 1,
                  remote_root_path TEXT NOT NULL DEFAULT '/',
                  notes TEXT
                );
                CREATE TABLE IF NOT EXISTS mesh_sync_rules (
                  id TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  local_path TEXT NOT NULL,
                  remote_host_id TEXT NOT NULL,
                  remote_path TEXT NOT NULL,
                  push_on_save INTEGER NOT NULL,
                  debounce_ms INTEGER NOT NULL,
                  enabled INTEGER NOT NULL,
                  include_glob TEXT,
                  exclude_glob TEXT,
                  last_sync_utc TEXT,
                  last_status TEXT,
                  last_error TEXT
                );
                CREATE TABLE IF NOT EXISTS mesh_objects (
                  host_id TEXT NOT NULL,
                  remote_path TEXT NOT NULL,
                  kind INTEGER NOT NULL,
                  size INTEGER NOT NULL,
                  remote_mtime_utc TEXT,
                  content_hash TEXT,
                  cache_state INTEGER NOT NULL,
                  local_blob_path TEXT,
                  cached_at_utc TEXT,
                  PRIMARY KEY (host_id, remote_path)
                );
                """;
            cmd.ExecuteNonQuery();
            TryAddColumn(conn, "mesh_hosts", "show_in_nav_tree", "INTEGER NOT NULL DEFAULT 1");
            TryAddColumn(conn, "mesh_hosts", "remote_root_path", "TEXT NOT NULL DEFAULT '/'");
            TryAddColumn(conn, "mesh_hosts", "notes", "TEXT");
            TryAddColumn(conn, "mesh_hosts", "certificate_path", "TEXT");
            TryAddColumn(conn, "mesh_hosts", "proxy_jump", "TEXT");
            EnsureIncusSchema(conn);
        }
    }

    private static void TryAddColumn(SqliteConnection conn, string table, string column, string definition)
    {
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = $"ALTER TABLE {table} ADD COLUMN {column} {definition}";
            cmd.ExecuteNonQuery();
        }
        catch (SqliteException ex) when (ex.SqliteErrorCode == 1) { /* duplicate column */ }
    }

    private SqliteConnection Open()
    {
        var conn = new SqliteConnection($"Data Source={_dbPath}");
        conn.Open();
        return conn;
    }

    public List<MeshHostRecord> ListHosts()
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT * FROM mesh_hosts ORDER BY alias";
            using var r = cmd.ExecuteReader();
            var list = new List<MeshHostRecord>();
            while (r.Read()) list.Add(ReadHost(r));
            return list;
        }
    }

    public MeshHostRecord? GetHost(string id)
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT * FROM mesh_hosts WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadHost(r) : null;
        }
    }

    public void UpsertHost(MeshHostRecord h)
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO mesh_hosts (id,alias,provider,hostname,port,username,key_path,auth_kind,jump_host_id,host_key_fp,s3_bucket,s3_region,s3_endpoint,s3_access_key,protected_secret,state,last_seen_utc,last_error,cache_quota_bytes,show_in_nav_tree,remote_root_path,notes,certificate_path,proxy_jump)
                VALUES ($id,$alias,$provider,$hostname,$port,$username,$key_path,$auth_kind,$jump,$fp,$bucket,$region,$endpoint,$access,$secret,$state,$seen,$err,$quota,$nav,$root,$notes,$cert,$proxy)
                ON CONFLICT(id) DO UPDATE SET
                  alias=$alias, provider=$provider, hostname=$hostname, port=$port, username=$username,
                  key_path=$key_path, auth_kind=$auth_kind, jump_host_id=$jump, host_key_fp=$fp,
                  s3_bucket=$bucket, s3_region=$region, s3_endpoint=$endpoint, s3_access_key=$access,
                  protected_secret=$secret, state=$state, last_seen_utc=$seen, last_error=$err, cache_quota_bytes=$quota,
                  show_in_nav_tree=$nav, remote_root_path=$root, notes=$notes,
                  certificate_path=$cert, proxy_jump=$proxy
                """;
            BindHost(cmd, h);
            cmd.ExecuteNonQuery();
        }
    }

    public void DeleteHost(string id)
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM mesh_hosts WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            cmd.ExecuteNonQuery();
        }
    }

    public List<MeshSyncRuleRecord> ListSyncRules()
    {
        lock (_lock)
        {
            using var conn = Open();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT * FROM mesh_sync_rules ORDER BY name";
            using var r = cmd.ExecuteReader();
            var list = new List<MeshSyncRuleRecord>();
            while (r.Read()) list.Add(ReadRule(r));
            return list;
        }
    }

    public void SaveSyncRules(IEnumerable<MeshSyncRuleRecord> rules)
    {
        lock (_lock)
        {
            using var conn = Open();
            using var tx = conn.BeginTransaction();
            using (var del = conn.CreateCommand())
            {
                del.CommandText = "DELETE FROM mesh_sync_rules";
                del.ExecuteNonQuery();
            }
            foreach (var rule in rules)
            {
                using var cmd = conn.CreateCommand();
                cmd.Transaction = tx;
                cmd.CommandText = """
                    INSERT INTO mesh_sync_rules (id,name,local_path,remote_host_id,remote_path,push_on_save,debounce_ms,enabled,include_glob,exclude_glob,last_sync_utc,last_status,last_error)
                    VALUES ($id,$name,$local,$host,$remote,$push,$debounce,$enabled,$inc,$exc,$sync,$status,$err)
                    """;
                cmd.Parameters.AddWithValue("$id", rule.Id);
                cmd.Parameters.AddWithValue("$name", rule.Name);
                cmd.Parameters.AddWithValue("$local", rule.LocalPath);
                cmd.Parameters.AddWithValue("$host", rule.RemoteHostId);
                cmd.Parameters.AddWithValue("$remote", rule.RemotePath);
                cmd.Parameters.AddWithValue("$push", rule.PushOnSave ? 1 : 0);
                cmd.Parameters.AddWithValue("$debounce", rule.DebounceMs);
                cmd.Parameters.AddWithValue("$enabled", rule.Enabled ? 1 : 0);
                cmd.Parameters.AddWithValue("$inc", (object?)rule.IncludeGlob ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$exc", (object?)rule.ExcludeGlob ?? DBNull.Value);
                cmd.Parameters.AddWithValue("$sync", rule.LastSyncUtc?.ToString("O") ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("$status", rule.LastStatus);
                cmd.Parameters.AddWithValue("$err", (object?)rule.LastError ?? DBNull.Value);
                cmd.ExecuteNonQuery();
            }
            tx.Commit();
        }
    }

    private static MeshHostRecord ReadHost(SqliteDataReader r)
    {
        static string? S(SqliteDataReader reader, string col) =>
            reader.GetOrdinal(col) >= 0 && !reader.IsDBNull(reader.GetOrdinal(col)) ? reader.GetString(reader.GetOrdinal(col)) : null;
        static int I(SqliteDataReader reader, string col, int fallback = 0) =>
            reader.GetOrdinal(col) >= 0 && !reader.IsDBNull(reader.GetOrdinal(col)) ? reader.GetInt32(reader.GetOrdinal(col)) : fallback;
        static long L(SqliteDataReader reader, string col, long fallback = 0) =>
            reader.GetOrdinal(col) >= 0 && !reader.IsDBNull(reader.GetOrdinal(col)) ? reader.GetInt64(reader.GetOrdinal(col)) : fallback;
        static byte[]? B(SqliteDataReader reader, string col) =>
            reader.GetOrdinal(col) >= 0 && !reader.IsDBNull(reader.GetOrdinal(col)) ? (byte[])reader.GetValue(reader.GetOrdinal(col)) : null;

        var seen = S(r, "last_seen_utc");
        return new MeshHostRecord
        {
            Id = S(r, "id") ?? "",
            Alias = S(r, "alias") ?? "",
            Provider = (MeshProviderKind)I(r, "provider"),
            Hostname = S(r, "hostname") ?? "",
            Port = I(r, "port", 22),
            Username = S(r, "username") ?? "",
            KeyPath = S(r, "key_path"),
            CertificatePath = S(r, "certificate_path"),
            ProxyJump = S(r, "proxy_jump"),
            AuthKind = (MeshAuthKind)I(r, "auth_kind"),
            JumpHostId = S(r, "jump_host_id"),
            HostKeyFingerprint = S(r, "host_key_fp"),
            S3Bucket = S(r, "s3_bucket"),
            S3Region = S(r, "s3_region"),
            S3Endpoint = S(r, "s3_endpoint"),
            S3AccessKeyId = S(r, "s3_access_key"),
            ProtectedSecret = B(r, "protected_secret"),
            State = (MeshConnectionState)I(r, "state"),
            LastSeenUtc = seen != null ? DateTime.Parse(seen) : null,
            LastError = S(r, "last_error"),
            CacheQuotaBytes = L(r, "cache_quota_bytes", 2L * 1024 * 1024 * 1024),
            ShowInNavTree = r.GetOrdinal("show_in_nav_tree") < 0 || I(r, "show_in_nav_tree", 1) != 0,
            RemoteRootPath = S(r, "remote_root_path") ?? "/",
            Notes = S(r, "notes"),
        };
    }

    private static void BindHost(SqliteCommand cmd, MeshHostRecord h)
    {
        cmd.Parameters.AddWithValue("$id", h.Id);
        cmd.Parameters.AddWithValue("$alias", h.Alias);
        cmd.Parameters.AddWithValue("$provider", (int)h.Provider);
        cmd.Parameters.AddWithValue("$hostname", h.Hostname);
        cmd.Parameters.AddWithValue("$port", h.Port);
        cmd.Parameters.AddWithValue("$username", h.Username);
        cmd.Parameters.AddWithValue("$key_path", (object?)h.KeyPath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$auth_kind", (int)h.AuthKind);
        cmd.Parameters.AddWithValue("$jump", (object?)h.JumpHostId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$fp", (object?)h.HostKeyFingerprint ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$bucket", (object?)h.S3Bucket ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$region", (object?)h.S3Region ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$endpoint", (object?)h.S3Endpoint ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$access", (object?)h.S3AccessKeyId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$secret", (object?)h.ProtectedSecret ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$state", (int)h.State);
        cmd.Parameters.AddWithValue("$seen", h.LastSeenUtc?.ToString("O") ?? (object)DBNull.Value);
        cmd.Parameters.AddWithValue("$err", (object?)h.LastError ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$quota", h.CacheQuotaBytes);
        cmd.Parameters.AddWithValue("$nav", h.ShowInNavTree ? 1 : 0);
        cmd.Parameters.AddWithValue("$root", string.IsNullOrWhiteSpace(h.RemoteRootPath) ? "/" : h.RemoteRootPath);
        cmd.Parameters.AddWithValue("$notes", (object?)h.Notes ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$cert", (object?)h.CertificatePath ?? DBNull.Value);
        cmd.Parameters.AddWithValue("$proxy", (object?)h.ProxyJump ?? DBNull.Value);
    }

    private static MeshSyncRuleRecord ReadRule(SqliteDataReader r) => new()
    {
        Id = r.GetString(0),
        Name = r.GetString(1),
        LocalPath = r.GetString(2),
        RemoteHostId = r.GetString(3),
        RemotePath = r.GetString(4),
        PushOnSave = r.GetInt32(5) != 0,
        DebounceMs = r.GetInt32(6),
        Enabled = r.GetInt32(7) != 0,
        IncludeGlob = r.IsDBNull(8) ? null : r.GetString(8),
        ExcludeGlob = r.IsDBNull(9) ? null : r.GetString(9),
        LastSyncUtc = r.IsDBNull(10) ? null : DateTime.Parse(r.GetString(10)),
        LastStatus = r.GetString(11),
        LastError = r.IsDBNull(12) ? null : r.GetString(12),
    };

    public void Dispose() { }
}
