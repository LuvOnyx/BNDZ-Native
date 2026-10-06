using System.Collections.Concurrent;
using System.IO.Compression;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;

namespace BNDZ.Services.LanShare;

/// <summary>
/// BNDZ-owned multi-protocol LAN sharer (CopyParty-style).
/// HTTP(+WebDAV) always available when a volume is shared. FTP/FTPS/SFTP/SSH/TFTP/SMB are opt-in.
/// MIT patterns from copyparty; FxSsh (MIT), VoDA.FtpServer (MIT), SMBLibrary (LGPL — gated).
/// No Python / copyparty.exe product surface.
/// </summary>
public sealed class LanShareService : IDisposable
{
    public static LanShareService Instance { get; } = new();

    private const long MaxZipBytes = 512L * 1024 * 1024;
    private const int DefaultHttpPort = 3923;

    private static readonly HashSet<string> AudioExt = new(StringComparer.OrdinalIgnoreCase)
    { ".mp3", ".wav", ".ogg", ".oga", ".flac", ".m4a", ".aac", ".opus", ".wma" };
    private static readonly HashSet<string> VideoExt = new(StringComparer.OrdinalIgnoreCase)
    { ".mp4", ".webm", ".ogv", ".mov", ".m4v" };
    private static readonly HashSet<string> ImageExt = new(StringComparer.OrdinalIgnoreCase)
    { ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".bmp" };

    private readonly object _gate = new();
    private readonly ConcurrentDictionary<string, Volume> _volumes = new(StringComparer.OrdinalIgnoreCase);
    private HttpListener? _http;
    private CancellationTokenSource? _httpCts;
    private Task? _httpLoop;
    private string? _lan;
    private int _httpPort;
    private LanShareProtocolOptions _proto = new();
    private LanShareSshHost? _ssh;
    private LanShareFtpHost? _ftp;
    private LanShareFtpHost? _ftps;
    private LanShareTftpHost? _tftp;
    private LanShareSmbHost? _smb;
    private bool _disposed;
    private long _bytes;
    private int _requests;

    public IReadOnlyList<LanShareSession> ListSessions()
    {
        SweepExpired();
        lock (_gate) return _volumes.Values.Select(v => Snapshot(v)).OrderByDescending(s => s.StartedUtc).ToList();
    }

    public LanShareSession Start(string folderPath, LanShareStartOptions? options = null)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);
        options ??= new LanShareStartOptions();
        if (string.IsNullOrWhiteSpace(folderPath))
            throw new InvalidOperationException("Pick a folder to share.");
        var full = Path.GetFullPath(folderPath.Trim());
        if (!Directory.Exists(full))
            throw new InvalidOperationException($"Folder not found: {full}");

        var lan = GetPrimaryLanAddress()
            ?? throw new InvalidOperationException("No LAN IPv4 address. Connect to Wi‑Fi/Ethernet and try again.");
        var token = NormalizeSlug(options.Slug) ?? CreateToken();
        if (_volumes.Values.Any(v => string.Equals(v.Token, token, StringComparison.OrdinalIgnoreCase)))
            throw new InvalidOperationException($"Share path /s/{token}/ is already in use. Pick another custom link.");

        EnsureHttpServer(lan, options.Protocols.HttpPort > 0 ? options.Protocols.HttpPort : DefaultHttpPort);

        var shareId = Guid.NewGuid().ToString("N")[..12];
        var vol = new Volume
        {
            ShareId = shareId,
            Root = full,
            FolderName = new DirectoryInfo(full).Name,
            Token = token,
            Label = string.IsNullOrWhiteSpace(options.Label) ? null : options.Label.Trim(),
            Username = string.IsNullOrWhiteSpace(options.Username) ? "bndz" : options.Username.Trim(),
            PasswordHash = string.IsNullOrEmpty(options.Password) ? null : HashPassword(options.Password),
            PasswordPlain = options.Password, // kept in-memory for FTP/SSH auth only
            AllowWrite = options.AllowWrite,
            ExpiresUtc = options.ExpiryMinutes is > 0 ? DateTime.UtcNow.AddMinutes(options.ExpiryMinutes.Value) : null,
            StartedUtc = DateTime.UtcNow,
        };
        _volumes[shareId] = vol;

        // Merge protocol flags (OR) and (re)start daemons against this volume as primary.
        MergeProtocols(options.Protocols);
        TryStartOptionalProtocols(vol);

        return Snapshot(vol);
    }

    // Back-compat overload used by existing IPC.
    public LanShareSession Start(string folderPath, string? password = null, int? preferredPort = null)
        => Start(folderPath, new LanShareStartOptions
        {
            Password = password,
            Protocols = new LanShareProtocolOptions { HttpPort = preferredPort ?? DefaultHttpPort },
        });

    public bool Stop(string shareId)
    {
        if (!_volumes.TryRemove(shareId, out var vol)) return false;
        vol.Running = false;
        if (_volumes.IsEmpty) StopAllProtocolsAndHttp();
        else
        {
            // Keep protocols pointed at any remaining volume.
            var next = _volumes.Values.OrderByDescending(v => v.StartedUtc).FirstOrDefault();
            if (next != null) TryStartOptionalProtocols(next);
        }
        return true;
    }

    public void StopAll()
    {
        foreach (var id in _volumes.Keys.ToList()) _volumes.TryRemove(id, out _);
        StopAllProtocolsAndHttp();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        StopAll();
    }

    private void EnsureHttpServer(string lan, int preferredPort)
    {
        lock (_gate)
        {
            if (_http != null) return;
            _lan = lan;
            _httpPort = FindFreePort(lan, preferredPort);
            var http = new HttpListener { IgnoreWriteExceptions = true };
            http.Prefixes.Add($"http://{lan}:{_httpPort}/");
            http.Prefixes.Add($"http://127.0.0.1:{_httpPort}/");
            try { http.Start(); }
            catch (HttpListenerException ex)
            {
                http.Close();
                throw new InvalidOperationException(
                    $"Could not bind HTTP on {lan}:{_httpPort}. Windows may need a URL ACL. Detail: {ex.Message}");
            }
            _http = http;
            _httpCts = new CancellationTokenSource();
            _httpLoop = Task.Run(() => HttpLoopAsync(_httpCts.Token));
        }
    }

    private void StopAllProtocolsAndHttp()
    {
        DisposeQuiet(ref _ssh);
        DisposeQuiet(ref _ftp);
        DisposeQuiet(ref _ftps);
        DisposeQuiet(ref _tftp);
        DisposeQuiet(ref _smb);
        try { _httpCts?.Cancel(); } catch { /* */ }
        try { _http?.Stop(); } catch { /* */ }
        try { _http?.Close(); } catch { /* */ }
        _http = null;
        _httpCts?.Dispose();
        _httpCts = null;
        _httpLoop = null;
    }

    private static void DisposeQuiet<T>(ref T? host) where T : class, IDisposable
    {
        try { host?.Dispose(); } catch { /* */ }
        host = null;
    }

    private void MergeProtocols(LanShareProtocolOptions incoming)
    {
        _proto = new LanShareProtocolOptions
        {
            Http = _proto.Http || incoming.Http,
            WebDav = _proto.WebDav || incoming.WebDav,
            Ftp = _proto.Ftp || incoming.Ftp,
            Ftps = _proto.Ftps || incoming.Ftps,
            Sftp = _proto.Sftp || incoming.Sftp,
            SshShell = _proto.SshShell || incoming.SshShell,
            Tftp = _proto.Tftp || incoming.Tftp,
            Smb = _proto.Smb || incoming.Smb,
            HttpPort = incoming.HttpPort > 0 ? incoming.HttpPort : _proto.HttpPort,
            FtpPort = incoming.FtpPort > 0 ? incoming.FtpPort : _proto.FtpPort,
            FtpsPort = incoming.FtpsPort > 0 ? incoming.FtpsPort : _proto.FtpsPort,
            SshPort = incoming.SshPort > 0 ? incoming.SshPort : _proto.SshPort,
            TftpPort = incoming.TftpPort > 0 ? incoming.TftpPort : _proto.TftpPort,
            SmbPort = incoming.SmbPort > 0 ? incoming.SmbPort : _proto.SmbPort,
        };
    }

    private void TryStartOptionalProtocols(Volume primary)
    {
        if (_lan == null) return;
        var bind = IPAddress.Parse(_lan);
        var statusNotes = new List<string>();

        if ((_proto.Sftp || _proto.SshShell) && _ssh == null)
        {
            try
            {
                _ssh = new LanShareSshHost(primary.Root, bind, _proto.SshPort, primary.Username, primary.PasswordPlain,
                    primary.AllowWrite, _proto.SshShell, _proto.Sftp);
                _ssh.Start();
                statusNotes.Add(_ssh.Note ?? "SSH started");
            }
            catch (Exception ex)
            {
                DisposeQuiet(ref _ssh);
                statusNotes.Add("SSH/SFTP failed: " + ex.Message);
            }
        }

        if (_proto.Ftp && _ftp == null)
        {
            try
            {
                _ftp = new LanShareFtpHost(primary.Root, bind, _proto.FtpPort, primary.Username, primary.PasswordPlain, primary.AllowWrite, ftps: false);
                _ftp.Start();
                statusNotes.Add(_ftp.Note ?? "FTP started");
            }
            catch (Exception ex)
            {
                DisposeQuiet(ref _ftp);
                statusNotes.Add("FTP failed: " + ex.Message);
            }
        }

        if (_proto.Ftps && _ftps == null)
        {
            var certDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "LanShare");
            var cert = Path.Combine(certDir, "ftps.crt");
            var key = Path.Combine(certDir, "ftps.key");
            try
            {
                _ftps = new LanShareFtpHost(primary.Root, bind, _proto.FtpsPort, primary.Username, primary.PasswordPlain, primary.AllowWrite, ftps: true, cert, key);
                _ftps.Start();
                statusNotes.Add(_ftps.Note ?? "FTPS started");
            }
            catch (Exception ex)
            {
                DisposeQuiet(ref _ftps);
                statusNotes.Add("FTPS failed: " + ex.Message);
            }
        }

        if (_proto.Tftp && _tftp == null)
        {
            try
            {
                _tftp = new LanShareTftpHost(primary.Root, bind, _proto.TftpPort);
                _tftp.Start();
                statusNotes.Add($"TFTP RRQ-only on {bind}:{_proto.TftpPort}");
            }
            catch (Exception ex)
            {
                DisposeQuiet(ref _tftp);
                statusNotes.Add("TFTP failed: " + ex.Message);
            }
        }

        if (_proto.Smb && _smb == null)
        {
            try
            {
                _smb = new LanShareSmbHost(primary.Root, primary.FolderName, bind, primary.Username, primary.PasswordPlain, primary.AllowWrite);
                _smb.Start();
                statusNotes.Add(_smb.Note ?? "SMB started");
            }
            catch (Exception ex)
            {
                DisposeQuiet(ref _smb);
                statusNotes.Add("SMB failed: " + ex.Message);
            }
        }

        primary.LastError = statusNotes.Count == 0 ? null : string.Join(" · ", statusNotes);
    }

    private LanShareSession Snapshot(Volume v)
    {
        var lan = _lan ?? GetPrimaryLanAddress() ?? "127.0.0.1";
        var port = _httpPort > 0 ? _httpPort : DefaultHttpPort;
        var hints = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["http"] = $"http://{lan}:{port}/s/{v.Token}/",
            ["webdav"] = $"http://{lan}:{port}/s/{v.Token}/",
        };
        if (_ftp != null) hints["ftp"] = $"ftp://{v.Username}@{lan}:{_proto.FtpPort}/";
        if (_ftps != null) hints["ftps"] = $"ftps://{v.Username}@{lan}:{_proto.FtpsPort}/";
        if (_ssh != null)
        {
            if (_proto.Sftp) hints["sftp"] = $"sftp://{v.Username}@{lan}:{_proto.SshPort}/";
            if (_proto.SshShell) hints["ssh"] = $"ssh {v.Username}@{lan} -p {_proto.SshPort}";
        }
        if (_tftp != null) hints["tftp"] = $"tftp {lan}  get <file>   (port {_proto.TftpPort})";
        if (_smb != null) hints["smb"] = $"\\\\{lan}\\{SanitizeShare(v.FolderName)}";

        return new LanShareSession
        {
            ShareId = v.ShareId,
            FolderPath = v.Root,
            FolderName = v.FolderName,
            Token = v.Token,
            LanAddress = lan,
            HttpPort = port,
            Url = $"http://{lan}:{port}/s/{v.Token}/",
            HubUrl = $"http://{lan}:{port}/",
            Label = v.Label,
            Username = v.Username,
            HasPassword = v.PasswordHash != null,
            AllowWrite = v.AllowWrite,
            ExpiresUtc = v.ExpiresUtc,
            StartedUtc = v.StartedUtc,
            Running = v.Running && !v.IsExpired,
            LastError = v.LastError,
            BytesServed = Interlocked.Read(ref _bytes),
            RequestCount = _requests,
            Protocols = new LanShareProtocolStatus
            {
                Http = _http != null,
                WebDav = _http != null && _proto.WebDav,
                Ftp = _ftp != null,
                Ftps = _ftps != null,
                Sftp = _ssh != null && _proto.Sftp,
                SshShell = _ssh != null && _proto.SshShell,
                Tftp = _tftp != null,
                Smb = _smb != null,
                FtpNote = _ftp?.Note,
                FtpsNote = _ftps?.Note,
                SshNote = _ssh?.Note,
                TftpNote = _tftp != null ? $"TFTP RRQ {_proto.TftpPort}" : null,
                SmbNote = _smb?.Note,
            },
            ConnectionHints = hints,
        };
    }

    private void SweepExpired()
    {
        foreach (var v in _volumes.Values.Where(x => x.IsExpired).ToList())
            Stop(v.ShareId);
    }

    private async Task HttpLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested && _http != null)
        {
            HttpListenerContext? ctx = null;
            try { ctx = await _http.GetContextAsync().WaitAsync(ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { break; }
            catch (HttpListenerException) { break; }
            catch (ObjectDisposedException) { break; }
            catch { continue; }
            _ = Task.Run(() => HandleHttpAsync(ctx!), ct);
        }
    }

    private async Task HandleHttpAsync(HttpListenerContext ctx)
    {
        try
        {
            Interlocked.Increment(ref _requests);
            SweepExpired();
            var req = ctx.Request; var res = ctx.Response;
            res.Headers["Cache-Control"] = "no-store";
            res.Headers["X-BNDZ-Share"] = "lan";
            res.Headers["X-Content-Type-Options"] = "nosniff";
            var method = (req.HttpMethod ?? "GET").ToUpperInvariant();
            var path = req.Url?.AbsolutePath ?? "/";

            if (method == "OPTIONS")
            {
                res.StatusCode = 204;
                res.Headers["Allow"] = _proto.WebDav
                    ? "GET, HEAD, OPTIONS, PROPFIND" + (_volumes.Values.Any(v => v.AllowWrite) ? ", PUT, DELETE, MKCOL" : "")
                    : "GET, HEAD, OPTIONS";
                if (_proto.WebDav) res.Headers["DAV"] = "1";
                res.Close(); return;
            }

            if (path is "/" or "/health")
            {
                await WriteHubAsync(res).ConfigureAwait(false); return;
            }

            if (!TryParseSharePath(path, out var token, out var rel))
            {
                await WriteText(res, 404, "text/plain; charset=utf-8", "Not found.").ConfigureAwait(false); return;
            }

            var vol = _volumes.Values.FirstOrDefault(v => string.Equals(v.Token, token, StringComparison.OrdinalIgnoreCase) && v.Running && !v.IsExpired);
            if (vol == null)
            {
                await WriteText(res, 404, "text/plain; charset=utf-8", "Share not found or expired.").ConfigureAwait(false); return;
            }
            if (vol.PasswordHash != null && !CheckPassword(req, vol.PasswordHash))
            {
                res.Headers["WWW-Authenticate"] = "Basic realm=\"BNDZ Share\"";
                await WriteText(res, 401, "text/plain; charset=utf-8", "Password required.").ConfigureAwait(false); return;
            }

            if (method == "PROPFIND" && _proto.WebDav)
            {
                await HandlePropFindAsync(res, vol, rel, req).ConfigureAwait(false); return;
            }

            if (method is "PUT" or "DELETE" or "MKCOL" or "MOVE" or "COPY" or "POST")
            {
                if (!vol.AllowWrite)
                {
                    await WriteText(res, 405, "text/plain; charset=utf-8", "Read-only share — enable write when starting the share.").ConfigureAwait(false);
                    return;
                }
                await HandleWriteAsync(req, res, vol, rel, method).ConfigureAwait(false);
                return;
            }

            if (method is not ("GET" or "HEAD"))
            {
                await WriteText(res, 405, "text/plain; charset=utf-8", "Method not allowed.").ConfigureAwait(false); return;
            }

            var q = req.Url?.Query ?? "";
            var wantZip = QueryHas(q, "zip", "1") || QueryHas(q, "download", "zip");
            var wantLs = QueryHas(q, "ls", "1") || QueryHas(q, "ls", "json");
            var forceDl = QueryHas(q, "dl", "1");

            if (!TryMap(vol.Root, rel, out var mapped, out var isDir))
            {
                await WriteText(res, 400, "text/plain; charset=utf-8", "Invalid path.").ConfigureAwait(false); return;
            }

            if (isDir)
            {
                if (!Directory.Exists(mapped))
                { await WriteText(res, 404, "text/plain; charset=utf-8", "Folder not found.").ConfigureAwait(false); return; }
                if (wantZip) { await ServeZipAsync(res, mapped, Path.GetFileName(mapped.TrimEnd('\\','/')) is { Length:>0 } n ? n : vol.FolderName).ConfigureAwait(false); return; }
                if (wantLs) { await WriteText(res, 200, "application/json; charset=utf-8", BuildLsJson(vol, mapped, rel)).ConfigureAwait(false); return; }
                await WriteText(res, 200, "text/html; charset=utf-8", BuildListingHtml(vol, mapped, rel)).ConfigureAwait(false); return;
            }

            if (!File.Exists(mapped))
            { await WriteText(res, 404, "text/plain; charset=utf-8", "File not found.").ConfigureAwait(false); return; }
            await ServeFileAsync(req, res, mapped, forceDl).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            try { await WriteText(ctx.Response, 500, "text/plain; charset=utf-8", "Server error: " + ex.Message).ConfigureAwait(false); } catch { /* */ }
        }
        finally { try { ctx.Response.Close(); } catch { /* */ } }
    }

    private async Task WriteHubAsync(HttpListenerResponse res)
    {
        var sessions = ListSessions().Where(s => s.Running).ToList();
        var enc = HtmlEncoder.Default;
        var sb = new StringBuilder();
        sb.Append("<!DOCTYPE html><html><head><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\">");
        sb.Append("<title>BNDZ Share Hub</title><style>");
        sb.Append("body{font-family:system-ui,sans-serif;background:#0b0d12;color:#e8ecf1;margin:0;padding:16px}");
        sb.Append("a{color:#22d3ee}.card{background:#12151c;border:1px solid rgba(34,211,238,.2);border-radius:12px;padding:12px;margin:8px 0}");
        sb.Append(".meta{color:#8b93a0;font-size:.8rem}.warn{color:#fbbf24;font-size:.75rem}</style></head><body>");
        sb.Append("<h1>BNDZ Share Hub</h1><p class=meta>LAN only · general file share · not internet</p>");
        if (sessions.Count == 0) sb.Append("<div class=card>No active shares. Start one from BNDZ → Share on LAN.</div>");
        foreach (var s in sessions)
        {
            sb.Append("<div class=card><div><strong>").Append(enc.Encode(s.Label ?? s.FolderName)).Append("</strong>");
            if (s.AllowWrite) sb.Append(" · <span class=warn>WRITE</span>");
            else sb.Append(" · read-only");
            sb.Append("</div><div class=meta>").Append(enc.Encode(s.FolderPath)).Append("</div>");
            sb.Append("<div><a href=\"").Append(enc.Encode(s.Url)).Append("\">Open share</a></div></div>");
        }
        sb.Append("<p class=warn>Phone must stay on the same Wi‑Fi. Stop in BNDZ ends every link.</p></body></html>");
        await WriteText(res, 200, "text/html; charset=utf-8", sb.ToString()).ConfigureAwait(false);
    }

    private async Task HandlePropFindAsync(HttpListenerResponse res, Volume vol, string rel, HttpListenerRequest req)
    {
        if (!TryMap(vol.Root, rel, out var mapped, out var isDir) || (isDir && !Directory.Exists(mapped)) || (!isDir && !File.Exists(mapped)))
        { await WriteText(res, 404, "text/plain", "Not found").ConfigureAwait(false); return; }

        var hrefBase = $"/s/{vol.Token}/" + (string.IsNullOrEmpty(rel) ? "" : rel.TrimEnd('/') + "/");
        var sb = new StringBuilder();
        sb.Append("<?xml version=\"1.0\" encoding=\"utf-8\"?><D:multistatus xmlns:D=\"DAV:\">");
        void Add(string href, bool dir, long len, DateTime mtime)
        {
            sb.Append("<D:response><D:href>").Append(WebUtility.HtmlEncode(href)).Append("</D:href><D:propstat><D:prop>");
            sb.Append("<D:displayname>").Append(WebUtility.HtmlEncode(Path.GetFileName(href.TrimEnd('/')))).Append("</D:displayname>");
            sb.Append("<D:resourcetype>").Append(dir ? "<D:collection/>" : "").Append("</D:resourcetype>");
            if (!dir) sb.Append("<D:getcontentlength>").Append(len).Append("</D:getcontentlength>");
            sb.Append("<D:getlastmodified>").Append(mtime.ToString("R")).Append("</D:getlastmodified>");
            sb.Append("</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>");
        }
        if (isDir)
        {
            Add(hrefBase, true, 0, Directory.GetLastWriteTimeUtc(mapped));
            foreach (var d in Directory.EnumerateDirectories(mapped))
                Add(hrefBase + Uri.EscapeDataString(Path.GetFileName(d)) + "/", true, 0, Directory.GetLastWriteTimeUtc(d));
            foreach (var f in Directory.EnumerateFiles(mapped))
                Add(hrefBase + Uri.EscapeDataString(Path.GetFileName(f)), false, new FileInfo(f).Length, File.GetLastWriteTimeUtc(f));
        }
        else Add(hrefBase.TrimEnd('/'), false, new FileInfo(mapped).Length, File.GetLastWriteTimeUtc(mapped));
        sb.Append("</D:multistatus>");
        res.StatusCode = 207;
        await WriteText(res, 207, "application/xml; charset=utf-8", sb.ToString()).ConfigureAwait(false);
    }

    private async Task HandleWriteAsync(HttpListenerRequest req, HttpListenerResponse res, Volume vol, string rel, string method)
    {
        if (!TryMap(vol.Root, rel, out var mapped, out _))
        { await WriteText(res, 400, "text/plain", "Invalid path").ConfigureAwait(false); return; }
        try
        {
            if (method == "PUT")
            {
                Directory.CreateDirectory(Path.GetDirectoryName(mapped)!);
                await using var fs = File.Create(mapped);
                await req.InputStream.CopyToAsync(fs).ConfigureAwait(false);
                await WriteText(res, 201, "text/plain", "Created").ConfigureAwait(false);
            }
            else if (method == "DELETE")
            {
                if (File.Exists(mapped)) File.Delete(mapped);
                else if (Directory.Exists(mapped)) Directory.Delete(mapped, recursive: true);
                else { await WriteText(res, 404, "text/plain", "Not found").ConfigureAwait(false); return; }
                res.StatusCode = 204; res.Close();
            }
            else if (method == "MKCOL")
            {
                Directory.CreateDirectory(mapped);
                await WriteText(res, 201, "text/plain", "Created").ConfigureAwait(false);
            }
            else await WriteText(res, 501, "text/plain", "Not implemented").ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            await WriteText(res, 500, "text/plain", ex.Message).ConfigureAwait(false);
        }
    }

    private string BuildListingHtml(Volume vol, string folderPath, string relUrl)
    {
        var enc = HtmlEncoder.Default;
        var token = vol.Token;
        var baseHref = $"/s/{token}/" + (string.IsNullOrEmpty(relUrl) ? "" : relUrl.TrimEnd('/') + "/");
        var title = string.IsNullOrEmpty(relUrl) ? (vol.Label ?? vol.FolderName) : Path.GetFileName(folderPath.TrimEnd('\\', '/'));
        var sb = new StringBuilder(24 * 1024);
        sb.Append("<!DOCTYPE html><html lang=en><head><meta charset=utf-8><meta name=viewport content=\"width=device-width,initial-scale=1\">");
        sb.Append("<title>").Append(enc.Encode(title)).Append(" — BNDZ Share</title><style>");
        sb.Append("body{font-family:system-ui,sans-serif;background:#0b0d12;color:#e8ecf1;margin:0;padding:16px}");
        sb.Append("a{color:#22d3ee;text-decoration:none}a:hover{text-decoration:underline}");
        sb.Append(".card{background:#12151c;border:1px solid rgba(34,211,238,.18);border-radius:12px;padding:12px;margin:8px 0}");
        sb.Append(".row{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}.meta{color:#8b93a0;font-size:.75rem}");
        sb.Append(".badge{font-size:.65rem;padding:2px 8px;border-radius:999px;border:1px solid rgba(251,191,36,.35);color:#fbbf24}");
        sb.Append("audio,video,img.preview{max-width:100%;margin-top:8px}video{max-height:360px}");
        sb.Append(".warn{color:#fbbf24;font-size:.75rem;margin-top:12px}</style></head><body>");
        sb.Append("<h1>").Append(enc.Encode(title)).Append("</h1>");
        sb.Append("<div class=meta>BNDZ Share · ").Append(vol.AllowWrite ? "read/write" : "read-only").Append(" · same Wi‑Fi only</div>");
        if (!string.IsNullOrEmpty(relUrl))
        {
            var parent = relUrl.Contains('/') ? relUrl[..relUrl.LastIndexOf('/')] : "";
            var parentHref = $"/s/{token}/" + (string.IsNullOrEmpty(parent) ? "" : parent + "/");
            sb.Append("<div class=card><a href=\"").Append(enc.Encode(parentHref)).Append("\">↑ Parent</a></div>");
        }
        sb.Append("<div class=\"card row\"><span class=badge>").Append(vol.AllowWrite ? "WRITE ENABLED" : "READ-ONLY").Append("</span>");
        sb.Append("<a href=\"").Append(enc.Encode(baseHref)).Append("?zip=1\">Download folder ZIP</a></div>");
        try
        {
            foreach (var d in Directory.EnumerateDirectories(folderPath).Select(x => new DirectoryInfo(x)).OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase))
            {
                var href = baseHref + Uri.EscapeDataString(d.Name) + "/";
                sb.Append("<div class=\"card row\"><div>📁 <a href=\"").Append(enc.Encode(href)).Append("\">").Append(enc.Encode(d.Name)).Append("</a></div><span class=meta>folder</span></div>");
            }
            foreach (var f in Directory.EnumerateFiles(folderPath).Select(x => new FileInfo(x)).OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase))
            {
                var href = baseHref + Uri.EscapeDataString(f.Name);
                var ext = f.Extension;
                sb.Append("<div class=card><div class=row><div>");
                sb.Append(AudioExt.Contains(ext) ? "🎵 " : VideoExt.Contains(ext) ? "🎬 " : ImageExt.Contains(ext) ? "🖼 " : "📄 ");
                sb.Append("<a href=\"").Append(enc.Encode(href)).Append("\">").Append(enc.Encode(f.Name)).Append("</a></div>");
                sb.Append("<span class=meta>").Append(FormatSize(f.Length)).Append("</span></div>");
                sb.Append("<div><a href=\"").Append(enc.Encode(href)).Append("?dl=1\">Download</a></div>");
                if (AudioExt.Contains(ext)) sb.Append("<audio controls preload=none src=\"").Append(enc.Encode(href)).Append("\"></audio>");
                if (VideoExt.Contains(ext)) sb.Append("<video controls preload=none src=\"").Append(enc.Encode(href)).Append("\"></video>");
                if (ImageExt.Contains(ext)) sb.Append("<img class=preview loading=lazy src=\"").Append(enc.Encode(href)).Append("\" alt=\"\">");
                sb.Append("</div>");
            }
        }
        catch (Exception ex) { sb.Append("<div class=\"card warn\">").Append(enc.Encode(ex.Message)).Append("</div>"); }
        sb.Append("<p class=warn>If this fails on your phone, stay on the same Wi‑Fi and confirm the share is Running in BNDZ.</p></body></html>");
        return sb.ToString();
    }

    private string BuildLsJson(Volume vol, string folderPath, string rel)
    {
        var files = new List<object>();
        foreach (var d in Directory.EnumerateDirectories(folderPath))
            files.Add(new { name = Path.GetFileName(d), type = "dir", size = 0 });
        foreach (var f in Directory.EnumerateFiles(folderPath))
            files.Add(new { name = Path.GetFileName(f), type = "file", size = new FileInfo(f).Length });
        return JsonSerializer.Serialize(new { share = vol.Token, path = rel, files });
    }

    private async Task ServeFileAsync(HttpListenerRequest req, HttpListenerResponse res, string filePath, bool forceDownload)
    {
        var fi = new FileInfo(filePath);
        var mime = GuessMime(fi.Extension);
        res.ContentType = mime;
        res.Headers["Accept-Ranges"] = "bytes";
        var disp = forceDownload ? "attachment" : "inline";
        res.AddHeader("Content-Disposition", $"{disp}; filename=\"{EscapeHeader(fi.Name)}\"");
        long start = 0, end = fi.Length - 1;
        var range = req.Headers["Range"];
        if (!string.IsNullOrEmpty(range) && range.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase) && fi.Length > 0)
        {
            var spec = range[6..]; var dash = spec.IndexOf('-');
            if (dash >= 0)
            {
                if (long.TryParse(spec[..dash], out var s)) start = s;
                if (long.TryParse(spec[(dash + 1)..], out var e)) end = e;
                if (end >= fi.Length) end = fi.Length - 1;
                if (start > end) start = 0;
                res.StatusCode = 206;
                res.Headers["Content-Range"] = $"bytes {start}-{end}/{fi.Length}";
            }
        }
        var length = Math.Max(0, end - start + 1);
        res.ContentLength64 = length;
        if (string.Equals(req.HttpMethod, "HEAD", StringComparison.OrdinalIgnoreCase)) return;
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
            Interlocked.Add(ref _bytes, read);
        }
    }

    private async Task ServeZipAsync(HttpListenerResponse res, string folderPath, string zipName)
    {
        long total = 0;
        try
        {
            foreach (var f in Directory.EnumerateFiles(folderPath, "*", SearchOption.AllDirectories))
            {
                try { total += new FileInfo(f).Length; } catch { }
                if (total > MaxZipBytes) break;
            }
        }
        catch { }
        if (total > MaxZipBytes)
        {
            await WriteText(res, 413, "text/plain; charset=utf-8", $"Folder too large to zip (>{MaxZipBytes / (1024 * 1024)} MiB).").ConfigureAwait(false);
            return;
        }
        res.StatusCode = 200;
        res.ContentType = "application/zip";
        res.AddHeader("Content-Disposition", $"attachment; filename=\"{EscapeHeader(zipName)}.zip\"");
        using var zip = new ZipArchive(res.OutputStream, ZipArchiveMode.Create, leaveOpen: true);
        var rootLen = folderPath.TrimEnd(Path.DirectorySeparatorChar).Length + 1;
        foreach (var file in Directory.EnumerateFiles(folderPath, "*", SearchOption.AllDirectories))
        {
            string entryName;
            try { entryName = file[rootLen..].Replace('\\', '/'); } catch { continue; }
            if (string.IsNullOrEmpty(entryName)) continue;
            var entry = zip.CreateEntry(entryName, CompressionLevel.Fastest);
            await using var entryStream = entry.Open();
            await using var fs = new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 64 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
            await fs.CopyToAsync(entryStream).ConfigureAwait(false);
            Interlocked.Add(ref _bytes, fs.Length);
        }
    }

    private static async Task WriteText(HttpListenerResponse res, int status, string contentType, string body)
    {
        var bytes = Encoding.UTF8.GetBytes(body);
        res.StatusCode = status;
        res.ContentType = contentType;
        res.ContentLength64 = bytes.Length;
        await res.OutputStream.WriteAsync(bytes).ConfigureAwait(false);
    }

    private static bool TryParseSharePath(string absolutePath, out string token, out string relUrl)
    {
        token = ""; relUrl = "";
        var parts = absolutePath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2 || !parts[0].Equals("s", StringComparison.OrdinalIgnoreCase)) return false;
        token = parts[1];
        if (token.Length < 2) return false;
        relUrl = parts.Length == 2 ? "" : string.Join('/', parts.Skip(2));
        try { relUrl = Uri.UnescapeDataString(relUrl); } catch { }
        return true;
    }

    private static bool TryMap(string rootFull, string relUrl, out string mapped, out bool isDir)
    {
        mapped = rootFull; isDir = true;
        var rel = (relUrl ?? "").Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
        if (string.IsNullOrEmpty(rel)) { mapped = rootFull; isDir = true; return true; }
        var segments = rel.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
        if (segments.Any(s => s is "." or "..")) { mapped = ""; isDir = false; return false; }
        mapped = Path.GetFullPath(Path.Combine(rootFull, rel));
        var rootPrefix = rootFull.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!mapped.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(mapped, rootFull, StringComparison.OrdinalIgnoreCase))
        { mapped = ""; isDir = false; return false; }
        if (Directory.Exists(mapped)) { isDir = true; return true; }
        if (File.Exists(mapped)) { isDir = false; return true; }
        isDir = mapped.EndsWith(Path.DirectorySeparatorChar);
        return true;
    }

    private static bool CheckPassword(HttpListenerRequest req, byte[] expectedHash)
    {
        var header = req.Headers["Authorization"];
        if (string.IsNullOrEmpty(header) || !header.StartsWith("Basic ", StringComparison.OrdinalIgnoreCase)) return false;
        try
        {
            var raw = Encoding.UTF8.GetString(Convert.FromBase64String(header["Basic ".Length..].Trim()));
            var idx = raw.IndexOf(':');
            var password = idx >= 0 ? raw[(idx + 1)..] : raw;
            return CryptographicOperations.FixedTimeEquals(HashPassword(password), expectedHash);
        }
        catch { return false; }
    }

    private static bool QueryHas(string query, string key, string value)
    {
        if (string.IsNullOrEmpty(query)) return false;
        foreach (var part in query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = part.Split('=', 2);
            if (kv.Length == 0) continue;
            if (!Uri.UnescapeDataString(kv[0]).Equals(key, StringComparison.OrdinalIgnoreCase)) continue;
            var v = kv.Length > 1 ? Uri.UnescapeDataString(kv[1]) : "";
            if (v.Equals(value, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static string GuessMime(string ext) => ext.ToLowerInvariant() switch
    {
        ".mp3" => "audio/mpeg", ".wav" => "audio/wav", ".ogg" or ".oga" => "audio/ogg", ".flac" => "audio/flac",
        ".m4a" => "audio/mp4", ".aac" => "audio/aac", ".opus" => "audio/opus",
        ".mp4" or ".m4v" => "video/mp4", ".webm" => "video/webm", ".ogv" => "video/ogg", ".mov" => "video/quicktime",
        ".jpg" or ".jpeg" => "image/jpeg", ".png" => "image/png", ".gif" => "image/gif", ".webp" => "image/webp", ".svg" => "image/svg+xml", ".bmp" => "image/bmp",
        ".pdf" => "application/pdf", ".txt" or ".log" or ".md" or ".csv" => "text/plain; charset=utf-8",
        ".json" => "application/json", ".html" or ".htm" => "text/html; charset=utf-8", ".zip" => "application/zip",
        _ => "application/octet-stream",
    };

    private static string FormatSize(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        double v = bytes; string[] u = ["KB", "MB", "GB", "TB"];
        foreach (var unit in u) { v /= 1024; if (v < 1024) return $"{v:0.##} {unit}"; }
        return $"{v:0.##} PB";
    }

    private static string EscapeHeader(string name) => name.Replace("\"", "'").Replace("\r", "").Replace("\n", "");
    private static string SanitizeShare(string name)
    {
        var s = new string(name.Where(ch => char.IsLetterOrDigit(ch) || ch is '_' or '-').ToArray());
        return string.IsNullOrWhiteSpace(s) ? "BNDZ" : s;
    }

    private static string? NormalizeSlug(string? slug)
    {
        if (string.IsNullOrWhiteSpace(slug)) return null;
        var s = new string(slug.Trim().Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' ? ch : '-').ToArray());
        s = s.Trim('-');
        return s.Length >= 2 ? s[..Math.Min(s.Length, 48)] : null;
    }

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
        try { var l = new TcpListener(IPAddress.Parse(lanAddress), port); l.Start(); l.Stop(); return true; }
        catch { return false; }
    }

    private sealed class Volume
    {
        public required string ShareId { get; init; }
        public required string Root { get; init; }
        public required string FolderName { get; init; }
        public required string Token { get; init; }
        public string? Label { get; init; }
        public string Username { get; init; } = "bndz";
        public byte[]? PasswordHash { get; init; }
        public string? PasswordPlain { get; init; }
        public bool AllowWrite { get; init; }
        public DateTime? ExpiresUtc { get; init; }
        public DateTime StartedUtc { get; init; }
        public bool Running { get; set; } = true;
        public string? LastError { get; set; }
        public bool IsExpired => ExpiresUtc is DateTime exp && DateTime.UtcNow >= exp;
    }
}
