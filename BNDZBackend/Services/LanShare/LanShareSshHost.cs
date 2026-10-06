using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using FxSsh;
using FxSsh.Services;

namespace BNDZ.Services.LanShare;

/// <summary>
/// SSH via MIT FxSsh 1.4 (NuGet). Interactive shell = Process (cmd) rooted at the share.
/// SFTP = BNDZ-owned SFTP v3 subsystem (LanShareSftpSubsystem). ConPTY/FxSsh.Sftp not in NuGet 1.4.
/// </summary>
internal sealed class LanShareSshHost : IDisposable
{
    private readonly string _root;
    private readonly IPAddress _bind;
    private readonly int _port;
    private readonly string _username;
    private readonly string? _password;
    private readonly bool _allowWrite;
    private readonly bool _enableShell;
    private readonly bool _enableSftp;
    private SshServer? _server;
    private string? _hostKeyPem;

    public string? Note { get; private set; }

    public LanShareSshHost(
        string rootFolder,
        IPAddress bindAddress,
        int port,
        string username,
        string? password,
        bool allowWrite,
        bool enableShell,
        bool enableSftp)
    {
        _root = Path.GetFullPath(rootFolder);
        _bind = bindAddress;
        _port = port;
        _username = string.IsNullOrWhiteSpace(username) ? "bndz" : username.Trim();
        _password = password;
        _allowWrite = allowWrite;
        _enableShell = enableShell;
        _enableSftp = enableSftp;
    }

    public void Start()
    {
        _hostKeyPem = EnsureHostKeyPem();
        var info = new StartingInfo(_bind, _port, "SSH-2.0-BNDZ_LanShare");
        _server = new SshServer(info);
        _server.AddHostKey("rsa-sha2-256", _hostKeyPem);
        _server.AddHostKey("rsa-sha2-512", _hostKeyPem);
        _server.ConnectionAccepted += OnConnectionAccepted;
        _server.Start();
        Note = $"SSH on {_bind}:{_port} user '{_username}'"
            + (_enableSftp ? "; SFTP v3 (BNDZ)" : "")
            + (_enableShell ? "; shell=cmd Process (share-rooted)" : "; shell off");
    }

    public void Dispose()
    {
        try { _server?.Stop(); } catch { /* */ }
        try { (_server as IDisposable)?.Dispose(); } catch { /* */ }
        _server = null;
    }

    private void OnConnectionAccepted(object? sender, Session session)
    {
        session.ServiceRegistered += (_, service) =>
        {
            if (service is UserAuthService auth)
            {
                auth.EnableNoneAuth = false;
                auth.UserAuth += (_, args) =>
                {
                    var userOk = string.Equals(args.Username, _username, StringComparison.OrdinalIgnoreCase);
                    var passOk = string.IsNullOrEmpty(_password) || string.Equals(args.Password, _password, StringComparison.Ordinal);
                    args.Result = userOk && passOk;
                };
            }
            else if (service is ConnectionService conn)
            {
                conn.CommandOpened += (_, e) =>
                {
                    if (e.ShellType == "shell" && _enableShell)
                    {
                        e.Agreed = true;
                        StartProcessShell(e.Channel);
                        return;
                    }

                    if (e.ShellType == "subsystem"
                        && string.Equals(e.CommandText, "sftp", StringComparison.OrdinalIgnoreCase)
                        && _enableSftp)
                    {
                        e.Agreed = true;
                        var sftp = new LanShareSftpSubsystem(_root, _allowWrite);
                        sftp.Attach(e.Channel);
                        return;
                    }

                    // Reject exec and unknown subsystems in v1.
                    e.Agreed = false;
                };
            }
        };
    }

    private void StartProcessShell(Channel channel)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/K \"cd /d {_root.Replace("\"", "")}\"",
                WorkingDirectory = _root,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            var proc = Process.Start(psi);
            if (proc is null)
            {
                var msg = Encoding.UTF8.GetBytes("BNDZ SSH: failed to start cmd.exe\r\n");
                channel.SendData(msg);
                channel.SendClose(1);
                return;
            }

            void Pump(StreamReader reader)
            {
                Task.Run(() =>
                {
                    try
                    {
                        var buf = new char[4096];
                        while (!proc.HasExited)
                        {
                            var n = reader.Read(buf, 0, buf.Length);
                            if (n <= 0) break;
                            var bytes = Encoding.UTF8.GetBytes(buf, 0, n);
                            try { channel.SendData(bytes); } catch { break; }
                        }
                    }
                    catch { /* */ }
                });
            }

            Pump(proc.StandardOutput);
            Pump(proc.StandardError);

            channel.DataReceived += (_, data) =>
            {
                try
                {
                    if (proc.HasExited) return;
                    var text = Encoding.UTF8.GetString(data.Span);
                    proc.StandardInput.Write(text);
                    proc.StandardInput.Flush();
                }
                catch { /* */ }
            };
            channel.CloseReceived += (_, _) =>
            {
                try { if (!proc.HasExited) proc.Kill(entireProcessTree: true); } catch { /* */ }
                try { proc.Dispose(); } catch { /* */ }
            };

            Task.Run(() =>
            {
                try
                {
                    proc.WaitForExit();
                    try { channel.SendClose((uint)Math.Max(0, proc.ExitCode)); } catch { /* */ }
                }
                catch { /* */ }
            });
        }
        catch (Exception ex)
        {
            var msg = Encoding.UTF8.GetBytes($"BNDZ SSH shell failed: {ex.Message}\r\n");
            try { channel.SendData(msg); } catch { /* */ }
            try { channel.SendClose(1); } catch { /* */ }
        }
    }

    private static string EnsureHostKeyPem()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "LanShare");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "ssh-host-rsa.pem");
        if (File.Exists(path))
            return File.ReadAllText(path);

        try
        {
            var pem = KeyGenerator.GenerateRsaKeyPem(2048);
            File.WriteAllText(path, pem);
            return pem;
        }
        catch
        {
            using var rsa = RSA.Create(2048);
            var pem = rsa.ExportPkcs8PrivateKeyPem();
            File.WriteAllText(path, pem);
            return pem;
        }
    }
}
