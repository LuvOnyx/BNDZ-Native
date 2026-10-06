using System.Net;
using System.Text;
using VoDA.FtpServer;
using VoDA.FtpServer.Models;
using VoDA.FtpServer.Interfaces;

namespace BNDZ.Services.LanShare;

/// <summary>FTP (and optional FTPS) via MIT VoDA.FtpServer, rooted at the share folder.</summary>
internal sealed class LanShareFtpHost : IDisposable
{
    private readonly string _root;
    private readonly IPAddress _bind;
    private readonly int _port;
    private readonly string _username;
    private readonly string? _password;
    private readonly bool _allowWrite;
    private readonly bool _ftps;
    private readonly string? _certPath;
    private readonly string? _certKeyPath;
    private CancellationTokenSource? _cts;
    private Task? _run;
    private object? _server; // VoDA FtpServer instance

    public string? Note { get; private set; }

    public LanShareFtpHost(
        string rootFolder,
        IPAddress bindAddress,
        int port,
        string username,
        string? password,
        bool allowWrite,
        bool ftps,
        string? certPath = null,
        string? certKeyPath = null)
    {
        _root = Path.GetFullPath(rootFolder);
        _bind = bindAddress;
        _port = port;
        _username = string.IsNullOrWhiteSpace(username) ? "bndz" : username.Trim();
        _password = password;
        _allowWrite = allowWrite;
        _ftps = ftps;
        _certPath = certPath;
        _certKeyPath = certKeyPath;
    }

    public void Start()
    {
        if (_ftps && (string.IsNullOrWhiteSpace(_certPath) || !File.Exists(_certPath)))
        {
            Note = "FTPS requested but no certificate — FTP plain started instead. Drop a cert under %LocalAppData%\\BNDZ\\LanShare to enable FTPS.";
            // fall through as plain FTP
        }

        var builder = new FtpServerBuilder()
            .ListenerSettings(cfg =>
            {
                cfg.Port = _port;
                cfg.ServerIp = _bind;
            })
            .Log(cfg => { cfg.Level = VoDA.FtpServer.Interfaces.LogLevel.None; })
            .Authorization(cfg =>
            {
                cfg.UseAuthorization = true;
                cfg.UsernameVerification += user =>
                    string.Equals(user, _username, StringComparison.OrdinalIgnoreCase);
                cfg.PasswordVerification += (user, pass) =>
                    string.Equals(user, _username, StringComparison.OrdinalIgnoreCase)
                    && (string.IsNullOrEmpty(_password) || string.Equals(pass, _password, StringComparison.Ordinal));
            })
            .FileSystem(fs =>
            {
                fs.OnExistFoulder += (_, path) => Directory.Exists(Map(path, isDir: true));
                fs.OnExistFile += (_, path) => File.Exists(Map(path, isDir: false));
                fs.OnGetList += (_, path) =>
                {
                    var dir = Map(path, isDir: true);
                    if (!Directory.Exists(dir))
                        return (Array.Empty<DirectoryModel>(), Array.Empty<FileModel>());
                    var dirs = Directory.EnumerateDirectories(dir)
                        .Select(d => new DirectoryModel(Path.GetFileName(d) ?? d, Directory.GetLastWriteTimeUtc(d)))
                        .ToList();
                    var files = Directory.EnumerateFiles(dir)
                        .Select(f => {
                            var fi = new FileInfo(f);
                            return new FileModel(fi.Name, fi.LastWriteTimeUtc, fi.Length);
                        })
                        .ToList();
                    return (dirs, files);
                };
                fs.OnGetFileSize += (_, path) =>
                {
                    var f = Map(path, isDir: false);
                    return File.Exists(f) ? new FileInfo(f).Length : 0;
                };
                fs.OnGetFileModificationTime += (_, path) =>
                {
                    var f = Map(path, isDir: false);
                    return File.Exists(f) ? File.GetLastWriteTimeUtc(f) : DateTime.UnixEpoch;
                };
                fs.OnDownload += (_, path) =>
                {
                    var f = Map(path, isDir: false);
                    return File.Exists(f) ? File.OpenRead(f) : Stream.Null;
                };
                fs.OnUpload += (_, path) =>
                {
                    if (!_allowWrite) throw new UnauthorizedAccessException("Read-only share");
                    var f = Map(path, isDir: false);
                    Directory.CreateDirectory(Path.GetDirectoryName(f)!);
                    return File.Create(f);
                };
                fs.OnAppend += (_, path) =>
                {
                    if (!_allowWrite) throw new UnauthorizedAccessException("Read-only share");
                    var f = Map(path, isDir: false);
                    Directory.CreateDirectory(Path.GetDirectoryName(f)!);
                    return new FileStream(f, FileMode.Append, FileAccess.Write, FileShare.None);
                };
                fs.OnCreate += (_, path) =>
                {
                    if (!_allowWrite) return false;
                    var d = Map(path, isDir: true);
                    Directory.CreateDirectory(d);
                    return true;
                };
                fs.OnDeleteFile += (_, path) =>
                {
                    if (!_allowWrite) return false;
                    var f = Map(path, isDir: false);
                    if (!File.Exists(f)) return false;
                    File.Delete(f);
                    return true;
                };
                fs.OnDeleteFolder += (_, path) =>
                {
                    if (!_allowWrite) return false;
                    var d = Map(path, isDir: true);
                    if (!Directory.Exists(d)) return false;
                    Directory.Delete(d, recursive: false);
                    return true;
                };
                fs.OnRename += (_, from, to) =>
                {
                    if (!_allowWrite) return false;
                    var a = Map(from, isDir: false);
                    var b = Map(to, isDir: false);
                    if (File.Exists(a)) { File.Move(a, b); return true; }
                    if (Directory.Exists(Map(from, isDir: true)))
                    {
                        Directory.Move(Map(from, isDir: true), Map(to, isDir: true));
                        return true;
                    }
                    return false;
                };
            });

        if (_ftps && !string.IsNullOrWhiteSpace(_certPath) && File.Exists(_certPath))
        {
            builder.Certificate(cfg =>
            {
                cfg.CertificatePath = _certPath!;
                if (!string.IsNullOrWhiteSpace(_certKeyPath))
                    cfg.CertificateKey = _certKeyPath!;
            });
            Note ??= $"FTPS on {_bind}:{_port}";
        }
        else
        {
            Note ??= $"FTP on {_bind}:{_port} (plain; FTPS needs cert)";
        }

        var server = builder.Build();
        _server = server;
        _cts = new CancellationTokenSource();
        _run = server.StartAsync(_cts.Token);
    }

    public void Dispose()
    {
        try { _cts?.Cancel(); } catch { /* */ }
        try
        {
            if (_server is IDisposable d) d.Dispose();
        }
        catch { /* */ }
        _cts?.Dispose();
    }

    private string Map(string ftpPath, bool isDir)
    {
        var rel = (ftpPath ?? "/").Replace('\\', '/').TrimStart('/');
        if (rel.Contains("..", StringComparison.Ordinal))
            throw new UnauthorizedAccessException("Path traversal blocked");
        var mapped = Path.GetFullPath(Path.Combine(_root, rel.Replace('/', Path.DirectorySeparatorChar)));
        var rootPrefix = _root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!mapped.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(mapped, _root, StringComparison.OrdinalIgnoreCase))
            throw new UnauthorizedAccessException("Outside share root");
        return mapped;
    }
}
