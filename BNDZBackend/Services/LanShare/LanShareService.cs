using System.Collections.Concurrent;
using System.IO.Compression;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;

namespace BNDZ.Services.LanShare;

/// <summary>
/// BNDZ-owned LAN HTTP folder sharer (CopyParty-style product surface).
/// Ideas studied from MIT-licensed copyparty (https://github.com/9001/copyparty):
/// volume-style share path, read-only default, tokenized URL, LAN bind, honest stop.
/// No GPL pieces (Mutagen / FFmpeg) and no foreign exe shell-out — native HttpListener.
/// </summary>
public sealed class LanShareService : IDisposable
{
    public static LanShareService Instance { get; } = new();

    private const long MaxZipBytes = 512L * 1024 * 1024; // 512 MiB safety cap for v1
    private const int DefaultPreferredPort = 3923; // copyparty default — familiar on LAN

    private static readonly HashSet<string> AudioExt = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp3", ".wav", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".opus", ".wma"
    };

    private readonly object _gate = new();
    private readonly ConcurrentDictionary<string, ActiveShare> _shares = new(StringComparer.OrdinalIgnoreCase);
    private bool _disposed;

    public IReadOnlyList<LanShareSession> ListSessions()
    {
        lock (_gate)
            return _shares.Values.Select(s => s.Session).OrderByDescending(s => s.StartedUtc).ToList();
    }

    public LanShareSession? GetSession(string shareId)
    {
        lock (_gate)
            return _shares.TryGetValue(shareId, out var s) ? s.Session : null;
    }

    public LanShareSession Start(string folderPath, string? password = null, int? preferredPort = null)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        if (string.IsNullOrWhiteSpace(folderPath))
            throw new InvalidOperationException("Pick a folder to share.");
        var full = Path.GetFullPath(folderPath.Trim());
        if (!Directory.Exists(full))
            throw new InvalidOperationException($"Folder not found: {full}");

        var lan = GetPrimaryLanAddress()
            ?? throw new InvalidOperationException("No LAN IPv4 address found. Connect to Wi‑Fi/Ethernet and try again.");

        var token = CreateToken();
        var shareId = Guid.NewGuid().ToString("N")[..12];
        var port = preferredPort is > 0 and < 65535 ? preferredPort.Value : FindFreePort(lan, DefaultPreferredPort);
        var pwdHash = string.IsNullOrEmpty(password) ? null : HashPassword(password);

        var session = new LanShareSession
        {
            ShareId = shareId,
            FolderPath = full,
            FolderName = new DirectoryInfo(full).Name,
            Token = token,
            LanAddress = lan,
            Port = port,
            Url = $"http://{lan}:{port}/s/{token}/",
            HasPassword = pwdHash != null,
            StartedUtc = DateTime.UtcNow,
            Running = true,
        };

        var cts = new CancellationTokenSource();
        var http = new HttpListener { IgnoreWriteExceptions = true };
        // Bind LAN IP only — not 0.0.0.0. Also loopback for local self-check.
        http.Prefixes.Add($"http://{lan}:{port}/");
        http.Prefixes.Add($"http://127.0.0.1:{port}/");

        try
        {
            http.Start();
        }
        catch (HttpListenerException ex)
        {
            http.Close();
            throw new InvalidOperationException(
                $"Could not bind HTTP on {lan}:{port}. Windows may need a URL ACL (netsh http add urlacl). Detail: {ex.Message}");
        }

        var active = new ActiveShare
        {
            Session = session,
            RootFullPath = full,
            Token = token,
            PasswordHash = pwdHash,
            Http = http,
            Cts = cts,
        };

        lock (_gate)
        {
            // v1: one active share at a time keeps the UX honest and avoids port clutter.
            foreach (var existing in _shares.Keys.ToList())
                StopInternal(existing, notify: false);
            _shares[shareId] = active;
        }

        active.LoopTask = Task.Run(() => HttpLoopAsync(active, cts.Token));
        return session;
    }

    public bool Stop(string shareId)
    {
        lock (_gate)
            return StopInternal(shareId, notify: true);
    }

    public void StopAll()
    {
        lock (_gate)
        {
            foreach (var id in _shares.Keys.ToList())
                StopInternal(id, notify: true);
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        StopAll();
    }

    private bool StopInternal(string shareId, bool notify)
    {
        if (!_shares.TryRemove(shareId, out var active)) return false;
        active.Session.Running = false;
        try { active.Cts.Cancel(); } catch { /* */ }
        try { active.Http.Stop(); } catch { /* */ }
        try { active.Http.Close(); } catch { /* */ }
        try { active.Cts.Dispose(); } catch { /* */ }
        _ = notify;
        return true;
    }

    private async Task HttpLoopAsync(ActiveShare share, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            HttpListenerContext? ctx = null;
            try
            {
                ctx = await share.Http.GetContextAsync().WaitAsync(ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) { break; }
            catch (HttpListenerException) { break; }
            catch (ObjectDisposedException) { break; }
            catch { continue; }

            _ = Task.Run(() => HandleRequestAsync(share, ctx!), ct);
        }
    }

    private async Task HandleRequestAsync(ActiveShare share, HttpListenerContext ctx)
    {
        try
        {
            Interlocked.Increment(ref share.RequestCountScratch);
            share.Session.RequestCount = share.RequestCountScratch;

            var req = ctx.Request;
            var res = ctx.Response;
            res.Headers["Cache-Control"] = "no-store";
            res.Headers["X-BNDZ-Share"] = "lan-readonly";
            res.Headers["X-Content-Type-Options"] = "nosniff";

            var method = req.HttpMethod?.ToUpperInvariant() ?? "GET";
            if (method is "PUT" or "POST" or "DELETE" or "PATCH" or "MKCOL" or "MOVE" or "COPY" or "PROPFIND" or "PROPPATCH")
            {
                await WriteTextAsync(res, 405, "text/plain; charset=utf-8", "Read-only share — writes disabled.").ConfigureAwait(false);
                return;
            }

            if (method == "OPTIONS")
            {
                res.StatusCode = 204;
                res.Headers["Allow"] = "GET, HEAD, OPTIONS";
                res.Close();
                return;
            }

            var path = req.Url?.AbsolutePath ?? "/";
            if (path == "/" || path.Equals("/health", StringComparison.OrdinalIgnoreCase))
            {
                await WriteTextAsync(res, 200, "text/plain; charset=utf-8",
                    $"BNDZ LAN Share OK\nfolder={share.Session.FolderName}\nreadonly=1\n").ConfigureAwait(false);
                return;
            }

            // Expect /s/{token}/... 
            if (!TryParseSharePath(path, out var token, out var relUrl))
            {
                await WriteTextAsync(res, 404, "text/plain; charset=utf-8", "Not found.").ConfigureAwait(false);
                return;
            }

            if (!CryptographicOperations.FixedTimeEquals(
                    Encoding.UTF8.GetBytes(token),
                    Encoding.UTF8.GetBytes(share.Token)))
            {
                await WriteTextAsync(res, 403, "text/plain; charset=utf-8", "Invalid share token.").ConfigureAwait(false);
                return;
            }

            if (share.PasswordHash != null && !CheckPassword(req, share.PasswordHash))
            {
                res.StatusCode = 401;
                res.Headers["WWW-Authenticate"] = "Basic realm=\"BNDZ LAN Share\"";
                await WriteTextAsync(res, 401, "text/plain; charset=utf-8", "Password required.").ConfigureAwait(false);
                return;
            }

            var query = req.Url?.Query ?? "";
            var wantZip = QueryHas(query, "zip", "1") || QueryHas(query, "download", "zip");

            if (!TryMapPath(share.RootFullPath, relUrl, out var mapped, out var isDir))
            {
                await WriteTextAsync(res, 400, "text/plain; charset=utf-8", "Invalid path.").ConfigureAwait(false);
                return;
            }

            if (isDir)
            {
                if (!Directory.Exists(mapped))
                {
                    await WriteTextAsync(res, 404, "text/plain; charset=utf-8", "Folder not found.").ConfigureAwait(false);
                    return;
                }
                if (wantZip)
                {
                    await ServeZipAsync(share, res, mapped, Path.GetFileName(mapped.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)) is { Length: > 0 } n ? n : share.Session.FolderName).ConfigureAwait(false);
                    return;
                }
                var html = BuildListingHtml(share, mapped, relUrl);
                await WriteTextAsync(res, 200, "text/html; charset=utf-8", html).ConfigureAwait(false);
                return;
            }

            if (!File.Exists(mapped))
            {
                await WriteTextAsync(res, 404, "text/plain; charset=utf-8", "File not found.").ConfigureAwait(false);
                return;
            }

            await ServeFileAsync(share, req, res, mapped).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            share.Session.LastError = ex.Message;
            try
            {
                if (ctx.Response.OutputStream.CanWrite)
                    await WriteTextAsync(ctx.Response, 500, "text/plain; charset=utf-8", "Server error.").ConfigureAwait(false);
            }
            catch { /* */ }
        }
        finally
        {
            try { ctx.Response.Close(); } catch { /* */ }
        }
    }

    private static bool TryParseSharePath(string absolutePath, out string token, out string relUrl)
    {
        token = "";
        relUrl = "";
        var parts = absolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) return false;
        if (!parts[0].Equals("s", StringComparison.OrdinalIgnoreCase)) return false;
        token = parts[1];
        if (token.Length < 8) return false;
        relUrl = parts.Length == 2 ? "" : string.Join('/', parts.Skip(2));
        try { relUrl = Uri.UnescapeDataString(relUrl); } catch { /* keep raw */ }
        return true;
    }

    private static bool TryMapPath(string rootFull, string relUrl, out string mapped, out bool isDir)
    {
        mapped = rootFull;
        isDir = true;
        var rel = (relUrl ?? "").Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
        if (string.IsNullOrEmpty(rel))
        {
            mapped = rootFull;
            isDir = true;
            return true;
        }

        // Block traversal tokens early.
        var segments = rel.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
        if (segments.Any(s => s is "." or ".."))
        {
            mapped = "";
            isDir = false;
            return false;
        }

        mapped = Path.GetFullPath(Path.Combine(rootFull, rel));
        var rootPrefix = rootFull.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!mapped.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(mapped, rootFull, StringComparison.OrdinalIgnoreCase))
        {
            mapped = "";
            isDir = false;
            return false;
        }

        if (Directory.Exists(mapped)) { isDir = true; return true; }
        if (File.Exists(mapped)) { isDir = false; return true; }
        // Trailing slash may have been stripped — treat missing as file miss later.
        isDir = mapped.EndsWith(Path.DirectorySeparatorChar);
        return true;
    }

    private static bool CheckPassword(HttpListenerRequest req, byte[] expectedHash)
    {
        var header = req.Headers["Authorization"];
        if (string.IsNullOrEmpty(header) || !header.StartsWith("Basic ", StringComparison.OrdinalIgnoreCase))
            return false;
        try
        {
            var raw = Encoding.UTF8.GetString(Convert.FromBase64String(header["Basic ".Length..].Trim()));
            var idx = raw.IndexOf(':');
            var password = idx >= 0 ? raw[(idx + 1)..] : raw;
            var actual = HashPassword(password);
            return CryptographicOperations.FixedTimeEquals(actual, expectedHash);
        }
        catch { return false; }
    }

    private async Task ServeFileAsync(ActiveShare share, HttpListenerRequest req, HttpListenerResponse res, string filePath)
    {
        var fi = new FileInfo(filePath);
        var mime = GuessMime(fi.Extension);
        res.ContentType = mime;
        res.Headers["Accept-Ranges"] = "bytes";
        res.AddHeader("Content-Disposition", $"inline; filename=\"{EscapeHeader(fi.Name)}\"");

        long start = 0;
        long end = fi.Length - 1;
        var range = req.Headers["Range"];
        if (!string.IsNullOrEmpty(range) && range.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase) && fi.Length > 0)
        {
            var spec = range[6..];
            var dash = spec.IndexOf('-');
            if (dash >= 0)
            {
                var a = spec[..dash];
                var b = spec[(dash + 1)..];
                if (long.TryParse(a, out var s)) start = s;
                if (long.TryParse(b, out var e)) end = e;
                if (end >= fi.Length) end = fi.Length - 1;
                if (start > end) start = 0;
                res.StatusCode = 206;
                res.Headers["Content-Range"] = $"bytes {start}-{end}/{fi.Length}";
            }
        }

        var length = Math.Max(0, end - start + 1);
        res.ContentLength64 = length;
        if (string.Equals(req.HttpMethod, "HEAD", StringComparison.OrdinalIgnoreCase))
        {
            res.StatusCode = res.StatusCode == 0 ? 200 : res.StatusCode;
            return;
        }

        await using var fs = new FileStream(filePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        if (start > 0) fs.Seek(start, SeekOrigin.Begin);
        var buffer = new byte[64 * 1024];
        long remaining = length;
        while (remaining > 0)
        {
            var toRead = (int)Math.Min(buffer.Length, remaining);
            var read = await fs.ReadAsync(buffer.AsMemory(0, toRead)).ConfigureAwait(false);
            if (read <= 0) break;
            await res.OutputStream.WriteAsync(buffer.AsMemory(0, read)).ConfigureAwait(false);
            remaining -= read;
            Interlocked.Add(ref share.BytesScratch, read);
            share.Session.BytesServed = share.BytesScratch;
        }
    }

    private async Task ServeZipAsync(ActiveShare share, HttpListenerResponse res, string folderPath, string zipName)
    {
        long total = 0;
        try
        {
            foreach (var f in Directory.EnumerateFiles(folderPath, "*", SearchOption.AllDirectories))
            {
                try { total += new FileInfo(f).Length; } catch { /* skip */ }
                if (total > MaxZipBytes) break;
            }
        }
        catch { /* */ }

        if (total > MaxZipBytes)
        {
            await WriteTextAsync(res, 413, "text/plain; charset=utf-8",
                $"Folder too large to zip in v1 (>{MaxZipBytes / (1024 * 1024)} MiB). Download files individually.").ConfigureAwait(false);
            return;
        }

        res.StatusCode = 200;
        res.ContentType = "application/zip";
        res.AddHeader("Content-Disposition", $"attachment; filename=\"{EscapeHeader(zipName)}.zip\"");

        using var zipStream = new ZipArchive(res.OutputStream, ZipArchiveMode.Create, leaveOpen: true);
        var rootLen = folderPath.TrimEnd(Path.DirectorySeparatorChar).Length + 1;
        foreach (var file in Directory.EnumerateFiles(folderPath, "*", SearchOption.AllDirectories))
        {
            string entryName;
            try { entryName = file[rootLen..].Replace('\\', '/'); }
            catch { continue; }
            if (string.IsNullOrEmpty(entryName)) continue;
            var entry = zipStream.CreateEntry(entryName, CompressionLevel.Fastest);
            await using var entryStream = entry.Open();
            await using var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            await fs.CopyToAsync(entryStream).ConfigureAwait(false);
            Interlocked.Add(ref share.BytesScratch, fs.Length);
            share.Session.BytesServed = share.BytesScratch;
        }
    }

    private static string BuildListingHtml(ActiveShare share, string folderPath, string relUrl)
    {
        var enc = HtmlEncoder.Default;
        var token = share.Token;
        var baseHref = $"/s/{token}/" + (string.IsNullOrEmpty(relUrl) ? "" : relUrl.TrimEnd('/') + "/");
        var title = string.IsNullOrEmpty(relUrl) ? share.Session.FolderName : Path.GetFileName(folderPath.TrimEnd('\\', '/'));

        var sb = new StringBuilder(16 * 1024);
        sb.Append("<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"utf-8\"/>");
        sb.Append("<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"/>");
        sb.Append("<title>").Append(enc.Encode(title)).Append(" — BNDZ LAN Share</title>");
        sb.Append("<style>");
        sb.Append("body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#0b0d12;color:#e8ecf1;margin:0;padding:16px;}");
        sb.Append("h1{font-size:1.15rem;margin:0 0 4px;} .sub{color:#8b93a0;font-size:.8rem;margin-bottom:14px;}");
        sb.Append("a{color:#22d3ee;text-decoration:none;} a:hover{text-decoration:underline;}");
        sb.Append(".card{background:#12151c;border:1px solid rgba(34,211,238,.18);border-radius:12px;padding:12px 14px;margin:8px 0;}");
        sb.Append(".row{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;}");
        sb.Append(".meta{color:#8b93a0;font-size:.75rem;} .badge{font-size:.65rem;padding:2px 8px;border-radius:999px;border:1px solid rgba(251,191,36,.35);color:#fbbf24;}");
        sb.Append("audio{width:100%;margin-top:8px;} .actions a{margin-right:10px;font-size:.8rem;}");
        sb.Append(".warn{color:#fbbf24;font-size:.75rem;margin-top:12px;}");
        sb.Append("</style></head><body>");
        sb.Append("<h1>").Append(enc.Encode(title)).Append("</h1>");
        sb.Append("<div class=\"sub\">BNDZ LAN Share · read-only · same Wi‑Fi only · token URL</div>");

        if (!string.IsNullOrEmpty(relUrl))
        {
            var parent = relUrl.Contains('/') ? relUrl[..relUrl.LastIndexOf('/')] : "";
            var parentHref = $"/s/{token}/" + (string.IsNullOrEmpty(parent) ? "" : parent + "/");
            sb.Append("<div class=\"card\"><a href=\"").Append(enc.Encode(parentHref)).Append("\">↑ Parent folder</a></div>");
        }

        sb.Append("<div class=\"card row\"><div><span class=\"badge\">READ-ONLY</span></div>");
        sb.Append("<div class=\"actions\"><a href=\"").Append(enc.Encode(baseHref)).Append("?zip=1\">⬇ Download folder ZIP</a></div></div>");

        try
        {
            var dirs = Directory.EnumerateDirectories(folderPath)
                .Select(d => new DirectoryInfo(d))
                .OrderBy(d => d.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();
            var files = Directory.EnumerateFiles(folderPath)
                .Select(f => new FileInfo(f))
                .OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase)
                .ToList();

            foreach (var d in dirs)
            {
                var href = baseHref + Uri.EscapeDataString(d.Name) + "/";
                sb.Append("<div class=\"card row\"><div>📁 <a href=\"").Append(enc.Encode(href)).Append("\">")
                  .Append(enc.Encode(d.Name)).Append("</a></div><span class=\"meta\">folder</span></div>");
            }

            foreach (var f in files)
            {
                var href = baseHref + Uri.EscapeDataString(f.Name);
                var isAudio = AudioExt.Contains(f.Extension);
                sb.Append("<div class=\"card\">");
                sb.Append("<div class=\"row\"><div>");
                sb.Append(isAudio ? "🎵 " : "📄 ");
                sb.Append("<a href=\"").Append(enc.Encode(href)).Append("\">").Append(enc.Encode(f.Name)).Append("</a>");
                sb.Append("</div><span class=\"meta\">").Append(FormatSize(f.Length)).Append("</span></div>");
                sb.Append("<div class=\"actions\"><a href=\"").Append(enc.Encode(href)).Append("\" download>Download</a></div>");
                if (isAudio)
                {
                    sb.Append("<audio controls preload=\"none\" src=\"").Append(enc.Encode(href)).Append("\"></audio>");
                }
                sb.Append("</div>");
            }

            if (dirs.Count == 0 && files.Count == 0)
                sb.Append("<div class=\"card meta\">This folder is empty.</div>");
        }
        catch (Exception ex)
        {
            sb.Append("<div class=\"card warn\">Could not list folder: ").Append(enc.Encode(ex.Message)).Append("</div>");
        }

        sb.Append("<p class=\"warn\">If this page fails on your phone, stay on the same Wi‑Fi and confirm the share is still Running in BNDZ. This is not an internet link.</p>");
        sb.Append("</body></html>");
        return sb.ToString();
    }

    private static async Task WriteTextAsync(HttpListenerResponse res, int status, string contentType, string body)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        res.StatusCode = status;
        res.ContentType = contentType;
        res.ContentLength64 = bytes.Length;
        await res.OutputStream.WriteAsync(bytes).ConfigureAwait(false);
    }

    private static bool QueryHas(string query, string key, string value)
    {
        if (string.IsNullOrEmpty(query)) return false;
        var q = query.TrimStart('?');
        foreach (var part in q.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = part.Split('=', 2);
            if (kv.Length == 0) continue;
            var k = Uri.UnescapeDataString(kv[0]);
            if (!k.Equals(key, StringComparison.OrdinalIgnoreCase)) continue;
            var v = kv.Length > 1 ? Uri.UnescapeDataString(kv[1]) : "";
            if (v.Equals(value, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static string GuessMime(string ext) => ext.ToLowerInvariant() switch
    {
        ".mp3" => "audio/mpeg",
        ".wav" => "audio/wav",
        ".ogg" or ".oga" => "audio/ogg",
        ".flac" => "audio/flac",
        ".m4a" => "audio/mp4",
        ".aac" => "audio/aac",
        ".opus" => "audio/opus",
        ".wma" => "audio/x-ms-wma",
        ".mp4" => "video/mp4",
        ".webm" => "video/webm",
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        ".svg" => "image/svg+xml",
        ".pdf" => "application/pdf",
        ".txt" or ".log" or ".md" or ".csv" => "text/plain; charset=utf-8",
        ".json" => "application/json",
        ".html" or ".htm" => "text/html; charset=utf-8",
        ".zip" => "application/zip",
        _ => "application/octet-stream",
    };

    private static string FormatSize(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        double v = bytes;
        string[] units = ["KB", "MB", "GB", "TB"];
        foreach (var u in units)
        {
            v /= 1024;
            if (v < 1024) return $"{v:0.##} {u}";
        }
        return $"{v:0.##} PB";
    }

    private static string EscapeHeader(string name)
        => name.Replace("\"", "'").Replace("\r", "").Replace("\n", "");

    private static string CreateToken()
    {
        Span<byte> buf = stackalloc byte[18];
        RandomNumberGenerator.Fill(buf);
        return Convert.ToBase64String(buf).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static byte[] HashPassword(string password)
    {
        var salt = Encoding.UTF8.GetBytes("BNDZ-LAN-SHARE-v1");
        return SHA256.HashData(Encoding.UTF8.GetBytes(password).Concat(salt).ToArray());
    }

    public static string? GetPrimaryLanAddress()
    {
        foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != OperationalStatus.Up) continue;
            if (ni.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
            foreach (var addr in ni.GetIPProperties().UnicastAddresses)
            {
                if (addr.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(addr.Address))
                    return addr.Address.ToString();
            }
        }
        return null;
    }

    private static int FindFreePort(string lanAddress, int preferred)
    {
        if (CanBind(lanAddress, preferred)) return preferred;
        var listener = new TcpListener(IPAddress.Parse(lanAddress), 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static bool CanBind(string lanAddress, int port)
    {
        try
        {
            var listener = new TcpListener(IPAddress.Parse(lanAddress), port);
            listener.Start();
            listener.Stop();
            return true;
        }
        catch { return false; }
    }

    private sealed class ActiveShare
    {
        public required LanShareSession Session { get; init; }
        public required string RootFullPath { get; init; }
        public required string Token { get; init; }
        public byte[]? PasswordHash { get; init; }
        public required HttpListener Http { get; init; }
        public required CancellationTokenSource Cts { get; init; }
        public Task? LoopTask { get; set; }
        public long BytesScratch;
        public int RequestCountScratch;
    }
}
