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

    public sealed class IndexProgressReport
    {
        public string CurrentPath { get; init; } = "";
        public int FilesIndexed { get; init; }
        public bool Done { get; init; }
        public string? Root { get; init; }
        public string? Error { get; init; }
    }

    /// <summary>UI bridge — set from MainWindow to emit INDEX_PROGRESS events.</summary>
    public Action<IndexProgressReport>? ProgressCallback { get; set; }

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
                CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
                  name,
                  path,
                  tokenize = 'porter unicode61'
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS content_fts USING fts5(
                  path UNINDEXED,
                  body,
                  tokenize = 'unicode61'
                );
                """;
            cmd.ExecuteNonQuery();
            EnsureFtsBackfill(conn);
            _schemaReady = true;
        }
    }

    private static void EnsureFtsBackfill(SqliteConnection conn)
    {
        try
        {
            using var count = conn.CreateCommand();
            count.CommandText = "SELECT (SELECT COUNT(*) FROM files_fts), (SELECT COUNT(*) FROM files)";
            using var r = count.ExecuteReader();
            if (!r.Read()) return;
            var fts = r.GetInt64(0);
            var files = r.GetInt64(1);
            if (files == 0 || fts >= files) return;
            using var rebuild = conn.CreateCommand();
            rebuild.CommandText = """
                DELETE FROM files_fts;
                INSERT INTO files_fts(name, path) SELECT name, path FROM files;
                """;
            rebuild.ExecuteNonQuery();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Index/FTS] backfill: {ex.Message}");
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

    public void EnsureDefaultLocationsIndexedAsync(CancellationToken ct)
    {
        if (Interlocked.CompareExchange(ref _indexing, 1, 0) != 0) return;
        try
        {
            IndexDefaultLocations(ct);
        }
        finally
        {
            Interlocked.Exchange(ref _indexing, 0);
        }
    }

    /// <summary>Queue default-library reindex; returns false if a job is already running.</summary>
    public bool TryStartDefaultReindex(CancellationToken ct)
    {
        if (Interlocked.CompareExchange(ref _indexing, 1, 0) != 0) return false;
        _ = Task.Run(() =>
        {
            try
            {
                IndexDefaultLocations(ct);
            }
            catch (Exception ex)
            {
                EmitProgress("", 0, true, null, ex.Message);
            }
            finally
            {
                Interlocked.Exchange(ref _indexing, 0);
            }
        });
        return true;
    }

    private void IndexDefaultLocations(CancellationToken ct)
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

    public void IndexLocation(string rootPath, CancellationToken ct, int maxDepth = 10)
    {
        var root = NormalizeWinPath(rootPath);
        if (!Directory.Exists(root)) return;

        IndexPathGlobbing.ConfigureExcludes();
        _writeLock.Wait(ct);
        var batch = 0;
        try
        {
            EmitProgress(root, 0, false, root);
            using var conn = OpenConnection();
            var upsert = conn.CreateCommand();
            upsert.CommandText = """
                INSERT INTO files(path,name,ext,size,modified,is_dir,media_kind) VALUES($p,$n,$e,$s,$m,$d,$k)
                ON CONFLICT(path) DO UPDATE SET name=$n,ext=$e,size=$s,modified=$m,is_dir=$d,media_kind=$k;
                DELETE FROM files_fts WHERE path=$p;
                INSERT INTO files_fts(name, path) VALUES($n, $p);
                """;
            upsert.Parameters.Add("$p", SqliteType.Text);
            upsert.Parameters.Add("$n", SqliteType.Text);
            upsert.Parameters.Add("$e", SqliteType.Text);
            upsert.Parameters.Add("$s", SqliteType.Integer);
            upsert.Parameters.Add("$m", SqliteType.Integer);
            upsert.Parameters.Add("$d", SqliteType.Integer);
            upsert.Parameters.Add("$k", SqliteType.Text);

            IndexDir(conn, root, root, 0, maxDepth, upsert, ref batch, ct);

            using var loc = conn.CreateCommand();
            loc.CommandText = "INSERT INTO locations(path,last_indexed) VALUES($p,$t) ON CONFLICT(path) DO UPDATE SET last_indexed=$t";
            loc.Parameters.AddWithValue("$p", ToPanePath(root));
            loc.Parameters.AddWithValue("$t", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            loc.ExecuteNonQuery();
            EmitProgress(root, batch, true, root);
        }
        catch (Exception ex)
        {
            EmitProgress(root, batch, true, root, ex.Message);
            throw;
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private void EmitProgress(string path, int filesIndexed, bool done, string? root = null, string? error = null)
    {
        try
        {
            ProgressCallback?.Invoke(new IndexProgressReport
            {
                CurrentPath = path,
                FilesIndexed = filesIndexed,
                Done = done,
                Root = root,
                Error = error,
            });
        }
        catch { /* ignore UI errors */ }
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
                    TryIndexTextContent(conn, tx, file, panePath, ext, fi.Length);
                    if (++batch % 250 == 0)
                    {
                        tx!.Commit();
                        tx.Dispose();
                        tx = null;
                        EmitProgress(file, batch, false);
                    }
                }
                catch { }
            }

            foreach (var sub in Directory.EnumerateDirectories(dir))
            {
                ct.ThrowIfCancellationRequested();
                var name = Path.GetFileName(sub);
                if (SkipDirs.Contains(name) || name.StartsWith('.') || IndexPathGlobbing.IsExcluded(sub, root)) continue;
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
                        EmitProgress(sub, batch, false);
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

        // Gold path: FTS5 name/path match (prefix tokens), then LIKE fallback.
        var fts = TryFtsSearch(conn, terms, limit, scopeRootPanePath);
        if (fts.Count > 0)
            return fts;

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

    /// <summary>FTS5 content body search for indexed text files (Smart Tools / content mode).</summary>
    public List<object> SearchContent(string query, int limit, string scopeRootPanePath = "")
    {
        var results = new List<object>();
        if (string.IsNullOrWhiteSpace(query)) return results;
        var match = BuildFtsMatch(query.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries));
        if (string.IsNullOrEmpty(match)) return results;

        try
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            var sql = """
                SELECT f.path, f.name, f.size, f.is_dir, f.modified,
                       snippet(c, 1, '', '', '…', 12) AS snip,
                       bm25(c) AS rank
                FROM content_fts c
                JOIN files f ON f.path = c.path
                WHERE c MATCH $q
                """;
            cmd.Parameters.AddWithValue("$q", match);
            if (!string.IsNullOrWhiteSpace(scopeRootPanePath))
            {
                var win = PaneToWin(scopeRootPanePath);
                if (!string.IsNullOrEmpty(win))
                {
                    sql += " AND f.path LIKE $scope ESCAPE '\\'";
                    cmd.Parameters.AddWithValue("$scope", ToPanePath(win).TrimEnd('/') + "/%");
                }
            }
            sql += " ORDER BY bm25(c) LIMIT $lim";
            cmd.Parameters.AddWithValue("$lim", Math.Max(1, Math.Min(limit, 2000)));
            cmd.CommandText = sql;
            return ReadContentRows(cmd);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Index/ContentFTS] {ex.Message}");
            return results;
        }
    }

    private static List<object> ReadContentRows(SqliteCommand cmd)
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
            var snip = reader.FieldCount > 5 && !reader.IsDBNull(5) ? reader.GetString(5) : "";
            var rank = reader.FieldCount > 6 && !reader.IsDBNull(6) ? reader.GetDouble(6) : 0d;
            if (isDir)
                results.Add(new { id = path, name, path, type = "directory", modified, snippet = snip, rank });
            else
                results.Add(new { id = path, name, path, type = "file", size, modified, snippet = snip, rank });
        }
        return results;
    }

    private static List<object> TryFtsSearch(SqliteConnection conn, string[] terms, int limit, string scopeRootPanePath)
    {
        try
        {
            var match = BuildFtsMatch(terms);
            if (string.IsNullOrEmpty(match)) return [];

            using var cmd = conn.CreateCommand();
            var sql = """
                SELECT f.path, f.name, f.size, f.is_dir, f.modified
                FROM files_fts
                JOIN files f ON f.path = files_fts.path
                WHERE files_fts MATCH $q
                """;
            cmd.Parameters.AddWithValue("$q", match);
            if (!string.IsNullOrWhiteSpace(scopeRootPanePath))
            {
                var win = PaneToWin(scopeRootPanePath);
                if (!string.IsNullOrEmpty(win))
                {
                    sql += " AND f.path LIKE $scope ESCAPE '\\'";
                    cmd.Parameters.AddWithValue("$scope", ToPanePath(win).TrimEnd('/') + "/%");
                }
            }
            sql += " ORDER BY bm25(files_fts), f.is_dir DESC, f.modified DESC LIMIT $lim";
            cmd.Parameters.AddWithValue("$lim", Math.Max(1, Math.Min(limit, 5000)));
            cmd.CommandText = sql;
            return ReadFileRows(cmd);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Index/FTS] {ex.Message}");
            return [];
        }
    }

    private static string BuildFtsMatch(string[] terms)
    {
        var parts = new List<string>();
        foreach (var t in terms)
        {
            var cleaned = new string(t.Where(c => char.IsLetterOrDigit(c) || c is '_' or '-' or '.').ToArray());
            if (cleaned.Length < 1) continue;
            // Prefix match — gold UX for partial names; quote if needed.
            if (cleaned.Any(c => !char.IsLetterOrDigit(c) && c is not '_' and not '-'))
                parts.Add($"\"{cleaned.Replace("\"", "")}\"*");
            else
                parts.Add($"{cleaned}*");
        }
        return parts.Count == 0 ? "" : string.Join(" AND ", parts);
    }

    private static readonly HashSet<string> IndexableTextExts = new(StringComparer.OrdinalIgnoreCase)
    {
        "txt", "md", "markdown", "csv", "json", "xml", "yml", "yaml", "toml", "ini", "log",
        "cs", "ts", "tsx", "js", "jsx", "py", "rs", "go", "java", "kt", "swift",
        "html", "htm", "css", "scss", "sql", "ps1", "bat", "cmd", "sh",
    };

    private static void TryIndexTextContent(SqliteConnection conn, SqliteTransaction? tx, string winPath, string panePath, string ext, long size)
    {
        if (size <= 0 || size > 512 * 1024) return;
        if (!IndexableTextExts.Contains(ext)) return;
        try
        {
            var snippet = ReadTextSnippet(winPath, 12_000);
            if (string.IsNullOrWhiteSpace(snippet)) return;

            using var del = conn.CreateCommand();
            del.Transaction = tx;
            del.CommandText = "DELETE FROM content_fts WHERE path=$p";
            del.Parameters.AddWithValue("$p", panePath);
            del.ExecuteNonQuery();

            using var ins = conn.CreateCommand();
            ins.Transaction = tx;
            ins.CommandText = "INSERT INTO content_fts(path, body) VALUES($p, $b)";
            ins.Parameters.AddWithValue("$p", panePath);
            ins.Parameters.AddWithValue("$b", snippet);
            ins.ExecuteNonQuery();
        }
        catch { /* best-effort content index */ }
    }

    private static string ReadTextSnippet(string path, int maxChars)
    {
        using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
        using var reader = new StreamReader(fs, detectEncodingFromByteOrderMarks: true);
        var buf = new char[Math.Min(maxChars, 16_384)];
        var n = reader.Read(buf, 0, buf.Length);
        if (n <= 0) return "";
        return new string(buf, 0, n);
    }

    public List<object> GetRecentFiles(int limit = 500) =>
        QueryView("SELECT path,name,size,is_dir,modified FROM files WHERE is_dir=0 ORDER BY modified DESC LIMIT $lim", limit);

    /// <summary>Continuum rail rows with media_kind for Peek Orbit + thumb priority.</summary>
    public List<object> GetContinuumFiles(int limit = 28)
    {
        var lim = Math.Max(1, Math.Min(limit, 64));
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT path,name,size,is_dir,modified,COALESCE(media_kind,'') FROM files
            WHERE is_dir=0
            ORDER BY
              CASE WHEN media_kind IN ('image','video') THEN 0
                   WHEN media_kind IN ('audio','document') THEN 1
                   ELSE 2 END,
              modified DESC
            LIMIT $lim
            """;
        cmd.Parameters.AddWithValue("$lim", lim);
        var results = new List<object>();
        using var reader = cmd.ExecuteReader();
        while (reader.Read())
        {
            var path = reader.GetString(0);
            var name = reader.GetString(1);
            var size = reader.GetInt64(2);
            var isDir = reader.GetInt32(3) == 1;
            var modified = reader.FieldCount > 4 && !reader.IsDBNull(4) ? reader.GetInt64(4) : 0L;
            var mediaKind = reader.FieldCount > 5 && !reader.IsDBNull(5) ? reader.GetString(5) : "";
            if (isDir)
                results.Add(new { id = path, name, path, type = "directory", modified, mediaKind });
            else
                results.Add(new { id = path, name, path, type = "file", size, modified, mediaKind });
        }
        return results;
    }

    /// <summary>Per-folder media density for Place plates / Pulse.</summary>
    public object GetLibraryPulse()
    {
        using var conn = OpenConnection();
        long images = 0, videos = 0, audio = 0, documents = 0, large = 0;
        using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = """
                SELECT
                  SUM(CASE WHEN media_kind='image' THEN 1 ELSE 0 END),
                  SUM(CASE WHEN media_kind='video' THEN 1 ELSE 0 END),
                  SUM(CASE WHEN media_kind='audio' THEN 1 ELSE 0 END),
                  SUM(CASE WHEN media_kind='document' OR lower(ext) IN ('pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md') THEN 1 ELSE 0 END),
                  SUM(CASE WHEN is_dir=0 AND size >= 104857600 THEN 1 ELSE 0 END)
                FROM files
                """;
            using var r = cmd.ExecuteReader();
            if (r.Read())
            {
                images = r.IsDBNull(0) ? 0 : Convert.ToInt64(r.GetValue(0));
                videos = r.IsDBNull(1) ? 0 : Convert.ToInt64(r.GetValue(1));
                audio = r.IsDBNull(2) ? 0 : Convert.ToInt64(r.GetValue(2));
                documents = r.IsDBNull(3) ? 0 : Convert.ToInt64(r.GetValue(3));
                large = r.IsDBNull(4) ? 0 : Convert.ToInt64(r.GetValue(4));
            }
        }
        return new { images, videos, audio, documents, large };
    }

    public List<object> GetMediaFiles(int limit = 1000) =>
        QueryView("SELECT path,name,size,is_dir,modified FROM files WHERE is_dir=0 AND media_kind IN ('image','video') ORDER BY modified DESC LIMIT $lim", limit);

    public List<object> GetAudioFiles(int limit = 1000) =>
        QueryView("SELECT path,name,size,is_dir,modified FROM files WHERE is_dir=0 AND media_kind='audio' ORDER BY modified DESC LIMIT $lim", limit);

    public List<object> GetDocumentFiles(int limit = 1000) =>
        QueryView("""
            SELECT path,name,size,is_dir,modified FROM files
            WHERE is_dir=0 AND (
              media_kind='document'
              OR lower(ext) IN ('pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','rtf','odt')
            )
            ORDER BY modified DESC LIMIT $lim
            """, limit);

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

    /// <summary>Same-folder siblings for Continuum Peek Orbit (media-first).</summary>
    public List<object> GetOrbitSiblings(string panePath, int limit = 6)
    {
        var norm = NormalizePanePath(panePath ?? "").TrimEnd('/');
        var slash = norm.LastIndexOf('/');
        if (slash <= 0 || string.IsNullOrWhiteSpace(norm)) return [];
        var dir = norm.Substring(0, slash);
        var lim = Math.Max(1, Math.Min(limit, 12));

        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT path,name,size,is_dir,modified FROM files
            WHERE is_dir=0
              AND path LIKE $prefix
              AND path NOT LIKE $nested
              AND path != $self
            ORDER BY
              CASE WHEN media_kind IN ('image','video') THEN 0 ELSE 1 END,
              modified DESC
            LIMIT $lim
            """;
        cmd.Parameters.AddWithValue("$prefix", dir + "/%");
        cmd.Parameters.AddWithValue("$nested", dir + "/%/%");
        cmd.Parameters.AddWithValue("$self", norm);
        cmd.Parameters.AddWithValue("$lim", lim);
        return ReadFileRows(cmd);
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
                ON CONFLICT(path) DO UPDATE SET name=$n,ext=$e,size=$s,modified=$m,is_dir=$d,media_kind=$k;
                DELETE FROM files_fts WHERE path=$p;
                INSERT INTO files_fts(name, path) VALUES($n, $p);
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
                TryIndexTextContent(conn, null, path, ToPanePath(path), ext, fi.Length);
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
