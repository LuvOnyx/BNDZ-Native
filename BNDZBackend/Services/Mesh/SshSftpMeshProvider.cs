using System.Collections.Concurrent;
using Renci.SshNet;
using Renci.SshNet.Sftp;

namespace BNDZ.Services.Mesh;

public interface IMeshProvider : IAsyncDisposable
{
    MeshProviderKind Kind { get; }
    Task ConnectAsync(MeshHostRecord host, CancellationToken ct = default);
    Task<IReadOnlyList<MeshDirEntry>> ListAsync(string remotePath, CancellationToken ct = default);
    Task DownloadAsync(string remotePath, string localFile, IProgress<long>? progress = null, CancellationToken ct = default);
    Task UploadAsync(string localFile, string remotePath, IProgress<long>? progress = null, CancellationToken ct = default);
    Task DeleteAsync(string remotePath, CancellationToken ct = default);
    Task RecursiveDeleteAsync(string remotePath, CancellationToken ct = default);
    Task MkdirAsync(string remotePath, CancellationToken ct = default);
    Task RenameAsync(string fromPath, string toPath, CancellationToken ct = default);
    Task CreateFileAsync(string remotePath, CancellationToken ct = default);
    Task WriteAsync(string remotePath, Stream content, IProgress<long>? progress = null, CancellationToken ct = default);
    Task WriteBytesAsync(string remotePath, byte[] content, CancellationToken ct = default);
    Task<MeshFileAttributes> GetAttributesAsync(string remotePath, CancellationToken ct = default);
    bool IsConnected { get; }
    void Disconnect();
}

/// <summary>
/// SSH/SFTP provider powered by SSH.NET — FileSSH-class browse/CRUD/auth for Remote Mesh.
/// </summary>
public sealed class SshSftpMeshProvider : IMeshProvider
{
    private static readonly ConcurrentDictionary<string, string> SessionPassphrases = new(StringComparer.OrdinalIgnoreCase);

    private SshClient? _ssh;
    private SftpClient? _sftp;
    private SshClient? _jumpClient;
    private ForwardedPortLocal? _jumpPort;
    private MeshHostRecord? _host;

    public MeshProviderKind Kind => MeshProviderKind.Ssh;
    public bool IsConnected => _sftp?.IsConnected == true;

    public static void CacheSessionPassphrase(string keyPath, string passphrase)
    {
        if (!string.IsNullOrEmpty(keyPath) && !string.IsNullOrEmpty(passphrase))
            SessionPassphrases[keyPath] = passphrase;
    }

    public Task ConnectAsync(MeshHostRecord host, CancellationToken ct = default)
    {
        Disconnect();
        _host = host;

        var authMethods = BuildAuthMethods(host);
        ConnectionInfo conn;

        if (!string.IsNullOrWhiteSpace(host.JumpHostId) || !string.IsNullOrWhiteSpace(host.ProxyJump))
        {
            // Jump handled by orchestrator when JumpHostId points at another mesh host.
            // ProxyJump hostname:port → local forward via a one-shot jump client.
            if (!string.IsNullOrWhiteSpace(host.ProxyJump) && string.IsNullOrWhiteSpace(host.JumpHostId))
            {
                ConnectViaProxyJump(host, authMethods);
                return Task.CompletedTask;
            }
        }

        conn = new ConnectionInfo(host.Hostname, host.Port, host.Username, authMethods.ToArray())
        {
            Timeout = TimeSpan.FromSeconds(25),
        };
        _ssh = new SshClient(conn);
        _sftp = new SftpClient(conn);
        AttachHostKeyHandler(_ssh, host);
        AttachHostKeyHandler(_sftp, host);
        _ssh.Connect();
        _sftp.Connect();
        return Task.CompletedTask;
    }

    /// <summary>Connect target host through an already-connected jump SSH client (mesh JumpHostId).</summary>
    public Task ConnectViaJumpAsync(MeshHostRecord host, SshClient jumpClient, CancellationToken ct = default)
    {
        DisconnectKeepJump();
        _host = host;
        _jumpClient = jumpClient;
        var authMethods = BuildAuthMethods(host);
        var localPort = FindFreePort();
        _jumpPort = new ForwardedPortLocal("127.0.0.1", (uint)localPort, host.Hostname, (uint)host.Port);
        jumpClient.AddForwardedPort(_jumpPort);
        _jumpPort.Start();
        var conn = new ConnectionInfo("127.0.0.1", localPort, host.Username, authMethods.ToArray())
        {
            Timeout = TimeSpan.FromSeconds(25),
        };
        _ssh = new SshClient(conn);
        _sftp = new SftpClient(conn);
        AttachHostKeyHandler(_ssh, host);
        AttachHostKeyHandler(_sftp, host);
        _ssh.Connect();
        _sftp.Connect();
        return Task.CompletedTask;
    }

    public SshClient? GetSshClient() => _ssh;

    private void ConnectViaProxyJump(MeshHostRecord host, List<AuthenticationMethod> targetAuth)
    {
        var (jumpHost, jumpPort) = ParseProxyJump(host.ProxyJump!);
        // Reuse same credentials for jump when importing from ssh config without a separate jump host record.
        var jumpAuth = BuildAuthMethods(host);
        var jumpConn = new ConnectionInfo(jumpHost, jumpPort, host.Username, jumpAuth.ToArray())
        {
            Timeout = TimeSpan.FromSeconds(25),
        };
        _jumpClient = new SshClient(jumpConn);
        _jumpClient.Connect();
        var localPort = FindFreePort();
        _jumpPort = new ForwardedPortLocal("127.0.0.1", (uint)localPort, host.Hostname, (uint)host.Port);
        _jumpClient.AddForwardedPort(_jumpPort);
        _jumpPort.Start();
        var conn = new ConnectionInfo("127.0.0.1", localPort, host.Username, targetAuth.ToArray())
        {
            Timeout = TimeSpan.FromSeconds(25),
        };
        _ssh = new SshClient(conn);
        _sftp = new SftpClient(conn);
        AttachHostKeyHandler(_ssh, host);
        AttachHostKeyHandler(_sftp, host);
        _ssh.Connect();
        _sftp.Connect();
    }

    private static List<AuthenticationMethod> BuildAuthMethods(MeshHostRecord host)
    {
        var methods = new List<AuthenticationMethod>();
        var secret = MeshCredentialVault.Unprotect(host.ProtectedSecret);

        if (host.AuthKind == MeshAuthKind.Password)
        {
            methods.Add(new PasswordAuthenticationMethod(host.Username, secret ?? ""));
            return methods;
        }

        if (host.AuthKind == MeshAuthKind.PrivateKey && !string.IsNullOrEmpty(host.KeyPath) && File.Exists(host.KeyPath))
        {
            PrivateKeyFile keyFile;
            try
            {
                if (!string.IsNullOrEmpty(secret))
                    keyFile = new PrivateKeyFile(host.KeyPath, secret);
                else if (SessionPassphrases.TryGetValue(host.KeyPath, out var cached))
                    keyFile = new PrivateKeyFile(host.KeyPath, cached);
                else
                    keyFile = new PrivateKeyFile(host.KeyPath);
            }
            catch (Exception ex) when (IsEncryptedKeyError(ex))
            {
                throw new InvalidOperationException(
                    $"Private key '{host.KeyPath}' is encrypted. Save a passphrase on the host and reconnect.", ex);
            }

            // CertificatePath is persisted for ssh-config parity; SSH.NET uses the identity key for auth.
            // When the cert file is itself a usable key material, include it as an additional key.
            if (!string.IsNullOrEmpty(host.CertificatePath) && File.Exists(host.CertificatePath))
            {
                try
                {
                    var certKey = new PrivateKeyFile(host.CertificatePath);
                    methods.Add(new PrivateKeyAuthenticationMethod(host.Username, keyFile, certKey));
                }
                catch
                {
                    methods.Add(new PrivateKeyAuthenticationMethod(host.Username, keyFile));
                }
            }
            else
            {
                methods.Add(new PrivateKeyAuthenticationMethod(host.Username, keyFile));
            }
            return methods;
        }

        // Agent / fallback: try common identity files, then empty private-key method last.
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var candidates = new[]
        {
            host.KeyPath,
            Path.Combine(home, ".ssh", "id_ed25519"),
            Path.Combine(home, ".ssh", "id_rsa"),
            Path.Combine(home, ".ssh", "id_ecdsa"),
        };
        foreach (var path in candidates.Where(p => !string.IsNullOrEmpty(p) && File.Exists(p!)).Distinct())
        {
            try
            {
                PrivateKeyFile kf;
                if (SessionPassphrases.TryGetValue(path!, out var cached))
                    kf = new PrivateKeyFile(path!, cached);
                else if (!string.IsNullOrEmpty(secret) && path == host.KeyPath)
                    kf = new PrivateKeyFile(path!, secret);
                else
                    kf = new PrivateKeyFile(path!);
                methods.Add(new PrivateKeyAuthenticationMethod(host.Username, kf));
            }
            catch { /* try next */ }
        }

        if (methods.Count == 0)
            methods.Add(new PasswordAuthenticationMethod(host.Username, secret ?? ""));

        return methods;
    }

    private static bool IsEncryptedKeyError(Exception ex) =>
        ex.Message.Contains("encrypted", StringComparison.OrdinalIgnoreCase)
        || ex.Message.Contains("passphrase", StringComparison.OrdinalIgnoreCase)
        || ex.GetType().Name.Contains("SshPassPhrase", StringComparison.OrdinalIgnoreCase);

    private static void AttachHostKeyHandler(BaseClient client, MeshHostRecord host)
    {
        if (string.IsNullOrWhiteSpace(host.HostKeyFingerprint)) return;
        var expected = NormalizeFp(host.HostKeyFingerprint);
        client.HostKeyReceived += (_, e) =>
        {
            var actual = Convert.ToHexString(e.FingerPrint).ToLowerInvariant();
            var actualColon = BitConverter.ToString(e.FingerPrint).Replace("-", ":").ToLowerInvariant();
            if (!string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase)
                && !string.Equals(NormalizeFp(actualColon), expected, StringComparison.OrdinalIgnoreCase)
                && !string.Equals(NormalizeFp(Convert.ToBase64String(e.FingerPrint)), expected, StringComparison.OrdinalIgnoreCase))
            {
                e.CanTrust = false;
            }
        };
    }

    private static string NormalizeFp(string fp) =>
        fp.Replace(":", "", StringComparison.Ordinal)
          .Replace(" ", "", StringComparison.Ordinal)
          .Replace("-", "", StringComparison.Ordinal)
          .Trim()
          .ToLowerInvariant();

    private static (string Host, int Port) ParseProxyJump(string proxyJump)
    {
        var s = proxyJump.Trim();
        // user@host:port or host:port or host
        var at = s.LastIndexOf('@');
        if (at >= 0) s = s[(at + 1)..];
        var colon = s.LastIndexOf(':');
        if (colon > 0 && int.TryParse(s[(colon + 1)..], out var port))
            return (s[..colon], port);
        return (s, 22);
    }

    private static int FindFreePort()
    {
        var listener = new System.Net.Sockets.TcpListener(System.Net.IPAddress.Loopback, 0);
        listener.Start();
        var port = ((System.Net.IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    public Task<IReadOnlyList<MeshDirEntry>> ListAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        var path = NormalizeRemote(remotePath);
        var entries = _sftp!.ListDirectory(path)
            .Where(e => e.Name is not "." and not "..")
            .Select(MapEntry)
            .OrderByDescending(e => e.IsDirectory)
            .ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return Task.FromResult<IReadOnlyList<MeshDirEntry>>(entries);
    }

    private static MeshDirEntry MapEntry(ISftpFile e)
    {
        return new MeshDirEntry
        {
            Name = e.Name,
            IsDirectory = e.IsDirectory,
            Size = e.IsDirectory ? 0 : e.Length,
            ModifiedUtc = e.LastWriteTimeUtc,
            IsSymlink = e.IsSymbolicLink,
            Mode = EncodeUnixMode(e),
            Uid = (uint)e.UserId,
            Gid = (uint)e.GroupId,
        };
    }

    private static int EncodeUnixMode(ISftpFile e)
    {
        int mode = 0;
        if (e.OwnerCanRead) mode |= 0b100_000_000;
        if (e.OwnerCanWrite) mode |= 0b010_000_000;
        if (e.OwnerCanExecute) mode |= 0b001_000_000;
        if (e.GroupCanRead) mode |= 0b000_100_000;
        if (e.GroupCanWrite) mode |= 0b000_010_000;
        if (e.GroupCanExecute) mode |= 0b000_001_000;
        if (e.OthersCanRead) mode |= 0b000_000_100;
        if (e.OthersCanWrite) mode |= 0b000_000_010;
        if (e.OthersCanExecute) mode |= 0b000_000_001;
        return mode;
    }

    private static int EncodeUnixMode(SftpFileAttributes a)
    {
        int mode = 0;
        if (a.OwnerCanRead) mode |= 0b100_000_000;
        if (a.OwnerCanWrite) mode |= 0b010_000_000;
        if (a.OwnerCanExecute) mode |= 0b001_000_000;
        if (a.GroupCanRead) mode |= 0b000_100_000;
        if (a.GroupCanWrite) mode |= 0b000_010_000;
        if (a.GroupCanExecute) mode |= 0b000_001_000;
        if (a.OthersCanRead) mode |= 0b000_000_100;
        if (a.OthersCanWrite) mode |= 0b000_000_010;
        if (a.OthersCanExecute) mode |= 0b000_000_001;
        return mode;
    }

    public Task DownloadAsync(string remotePath, string localFile, IProgress<long>? progress = null, CancellationToken ct = default)
    {
        EnsureConnected();
        Directory.CreateDirectory(Path.GetDirectoryName(localFile)!);
        using var fs = File.Create(localFile);
        _sftp!.DownloadFile(NormalizeRemote(remotePath), fs, b =>
        {
            ct.ThrowIfCancellationRequested();
            progress?.Report((long)b);
        });
        return Task.CompletedTask;
    }

    public Task UploadAsync(string localFile, string remotePath, IProgress<long>? progress = null, CancellationToken ct = default)
    {
        EnsureConnected();
        var remote = NormalizeRemote(remotePath);
        var dir = ParentRemote(remote);
        if (!string.IsNullOrEmpty(dir)) EnsureRemoteDir(dir);
        using var fs = File.OpenRead(localFile);
        _sftp!.UploadFile(fs, remote, true, b =>
        {
            ct.ThrowIfCancellationRequested();
            progress?.Report((long)b);
        });
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        var p = NormalizeRemote(remotePath);
        if (!_sftp!.Exists(p)) return Task.CompletedTask;
        var attr = _sftp.GetAttributes(p);
        if (attr.IsDirectory) _sftp.DeleteDirectory(p);
        else _sftp.DeleteFile(p);
        return Task.CompletedTask;
    }

    public Task RecursiveDeleteAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        var p = NormalizeRemote(remotePath);
        if (!_sftp!.Exists(p)) return Task.CompletedTask;
        RecursiveDeleteInternal(p, ct);
        return Task.CompletedTask;
    }

    private void RecursiveDeleteInternal(string path, CancellationToken ct)
    {
        ct.ThrowIfCancellationRequested();
        var attr = _sftp!.GetAttributes(path);
        if (attr.IsDirectory && !attr.IsSymbolicLink)
        {
            foreach (var child in _sftp.ListDirectory(path))
            {
                if (child.Name is "." or "..") continue;
                RecursiveDeleteInternal(child.FullName.Replace('\\', '/'), ct);
            }
            _sftp.DeleteDirectory(path);
        }
        else
        {
            _sftp.DeleteFile(path);
        }
    }

    public Task MkdirAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        EnsureRemoteDir(NormalizeRemote(remotePath));
        return Task.CompletedTask;
    }

    public Task RenameAsync(string fromPath, string toPath, CancellationToken ct = default)
    {
        EnsureConnected();
        var from = NormalizeRemote(fromPath);
        var to = NormalizeRemote(toPath);
        var parent = ParentRemote(to);
        if (!string.IsNullOrEmpty(parent)) EnsureRemoteDir(parent);
        _sftp!.RenameFile(from, to);
        return Task.CompletedTask;
    }

    public Task CreateFileAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        var remote = NormalizeRemote(remotePath);
        var parent = ParentRemote(remote);
        if (!string.IsNullOrEmpty(parent)) EnsureRemoteDir(parent);
        using var stream = _sftp!.Create(remote);
        return Task.CompletedTask;
    }

    public Task WriteAsync(string remotePath, Stream content, IProgress<long>? progress = null, CancellationToken ct = default)
    {
        EnsureConnected();
        var remote = NormalizeRemote(remotePath);
        var parent = ParentRemote(remote);
        if (!string.IsNullOrEmpty(parent)) EnsureRemoteDir(parent);
        using var dest = _sftp!.OpenWrite(remote);
        var buffer = new byte[64 * 1024];
        long written = 0;
        int read;
        while ((read = content.Read(buffer, 0, buffer.Length)) > 0)
        {
            ct.ThrowIfCancellationRequested();
            dest.Write(buffer, 0, read);
            written += read;
            progress?.Report(written);
        }
        dest.Flush();
        return Task.CompletedTask;
    }

    public Task WriteBytesAsync(string remotePath, byte[] content, CancellationToken ct = default)
    {
        using var ms = new MemoryStream(content);
        return WriteAsync(remotePath, ms, null, ct);
    }

    public Task<MeshFileAttributes> GetAttributesAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        var p = NormalizeRemote(remotePath);
        if (!_sftp!.Exists(p))
            return Task.FromResult(new MeshFileAttributes { Path = p, Exists = false });
        var a = _sftp.GetAttributes(p);
        return Task.FromResult(new MeshFileAttributes
        {
            Path = p,
            Exists = true,
            IsDirectory = a.IsDirectory,
            IsSymlink = a.IsSymbolicLink,
            Size = a.Size,
            ModifiedUtc = a.LastWriteTimeUtc,
            Mode = EncodeUnixMode(a),
            Uid = (uint)a.UserId,
            Gid = (uint)a.GroupId,
        });
    }

    public ShellStream? CreateShellStream(string term, uint cols, uint rows)
    {
        EnsureConnected();
        var stream = _ssh!.CreateShellStream(term, cols, rows, cols * 8, rows * 8, 4096);
        return stream;
    }

    public void TryResizeShell(ShellStream shell, uint cols, uint rows)
    {
        try
        {
            // SSH.NET: send window-change via reflection on the channel when available.
            var channelField = typeof(ShellStream).GetField("_channel",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic);
            var channel = channelField?.GetValue(shell);
            if (channel == null) return;
            var method = channel.GetType().GetMethod("SendWindowChangeRequest",
                System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.Public | System.Reflection.BindingFlags.NonPublic);
            method?.Invoke(channel, [cols, rows, cols * 8u, rows * 8u]);
        }
        catch { /* best effort */ }
    }

    private void EnsureRemoteDir(string path)
    {
        if (string.IsNullOrEmpty(path) || path == "/") return;
        var parts = path.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var cur = "";
        foreach (var part in parts)
        {
            cur += "/" + part;
            if (!_sftp!.Exists(cur)) _sftp.CreateDirectory(cur);
        }
    }

    private static string ParentRemote(string path)
    {
        var p = NormalizeRemote(path);
        var idx = p.LastIndexOf('/');
        if (idx <= 0) return "/";
        return p[..idx];
    }

    internal static string NormalizeRemote(string path)
    {
        var p = path.Replace('\\', '/');
        if (!p.StartsWith('/')) p = "/" + p;
        while (p.Contains("//", StringComparison.Ordinal)) p = p.Replace("//", "/");
        return p == "" ? "/" : p;
    }

    private void EnsureConnected()
    {
        if (_sftp?.IsConnected != true) throw new InvalidOperationException("SFTP not connected");
    }

    private void DisconnectKeepJump()
    {
        try { _sftp?.Disconnect(); } catch { }
        try { _ssh?.Disconnect(); } catch { }
        _sftp?.Dispose();
        _ssh?.Dispose();
        _sftp = null;
        _ssh = null;
        try { _jumpPort?.Stop(); } catch { }
        _jumpPort = null;
    }

    public void Disconnect()
    {
        DisconnectKeepJump();
        try { _jumpClient?.Disconnect(); } catch { }
        _jumpClient?.Dispose();
        _jumpClient = null;
        _host = null;
    }

    public ValueTask DisposeAsync()
    {
        Disconnect();
        return ValueTask.CompletedTask;
    }
}
