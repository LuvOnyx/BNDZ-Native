using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
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
    private readonly SemaphoreSlim _metaLock = new(1, 1);
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
                  created INTEGER NOT NULL DEFAULT 0,
                  is_dir INTEGER NOT NULL DEFAULT 0,
                  media_kind TEXT
                );
                CREATE INDEX IF NOT EXISTS idx_files_name ON files(name COLLATE NOCASE);
                CREATE INDEX IF NOT EXISTS idx_files_modified ON files(modified DESC);
                CREATE INDEX IF NOT EXISTS idx_files_created ON files(created DESC);
                CREATE INDEX IF NOT EXISTS idx_files_media ON files(media_kind, modified DESC);
                CREATE INDEX IF NOT EXISTS idx_files_size ON files(size DESC);
                CREATE TABLE IF NOT EXISTS locations (
                  path TEXT PRIMARY KEY,
                  last_indexed INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS meta_kv (
                  key TEXT PRIMARY KEY,
                  value TEXT NOT NULL,
                  updated INTEGER NOT NULL DEFAULT 0
                );
                CREATE TABLE IF NOT EXISTS path_stats (
                  path TEXT PRIMARY KEY,
                  open_count INTEGER NOT NULL DEFAULT 0,
                  last_open INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_path_stats_open ON path_stats(open_count DESC, last_open DESC);
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
            EnsureCreatedColumn(conn);
            EnsureProducerColumns(conn);
            EnsureFtsBackfill(conn);
            EnsureMetaKv(conn);
            BackfillCreatedDates(conn);
            _schemaReady = true;
        }
    }

    private static void EnsureCreatedColumn(SqliteConnection conn)
    {
        using var check = conn.CreateCommand();
        check.CommandText = "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name='created'";
        if (Convert.ToInt64(check.ExecuteScalar()) != 0) return;
        using var alter = conn.CreateCommand();
        alter.CommandText = "ALTER TABLE files ADD COLUMN created INTEGER NOT NULL DEFAULT 0";
        alter.ExecuteNonQuery();
        using var idx = conn.CreateCommand();
        idx.CommandText = "CREATE INDEX IF NOT EXISTS idx_files_created ON files(created DESC)";
        idx.ExecuteNonQuery();
    }

    private static void EnsureProducerColumns(SqliteConnection conn)
    {
        using var check = conn.CreateCommand();
        check.CommandText = "SELECT COUNT(*) FROM pragma_table_info('files') WHERE name='bpm'";
        if (Convert.ToInt64(check.ExecuteScalar()) != 0) return;
        using var alter = conn.CreateCommand();
        alter.CommandText = """
            ALTER TABLE files ADD COLUMN bpm REAL;
            ALTER TABLE files ADD COLUMN musical_key TEXT;
            ALTER TABLE files ADD COLUMN camelot TEXT;
            """;
        alter.ExecuteNonQuery();
        using var idx = conn.CreateCommand();
        idx.CommandText = "CREATE INDEX IF NOT EXISTS idx_files_bpm ON files(bpm) WHERE bpm IS NOT NULL";
        idx.ExecuteNonQuery();
    }

    /// <summary>Store BPM/Key/Camelot for a file in the index.</summary>
    public void StoreProducerMeta(string path, double bpm, string? musicalKey, string? camelot)
    {
        EnsureSchema();
        var panePath = ToPanePath(path);
        if (string.IsNullOrWhiteSpace(panePath)) return;
        try
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                UPDATE files SET bpm = $bpm, musical_key = $key, camelot = $cam
                WHERE path = $p
                """;
            cmd.Parameters.AddWithValue("$bpm", bpm > 0 ? bpm : DBNull.Value);
            cmd.Parameters.AddWithValue("$key", string.IsNullOrWhiteSpace(musicalKey) ? DBNull.Value : musicalKey);
            cmd.Parameters.AddWithValue("$cam", string.IsNullOrWhiteSpace(camelot) ? DBNull.Value : camelot);
            cmd.Parameters.AddWithValue("$p", panePath);
            cmd.ExecuteNonQuery();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Index/ProducerMeta] {ex.Message}");
        }
    }

    /// <summary>Retrieve stored producer metadata for a file path.</summary>
    public (double bpm, string? key, string? camelot) GetProducerMeta(string path)
    {
        EnsureSchema();
        var panePath = ToPanePath(path);
        if (string.IsNullOrWhiteSpace(panePath)) return (0, null, null);
        try
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT bpm, musical_key, camelot FROM files WHERE path = $p";
            cmd.Parameters.AddWithValue("$p", panePath);
            using var r = cmd.ExecuteReader();
            if (r.Read())
            {
                var bpm = r.IsDBNull(0) ? 0.0 : r.GetDouble(0);
                var key = r.IsDBNull(1) ? null : r.GetString(1);
                var cam = r.IsDBNull(2) ? null : r.GetString(2);
                return (bpm, key, cam);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Index/ProducerMeta] {ex.Message}");
        }
        return (0, null, null);
    }

    /// <summary>Gradually backfill creation timestamps for rows indexed before the created column existed.</summary>
    private static void BackfillCreatedDates(SqliteConnection conn, int batchSize = 5000)
    {
        try
        {
            using var sel = conn.CreateCommand();
            sel.CommandText = "SELECT path FROM files WHERE created=0 LIMIT $lim";
            sel.Parameters.AddWithValue("$lim", Math.Max(1, batchSize));
            var paths = new List<string>();
            using (var r = sel.ExecuteReader())
                while (r.Read()) paths.Add(r.GetString(0));
            if (paths.Count == 0) return;

            using var upd = conn.CreateCommand();
            upd.CommandText = "UPDATE files SET created=$c WHERE path=$p";
            upd.Parameters.Add("$p", SqliteType.Text);
            upd.Parameters.Add("$c", SqliteType.Integer);
            foreach (var panePath in paths)
            {
                try
                {
                    var win = PaneToWin(panePath);
                    if (string.IsNullOrEmpty(win)) continue;
                    long created = 0;
                    if (File.Exists(win))
                        created = new DateTimeOffset(File.GetCreationTimeUtc(win)).ToUnixTimeSeconds();
                    else if (Directory.Exists(win))
                        created = new DateTimeOffset(Directory.GetCreationTimeUtc(win)).ToUnixTimeSeconds();
                    if (created <= 0) continue;
                    upd.Parameters["$p"].Value = panePath;
                    upd.Parameters["$c"].Value = created;
                    upd.ExecuteNonQuery();
                }
                catch { /* skip unreadable paths */ }
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Index/CreatedBackfill] {ex.Message}");
        }
    }

    private static void EnsureMetaKv(SqliteConnection conn)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            CREATE TABLE IF NOT EXISTS meta_kv (
              key TEXT PRIMARY KEY,
              value TEXT NOT NULL,
              updated INTEGER NOT NULL DEFAULT 0
            );
            """;
        cmd.ExecuteNonQuery();
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
            IndexLocation(root, ct, maxDepth: 12);
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
                INSERT INTO files(path,name,ext,size,modified,is_dir,media_kind,created) VALUES($p,$n,$e,$s,$m,$d,$k,$c)
                ON CONFLICT(path) DO UPDATE SET name=$n,ext=$e,size=$s,modified=$m,is_dir=$d,media_kind=$k,created=$c;
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
            upsert.Parameters.Add("$c", SqliteType.Integer);

            IndexDir(conn, root, root, 0, maxDepth, upsert, ref batch, ct);

            using var loc = conn.CreateCommand();
            loc.CommandText = "INSERT INTO locations(path,last_indexed) VALUES($p,$t) ON CONFLICT(path) DO UPDATE SET last_indexed=$t";
            loc.Parameters.AddWithValue("$p", ToPanePath(root));
            loc.Parameters.AddWithValue("$t", DateTimeOffset.UtcNow.ToUnixTimeSeconds());
            loc.ExecuteNonQuery();
            RefreshIndexStatsCache(conn);
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
                    upsert.Parameters["$c"].Value = new DateTimeOffset(fi.CreationTimeUtc).ToUnixTimeSeconds();
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
                    upsert.Parameters["$c"].Value = new DateTimeOffset(di.CreationTimeUtc).ToUnixTimeSeconds();
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

        var sql = $"SELECT {FileRowColumns} FROM files WHERE {string.Join(" AND ", where)}";
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
            var sql = $"""
                SELECT f.path, f.name, f.size, f.is_dir, f.modified, COALESCE(f.ext,''), COALESCE(f.media_kind,''), f.created,
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
            var ext = reader.FieldCount > 5 && !reader.IsDBNull(5) ? reader.GetString(5) : "";
            var mediaKind = reader.FieldCount > 6 && !reader.IsDBNull(6) ? reader.GetString(6) : "";
            var created = reader.FieldCount > 7 && !reader.IsDBNull(7) ? reader.GetInt64(7) : 0L;
            var snip = reader.FieldCount > 8 && !reader.IsDBNull(8) ? reader.GetString(8) : "";
            var rank = reader.FieldCount > 9 && !reader.IsDBNull(9) ? reader.GetDouble(9) : 0d;
            if (isDir)
                results.Add(new { id = path, name, path, type = "directory", modified = FormatModifiedIso(modified), created = FormatModifiedIso(created), snippet = snip, rank, mediaKind = string.IsNullOrWhiteSpace(mediaKind) ? null : mediaKind });
            else
                results.Add(new { id = path, name, path, type = "file", size, modified = FormatModifiedIso(modified), created = FormatModifiedIso(created), extension = string.IsNullOrWhiteSpace(ext) ? null : ext.Trim().TrimStart('.').ToLowerInvariant(), snippet = snip, rank, mediaKind = string.IsNullOrWhiteSpace(mediaKind) ? null : mediaKind });
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
            var sql = $"""
                SELECT f.path, f.name, f.size, f.is_dir, f.modified, COALESCE(f.ext,''), COALESCE(f.media_kind,''), f.created
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
        "pdf", "png", "jpg", "jpeg", "jfif", "bmp", "tif", "tiff", "webp",
    };

    private static void TryIndexTextContent(SqliteConnection conn, SqliteTransaction? tx, string winPath, string panePath, string ext, long size)
    {
        if (size <= 0) return;
        if (!IndexableTextExts.Contains(ext)) return;

        // Text files stay small; PDF/OCR allow larger but still bounded.
        var isRich = ext.Equals("pdf", StringComparison.OrdinalIgnoreCase)
            || ext is "png" or "jpg" or "jpeg" or "jfif" or "bmp" or "tif" or "tiff" or "webp";
        if (!isRich && size > 512 * 1024) return;
        if (isRich && size > 32 * 1024 * 1024) return;

        try
        {
            string? snippet = null;
            if (isRich)
                snippet = BndzContentTextExtractor.TryExtract(winPath, ext, size, 12_000);
            else
                snippet = ReadTextSnippet(winPath, 12_000);

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
        try
        {
            // Charset detection for Shift-JIS / ANSI / UTF-16 logs (UTF.Unknown).
            var bytes = File.ReadAllBytes(path);
            if (bytes.Length == 0) return "";
            if (bytes.Length > maxChars * 4)
                bytes = bytes.AsSpan(0, Math.Min(bytes.Length, maxChars * 4)).ToArray();

            var detected = UtfUnknown.CharsetDetector.DetectFromBytes(bytes);
            var enc = detected?.Detected?.Encoding ?? Encoding.UTF8;
            var text = enc.GetString(bytes);
            if (text.Length > maxChars) text = text[..maxChars];
            return text;
        }
        catch
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var reader = new StreamReader(fs, detectEncodingFromByteOrderMarks: true);
            var buf = new char[Math.Min(maxChars, 16_384)];
            var n = reader.Read(buf, 0, buf.Length);
            if (n <= 0) return "";
            return new string(buf, 0, n);
        }
    }

    public List<object> GetRecentFiles(int limit = 500) =>
        QueryView($"SELECT {FileRowColumns} FROM files WHERE is_dir=0 ORDER BY modified DESC LIMIT $lim", limit);

    /// <summary>Continuum rail rows with media_kind for Peek Orbit + thumb priority.</summary>
    public List<object> GetContinuumFiles(int limit = 28)
    {
        var lim = Math.Max(1, Math.Min(limit, 64));
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT {FileRowColumns} FROM files
            WHERE is_dir=0
            ORDER BY
              CASE WHEN media_kind IN ('image','video') THEN 0
                   WHEN media_kind IN ('audio','document') THEN 1
                   ELSE 2 END,
              modified DESC
            LIMIT $lim
            """;
        cmd.Parameters.AddWithValue("$lim", lim);
        return ReadFileRows(cmd);
    }

    /// <summary>Cheap fingerprint — skip expensive continuum/orbit rebuild when unchanged.</summary>
    public string GetContinuumFingerprint()
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(*), COALESCE(MAX(modified),0) FROM files WHERE is_dir=0";
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return "0:0";
        var count = r.IsDBNull(0) ? 0L : Convert.ToInt64(r.GetValue(0));
        var maxMod = r.IsDBNull(1) ? 0L : Convert.ToInt64(r.GetValue(1));
        return $"{count}:{maxMod}";
    }

    public void RecordPathOpen(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        var norm = path.Replace('\\', '/');
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        _writeLock.Wait();
        try
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO path_stats(path, open_count, last_open) VALUES($p, 1, $t)
                ON CONFLICT(path) DO UPDATE SET
                  open_count = open_count + 1,
                  last_open = excluded.last_open
                """;
            cmd.Parameters.AddWithValue("$p", norm);
            cmd.Parameters.AddWithValue("$t", now);
            cmd.ExecuteNonQuery();
        }
        finally { _writeLock.Release(); }
    }

    public List<object> GetMostOpenedFiles(int limit = 12)
    {
        var lim = Math.Clamp(limit, 1, 32);
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT f.path, f.name, f.size, f.is_dir, f.modified, COALESCE(f.ext,''), COALESCE(f.media_kind,''), COALESCE(s.open_count,0)
            FROM path_stats s
            INNER JOIN files f ON f.path = s.path
            ORDER BY s.open_count DESC, s.last_open DESC
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
            var ext = reader.FieldCount > 5 && !reader.IsDBNull(5) ? reader.GetString(5) : "";
            var mediaKind = reader.FieldCount > 6 && !reader.IsDBNull(6) ? reader.GetString(6) : "";
            var opens = reader.FieldCount > 7 && !reader.IsDBNull(7) ? reader.GetInt64(7) : 0L;
            if (isDir)
            {
                results.Add(new
                {
                    id = path,
                    name,
                    path,
                    type = "directory",
                    modified = FormatModifiedIso(modified),
                    mediaKind = string.IsNullOrWhiteSpace(mediaKind) ? null : mediaKind,
                    openCount = opens,
                });
            }
            else
            {
                results.Add(new
                {
                    id = path,
                    name,
                    path,
                    type = "file",
                    size,
                    modified = FormatModifiedIso(modified),
                    extension = string.IsNullOrWhiteSpace(ext) ? null : ext.Trim().TrimStart('.').ToLowerInvariant(),
                    mediaKind = string.IsNullOrWhiteSpace(mediaKind) ? null : mediaKind,
                    openCount = opens,
                });
            }
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

    public List<object> GetMediaFiles(int limit = 200) =>
        QueryView($"SELECT {FileRowColumns} FROM files WHERE is_dir=0 AND media_kind IN ('image','video') ORDER BY modified DESC LIMIT $lim", Math.Min(limit, 250));

    public List<object> GetAudioFiles(int limit = 200) =>
        QueryView($"SELECT {FileRowColumns} FROM files WHERE is_dir=0 AND media_kind='audio' ORDER BY modified DESC LIMIT $lim", Math.Min(limit, 250));

    public List<object> GetDocumentFiles(int limit = 1000) =>
        QueryView($"""
            SELECT {FileRowColumns} FROM files
            WHERE is_dir=0 AND (
              media_kind='document'
              OR lower(ext) IN ('pdf','doc','docx','xls','xlsx','ppt','pptx','txt','md','rtf','odt')
            )
            ORDER BY modified DESC LIMIT $lim
            """, limit);

    public List<object> GetLargeFiles(int limit = 500, long minBytes = 100 * 1024 * 1024) =>
        QueryView($"SELECT {FileRowColumns} FROM files WHERE is_dir=0 AND size >= $min ORDER BY size DESC LIMIT $lim", limit, minBytes);

    private List<object> QueryView(string sql, int limit, long? minBytes = null)
    {
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("$lim", Math.Max(1, Math.Min(limit, 5000)));
        if (minBytes.HasValue) cmd.Parameters.AddWithValue("$min", minBytes.Value);
        return ReadFileRows(cmd);
    }

    private const string FileRowColumns = "path,name,size,is_dir,modified,COALESCE(ext,''),COALESCE(media_kind,''),created";

    private static string FormatModifiedIso(long unixSeconds)
    {
        if (unixSeconds <= 0) return "";
        return DateTimeOffset.FromUnixTimeSeconds(unixSeconds).ToString("o");
    }

    private static object BuildIndexedFileRow(
        string path, string name, long size, bool isDir, long modifiedUnix, string ext, string mediaKind, long createdUnix = 0)
    {
        var modified = FormatModifiedIso(modifiedUnix);
        var created = FormatModifiedIso(createdUnix);
        var extNorm = string.IsNullOrWhiteSpace(ext) ? null : ext.Trim().TrimStart('.').ToLowerInvariant();
        var kind = string.IsNullOrWhiteSpace(mediaKind) ? null : mediaKind;
        if (isDir)
            return new { id = path, name, path, type = "directory", modified, created, mediaKind = kind };
        return new
        {
            id = path,
            name,
            path,
            type = "file",
            size,
            modified,
            created,
            extension = extNorm,
            mediaKind = kind,
        };
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
            var ext = reader.FieldCount > 5 && !reader.IsDBNull(5) ? reader.GetString(5) : "";
            var mediaKind = reader.FieldCount > 6 && !reader.IsDBNull(6) ? reader.GetString(6) : "";
            var created = reader.FieldCount > 7 && !reader.IsDBNull(7) ? reader.GetInt64(7) : 0L;
            results.Add(BuildIndexedFileRow(path, name, size, isDir, modified, ext, mediaKind, created));
        }
        return results;
    }

    public Dictionary<string, object?>? GetEntry(string panePath)
    {
        if (string.IsNullOrWhiteSpace(panePath)) return null;
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT name,ext,size,modified,is_dir,media_kind,created FROM files WHERE path=$p";
        cmd.Parameters.AddWithValue("$p", NormalizePanePath(panePath));
        using var r = cmd.ExecuteReader();
        if (!r.Read()) return null;
        return new Dictionary<string, object?>
        {
            ["name"] = r.GetString(0),
            ["extension"] = r.IsDBNull(1) ? null : r.GetString(1),
            ["size"] = r.GetInt64(2),
            ["modified"] = FormatModifiedIso(r.GetInt64(3)),
            ["modifiedUnix"] = r.GetInt64(3),
            ["isDirectory"] = r.GetInt32(4) == 1,
            ["mediaKind"] = r.IsDBNull(5) ? null : r.GetString(5),
            ["created"] = FormatModifiedIso(r.FieldCount > 6 && !r.IsDBNull(6) ? r.GetInt64(6) : 0L),
            ["createdUnix"] = r.FieldCount > 6 && !r.IsDBNull(6) ? r.GetInt64(6) : 0L,
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

        if (TryReadIndexStats(conn, out var cachedFiles, out var cachedFolders))
            return new { fileCount = cachedFiles, folderCount = cachedFolders, locations };

        // Indexing holds _writeLock — never block status on COUNT(*) during a scan.
        if (!_writeLock.Wait(0))
        {
            return new { fileCount = 0L, folderCount = 0L, locations };
        }
        try
        {
            RefreshIndexStatsCache(conn);
            TryReadIndexStats(conn, out cachedFiles, out cachedFolders);
            return new { fileCount = cachedFiles, folderCount = cachedFolders, locations };
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private static bool TryReadIndexStats(SqliteConnection conn, out long fileCount, out long folderCount)
    {
        fileCount = 0;
        folderCount = 0;
        try
        {
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT value FROM meta_kv WHERE key='index_stats_v1' LIMIT 1";
            var raw = cmd.ExecuteScalar() as string;
            if (string.IsNullOrWhiteSpace(raw)) return false;
            using var doc = JsonDocument.Parse(raw);
            var root = doc.RootElement;
            if (root.TryGetProperty("fileCount", out var fc)) fileCount = fc.GetInt64();
            if (root.TryGetProperty("folderCount", out var fdc)) folderCount = fdc.GetInt64();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static void RefreshIndexStatsCache(SqliteConnection conn)
    {
        long fileCount = 0, folderCount = 0;
        using (var countCmd = conn.CreateCommand())
        {
            countCmd.CommandText = """
                SELECT
                  COALESCE(SUM(CASE WHEN is_dir=0 THEN 1 ELSE 0 END), 0),
                  COALESCE(SUM(CASE WHEN is_dir=1 THEN 1 ELSE 0 END), 0)
                FROM files
                """;
            using var r = countCmd.ExecuteReader();
            if (r.Read())
            {
                fileCount = r.IsDBNull(0) ? 0 : r.GetInt64(0);
                folderCount = r.IsDBNull(1) ? 0 : r.GetInt64(1);
            }
        }
        var json = JsonSerializer.Serialize(new { fileCount, folderCount });
        using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO meta_kv(key, value, updated) VALUES('index_stats_v1', $v, $u)
            ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated
            """;
        cmd.Parameters.AddWithValue("$v", json);
        cmd.Parameters.AddWithValue("$u", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        cmd.ExecuteNonQuery();
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
        cmd.CommandText = $"""
            SELECT {FileRowColumns} FROM files
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

    /// <summary>Index peers with identical byte size (candidate content twins).</summary>
    public List<object> FindSameSize(string panePath, long size, int limit = 36)
    {
        if (size <= 0) return [];
        var norm = NormalizePanePath(panePath ?? "").TrimEnd('/');
        var lim = Math.Max(1, Math.Min(limit, 64));
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT {FileRowColumns} FROM files
            WHERE is_dir=0 AND size=$size AND path != $self
            ORDER BY modified DESC
            LIMIT $lim
            """;
        cmd.Parameters.AddWithValue("$size", size);
        cmd.Parameters.AddWithValue("$self", norm);
        cmd.Parameters.AddWithValue("$lim", lim);
        return ReadFileRows(cmd);
    }

    /// <summary>Same media_kind peers near the focus size (visual / library neighbors).</summary>
    public List<object> FindMediaPeers(string panePath, string mediaKind, long size, int limit = 12)
    {
        if (string.IsNullOrWhiteSpace(mediaKind)) return [];
        var norm = NormalizePanePath(panePath ?? "").TrimEnd('/');
        var lim = Math.Max(1, Math.Min(limit, 24));
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = $"""
            SELECT {FileRowColumns} FROM files
            WHERE is_dir=0
              AND media_kind=$kind
              AND path != $self
            ORDER BY ABS(size - $size) ASC, modified DESC
            LIMIT $lim
            """;
        cmd.Parameters.AddWithValue("$kind", mediaKind);
        cmd.Parameters.AddWithValue("$self", norm);
        cmd.Parameters.AddWithValue("$size", Math.Max(0, size));
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
                INSERT INTO files(path,name,ext,size,modified,is_dir,media_kind,created) VALUES($p,$n,$e,$s,$m,$d,$k,$c)
                ON CONFLICT(path) DO UPDATE SET name=$n,ext=$e,size=$s,modified=$m,is_dir=$d,media_kind=$k,created=$c;
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
            upsert.Parameters.Add("$c", SqliteType.Integer);

            if (File.Exists(path))
            {
                var fi = new FileInfo(path);
                var ext = fi.Extension.TrimStart('.').ToLowerInvariant();
                upsert.Parameters["$p"].Value = ToPanePath(path);
                upsert.Parameters["$n"].Value = fi.Name;
                upsert.Parameters["$e"].Value = string.IsNullOrEmpty(ext) ? DBNull.Value : ext;
                upsert.Parameters["$s"].Value = fi.Length;
                upsert.Parameters["$m"].Value = new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeSeconds();
                upsert.Parameters["$c"].Value = new DateTimeOffset(fi.CreationTimeUtc).ToUnixTimeSeconds();
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
                upsert.Parameters["$c"].Value = new DateTimeOffset(di.CreationTimeUtc).ToUnixTimeSeconds();
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

    public string? TryGetMeta(string key)
    {
        if (string.IsNullOrWhiteSpace(key)) return null;
        using var conn = OpenConnection();
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT value FROM meta_kv WHERE key=$k LIMIT 1";
        cmd.Parameters.AddWithValue("$k", key);
        var v = cmd.ExecuteScalar();
        return v as string;
    }

    public void SetMeta(string key, string value)
    {
        if (string.IsNullOrWhiteSpace(key)) return;
        _metaLock.Wait();
        try
        {
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                INSERT INTO meta_kv(key, value, updated) VALUES($k, $v, $u)
                ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated=excluded.updated
                """;
            cmd.Parameters.AddWithValue("$k", key);
            cmd.Parameters.AddWithValue("$v", value ?? "");
            cmd.Parameters.AddWithValue("$u", DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            cmd.ExecuteNonQuery();
        }
        finally
        {
            _metaLock.Release();
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
