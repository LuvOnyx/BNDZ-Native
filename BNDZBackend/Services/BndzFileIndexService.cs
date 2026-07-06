using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Data.Sqlite;

namespace BNDZ.Services;

/// <summary>Background file-name cache for fast search and smart views. Separate from folder-size scanning.</summary>
public sealed class BndzFileIndexService : IDisposable
{
    private static readonly Lazy<BndzFileIndexService> Lazy = new(() => new BndzFileIndexService());
    public static BndzFileIndexService Instance => Lazy.Value;

    private static readonly HashSet<string> SkipDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "$Recycle.Bin", "System Volume Information", "Windows", "WinSxS",
        "node_modules", ".git", "AppData\\Local\\Temp", "Temp"
    };

    private readonly string _dbPath;
    private readonly object _schemaGate = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private volatile bool _schemaReady;
    private int _indexing;

    private BndzFileIndexService()
    {
        var dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Index");
        Directory.CreateDirectory(dir);
        _dbPath = Path.Combine(dir, "files.db");
        EnsureSchema();
        _ = Task.Run(() => EnsureDefaultLocationsIndexedAsync(CancellationToken.None));
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
                CREATE TABLE IF NOT EXISTS files (
                  path TEXT PRIMARY KEY,
                  name TEXT NOT NULL,
                  ext TEXT,
                  size INTEGER NOT NULL DEFAULT 0,
                  modified INTEGER NOT NULL DEFAULT 0,
                  is_dir INTEGER NOT NULL DEFAULT 0,
                  media_kind TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_files_name ON files(name COLLATE NOCASE);
                CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified DESC);
                CREATE INDEX IF NOT EXISTS idx_files_media ON files(media_kind, modified DESC);
                CREATE INDEX IF NOT EXISTS idx_files_size ON files(size DESC);
                CREATE TABLE IF NOT EXISTS locations (
                  path TEXT PRIMARY KEY,
                  last_indexed INTEGER NOT NULL DEFAULT 0
                );
                """;
            cmd.ExecuteNonQuery();
            _schemaReady = true;
        }
    }

    private static SqliteConnection OpenConnection()
    {
        var conn = new SqliteConnection($"Data Source={Instance._dbPath}");
        conn.Open();
        using var pragma = conn.CreateCommand();
        pragma.CommandText = "PRAGMA busy_timeout=8000;";
        pragma.ExecuteNonQuery();
        return conn;
    }

    public void EnsureDefaultLocationsIndexedAsync(CancellationToken ct)
    {
        if (Interlocked.CompareExchange(ref _indexing, 1, 0) != 0) return;
        try
        {
            var roots = new[]
            {
                Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
                Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
                Environment.GetFolderPath(Environment.SpecialFolder.MyPictures),
                Environment.GetFolderPath(Environment.SpecialFolder.MyMusic),
                Environment.GetFolderPath(Environment.SpecialFolder.MyVideos),
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) is { Length: > 0 } profile
                    ? Path.Combine(profile, "Downloads") : "",
            }.Where(p => !string.IsNullOrWhiteSpace(p) && Directory.Exists(p)).Distinct(StringComparer.OrdinalIgnoreCase);

            foreach (var root in roots)
            {
                ct.ThrowIfCancellationRequested();
                IndexLocation(root, ct, maxDepth: 6);
                Thread.Sleep(50);
            }
        }
        finally
        {
            Interlocked.Exchange(ref _indexing, 0);
        }
    }

    public void IndexLocation(string rootPath, CancellationToken ct, int maxDepth = 10)
    {
        var root = NormalizeWinPath(rootPath);
        if (!Directory.Exists(root)) return;

        _writeLock.Wait(ct);
        try
        {
            using var conn = OpenConnection();
            var upsert = conn.CreateCommand();
            upsert.CommandText = """
                INSERT INTO files(path,name,ext,size,modified,is_dir,media_kind) VALUES($p,$n,$e,$s,$m,$d,$k)
                ON CONFLICT(path) DO UPDATE SET name=$n,ext=$e,size=$s,modified=$m,is_dir=$d,media_kind=$k
                """;
            upsert.Parameters.Add("$p", SqliteType.Text);
            upsert.Parameters.Add("$n", SqliteType.Text);
            upsert.Parameters.Add("$e", SqliteType.Text);
            upsert.Parameters.Add("$s", SqliteType.Integer);
            upsert.Parameters.Add("$m", SqliteType.Integer);
            upsert.Parameters.Add("$d", SqliteType.Integer);
            upsert.Parameters.Add("$k", SqliteType.Text);

            var batch = 0;
            IndexDir(conn, root, root, 0, maxDepth, upsert, ref batch, ct);

            using var loc = conn.CreateCommand();
            loc.CommandText = "INSERT INTO locations(path,last_indexed) VALUES($p,$t) ON CONFLICT(path) DO UPDATE SET last_indexed=$t";
            loc.Parameters.AddWithValue("$p", root);
            loc.Parameters.AddWithValue("$t", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            loc.ExecuteNonQuery();
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private void IndexDir(SqliteConnection conn, string root, string dir, int depth, int maxDepth, SqliteCommand upsert, ref int batch, CancellationToken ct)
    {
        if (depth > maxDepth) return;
        ct.ThrowIfCancellationRequested();

        SqliteTransaction? tx = null;
        try
        {
            foreach (var file in Directory.EnumerateFiles(dir))
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var fi = new FileInfo(file);
                    var panePath = ToPanePath(file);
                    var ext = fi.Extension.TrimStart('.').ToLowerInvariant();
                    upsert.Parameters["$p"].Value = panePath;
                    upsert.Parameters["$n"].Value = fi.Name;
                    upsert.Parameters["$e"].Value = string.IsNullOrEmpty(ext) ? DBNull.Value : ext;
                    upsert.Parameters["$s"].Value = fi.Length;
                    upsert.Parameters["$m"].Value = new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeSeconds();
                    upsert.Parameters["$d"].Value = 0;
                    upsert.Parameters["$k"].Value = ClassifyMedia(ext) ?? (object)DBNull.Value;
                    if (tx == null) tx = conn.BeginTransaction();
                    upsert.Transaction = tx;
                    upsert.ExecuteNonQuery();
                    if (++batch % 250 == 0)
                    {
                        tx!.Commit();
                        tx.Dispose();
                        tx = null;
                    }
                }
                catch { }
            }

            foreach (var sub in Directory.EnumerateDirectories(dir))
            {
                ct.ThrowIfCancellationRequested();
                var name = Path.GetFileName(sub);
                if (SkipDirs.Contains(name) || name.StartsWith('.')) continue;
                try
                {
                    var di = new DirectoryInfo(sub);
                    var panePath = ToPanePath(sub);
                    upsert.Parameters["$p"].Value = panePath;
                    upsert.Parameters["$n"].Value = di.Name;
                    upsert.Parameters["$e"].Value = DBNull.Value;
                    upsert.Parameters["$s"].Value = 0L;
                    upsert.Parameters["$m"].Value = new DateTimeOffset(di.LastWriteTimeUtc).ToUnixTimeSeconds();
                    upsert.Parameters["$d"].Value = 1;
                    upsert.Parameters["$k"].Value = DBNull.Value;
                    if (tx == null) tx = conn.BeginTransaction();
                    upsert.Transaction = tx;
                    upsert.ExecuteNonQuery();
                    if (++batch % 250 == 0)
                    {
                        tx!.Commit();
                        tx.Dispose();
                        tx = null;
                    }
                    IndexDir(conn, root, sub, depth + 1, maxDepth, upsert, ref batch, ct);
                }
                catch { }
            }

            tx?.Commit();
            tx?.Dispose();
        }
        catch
        {
            try { tx?.Rollback(); } catch { }
            tx?.Dispose();
        }
    }

    public List<object> Search(string query, int limit, string scopeRootPanePath = "")
    {
        var results = new List<object>();
        if (string.IsNullOrWhiteSpace(query)) return results;

        var terms = query.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries);
        if (terms.Length == 0) return results;

        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();

        var where = new List<string>();
        for (var i = 0; i < terms.Length; i++)
        {
            where.Add($"name LIKE $t{i} ESCAPE '\\'");
            cmd.Parameters.AddWithValue($"$t{i}", $"%{EscapeLike(terms[i])}%");
        }

        var sql = $"SELECT path,name,size,is_dir,modified FROM files WHERE {string.Join(" AND ", where)}";
        if (!string.IsNullOrWhiteSpace(scopeRootPanePath))
        {
            var win = PaneToWin(scopeRootPanePath);
            if (!string.IsNullOrEmpty(win))
            {
                sql += " AND path LIKE $scope ESCAPE '\\'";
                cmd.Parameters.AddWithValue("$scope", ToPanePath(win).TrimEnd('/') + "/%");
            }
        }
        sql += " ORDER BY is_dir DESC, modified DESC LIMIT $lim";
        cmd.Parameters.AddWithValue("$lim", Math.Max(1, Math.Min(limit, 5000)));
        cmd.CommandText = sql;

        return ReadFileRows(cmd);
    }

    public List<object> GetRecentFiles(int limit = 500) =>
        QueryView("SELECT path,name,size,is_dir,modified FROM files WHERE is_dir=0 ORDER BY modified DESC LIMIT $lim", limit);

    public List<object> GetMediaFiles(int limit = 1000) =>
        QueryView("SELECT path,name,size,is_dir,modified FROM files WHERE is_dir=0 AND media_kind IN ('image','video') ORDER BY modified DESC LIMIT $lim", limit);

    public List<object> GetLargeFiles(int limit = 500, long minBytes = 100 * 1024 * 1024) =>
        QueryView("SELECT path,name,size,is_dir,modified FROM files WHERE is_dir=0 AND size >= $min ORDER BY size DESC LIMIT $lim", limit, minBytes);

    private List<object> QueryView(string sql, int limit, long? minBytes = null)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("$lim", Math.Max(1, Math.Min(limit, 5000)));
        if (minBytes.HasValue) cmd.Parameters.AddWithValue("$min", minBytes.Value);
        return ReadFileRows(cmd);
    }

    private static List<object> ReadFileRows(SqliteCommand cmd)
    {
        var results = new List<object>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var path = reader.GetString(0);
            var name = reader.GetString(1);
            var size = reader.GetInt64(2);
            var isDir = reader.GetInt32(3) == 1;
            var modified = reader.FieldCount > 4 && !reader.IsDBNull(4) ? reader.GetInt64(4) : 0L;
            if (isDir)
                results.Add(new { id = path, name, path, type = "directory", modified });
            else
                results.Add(new { id = path, name, path, type = "file", size, modified });
        }
        return results;
    }

    public Dictionary<string, object?>? GetEntry(string panePath)
    {
        if (string.IsNullOrWhiteSpace(panePath)) return null;
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT name,ext,size,modified,is_dir,media_kind FROM files WHERE path=$p";
        cmd.Parameters.AddWithValue("$p", NormalizePanePath(panePath));
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        return new Dictionary<string, object?>
        {
            ["name"] = r.GetString(0),
            ["extension"] = r.IsDBNull(1) ? null : r.GetString(1),
            ["size"] = r.GetInt64(2),
            ["modified"] = r.GetInt64(3),
            ["isDirectory"] = r.GetInt32(4) == 1,
            ["mediaKind"] = r.IsDBNull(5) ? null : r.GetString(5),
        };
    }

    public object GetIndexStatus()
    {
        using var conn = OpenConnection();
        var locations = new List<object>();
        using (var locCmd = conn.CreateCommand())
        {
            locCmd.CommandText = "SELECT path, last_indexed FROM locations ORDER BY last_indexed DESC";
            using var r = locCmd.ExecuteReader();
            while (r.Read())
                locations.Add(new { path = r.GetString(0), lastIndexed = r.GetInt64(1) });
        }
        long fileCount = 0, folderCount = 0;
        using (var countCmd = conn.CreateCommand())
        {
            countCmd.CommandText = "SELECT COUNT(*) FROM files WHERE is_dir=0";
            fileCount = Convert.ToInt64(countCmd.ExecuteScalar());
            countCmd.CommandText = "SELECT COUNT(*) FROM files WHERE is_dir=1";
            folderCount = Convert.ToInt64(countCmd.ExecuteScalar());
        }
        return new { fileCount, folderCount, locations };
    }

    /// <summary>Apply a filesystem watcher event to keep the index fresh.</summary>
    public void ApplyFsEvent(string eventType, string dirPane, string? name, string? oldName = null)
    {
        if (string.IsNullOrWhiteSpace(dirPane) || string.IsNullOrWhiteSpace(name)) return;
        var dir = NormalizePanePath(dirPane).TrimEnd('/');
        var panePath = $"{dir}/{name.Replace('\\', '/')}";

        try
        {
            switch (eventType)
            {
                case "Deleted":
                    RemoveEntry(panePath);
                    break;
                case "Created":
                case "Changed":
                    IndexSinglePath(PaneToWin(panePath));
                    break;
                case "Renamed":
                    if (!string.IsNullOrWhiteSpace(oldName))
                    {
                        var oldPane = $"{dir}/{oldName.Replace('\\', '/')}";
                        RemoveEntry(oldPane);
                    }
                    IndexSinglePath(PaneToWin(panePath));
                    break;
            }
        }
        catch { }
    }

    public void IndexSinglePath(string winPath)
    {
        if (string.IsNullOrWhiteSpace(winPath)) return;
        var path = NormalizeWinPath(winPath);
        if (!File.Exists(path) && !Directory.Exists(path)) return;

        _writeLock.Wait();
        try
        {
            using var conn = OpenConnection();
            using var upsert = conn.CreateCommand();
            upsert.CommandText = """
                INSERT INTO files(path,name,ext,size,modified,is_dir,media_kind) VALUES($p,$n,$e,$s,$m,$d,$k)
                ON CONFLICT(path) DO UPDATE SET name=$n,ext=$e,size=$s,modified=$m,is_dir=$d,media_kind=$k
                """;
            upsert.Parameters.Add("$p", SqliteType.Text);
            upsert.Parameters.Add("$n", SqliteType.Text);
            upsert.Parameters.Add("$e", SqliteType.Text);
            upsert.Parameters.Add("$s", SqliteType.Integer);
            upsert.Parameters.Add("$m", SqliteType.Integer);
            upsert.Parameters.Add("$d", SqliteType.Integer);
            upsert.Parameters.Add("$k", SqliteType.Text);

            if (File.Exists(path))
            {
                var fi = new FileInfo(path);
                var ext = fi.Extension.TrimStart('.').ToLowerInvariant();
                upsert.Parameters["$p"].Value = ToPanePath(path);
                upsert.Parameters["$n"].Value = fi.Name;
                upsert.Parameters["$e"].Value = string.IsNullOrEmpty(ext) ? DBNull.Value : ext;
                upsert.Parameters["$s"].Value = fi.Length;
                upsert.Parameters["$m"].Value = new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeSeconds();
                upsert.Parameters["$d"].Value = 0;
                upsert.Parameters["$k"].Value = ClassifyMedia(ext) ?? (object)DBNull.Value;
                upsert.ExecuteNonQuery();
            }
            else if (Directory.Exists(path))
            {
                var di = new DirectoryInfo(path);
                upsert.Parameters["$p"].Value = ToPanePath(path);
                upsert.Parameters["$n"].Value = di.Name;
                upsert.Parameters["$e"].Value = DBNull.Value;
                upsert.Parameters["$s"].Value = 0L;
                upsert.Parameters["$m"].Value = new DateTimeOffset(di.LastWriteTimeUtc).ToUnixTimeSeconds();
                upsert.Parameters["$d"].Value = 1;
                upsert.Parameters["$k"].Value = DBNull.Value;
                upsert.ExecuteNonQuery();
            }
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private void RemoveEntry(string panePath)
    {
        _writeLock.Wait();
        try
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "DELETE FROM files WHERE path=$p";
            cmd.Parameters.AddWithValue("$p", NormalizePanePath(panePath));
            cmd.ExecuteNonQuery();
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private static string EscapeLike(string s) => s.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_");

    private static string? ClassifyMedia(string ext) => ext switch
    {
        "jpg" or "jpeg" or "png" or "gif" or "webp" or "bmp" or "heic" => "image",
        "mp4" or "mkv" or "avi" or "mov" or "webm" => "video",
        "mp3" or "flac" or "wav" or "aac" or "ogg" => "audio",
        "pdf" or "doc" or "docx" or "txt" or "md" => "document",
        _ => null,
    };

    private static string NormalizeWinPath(string p) => p.Replace('/', '\\').TrimEnd('\\');

    private static string ToPanePath(string winPath)
    {
        var p = winPath.Replace('\\', '/');
        if (p.Length >= 2 && char.IsLetter(p[0]) && p[1] == ':')
            return "/" + p;
        return p.StartsWith('/') ? p : "/" + p;
    }

    private static string PaneToWin(string panePath)
    {
        var p = panePath.Replace('\\', '/');
        if (p.StartsWith('/') && p.Length >= 3 && char.IsLetter(p[1]) && p[2] == ':')
            return p[1] + ":" + p.Substring(3).Replace('/', '\\');
        return p.TrimStart('/').Replace('/', '\\');
    }

    private static string NormalizePanePath(string p) => p.Replace('\\', '/');
}
