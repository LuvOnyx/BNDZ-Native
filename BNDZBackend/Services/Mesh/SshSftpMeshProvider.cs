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
    Task MkdirAsync(string remotePath, CancellationToken ct = default);
    bool IsConnected { get; }
    void Disconnect();
}

public sealed class SshSftpMeshProvider : IMeshProvider
{
    private SshClient? _ssh;
    private SftpClient? _sftp;
    private MeshHostRecord? _host;

    public MeshProviderKind Kind => MeshProviderKind.Ssh;
    public bool IsConnected => _sftp?.IsConnected == true;

    public Task ConnectAsync(MeshHostRecord host, CancellationToken ct = default)
    {
        Disconnect();
        _host = host;
        var methods = new List<AuthenticationMethod>();
        if (host.AuthKind == MeshAuthKind.Password)
        {
            var pw = MeshCredentialVault.Unprotect(host.ProtectedSecret) ?? "";
            methods.Add(new PasswordAuthenticationMethod(host.Username, pw));
        }
        else if (host.AuthKind == MeshAuthKind.PrivateKey && !string.IsNullOrEmpty(host.KeyPath) && File.Exists(host.KeyPath))
        {
            var key = new PrivateKeyFile(host.KeyPath);
            methods.Add(new PrivateKeyAuthenticationMethod(host.Username, key));
        }
        else
        {
            methods.Add(new PrivateKeyAuthenticationMethod(host.Username));
        }

        var conn = new ConnectionInfo(host.Hostname, host.Port, host.Username, methods.ToArray())
        {
            Timeout = TimeSpan.FromSeconds(20),
        };
        _ssh = new SshClient(conn);
        _sftp = new SftpClient(conn);
        _ssh.Connect();
        _sftp.Connect();
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<MeshDirEntry>> ListAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        var path = NormalizeRemote(remotePath);
        var entries = _sftp!.ListDirectory(path)
            .Where(e => e.Name is not "." and not "..")
            .Select(e => new MeshDirEntry
            {
                Name = e.Name,
                IsDirectory = e.IsDirectory,
                Size = e.IsDirectory ? 0 : (long)e.Length,
                ModifiedUtc = e.LastWriteTimeUtc,
            })
            .OrderByDescending(e => e.IsDirectory)
            .ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        return Task.FromResult<IReadOnlyList<MeshDirEntry>>(entries);
    }

    public Task DownloadAsync(string remotePath, string localFile, IProgress<long>? progress = null, CancellationToken ct = default)
    {
        EnsureConnected();
        Directory.CreateDirectory(Path.GetDirectoryName(localFile)!);
        using var fs = File.Create(localFile);
        _sftp!.DownloadFile(NormalizeRemote(remotePath), fs, b => progress?.Report((long)b));
        return Task.CompletedTask;
    }

    public Task UploadAsync(string localFile, string remotePath, IProgress<long>? progress = null, CancellationToken ct = default)
    {
        EnsureConnected();
        var remote = NormalizeRemote(remotePath);
        var dir = Path.GetDirectoryName(remote.Replace('/', Path.DirectorySeparatorChar));
        if (!string.IsNullOrEmpty(dir)) EnsureRemoteDir(dir.Replace('\\', '/'));
        using var fs = File.OpenRead(localFile);
        _sftp!.UploadFile(fs, remote, true, b => progress?.Report((long)b));
        return Task.CompletedTask;
    }

    public Task DeleteAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        var p = NormalizeRemote(remotePath);
        if (_sftp!.Exists(p))
        {
            var attr = _sftp.GetAttributes(p);
            if (attr.IsDirectory) _sftp.DeleteDirectory(p);
            else _sftp.DeleteFile(p);
        }
        return Task.CompletedTask;
    }

    public Task MkdirAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        EnsureRemoteDir(NormalizeRemote(remotePath));
        return Task.CompletedTask;
    }

    public ShellStream? CreateShellStream(string term, uint cols, uint rows)
    {
        EnsureConnected();
        return _ssh!.CreateShellStream(term, cols, rows, cols * 8, rows * 8, 4096);
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

    private static string NormalizeRemote(string path)
    {
        var p = path.Replace('\\', '/');
        if (!p.StartsWith('/')) p = "/" + p;
        return p == "" ? "/" : p;
    }

    private void EnsureConnected()
    {
        if (_sftp?.IsConnected != true) throw new InvalidOperationException("SFTP not connected");
    }

    public void Disconnect()
    {
        try { _sftp?.Disconnect(); } catch { }
        try { _ssh?.Disconnect(); } catch { }
        _sftp?.Dispose();
        _ssh?.Dispose();
        _sftp = null;
        _ssh = null;
    }

    public ValueTask DisposeAsync()
    {
        Disconnect();
        return ValueTask.CompletedTask;
    }
}
