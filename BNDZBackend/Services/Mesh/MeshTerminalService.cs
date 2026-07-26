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
            shell.WriteLine($"cd {cwd}");
        }
        var session = new TerminalSession { Id = id, HostId = hostId, Shell = shell, IsLocal = false };
        shell.DataReceived += (_, e) =>
        {
            var b64 = Convert.ToBase64String(e.Data);
            OnOutput?.Invoke(id, b64);
        };
        _sessions[id] = session;
        return new MeshTerminalSessionInfo { Id = id, HostId = hostId, RemoteCwd = cwd, IsLocal = false };
    }

    public MeshTerminalSessionInfo OpenLocal(string? cwd, uint cols = 120, uint rows = 32)
    {
        var id = Guid.NewGuid().ToString("N")[..12];
        try
        {
            var psi = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoLogo -NoExit",
                WorkingDirectory = string.IsNullOrEmpty(cwd) ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile) : cwd,
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            var proc = System.Diagnostics.Process.Start(psi)
                ?? throw new InvalidOperationException("Failed to start PowerShell");
            var session = new TerminalSession { Id = id, HostId = "", Process = proc, IsLocal = true };
            proc.OutputDataReceived += (_, e) => { if (e.Data != null) OnOutput?.Invoke(id, Convert.ToBase64String(Encoding.UTF8.GetBytes(e.Data + "\n"))); };
            proc.ErrorDataReceived += (_, e) => { if (e.Data != null) OnOutput?.Invoke(id, Convert.ToBase64String(Encoding.UTF8.GetBytes(e.Data + "\n"))); };
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();
            proc.Exited += (_, _) => OnExit?.Invoke(id, proc.ExitCode);
            proc.EnableRaisingEvents = true;
            _sessions[id] = session;
            OnOutput?.Invoke(id, Convert.ToBase64String(Encoding.UTF8.GetBytes("\r\nBNDZ local shell — PowerShell\r\n\r\n")));
            return new MeshTerminalSessionInfo { Id = id, HostId = "", RemoteCwd = cwd, IsLocal = true };
        }
        catch (Exception ex)
        {
            throw new InvalidOperationException($"Local terminal failed: {ex.Message}", ex);
        }
    }

    public void SendInput(string sessionId, string base64)
    {
        if (!_sessions.TryGetValue(sessionId, out var s)) return;
        var bytes = Convert.FromBase64String(base64);
        var text = Encoding.UTF8.GetString(bytes);
        if (s.Shell != null) s.Shell.Write(text);
        else if (s.Process != null) { s.Process.StandardInput.Write(text); s.Process.StandardInput.Flush(); }
    }

    public void Resize(string sessionId, uint cols, uint rows)
    {
        if (_sessions.TryGetValue(sessionId, out var s) && s.Shell != null)
        {
            // SSH.NET ShellStream doesn't expose resize on all platforms — best-effort noop
        }
    }

    public void Close(string sessionId)
    {
        if (!_sessions.TryRemove(sessionId, out var s)) return;
        try { s.Shell?.Close(); } catch { }
        try { if (s.Process is { HasExited: false } proc) proc.Kill(entireProcessTree: true); } catch { }
    }

    public void Dispose()
    {
        foreach (var id in _sessions.Keys.ToList()) Close(id);
    }

    private sealed class TerminalSession
    {
        public string Id { get; set; } = "";
        public string HostId { get; set; } = "";
        public bool IsLocal { get; set; }
        public ShellStream? Shell { get; set; }
        public System.Diagnostics.Process? Process { get; set; }
    }
}
