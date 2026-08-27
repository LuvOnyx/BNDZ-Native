using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SIPSorcery.Net;

namespace BNDZ.Services.MeshDrop;

/// <summary>Zero-trust P2P file transfer via WebRTC data channels (LAN / relay signaling).</summary>
public sealed class MeshDropService : IDisposable
{
    private static readonly string[] DefaultStunServers = ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"];

    private readonly FileTransferQueueService _queue;
    private readonly ConcurrentDictionary<string, MeshDropSession> _sessions = new();
    private readonly ConcurrentDictionary<string, PeerContext> _peers = new();
    private readonly ConcurrentDictionary<string, MeshDropLanBeacon> _lanBeacons = new();
    private readonly object _lock = new();
    private Action<object>? _sessionChanged;
    private string[] _stunServers = DefaultStunServers;
    private bool _lanDiscoveryEnabled = true;
    private string? _turnUrl;
    private string? _turnUsername;
    private string? _turnCredential;

    public MeshDropService(FileTransferQueueService queue) => _queue = queue;

    public void SetConfig(string[]? stunServers, bool lanDiscovery, string? turnUrl = null, string? turnUsername = null, string? turnCredential = null)
    {
        _stunServers = stunServers?.Length > 0 ? stunServers : DefaultStunServers;
        _lanDiscoveryEnabled = lanDiscovery;
        _turnUrl = string.IsNullOrWhiteSpace(turnUrl) ? null : turnUrl.Trim();
        _turnUsername = string.IsNullOrWhiteSpace(turnUsername) ? null : turnUsername;
        _turnCredential = string.IsNullOrWhiteSpace(turnCredential) ? null : turnCredential;
    }

    public void SetSessionChangedHandler(Action<object>? handler) => _sessionChanged = handler;

    public IReadOnlyList<MeshDropSession> ListSessions()
        => _sessions.Values.OrderByDescending(s => s.CreatedUtc).ToList();

    public MeshDropSession? GetSession(string sessionId)
        => _sessions.TryGetValue(sessionId, out var s) ? s : null;

    /// <summary>Host: create offer mesh code for selected paths.</summary>
    public async Task<(string sessionId, string meshCode, MeshDropSession session)> CreateOfferAsync(
        IReadOnlyList<string> paths,
        string? label = null,
        CancellationToken ct = default)
    {
        var sessionId = Guid.NewGuid().ToString("N")[..12];
        var manifest = BuildManifest(sessionId, paths);
        var session = new MeshDropSession
        {
            SessionId = sessionId,
            Role = MeshDropSessionRole.Host,
            State = MeshDropSessionState.WaitingForAnswer,
            Label = label ?? $"{manifest.Files.Count(f => !f.IsDirectory)} items",
            FileCount = manifest.Files.Count(f => !f.IsDirectory),
            TotalBytes = manifest.TotalBytes,
        };
        _sessions[sessionId] = session;

        var ctx = new PeerContext { SessionId = sessionId, Role = MeshDropSessionRole.Host, Manifest = manifest };
        _peers[sessionId] = ctx;

        var pc = CreatePeerConnection(ctx);
        ctx.PeerConnection = pc;
        var dc = await pc.createDataChannel("meshdrop", new RTCDataChannelInit { ordered = true });
        WireDataChannel(ctx, dc);

        var offer = pc.createOffer();
        await pc.setLocalDescription(offer);
        await WaitForIceGatheringAsync(pc, ct);

        var sdp = pc.localDescription?.sdp?.ToString() ?? "";
        var cred = MeshDropCredentialVault.CreateEphemeral(sessionId);
        var offerPayload = new MeshDropSignaling.OfferPayload
        {
            SessionId = sessionId,
            HostName = Environment.MachineName,
            Sdp = sdp,
            Fingerprint = MeshDropSignaling.ComputeFingerprint(sdp),
            HostKeyFingerprint = cred.Fingerprint,
            OneTimeToken = cred.OneTimeToken,
            ExpiresUtc = DateTimeOffset.UtcNow.AddHours(24).ToUnixTimeMilliseconds(),
            FileCount = session.FileCount,
            TotalBytes = session.TotalBytes,
            Label = session.Label ?? "",
        };
        var meshCode = MeshDropSignaling.EncodeOffer(offerPayload);

        if (_lanDiscoveryEnabled)
            StartLanBeacon(sessionId, meshCode, session.Label ?? "BNDZ Mesh Drop");

        NotifySessionChanged(session);
        return (sessionId, meshCode, session);
    }

    /// <summary>Receiver: accept offer mesh code, return answer mesh code.</summary>
    public async Task<(string sessionId, string answerCode, MeshDropSession session)> AcceptOfferAsync(
        string meshCode,
        string destDir,
        CancellationToken ct = default)
    {
        var offer = MeshDropSignaling.DecodeOffer(meshCode)
            ?? throw new InvalidOperationException("Invalid Mesh Code");

        if (offer.ExpiresUtc > 0 && DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() > offer.ExpiresUtc)
            throw new InvalidOperationException("Mesh Code expired");

        var sessionId = offer.SessionId;
        var session = new MeshDropSession
        {
            SessionId = sessionId,
            Role = MeshDropSessionRole.Receiver,
            State = MeshDropSessionState.Connecting,
            Label = offer.Label,
            PeerLabel = offer.HostName,
            FileCount = offer.FileCount,
            TotalBytes = offer.TotalBytes,
        };
        _sessions[sessionId] = session;

        var ctx = new PeerContext
        {
            SessionId = sessionId,
            Role = MeshDropSessionRole.Receiver,
            DestDir = destDir,
        };
        _peers[sessionId] = ctx;

        var pc = CreatePeerConnection(ctx);
        ctx.PeerConnection = pc;
        pc.ondatachannel += dc => WireDataChannel(ctx, dc);

        var remoteInit = new RTCSessionDescriptionInit { type = RTCSdpType.offer, sdp = offer.Sdp };
        pc.setRemoteDescription(remoteInit);
        var answer = pc.createAnswer();
        await pc.setLocalDescription(answer);
        await WaitForIceGatheringAsync(pc, ct);

        var answerSdp = pc.localDescription?.sdp?.ToString() ?? "";
        var answerPayload = new MeshDropSignaling.AnswerPayload
        {
            SessionId = sessionId,
            ReceiverName = Environment.MachineName,
            Sdp = answerSdp,
            Fingerprint = MeshDropSignaling.ComputeFingerprint(answerSdp),
            OneTimeToken = offer.OneTimeToken,
        };
        var answerCode = MeshDropSignaling.EncodeAnswer(answerPayload);

        NotifySessionChanged(session);
        return (sessionId, answerCode, session);
    }

    /// <summary>Host: finalize connection with answer mesh code.</summary>
    public Task ConnectWithAnswerAsync(string sessionId, string answerCode, CancellationToken ct = default)
    {
        _ = ct;
        if (!_peers.TryGetValue(sessionId, out var ctx) || ctx.PeerConnection == null)
            throw new InvalidOperationException("Session not found");

        var answer = MeshDropSignaling.DecodeAnswer(answerCode)
            ?? throw new InvalidOperationException("Invalid answer code");

        // Prefer vault-backed one-time token when present (local host session).
        var hostCred = MeshDropCredentialVault.Get(sessionId);
        if (hostCred != null)
        {
            if (!MeshDropCredentialVault.TryConsumeToken(sessionId, answer.OneTimeToken))
                throw new InvalidOperationException("Mesh Drop pairing token invalid or already used.");
        }

        var remoteInit = new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = answer.Sdp };
        ctx.PeerConnection.setRemoteDescription(remoteInit);

        if (_sessions.TryGetValue(sessionId, out var session))
        {
            session.State = MeshDropSessionState.Connecting;
            session.PeerLabel = answer.ReceiverName;
            NotifySessionChanged(session);
        }

        return Task.CompletedTask;
    }

    /// <summary>Start sending files (host only, after connected).</summary>
    public async Task SendAsync(string sessionId, string operationId, CancellationToken ct = default)
    {
        if (!_peers.TryGetValue(sessionId, out var ctx) || ctx.Manifest == null)
            throw new InvalidOperationException("Session not ready");

        var session = _sessions[sessionId];
        session.State = MeshDropSessionState.Transferring;
        NotifySessionChanged(session);

        _queue.RegisterJob(operationId, "mesh-drop-send", session.Label ?? "Mesh Drop", "webrtc",
            ctx.Manifest.Files.Count(f => !f.IsDirectory), "mesh-drop", FileTransferPriority.High);

        var sw = Stopwatch.StartNew();
        long transferred = 0;
        int completed = 0;
        var files = ctx.Manifest.Files.Where(f => !f.IsDirectory).ToList();

        try
        {
            await SendFrameAsync(ctx, MeshDropProtocol.BuildManifestFrame(ctx.Manifest), ct);

            foreach (var file in files)
            {
                ct.ThrowIfCancellationRequested();
                var fullPath = file.RelativePath;
                if (ctx.SourcePaths != null)
                {
                    var match = ctx.SourcePaths.FirstOrDefault(p =>
                        string.Equals(Path.GetFileName(p), Path.GetFileName(file.RelativePath), StringComparison.OrdinalIgnoreCase)
                        || p.EndsWith(file.RelativePath.Replace('/', Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase));
                    if (!string.IsNullOrEmpty(match)) fullPath = match;
                }

                if (!File.Exists(fullPath))
                {
                    var resolved = ResolveSourcePath(ctx, file.RelativePath);
                    if (resolved != null) fullPath = resolved;
                }
                if (!File.Exists(fullPath)) continue;

                await using var fs = File.OpenRead(fullPath);
                var chunkIndex = 0;
                var buffer = new byte[MeshDropProtocol.ChunkSize];
                int read;
                while ((read = await fs.ReadAsync(buffer, ct)) > 0)
                {
                    await SendFrameAsync(ctx, MeshDropProtocol.BuildChunkFrame(file.RelativePath, chunkIndex++, buffer.AsSpan(0, read).ToArray()), ct);
                    transferred += read;
                    var speed = sw.Elapsed.TotalSeconds > 0.1 ? transferred / sw.Elapsed.TotalSeconds : 0;
                    session.TransferredBytes = transferred;
                    session.SpeedBytesPerSecond = speed;
                    session.FilesCompleted = completed;
                    var pct = session.TotalBytes > 0 ? (int)Math.Clamp(transferred * 100 / session.TotalBytes, 0, 99) : 0;
                    _queue.UpdateProgress(operationId, pct, file.RelativePath, completed, files.Count, transferred, session.TotalBytes, speed);
                    NotifySessionChanged(session);
                }
                completed++;
            }

            await SendFrameAsync(ctx, MeshDropProtocol.BuildCompleteFrame(), ct);
            session.State = MeshDropSessionState.Completed;
            session.FilesCompleted = completed;
            session.CompletedUtc = DateTime.UtcNow;
            _queue.MarkCompleted(operationId, "sha256", "verified");
            NotifySessionChanged(session);
        }
        catch (OperationCanceledException)
        {
            _queue.MarkCancelled(operationId);
            session.State = MeshDropSessionState.Cancelled;
            NotifySessionChanged(session);
            throw;
        }
        catch (Exception ex)
        {
            _queue.MarkFailed(operationId, ex.Message);
            session.State = MeshDropSessionState.Failed;
            session.Error = ex.Message;
            NotifySessionChanged(session);
            throw;
        }
    }

    public void Cancel(string sessionId)
    {
        StopLanBeacon(sessionId);
        if (_peers.TryRemove(sessionId, out var ctx))
        {
            ctx.PeerConnection?.close();
            ctx.PeerConnection?.Dispose();
        }
        if (_sessions.TryGetValue(sessionId, out var session))
        {
            session.State = MeshDropSessionState.Cancelled;
            NotifySessionChanged(session);
        }
    }

    public Task<IReadOnlyList<MeshDropLanPeer>> DiscoverLanAsync(CancellationToken ct = default)
    {
        if (!_lanDiscoveryEnabled) return Task.FromResult<IReadOnlyList<MeshDropLanPeer>>(Array.Empty<MeshDropLanPeer>());
        return MeshDropLanBeacon.DiscoverAsync(TimeSpan.FromSeconds(3), ct);
    }

    public Task<string?> FetchLanOfferAsync(string address, int port, CancellationToken ct = default)
        => MeshDropLanBeacon.FetchOfferMeshCodeAsync(address, port, ct);

    public async Task<MeshDropSignalingRelay.RelayRoom?> CreateRelayRoomAsync(string relayBaseUrl, string meshCode, string? label = null, CancellationToken ct = default)
        => await MeshDropSignalingRelay.CreateHostRoomAsync(relayBaseUrl, meshCode, label, ct).ConfigureAwait(false);

    public Task<string?> PollRelayAnswerAsync(string pollUrl, CancellationToken ct = default)
        => MeshDropSignalingRelay.PollAnswerAsync(pollUrl, ct);

    public Task<bool> SubmitRelayAnswerAsync(string relayBaseUrl, string roomId, string answerCode, CancellationToken ct = default)
        => MeshDropSignalingRelay.SubmitAnswerAsync(relayBaseUrl, roomId, answerCode, ct);

    public Task<string?> ResolveRelayOfferAsync(string relayBaseUrl, string roomId, CancellationToken ct = default)
        => MeshDropSignalingRelay.ResolveRoomOfferAsync(relayBaseUrl, roomId, ct);

    private void StartLanBeacon(string sessionId, string meshCode, string label)
    {
        StopLanBeacon(sessionId);
        var beacon = new MeshDropLanBeacon();
        beacon.Start(sessionId, meshCode, label);
        _lanBeacons[sessionId] = beacon;
    }

    private void StopLanBeacon(string sessionId)
    {
        if (_lanBeacons.TryRemove(sessionId, out var beacon))
            beacon.Dispose();
    }

    private RTCPeerConnection CreatePeerConnection(PeerContext ctx)
    {
        var servers = _stunServers.Select(s => new RTCIceServer { urls = s }).ToList();
        if (!string.IsNullOrWhiteSpace(_turnUrl))
        {
            servers.Add(new RTCIceServer
            {
                urls = _turnUrl!,
                username = _turnUsername,
                credential = _turnCredential,
            });
        }
        var config = new RTCConfiguration
        {
            iceServers = servers,
        };
        var pc = new RTCPeerConnection(config);
        pc.onconnectionstatechange += state =>
        {
            if (state == RTCPeerConnectionState.connected && _sessions.TryGetValue(ctx.SessionId, out var s))
            {
                s.State = MeshDropSessionState.Connected;
                NotifySessionChanged(s);
            }
            else if (state == RTCPeerConnectionState.failed && _sessions.TryGetValue(ctx.SessionId, out var s2))
            {
                s2.State = MeshDropSessionState.Failed;
                s2.Error = "WebRTC connection failed";
                NotifySessionChanged(s2);
            }
        };
        return pc;
    }

    private void WireDataChannel(PeerContext ctx, RTCDataChannel dc)
    {
        ctx.DataChannel = dc;
        var recvBuffer = new List<byte>();

        dc.onopen += () =>
        {
            if (_sessions.TryGetValue(ctx.SessionId, out var s))
            {
                s.State = MeshDropSessionState.Connected;
                NotifySessionChanged(s);
            }
        };

        dc.onmessage += (_, _, data) =>
        {
            recvBuffer.AddRange(data);
            ProcessReceiveBuffer(ctx, recvBuffer);
        };
    }

    private void ProcessReceiveBuffer(PeerContext ctx, List<byte> buffer)
    {
        while (buffer.Count >= 8)
        {
            if (!MeshDropProtocol.TryParseFrame(buffer.ToArray(), out var type, out var payload, out var consumed))
                break;
            buffer.RemoveRange(0, consumed);
            HandleFrame(ctx, type, payload);
        }
    }

    private void HandleFrame(PeerContext ctx, string type, byte[] payload)
    {
        switch (type)
        {
            case MeshDropProtocol.ManifestType:
                var manifest = JsonSerializer.Deserialize<MeshDropManifest>(payload,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                if (manifest != null) ctx.Manifest = manifest;
                break;
            case MeshDropProtocol.ChunkType:
                HandleChunk(ctx, payload);
                break;
            case MeshDropProtocol.CompleteType:
                // Flush and close all receive streams for this session so files are fully written.
                foreach (var kv in _recvStreams.ToArray())
                {
                    try
                    {
                        if (kv.Key.Contains(ctx.SessionId, StringComparison.OrdinalIgnoreCase)
                            || (ctx.DestDir != null && kv.Key.StartsWith(ctx.DestDir, StringComparison.OrdinalIgnoreCase)))
                        {
                            kv.Value.Flush(true);
                            kv.Value.Dispose();
                            _recvStreams.TryRemove(kv.Key, out _);
                        }
                    }
                    catch { /* best-effort */ }
                }
                if (_sessions.TryGetValue(ctx.SessionId, out var s))
                {
                    s.State = MeshDropSessionState.Completed;
                    s.CompletedUtc = DateTime.UtcNow;
                    NotifySessionChanged(s);
                }
                break;
        }
    }

    private readonly ConcurrentDictionary<string, FileStream> _recvStreams = new();

    private void HandleChunk(PeerContext ctx, byte[] payload)
    {
        if (payload.Length < 8) return;
        var pathLen = BitConverter.ToInt32(payload, 0);
        if (pathLen <= 0 || payload.Length < 4 + pathLen + 4) return;
        var relPath = Encoding.UTF8.GetString(payload, 4, pathLen);
        var chunkIndex = BitConverter.ToInt32(payload, 4 + pathLen);
        var data = payload.AsSpan(4 + pathLen + 4).ToArray();

        var destDir = ctx.DestDir ?? Path.Combine(Path.GetTempPath(), "BNDZ", "MeshDrop", ctx.SessionId);
        Directory.CreateDirectory(destDir);
        var destFile = Path.Combine(destDir, relPath.Replace('/', Path.DirectorySeparatorChar));
        var destFileDir = Path.GetDirectoryName(destFile);
        if (!string.IsNullOrEmpty(destFileDir)) Directory.CreateDirectory(destFileDir);

        var streamKey = destFile;
        var fs = _recvStreams.GetOrAdd(streamKey, _ => new FileStream(destFile, FileMode.Create, FileAccess.Write, FileShare.Read));
        if (data.Length > 0)
        {
            // Chunks arrive in order for MeshDrop; write bytes so receive is not an empty stub.
            fs.Write(data, 0, data.Length);
            fs.Flush(false);
        }

        if (_sessions.TryGetValue(ctx.SessionId, out var session))
        {
            session.TransferredBytes += data.Length;
            session.State = MeshDropSessionState.Transferring;
            NotifySessionChanged(session);
        }
    }

    private async Task SendFrameAsync(PeerContext ctx, byte[] frame, CancellationToken ct)
    {
        if (ctx.DataChannel?.readyState == RTCDataChannelState.open)
        {
            ctx.DataChannel.send(frame);
            return;
        }
        await Task.Delay(50, ct);
        if (ctx.DataChannel?.readyState == RTCDataChannelState.open)
            ctx.DataChannel.send(frame);
    }

    private static async Task WaitForIceGatheringAsync(RTCPeerConnection pc, CancellationToken ct)
    {
        if (pc.iceGatheringState == RTCIceGatheringState.complete) return;
        var tcs = new TaskCompletionSource();
        void Handler(RTCIceGatheringState state)
        {
            if (state == RTCIceGatheringState.complete) tcs.TrySetResult();
        }
        pc.onicegatheringstatechange += Handler;
        try
        {
            using var reg = ct.Register(() => tcs.TrySetCanceled());
            await Task.WhenAny(tcs.Task, Task.Delay(5000, ct));
        }
        finally
        {
            pc.onicegatheringstatechange -= Handler;
        }
    }

    private MeshDropManifest BuildManifest(string sessionId, IReadOnlyList<string> paths)
    {
        var files = new List<MeshDropFileEntry>();
        var sourcePaths = new List<string>();

        foreach (var path in paths)
        {
            if (!File.Exists(path) && !Directory.Exists(path)) continue;
            sourcePaths.Add(Path.GetFullPath(path));

            if (File.Exists(path))
            {
                var fi = new FileInfo(path);
                files.Add(new MeshDropFileEntry
                {
                    RelativePath = fi.Name,
                    Size = fi.Length,
                    Sha256 = MeshDropProtocol.ComputeSha256(path),
                });
            }
            else
            {
                CollectDirectory(path, Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)) ?? "folder", files);
            }
        }

        if (_peers.TryGetValue(sessionId, out var ctx))
            ctx.SourcePaths = sourcePaths;

        return new MeshDropManifest
        {
            SessionId = sessionId,
            HostName = Environment.MachineName,
            Files = files,
        };
    }

    private static void CollectDirectory(string root, string prefix, List<MeshDropFileEntry> files)
    {
        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            var rel = Path.Combine(prefix, Path.GetRelativePath(root, file)).Replace('\\', '/');
            var fi = new FileInfo(file);
            files.Add(new MeshDropFileEntry
            {
                RelativePath = rel,
                Size = fi.Length,
                Sha256 = MeshDropProtocol.ComputeSha256(file),
            });
        }
    }

    private static string? ResolveSourcePath(PeerContext ctx, string relativePath)
    {
        if (ctx.SourcePaths == null) return null;
        foreach (var root in ctx.SourcePaths)
        {
            if (File.Exists(root)) continue;
            var candidate = Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    private static int FindFreePort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private void NotifySessionChanged(MeshDropSession session)
        => _sessionChanged?.Invoke(new { type = "MESH_DROP_SESSION_CHANGED", payload = session.ToDto() });

    public void Dispose()
    {
        foreach (var beacon in _lanBeacons.Values) beacon.Dispose();
        _lanBeacons.Clear();
        foreach (var ctx in _peers.Values)
        {
            ctx.DataChannel?.close();
            ctx.PeerConnection?.close();
            ctx.PeerConnection?.Dispose();
            ctx.LanRegistration?.Dispose();
        }
        foreach (var fs in _recvStreams.Values) fs.Dispose();
        _recvStreams.Clear();
        _peers.Clear();
    }

    private sealed class PeerContext
    {
        public required string SessionId { get; init; }
        public MeshDropSessionRole Role { get; init; }
        public MeshDropManifest? Manifest { get; set; }
        public List<string>? SourcePaths { get; set; }
        public string? DestDir { get; init; }
        public RTCPeerConnection? PeerConnection { get; set; }
        public RTCDataChannel? DataChannel { get; set; }
        public IDisposable? LanRegistration { get; set; }
    }
}
