using System.Collections.Concurrent;
using System.Text;
using Renci.SshNet;

namespace BNDZ.Services.Mesh;

public sealed class MeshTerminalService : IDisposable
{
    private readonly BndzMeshOrchestrator _orchestrator;
    private readonly ConcurrentDictionary<string, TerminalSession> _sessions = new();

    public MeshTerminalService(BndzMeshOrchestrator orchestrator) => _orchestrator = orchestrator;

    public event Action<string, string>? OnOutput; // sessionId, base64 chunk
    public event Action<string, int>? OnExit; // sessionId, exit code

    public MeshTerminalSessionInfo OpenSsh(string hostId, string? cwd, uint cols = 120, uint rows = 32)
    {
        var id = Guid.NewGuid().ToString("N")[..12];
        var host = _orchestrator.GetHost(hostId) ?? throw new InvalidOperationException("Host not found");
        _orchestrator.EnsureConnected(hostId);
        var provider = _orchestrator.GetSshProvider(hostId);
        var shell = provider.CreateShellStream("xterm-256color", cols, rows)
            ?? throw new InvalidOperationException("Failed to open SSH shell");
        if (!string.IsNullOrEmpty(cwd))
        {
            var quoted = cwd.Replace("'", "'\\''");
            shell.WriteLine($"cd '{quoted}'");
            shell.Write("\r");
        }
        var session = new TerminalSession { Id = id, HostId = hostId, Shell = shell, IsLocal = false };
        shell.DataReceived += (_, e) =>
        {
            var b64 = Convert.ToBase64String(e.Data);
            OnOutput?.Invoke(id, b64);
        };
        _sessions[id] = session;
        OnOutput?.Invoke(id, Convert.ToBase64String(Encoding.UTF8.GetBytes($"\r\nBNDZ SSH — {host.Alias ?? host.Hostname ?? hostId}\r\n\r\n")));
        return new MeshTerminalSessionInfo { Id = id, HostId = hostId, RemoteCwd = cwd, IsLocal = false, Embedded = false, ExternalOs = false };
    }

    /// <summary>
    /// Local PowerShell via ConPTY → same xterm.js surface as SSH.
    /// This is the Windows Terminal model — not HWND SetParent, not a detached OS window.
    /// </summary>
    public MeshTerminalSessionInfo OpenLocal(string? cwd, uint cols = 120, uint rows = 32)
    {
        var id = Guid.NewGuid().ToString("N")[..12];
        var workDir = ResolveLocalWorkingDirectory(cwd);
        BndzConPtyTerminal? pty = null;
        try
        {
            pty = BndzConPtyTerminal.Start(
                workDir,
                cols,
                rows,
                onData: data =>
                {
                    try { OnOutput?.Invoke(id, Convert.ToBase64String(data)); }
                    catch { /* ignore */ }
                },
                onExit: code =>
                {
                    try { OnExit?.Invoke(id, code); }
                    catch { /* ignore */ }
                });
        }
        catch
        {
            pty?.Dispose();
            throw;
        }

        var session = new TerminalSession
        {
            Id = id,
            HostId = "",
            IsLocal = true,
            PendingCwd = workDir,
            LocalPty = pty,
        };
        _sessions[id] = session;
        return new MeshTerminalSessionInfo
        {
            Id = id,
            HostId = "",
            RemoteCwd = workDir,
            IsLocal = true,
            Embedded = false,
            ExternalOs = false,
        };
    }

    /// <summary>Legacy HWND layout — permanently no-op (WebView SetParent blacks out the FM).</summary>
    public void AttachOrLayoutEmbedded(string sessionId, IntPtr parentHwnd, int x, int y, int width, int height, bool visible)
    {
        _ = sessionId;
        _ = parentHwnd;
        _ = x;
        _ = y;
        _ = width;
        _ = height;
        _ = visible;
    }

    public void SendInput(string sessionId, string base64)
    {
        if (!_sessions.TryGetValue(sessionId, out var s)) return;
        var bytes = Convert.FromBase64String(base64);
        if (s.LocalPty != null)
        {
            s.LocalPty.Write(bytes);
            return;
        }
        if (s.Shell != null)
            s.Shell.Write(Encoding.UTF8.GetString(bytes));
    }

    public void Resize(string sessionId, uint cols, uint rows)
    {
        if (!_sessions.TryGetValue(sessionId, out var s)) return;
        if (s.LocalPty != null)
        {
            s.LocalPty.Resize(cols, rows);
            return;
        }
        if (s.Shell == null) return;
        try
        {
            var provider = _orchestrator.GetSshProvider(s.HostId);
            provider.TryResizeShell(s.Shell, cols, rows);
        }
        catch { /* best effort */ }
    }

    public void Close(string sessionId)
    {
        if (!_sessions.TryRemove(sessionId, out var s)) return;
        try { s.Shell?.Close(); } catch { }
        try { s.LocalPty?.Dispose(); } catch { }
    }

    public void Dispose()
    {
        foreach (var id in _sessions.Keys.ToList()) Close(id);
    }

    private static string ResolveLocalWorkingDirectory(string? cwd)
    {
        if (string.IsNullOrWhiteSpace(cwd))
            return Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        var p = cwd.Trim().Replace('/', '\\');
        if (p.Length >= 3 && p[0] == '\\' && char.IsLetter(p[1]) && p[2] == ':')
            p = p[1..];
        if (p.Length == 2 && char.IsLetter(p[0]) && p[1] == ':')
            p += "\\";
        if (Directory.Exists(p))
            return p;

        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return string.IsNullOrEmpty(profile) ? Environment.CurrentDirectory : profile;
    }

    private sealed class TerminalSession
    {
        public string Id { get; set; } = "";
        public string HostId { get; set; } = "";
        public bool IsLocal { get; set; }
        public string? PendingCwd { get; set; }
        public ShellStream? Shell { get; set; }
        public BndzConPtyTerminal? LocalPty { get; set; }
    }
}
