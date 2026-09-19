using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Threading;
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
        shell.DataReceived += (_, e) => EmitOrBuffer(session, Convert.ToBase64String(e.Data));
        _sessions[id] = session;
        EmitOrBuffer(session, Convert.ToBase64String(Encoding.UTF8.GetBytes(
            $"\r\nBNDZ SSH — {host.Alias ?? host.Hostname ?? hostId}\r\n\r\n")));
        ArmAttachTimeout(session);
        TermLog($"OpenSsh id={id} host={hostId} cwd={cwd ?? ""}");
        return new MeshTerminalSessionInfo { Id = id, HostId = hostId, RemoteCwd = cwd, IsLocal = false, Embedded = false, ExternalOs = false };
    }

    /// <summary>
    /// Local PowerShell via ConPTY → xterm.js (VS Code / node-pty model).
    /// Critical for BNDZShell: MESH_TERMINAL_OPEN_RESULT travels the proven Invoke/response
    /// channel; background PushWebMessage can drop ConPTY frames under WinUI STA pressure.
    /// So we capture the first paint into BootstrapOutputBase64 on that channel, then stream.
    /// </summary>
    public MeshTerminalSessionInfo OpenLocal(string? cwd, uint cols = 120, uint rows = 32)
    {
        var id = Guid.NewGuid().ToString("N")[..12];
        var workDir = ResolveLocalWorkingDirectory(cwd);
        var session = new TerminalSession
        {
            Id = id,
            HostId = "",
            IsLocal = true,
            PendingCwd = workDir,
        };
        _sessions[id] = session;

        var bootstrapGate = new object();
        var bootstrap = new MemoryStream();
        var live = 0; // 0 = collecting bootstrap, 1 = live stream to OnOutput

        BndzConPtyTerminal? pty = null;
        try
        {
            TermLog($"OpenLocal id={id} cwd={workDir} cols={cols} rows={rows}");
            // Banner first — guaranteed visible once FE writes bootstrap from OPEN_RESULT.
            var banner = Encoding.UTF8.GetBytes($"\r\nBNDZ Local PowerShell — {workDir}\r\n\r\n");
            lock (bootstrapGate) { bootstrap.Write(banner, 0, banner.Length); }

            pty = BndzConPtyTerminal.Start(
                workDir,
                cols,
                rows,
                onData: data =>
                {
                    try
                    {
                        if (Volatile.Read(ref live) == 0)
                        {
                            lock (bootstrapGate) { bootstrap.Write(data, 0, data.Length); }
                            if (Interlocked.Increment(ref session.DataLogCount) <= 12)
                                TermLog($"boot id={id} bytes={data.Length} total={bootstrap.Length}");
                            return;
                        }
                        if (Interlocked.Increment(ref session.DataLogCount) <= 24)
                            TermLog($"onData id={id} bytes={data.Length}");
                        EmitLive(session, Convert.ToBase64String(data));
                    }
                    catch (Exception ex)
                    {
                        TermLog($"onData error id={id}: {ex.Message}");
                    }
                },
                onExit: code =>
                {
                    TermLog($"onExit id={id} code={code}");
                    try { OnExit?.Invoke(id, code); }
                    catch { /* ignore */ }
                });
        }
        catch (Exception ex)
        {
            TermLog($"OpenLocal FAILED id={id}: {ex}");
            _sessions.TryRemove(id, out _);
            pty?.Dispose();
            throw;
        }

        session.LocalPty = pty;

        // Wait for ConPTY's first real frame (DA + clear + prompt). Smoke tests show ~100–300ms.
        var sw = Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < 400)
        {
            int len;
            lock (bootstrapGate) { len = (int)bootstrap.Length; }
            // Banner (~40+) plus VT/prompt (~80+) — enough to paint something visible.
            if (len >= 120) break;
            Thread.Sleep(15);
        }

        byte[] bootBytes;
        lock (bootstrapGate)
        {
            bootBytes = bootstrap.ToArray();
            Volatile.Write(ref live, 1);
            session.ClientAttached = true;
        }

        var bootB64 = bootBytes.Length > 0 ? Convert.ToBase64String(bootBytes) : null;
        TermLog($"OpenLocal bootstrap id={id} bytes={bootBytes.Length} elapsedMs={sw.ElapsedMilliseconds} handlers={(OnOutput == null ? 0 : 1)}");

        // Also push bootstrap on the live channel (best-effort) for listeners already attached.
        if (!string.IsNullOrEmpty(bootB64))
            EmitLive(session, bootB64);

        return new MeshTerminalSessionInfo
        {
            Id = id,
            HostId = "",
            RemoteCwd = workDir,
            IsLocal = true,
            Embedded = false,
            ExternalOs = false,
            BootstrapOutputBase64 = bootB64,
        };
    }

    public void Acknowledge(string sessionId)
    {
        if (!_sessions.TryGetValue(sessionId, out var s)) return;
        TermLog($"ACK id={sessionId} buffered={s.OutputBuffer.Count} attached={s.ClientAttached}");
        FlushBuffer(s);
    }

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
        FlushBuffer(s);
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
        FlushBuffer(s);
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
        TermLog($"Close id={sessionId}");
        try { s.AttachTimeoutCts?.Cancel(); } catch { }
        try { s.Shell?.Close(); } catch { }
        try { s.LocalPty?.Dispose(); } catch { }
    }

    public void Dispose()
    {
        foreach (var id in _sessions.Keys.ToList()) Close(id);
    }

    private void EmitLive(TerminalSession session, string b64)
    {
        if (string.IsNullOrEmpty(b64)) return;
        try
        {
            OnOutput?.Invoke(session.Id, b64);
        }
        catch (Exception ex)
        {
            TermLog($"OnOutput error id={session.Id}: {ex.Message}");
        }
    }

    private void EmitOrBuffer(TerminalSession session, string b64)
    {
        if (string.IsNullOrEmpty(b64)) return;
        if (session.ClientAttached)
        {
            EmitLive(session, b64);
            return;
        }
        lock (session.BufferGate)
        {
            if (session.ClientAttached)
            {
                EmitLive(session, b64);
                return;
            }
            session.OutputBuffer.Add(b64);
            while (session.OutputBuffer.Count > 800)
                session.OutputBuffer.RemoveAt(0);
        }
    }

    private void FlushBuffer(TerminalSession session)
    {
        List<string>? pending = null;
        lock (session.BufferGate)
        {
            if (session.ClientAttached && session.OutputBuffer.Count == 0) return;
            session.ClientAttached = true;
            if (session.OutputBuffer.Count > 0)
            {
                pending = new List<string>(session.OutputBuffer);
                session.OutputBuffer.Clear();
            }
        }
        try { session.AttachTimeoutCts?.Cancel(); } catch { }
        if (pending == null) return;
        TermLog($"FlushBuffer id={session.Id} chunks={pending.Count}");
        foreach (var chunk in pending)
            EmitLive(session, chunk);
    }

    private void ArmAttachTimeout(TerminalSession session)
    {
        session.AttachTimeoutCts = new CancellationTokenSource();
        var token = session.AttachTimeoutCts.Token;
        _ = Task.Run(async () =>
        {
            try
            {
                await Task.Delay(1500, token).ConfigureAwait(false);
                if (!token.IsCancellationRequested)
                    FlushBuffer(session);
            }
            catch (OperationCanceledException) { /* expected */ }
        }, token);
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

    private static void TermLog(string message)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BNDZ");
            Directory.CreateDirectory(dir);
            File.AppendAllText(
                Path.Combine(dir, "terminal.log"),
                $"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}");
        }
        catch { /* best-effort */ }
    }

    private sealed class TerminalSession
    {
        public string Id { get; set; } = "";
        public string HostId { get; set; } = "";
        public bool IsLocal { get; set; }
        public string? PendingCwd { get; set; }
        public ShellStream? Shell { get; set; }
        public BndzConPtyTerminal? LocalPty { get; set; }
        public readonly object BufferGate = new();
        public readonly List<string> OutputBuffer = new();
        public bool ClientAttached;
        public CancellationTokenSource? AttachTimeoutCts;
        public int DataLogCount;
    }
}
