using BNDZ.Services.Mesh.Incus;
using Microsoft.Data.Sqlite;

namespace BNDZ.Services.Mesh;

public sealed partial class MeshDatabase
{
    private void EnsureIncusSchema(SqliteConnection conn)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS incus_endpoints (
              id TEXT PRIMARY KEY,
              alias TEXT NOT NULL,
              api_url TEXT NOT NULL,
              server_fingerprint TEXT,
              project TEXT,
              default_image TEXT NOT NULL,
              default_image_server TEXT NOT NULL,
              default_instance_type TEXT NOT NULL,
              default_ssh_user TEXT NOT NULL,
              default_ssh_port INTEGER NOT NULL,
              default_ssh_key_path TEXT,
              allow_insecure_tls INTEGER NOT NULL DEFAULT 0,
              notes TEXT,
              last_error TEXT,
              last_seen_utc TEXT,
              trusted INTEGER NOT NULL DEFAULT 0,
              protected_trust_token BLOB
            );
            CREATE TABLE IF NOT EXISTS incus_ephemeral (
              id TEXT PRIMARY KEY,
              endpoint_id TEXT NOT NULL,
              instance_name TEXT NOT NULL,
              status TEXT NOT NULL,
              ipv4 TEXT,
              ipv6 TEXT,
              mesh_host_id TEXT,
              image_alias TEXT NOT NULL,
              instance_type TEXT NOT NULL,
              ephemeral INTEGER NOT NULL DEFAULT 1,
              created_utc TEXT NOT NULL,
              last_error TEXT,
              notes TEXT
            );
            """;
        cmd.ExecuteNonQuery();
    }

    public List<IncusEndpointRecord> ListIncusEndpoints()
    {
        lock (_lock)
        {
            using var conn = Open();
            EnsureIncusSchema(conn);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT * FROM incus_endpoints ORDER BY alias";
            using var r = cmd.ExecuteReader();
            var list = new List<IncusEndpointRecord>();
            while (r.Read()) list.Add(ReadIncusEndpoint(r));
            return list;
        }
    }

    public IncusEndpointRecord? GetIncusEndpoint(string id)
    {
        lock (_lock)
        {
            using var conn = Open();
            EnsureIncusSchema(conn);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT * FROM incus_endpoints WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadIncusEndpoint(r) : null;
        }
    }

    public void UpsertIncusEndpoint(IncusEndpointRecord e)
    {
        lock (_lock)
        {
            using var conn = Open();
            EnsureIncusSchema(conn);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO incus_endpoints (
                  id, alias, api_url, server_fingerprint, project, default_image, default_image_server,
                  default_instance_type, default_ssh_user, default_ssh_port, default_ssh_key_path,
                  allow_insecure_tls, notes, last_error, last_seen_utc, trusted, protected_trust_token)
                VALUES (
                  $id, $alias, $url, $fp, $project, $image, $imgserver, $itype, $sshuser, $sshport, $sshkey,
                  $insecure, $notes, $err, $seen, $trusted, $token)
                ON CONFLICT(id) DO UPDATE SET
                  alias=$alias, api_url=$url, server_fingerprint=$fp, project=$project,
                  default_image=$image, default_image_server=$imgserver, default_instance_type=$itype,
                  default_ssh_user=$sshuser, default_ssh_port=$sshport, default_ssh_key_path=$sshkey,
                  allow_insecure_tls=$insecure, notes=$notes, last_error=$err, last_seen_utc=$seen,
                  trusted=$trusted,
                  protected_trust_token=COALESCE($token, protected_trust_token)
                """;
            cmd.Parameters.AddWithValue("$id", e.Id);
            cmd.Parameters.AddWithValue("$alias", e.Alias);
            cmd.Parameters.AddWithValue("$url", e.ApiUrl);
            cmd.Parameters.AddWithValue("$fp", (object?)e.ServerFingerprint ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$project", (object?)e.Project ?? "default");
            cmd.Parameters.AddWithValue("$image", e.DefaultImage);
            cmd.Parameters.AddWithValue("$imgserver", e.DefaultImageServer);
            cmd.Parameters.AddWithValue("$itype", e.DefaultInstanceType);
            cmd.Parameters.AddWithValue("$sshuser", e.DefaultSshUser);
            cmd.Parameters.AddWithValue("$sshport", e.DefaultSshPort);
            cmd.Parameters.AddWithValue("$sshkey", (object?)e.DefaultSshKeyPath ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$insecure", e.AllowInsecureTls ? 1 : 0);
            cmd.Parameters.AddWithValue("$notes", (object?)e.Notes ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$err", (object?)e.LastError ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$seen", e.LastSeenUtc?.ToString("O") ?? (object)DBNull.Value);
            cmd.Parameters.AddWithValue("$trusted", e.Trusted ? 1 : 0);
            cmd.Parameters.AddWithValue("$token", (object?)e.ProtectedTrustToken ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }
    }

    public void DeleteIncusEndpoint(string id)
    {
        lock (_lock)
        {
            using var conn = Open();
            EnsureIncusSchema(conn);
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "DELETE FROM incus_ephemeral WHERE endpoint_id = $id";
                cmd.Parameters.AddWithValue("$id", id);
                cmd.ExecuteNonQuery();
            }
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "DELETE FROM incus_endpoints WHERE id = $id";
                cmd.Parameters.AddWithValue("$id", id);
                cmd.ExecuteNonQuery();
            }
        }
    }

    public List<IncusEphemeralInstanceRecord> ListIncusEphemeral()
    {
        lock (_lock)
        {
            using var conn = Open();
            EnsureIncusSchema(conn);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT * FROM incus_ephemeral ORDER BY created_utc DESC";
            using var r = cmd.ExecuteReader();
            var list = new List<IncusEphemeralInstanceRecord>();
            while (r.Read()) list.Add(ReadIncusEphemeral(r));
            return list;
        }
    }

    public IncusEphemeralInstanceRecord? GetIncusEphemeral(string id)
    {
        lock (_lock)
        {
            using var conn = Open();
            EnsureIncusSchema(conn);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT * FROM incus_ephemeral WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            using var r = cmd.ExecuteReader();
            return r.Read() ? ReadIncusEphemeral(r) : null;
        }
    }

    public void UpsertIncusEphemeral(IncusEphemeralInstanceRecord e)
    {
        lock (_lock)
        {
            using var conn = Open();
            EnsureIncusSchema(conn);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO incus_ephemeral (
                  id, endpoint_id, instance_name, status, ipv4, ipv6, mesh_host_id,
                  image_alias, instance_type, ephemeral, created_utc, last_error, notes)
                VALUES (
                  $id, $endpoint, $name, $status, $ipv4, $ipv6, $mesh,
                  $image, $itype, $eph, $created, $err, $notes)
                ON CONFLICT(id) DO UPDATE SET
                  endpoint_id=$endpoint, instance_name=$name, status=$status, ipv4=$ipv4, ipv6=$ipv6,
                  mesh_host_id=$mesh, image_alias=$image, instance_type=$itype, ephemeral=$eph,
                  created_utc=$created, last_error=$err, notes=$notes
                """;
            cmd.Parameters.AddWithValue("$id", e.Id);
            cmd.Parameters.AddWithValue("$endpoint", e.EndpointId);
            cmd.Parameters.AddWithValue("$name", e.InstanceName);
            cmd.Parameters.AddWithValue("$status", e.Status);
            cmd.Parameters.AddWithValue("$ipv4", (object?)e.Ipv4 ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$ipv6", (object?)e.Ipv6 ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$mesh", (object?)e.MeshHostId ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$image", e.ImageAlias);
            cmd.Parameters.AddWithValue("$itype", e.InstanceType);
            cmd.Parameters.AddWithValue("$eph", e.Ephemeral ? 1 : 0);
            cmd.Parameters.AddWithValue("$created", e.CreatedUtc.ToString("O"));
            cmd.Parameters.AddWithValue("$err", (object?)e.LastError ?? DBNull.Value);
            cmd.Parameters.AddWithValue("$notes", (object?)e.Notes ?? DBNull.Value);
            cmd.ExecuteNonQuery();
        }
    }

    public void DeleteIncusEphemeral(string id)
    {
        lock (_lock)
        {
            using var conn = Open();
            EnsureIncusSchema(conn);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM incus_ephemeral WHERE id = $id";
            cmd.Parameters.AddWithValue("$id", id);
            cmd.ExecuteNonQuery();
        }
    }

    private static IncusEndpointRecord ReadIncusEndpoint(SqliteDataReader r)
    {
        static string? S(SqliteDataReader reader, string col) =>
            reader.GetOrdinal(col) >= 0 && !reader.IsDBNull(reader.GetOrdinal(col)) ? reader.GetString(reader.GetOrdinal(col)) : null;
        static int I(SqliteDataReader reader, string col, int fallback = 0) =>
            reader.GetOrdinal(col) >= 0 && !reader.IsDBNull(reader.GetOrdinal(col)) ? reader.GetInt32(reader.GetOrdinal(col)) : fallback;
        static byte[]? B(SqliteDataReader reader, string col) =>
            reader.GetOrdinal(col) >= 0 && !reader.IsDBNull(reader.GetOrdinal(col)) ? (byte[])reader.GetValue(reader.GetOrdinal(col)) : null;

        var seen = S(r, "last_seen_utc");
        return new IncusEndpointRecord
        {
            Id = S(r, "id") ?? "",
            Alias = S(r, "alias") ?? "",
            ApiUrl = S(r, "api_url") ?? "",
            ServerFingerprint = S(r, "server_fingerprint"),
            Project = S(r, "project") ?? "default",
            DefaultImage = S(r, "default_image") ?? "ubuntu/24.04",
            DefaultImageServer = S(r, "default_image_server") ?? "https://images.linuxcontainers.org",
            DefaultInstanceType = S(r, "default_instance_type") ?? "container",
            DefaultSshUser = S(r, "default_ssh_user") ?? "root",
            DefaultSshPort = I(r, "default_ssh_port", 22),
            DefaultSshKeyPath = S(r, "default_ssh_key_path"),
            AllowInsecureTls = I(r, "allow_insecure_tls") != 0,
            Notes = S(r, "notes"),
            LastError = S(r, "last_error"),
            LastSeenUtc = seen != null ? DateTime.Parse(seen) : null,
            Trusted = I(r, "trusted") != 0,
            ProtectedTrustToken = B(r, "protected_trust_token"),
        };
    }

    private static IncusEphemeralInstanceRecord ReadIncusEphemeral(SqliteDataReader r)
    {
        static string? S(SqliteDataReader reader, string col) =>
            reader.GetOrdinal(col) >= 0 && !reader.IsDBNull(reader.GetOrdinal(col)) ? reader.GetString(reader.GetOrdinal(col)) : null;
        static int I(SqliteDataReader reader, string col, int fallback = 0) =>
            reader.GetOrdinal(col) >= 0 && !reader.IsDBNull(reader.GetOrdinal(col)) ? reader.GetInt32(reader.GetOrdinal(col)) : fallback;

        var created = S(r, "created_utc");
        return new IncusEphemeralInstanceRecord
        {
            Id = S(r, "id") ?? "",
            EndpointId = S(r, "endpoint_id") ?? "",
            InstanceName = S(r, "instance_name") ?? "",
            Status = S(r, "status") ?? "Unknown",
            Ipv4 = S(r, "ipv4"),
            Ipv6 = S(r, "ipv6"),
            MeshHostId = S(r, "mesh_host_id"),
            ImageAlias = S(r, "image_alias") ?? "",
            InstanceType = S(r, "instance_type") ?? "container",
            Ephemeral = I(r, "ephemeral", 1) != 0,
            CreatedUtc = created != null ? DateTime.Parse(created) : DateTime.UtcNow,
            LastError = S(r, "last_error"),
            Notes = S(r, "notes"),
        };
    }
}
