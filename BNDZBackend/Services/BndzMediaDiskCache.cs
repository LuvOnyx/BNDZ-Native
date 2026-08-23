using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Data.Sqlite;
using ZstdSharp;

namespace BNDZ.Services;

/// <summary>
/// Durable L2 media cache — Spacedrive-style content-addressed store + SQLite catalog.
/// Icons/thumbs survive restarts; L1 RAM LRU stays in <see cref="BndzHostCaches"/>.
/// Layout: %LocalAppData%/BNDZ/Cache/catalog.db + cas/{ab}/{hash}.bin (raw PNG bytes).
/// </summary>
public sealed class BndzMediaDiskCache : IDisposable
{
    public enum Kind : byte
    {
        Icon = 1,
        Thumbnail = 2,
    }

    public sealed class Policy
    {
        public bool CacheIconsOnDisk { get; set; } = true;
        public bool CacheThumbsOnDisk { get; set; } = true;
        public bool ShowCachedIconsOnly { get; set; }
        public bool ShowCachedThumbsOnly { get; set; }
        public bool IncludeLocalDisks { get; set; } = true;
        public bool IncludeRemovableAndNetwork { get; set; }
        public long MaxIconBytes { get; set; } = 256L * 1024 * 1024;
        public long MaxThumbBytes { get; set; } = 2L * 1024 * 1024 * 1024;
    }

    private static readonly Lazy<BndzMediaDiskCache> Lazy = new(() => new BndzMediaDiskCache());
    public static BndzMediaDiskCache Instance => Lazy.Value;

    private readonly string _root;
    private readonly string _casRoot;
    private readonly string _dbPath;
    private readonly object _schemaGate = new();
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private volatile bool _schemaReady;
    private volatile Policy _policy = new();

    private BndzMediaDiskCache()
    {
        _root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Cache");
        _casRoot = Path.Combine(_root, "cas");
        _dbPath = Path.Combine(_root, "catalog.db");
        Directory.CreateDirectory(_casRoot);
        EnsureSchema();
    }

    public Policy CurrentPolicy => _policy;

    public void Dispose() => _writeLock.Dispose();

    public void ApplySettingsJson(string? json)
    {
        var p = new Policy();
        if (!string.IsNullOrWhiteSpace(json))
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                p.CacheIconsOnDisk = GetBool(root, "cacheSpecificIcons", true);
                p.CacheThumbsOnDisk = GetBool(root, "cacheThumbnailsOnDisk", true);
                p.ShowCachedIconsOnly = GetBool(root, "showCachedIconsOnly", false);
                p.ShowCachedThumbsOnly = GetBool(root, "showCachedThumbnailsOnly", false);
                p.IncludeLocalDisks = GetBool(root, "includeLocalDisks", true);
                p.IncludeRemovableAndNetwork = GetBool(root, "includeRemovableMediaAndNetworkLocations", false);
            }
            catch
            {
                /* keep defaults */
            }
        }

        // One-shot upgrade: older builds defaulted both flags to false. First run of the
        // durable CAS enables gold defaults so icons/thumbs actually persist after relaunch.
        try
        {
            Directory.CreateDirectory(_root);
            var marker = Path.Combine(_root, ".v2-durable-on");
            if (!File.Exists(marker))
            {
                p.CacheIconsOnDisk = true;
                p.CacheThumbsOnDisk = true;
                p.IncludeLocalDisks = true;
                File.WriteAllText(marker, "1");
            }

            // One-shot: "cached thumbs only" with an empty thumb catalog blanks every media
            // cell (shell type glyphs only). Force gold extract-on-miss until CAS is warm.
            var v3 = Path.Combine(_root, ".v3-thumb-extract-on-miss");
            if (!File.Exists(v3))
            {
                if (p.ShowCachedThumbsOnly && !HasAnyEntries(Kind.Thumbnail))
                    p.ShowCachedThumbsOnly = false;
                File.WriteAllText(v3, "1");
            }
            else if (p.ShowCachedThumbsOnly && !HasAnyEntries(Kind.Thumbnail))
            {
                // Keep defending even after the marker — empty catalog + cached-only = blank list.
                p.ShowCachedThumbsOnly = false;
            }

            // One-shot: old RememberExtractedIcon used USEFILEATTRIBUTES for directories, mapping the
            // Downloads (etc.) PNG onto the generic folder SYSICONINDEX + __folder__ key.
            // Every folder then painted as Downloads. Purge icon CAS + in-memory glyph maps.
            var v4 = Path.Combine(_root, ".v4-folder-glyph-unpoison");
            if (!File.Exists(v4))
            {
                try
                {
                    ClearKind(Kind.Icon);
                    BndzHostCaches.ClearIcons();
                    ShellGlyphMapService.Instance.ClearMemory();
                }
                catch { /* best-effort */ }
                File.WriteAllText(v4, "1");
            }
            // One-shot: MakeTransparent / Icon.ToBitmap destroyed alpha → glowing white folder plates.
            // Purge icon L1+L2 + glyph maps after ShellArgbPngEncoder (Format32bppArgb) landed.
            var v5 = Path.Combine(_root, ".v5-argb-png-encode");
            if (!File.Exists(v5))
            {
                try
                {
                    ClearKind(Kind.Icon);
                    BndzHostCaches.ClearIcons();
                    ShellGlyphMapService.Instance.ClearMemory();
                }
                catch { /* best-effort */ }
                File.WriteAllText(v5, "1");
            }
        }
        catch { /* ignore */ }

        _policy = p;
    }

    /// <summary>Delete all catalog rows of a kind and orphaned CAS blobs.</summary>
    public void ClearKind(Kind kind)
    {
        _writeLock.Wait();
        try
        {
            EnsureSchema();
            using var conn = OpenConnection();
            var hashes = new List<string>();
            using (var pick = conn.CreateCommand())
            {
                pick.CommandText = "SELECT cas_hash FROM entries WHERE kind = $kind;";
                pick.Parameters.AddWithValue("$kind", (long)kind);
                using var reader = pick.ExecuteReader();
                while (reader.Read())
                    hashes.Add(reader.GetString(0));
            }
            using (var del = conn.CreateCommand())
            {
                del.CommandText = "DELETE FROM entries WHERE kind = $kind;";
                del.Parameters.AddWithValue("$kind", (long)kind);
                del.ExecuteNonQuery();
            }
            foreach (var hash in hashes.Distinct(StringComparer.OrdinalIgnoreCase))
                TryDeleteCasIfOrphan(conn, hash);
        }
        finally
        {
            _writeLock.Release();
        }
    }

    /// <summary>True when the durable catalog has at least one entry of the given kind.</summary>
    public bool HasAnyEntries(Kind kind)
    {
        try
        {
            EnsureSchema();
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT 1 FROM entries WHERE kind = $kind LIMIT 1;";
            cmd.Parameters.AddWithValue("$kind", (long)kind);
            return cmd.ExecuteScalar() != null;
        }
        catch
        {
            return false;
        }
    }

    private static bool GetBool(JsonElement root, string name, bool fallback)
    {
        if (!root.TryGetProperty(name, out var el)) return fallback;
        return el.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => fallback,
        };
    }

    public bool AllowsThumbPath(string path)
    {
        var p = _policy;
        if (!p.CacheThumbsOnDisk) return false;
        if (string.IsNullOrWhiteSpace(path)) return false;
        if (ShellPathResolver.IsShellVirtualPath(path)
            || path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase))
            return false;

        try
        {
            var root = Path.GetPathRoot(path);
            if (string.IsNullOrEmpty(root)) return p.IncludeLocalDisks;
            var drive = new DriveInfo(root);
            return drive.DriveType switch
            {
                DriveType.Fixed => p.IncludeLocalDisks,
                DriveType.Removable or DriveType.Network or DriveType.CDRom or DriveType.Ram
                    => p.IncludeRemovableAndNetwork,
                _ => p.IncludeLocalDisks,
            };
        }
        catch
        {
            return p.IncludeLocalDisks;
        }
    }

    /// <summary>Cheap delivery URL for a warm CAS entry (custom scheme — not bndz.local folder map).</summary>
    public const string NativeIconUrlPrefix = BndzMediaScheme.CustomScheme + "://" + BndzMediaScheme.Authority + "/";

    /// <summary>Try L2 → URL when CAS file exists (no base64 encode). Null on miss.</summary>
    public string? TryGetCasUrl(Kind kind, string cacheKey)
    {
        var hash = TryGetCasHash(kind, cacheKey);
        return string.IsNullOrEmpty(hash) ? null : BndzMediaScheme.UrlForHash(hash);
    }

    /// <summary>Look up cas_hash for a cache key without reading PNG bytes.</summary>
    public string? TryGetCasHash(Kind kind, string cacheKey)
    {
        if (string.IsNullOrEmpty(cacheKey)) return null;
        if (kind == Kind.Icon && !_policy.CacheIconsOnDisk) return null;
        if (kind == Kind.Thumbnail && !_policy.CacheThumbsOnDisk) return null;

        try
        {
            EnsureSchema();
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT cas_hash FROM entries WHERE cache_key = $k AND kind = $kind LIMIT 1;";
            cmd.Parameters.AddWithValue("$k", cacheKey);
            cmd.Parameters.AddWithValue("$kind", (long)kind);
            var hashObj = cmd.ExecuteScalar();
            if (hashObj is not string hash || hash.Length < 4) return null;
            var file = CasPath(hash);
            if (!File.Exists(file))
            {
                DeleteEntry(conn, cacheKey);
                return null;
            }
            return hash;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Open CAS file stream by hex hash (for native-icon URL serving).</summary>
    public Stream? OpenCasStreamByHash(string hash)
    {
        var normalized = BndzMediaScheme.NormalizeHash(hash);
        if (string.IsNullOrEmpty(normalized)) return null;
        try
        {
            var file = CasPath(normalized);
            if (!File.Exists(file)) return null;
            return new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024, FileOptions.SequentialScan);
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Read CAS PNG bytes as base64 (no data: prefix). Null on miss.</summary>
    public string? TryReadBase64ByHash(string? hash)
    {
        try
        {
            using var stream = OpenCasStreamByHash(hash ?? "");
            if (stream == null) return null;
            using var ms = new MemoryStream(capacity: (int)Math.Min(stream.Length, 8 * 1024 * 1024));
            stream.CopyTo(ms);
            if (ms.Length == 0) return null;
            return Convert.ToBase64String(ms.ToArray());
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Try L2 disk read. Returns base64 PNG (no data: prefix) or null.</summary>
    public string? TryGetBase64(Kind kind, string cacheKey)
    {
        if (string.IsNullOrEmpty(cacheKey)) return null;
        if (kind == Kind.Icon && !_policy.CacheIconsOnDisk) return null;
        if (kind == Kind.Thumbnail && !_policy.CacheThumbsOnDisk) return null;

        try
        {
            EnsureSchema();
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = "SELECT cas_hash FROM entries WHERE cache_key = $k AND kind = $kind LIMIT 1;";
            cmd.Parameters.AddWithValue("$k", cacheKey);
            cmd.Parameters.AddWithValue("$kind", (long)kind);
            var hashObj = cmd.ExecuteScalar();
            if (hashObj is not string hash || hash.Length < 4) return null;

            var file = CasPath(hash);
            if (!File.Exists(file))
            {
                DeleteEntry(conn, cacheKey);
                return null;
            }

            var bytes = MaybeZstdDecompress(File.ReadAllBytes(file));
            if (bytes.Length == 0) return null;

            // Touch last_access asynchronously — don't block the icon hot path.
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            _ = Task.Run(async () =>
            {
                try
                {
                    await _writeLock.WaitAsync().ConfigureAwait(false);
                    try
                    {
                        using var w = OpenConnection();
                        using var touch = w.CreateCommand();
                        touch.CommandText = "UPDATE entries SET last_access = $t WHERE cache_key = $k;";
                        touch.Parameters.AddWithValue("$t", now);
                        touch.Parameters.AddWithValue("$k", cacheKey);
                        touch.ExecuteNonQuery();
                    }
                    finally { _writeLock.Release(); }
                }
                catch { /* ignore */ }
            });

            return Convert.ToBase64String(bytes);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BndzMediaDiskCache] TryGet failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>Persist raw PNG from base64 into CAS + catalog.</summary>
    public void PutBase64(Kind kind, string cacheKey, string base64)
    {
        if (string.IsNullOrEmpty(cacheKey) || string.IsNullOrEmpty(base64)) return;
        if (kind == Kind.Icon && !_policy.CacheIconsOnDisk) return;
        if (kind == Kind.Thumbnail && !_policy.CacheThumbsOnDisk) return;

        try
        {
            var payload = base64.StartsWith("data:", StringComparison.OrdinalIgnoreCase)
                ? base64[(base64.IndexOf(',') + 1)..]
                : base64;
            var bytes = Convert.FromBase64String(payload);
            if (bytes.Length == 0) return;
            PutBytes(kind, cacheKey, bytes);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BndzMediaDiskCache] Put failed: {ex.Message}");
        }
    }

    public void PutBytes(Kind kind, string cacheKey, byte[] bytes)
    {
        if (string.IsNullOrEmpty(cacheKey) || bytes.Length == 0) return;
        if (kind == Kind.Icon && !_policy.CacheIconsOnDisk) return;
        if (kind == Kind.Thumbnail && !_policy.CacheThumbsOnDisk) return;

        _writeLock.Wait();
        try
        {
            EnsureSchema();
            var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
            var dest = CasPath(hash);
            Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
            if (!File.Exists(dest))
            {
                var tmp = dest + ".tmp";
                var toWrite = MaybeZstdCompress(bytes);
                File.WriteAllBytes(tmp, toWrite);
                File.Move(tmp, dest, overwrite: true);
            }

            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            using var conn = OpenConnection();
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = """
                    INSERT INTO entries(cache_key, kind, cas_hash, byte_len, last_access, created)
                    VALUES($k, $kind, $hash, $len, $t, $t)
                    ON CONFLICT(cache_key) DO UPDATE SET
                      cas_hash = excluded.cas_hash,
                      byte_len = excluded.byte_len,
                      last_access = excluded.last_access;
                    """;
                cmd.Parameters.AddWithValue("$k", cacheKey);
                cmd.Parameters.AddWithValue("$kind", (long)kind);
                cmd.Parameters.AddWithValue("$hash", hash);
                cmd.Parameters.AddWithValue("$len", bytes.LongLength);
                cmd.Parameters.AddWithValue("$t", now);
                cmd.ExecuteNonQuery();
            }

            EnforceBudget(conn, kind);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BndzMediaDiskCache] PutBytes failed: {ex.Message}");
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public (int filesRemoved, long bytesFreed) ClearAll()
    {
        int files = 0;
        long bytes = 0;
        _writeLock.Wait();
        try
        {
            EnsureSchema();
            using (var conn = OpenConnection())
            using (var cmd = conn.CreateCommand())
            {
                cmd.CommandText = "DELETE FROM entries;";
                cmd.ExecuteNonQuery();
            }

            if (Directory.Exists(_casRoot))
            {
                foreach (var file in Directory.EnumerateFiles(_casRoot, "*", SearchOption.AllDirectories))
                {
                    try
                    {
                        var len = new FileInfo(file).Length;
                        File.Delete(file);
                        files++;
                        bytes += len;
                    }
                    catch { /* ignore */ }
                }
            }
        }
        finally
        {
            _writeLock.Release();
        }

        return (files, bytes);
    }

    private void EnforceBudget(SqliteConnection conn, Kind kind)
    {
        var max = kind == Kind.Icon ? _policy.MaxIconBytes : _policy.MaxThumbBytes;
        long used;
        using (var sum = conn.CreateCommand())
        {
            sum.CommandText = "SELECT COALESCE(SUM(byte_len), 0) FROM entries WHERE kind = $kind;";
            sum.Parameters.AddWithValue("$kind", (long)kind);
            used = (long)(sum.ExecuteScalar() ?? 0L);
        }
        if (used <= max) return;

        var doomed = new List<(string key, string hash, long len)>();
        long reclaim = 0;
        using (var pick = conn.CreateCommand())
        {
            pick.CommandText = """
                SELECT cache_key, cas_hash, byte_len FROM entries
                WHERE kind = $kind
                ORDER BY last_access ASC
                LIMIT 256;
                """;
            pick.Parameters.AddWithValue("$kind", (long)kind);
            using var reader = pick.ExecuteReader();
            while (reader.Read() && used - reclaim > max)
            {
                var len = reader.GetInt64(2);
                doomed.Add((reader.GetString(0), reader.GetString(1), len));
                reclaim += len;
            }
        }

        foreach (var (key, hash, len) in doomed)
        {
            DeleteEntry(conn, key);
            TryDeleteCasIfOrphan(conn, hash);
        }
    }

    private static void DeleteEntry(SqliteConnection conn, string cacheKey)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "DELETE FROM entries WHERE cache_key = $k;";
        cmd.Parameters.AddWithValue("$k", cacheKey);
        cmd.ExecuteNonQuery();
    }

    private void TryDeleteCasIfOrphan(SqliteConnection conn, string hash)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT COUNT(1) FROM entries WHERE cas_hash = $h;";
        cmd.Parameters.AddWithValue("$h", hash);
        var count = (long)(cmd.ExecuteScalar() ?? 0L);
        if (count > 0) return;
        try
        {
            var path = CasPath(hash);
            if (File.Exists(path)) File.Delete(path);
        }
        catch { /* ignore */ }
    }

    private string CasPath(string hash)
    {
        var a = hash.Length >= 2 ? hash[..2] : "00";
        return Path.Combine(_casRoot, a, hash + ".bin");
    }

    private void EnsureSchema()
    {
        if (_schemaReady) return;
        lock (_schemaGate)
        {
            if (_schemaReady) return;
            Directory.CreateDirectory(_root);
            Directory.CreateDirectory(_casRoot);
            using var conn = OpenConnection();
            using var cmd = conn.CreateCommand();
            cmd.CommandText = """
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=NORMAL;
                PRAGMA busy_timeout=8000;
                CREATE TABLE IF NOT EXISTS entries (
                  cache_key TEXT PRIMARY KEY,
                  kind INTEGER NOT NULL,
                  cas_hash TEXT NOT NULL,
                  byte_len INTEGER NOT NULL DEFAULT 0,
                  last_access INTEGER NOT NULL DEFAULT 0,
                  created INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_entries_kind_access ON entries(kind, last_access);
                CREATE INDEX IF NOT EXISTS idx_entries_hash ON entries(cas_hash);
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

    /// <summary>Wave 15 — BNZS header + Zstd payload when compression wins (≥4KB).</summary>
    private static byte[] MaybeZstdCompress(byte[] bytes)
    {
        if (bytes.Length < 4096) return bytes;
        try
        {
            using var compressor = new Compressor(3);
            var compressed = compressor.Wrap(bytes).ToArray();
            if (compressed.Length + 8 >= bytes.Length) return bytes;
            var toWrite = new byte[8 + compressed.Length];
            toWrite[0] = (byte)'B';
            toWrite[1] = (byte)'N';
            toWrite[2] = (byte)'Z';
            toWrite[3] = (byte)'S';
            BitConverter.TryWriteBytes(toWrite.AsSpan(4, 4), bytes.Length);
            Buffer.BlockCopy(compressed, 0, toWrite, 8, compressed.Length);
            return toWrite;
        }
        catch
        {
            return bytes;
        }
    }

    private static byte[] MaybeZstdDecompress(byte[] raw)
    {
        if (raw.Length < 8 || raw[0] != (byte)'B' || raw[1] != (byte)'N' || raw[2] != (byte)'Z' || raw[3] != (byte)'S')
            return raw;
        try
        {
            using var decompressor = new Decompressor();
            return decompressor.Unwrap(raw.AsSpan(8)).ToArray();
        }
        catch
        {
            return raw;
        }
    }
}
