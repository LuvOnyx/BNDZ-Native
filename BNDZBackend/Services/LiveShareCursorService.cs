using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace BNDZ.Services;

/// <summary>
/// Broadcasts list selection / cursor path for mesh peers browsing a shared folder.
/// Uses a local JSON file per folder so peers on the same machine (or synced share) can read state.
/// </summary>
public sealed class LiveShareCursorService : IDisposable
{
    private static readonly Lazy<LiveShareCursorService> Lazy = new(() => new LiveShareCursorService());
    public static LiveShareCursorService Instance => Lazy.Value;

    private readonly string _rootDir;
    private readonly string _peerId;
    private readonly string _machineName;
    private readonly object _gate = new();
    private readonly Dictionary<string, LiveShareSession> _active = new(StringComparer.OrdinalIgnoreCase);
    private System.Threading.Timer? _heartbeatTimer;

    public LiveShareCursorService()
    {
        _rootDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "LiveShare");
        Directory.CreateDirectory(_rootDir);
        _machineName = Environment.MachineName;
        _peerId = $"{_machineName}-{Environment.UserName}-{Guid.NewGuid():N}".ToLowerInvariant();
        _heartbeatTimer = new System.Threading.Timer(HeartbeatTick, null, TimeSpan.FromSeconds(2), TimeSpan.FromSeconds(2));
    }

    public sealed class LiveShareSession
    {
        public string FolderPath { get; init; } = "";
        public string[] SelectionPaths { get; set; } = Array.Empty<string>();
        public string? CursorPath { get; set; }
        public string PeerId { get; init; } = "";
        public string MachineName { get; init; } = "";
        public DateTime UpdatedUtc { get; set; }
    }

    public sealed class LiveSharePeerState
    {
        public string PeerId { get; init; } = "";
        public string MachineName { get; init; } = "";
        public string FolderPath { get; init; } = "";
        public string[] SelectionPaths { get; init; } = Array.Empty<string>();
        public string? CursorPath { get; init; }
        public DateTime UpdatedUtc { get; init; }
    }

    public LiveShareSession Start(string folderWinPath)
    {
        var norm = Normalize(folderWinPath);
        lock (_gate)
        {
            var session = new LiveShareSession
            {
                FolderPath = norm,
                PeerId = _peerId,
                MachineName = _machineName,
                UpdatedUtc = DateTime.UtcNow,
            };
            _active[norm] = session;
            WriteStateFile(session);
            return session;
        }
    }

    public void Stop(string folderWinPath)
    {
        var norm = Normalize(folderWinPath);
        lock (_gate)
        {
            _active.Remove(norm);
            TryDeleteStateFile(norm);
        }
    }

    public void Update(string folderWinPath, string[]? selectionPaths, string? cursorPath)
    {
        var norm = Normalize(folderWinPath);
        lock (_gate)
        {
            if (!_active.TryGetValue(norm, out var session)) return;
            session.SelectionPaths = selectionPaths ?? Array.Empty<string>();
            session.CursorPath = cursorPath;
            session.UpdatedUtc = DateTime.UtcNow;
            WriteStateFile(session);
        }
    }

    public List<LiveSharePeerState> GetPeers(string folderWinPath)
    {
        var norm = Normalize(folderWinPath);
        var results = new List<LiveSharePeerState>();
        var staleCutoff = DateTime.UtcNow.AddSeconds(-12);

        try
        {
            foreach (var file in Directory.EnumerateFiles(_rootDir, "*.json"))
            {
                try
                {
                    var json = File.ReadAllText(file);
                    var state = JsonSerializer.Deserialize<LiveSharePeerStateDto>(json);
                    if (state == null || string.IsNullOrWhiteSpace(state.FolderPath)) continue;
                    if (!string.Equals(Normalize(state.FolderPath), norm, StringComparison.OrdinalIgnoreCase)) continue;
                    if (string.Equals(state.PeerId, _peerId, StringComparison.OrdinalIgnoreCase)) continue;
                    var updated = DateTime.TryParse(state.UpdatedUtc, out var dt) ? dt : DateTime.MinValue;
                    if (updated < staleCutoff) continue;
                    results.Add(new LiveSharePeerState
                    {
                        PeerId = state.PeerId ?? "",
                        MachineName = state.MachineName ?? "Peer",
                        FolderPath = state.FolderPath ?? "",
                        SelectionPaths = state.SelectionPaths ?? Array.Empty<string>(),
                        CursorPath = state.CursorPath,
                        UpdatedUtc = updated,
                    });
                }
                catch { /* skip corrupt */ }
            }
        }
        catch { }

        return results.OrderByDescending(p => p.UpdatedUtc).ToList();
    }

    public bool IsActive(string folderWinPath)
    {
        lock (_gate) return _active.ContainsKey(Normalize(folderWinPath));
    }

    public void Dispose()
    {
        _heartbeatTimer?.Dispose();
        _heartbeatTimer = null;
        lock (_gate)
        {
            foreach (var key in _active.Keys.ToList())
                TryDeleteStateFile(key);
            _active.Clear();
        }
    }

    private void HeartbeatTick(object? _)
    {
        lock (_gate)
        {
            foreach (var session in _active.Values)
            {
                session.UpdatedUtc = DateTime.UtcNow;
                WriteStateFile(session);
            }
        }
    }

    private void WriteStateFile(LiveShareSession session)
    {
        try
        {
            var hash = FolderHash(session.FolderPath);
            var path = Path.Combine(_rootDir, $"{hash}-{_peerId}.json");
            var dto = new LiveSharePeerStateDto
            {
                PeerId = session.PeerId,
                MachineName = session.MachineName,
                FolderPath = session.FolderPath,
                SelectionPaths = session.SelectionPaths,
                CursorPath = session.CursorPath,
                UpdatedUtc = session.UpdatedUtc.ToString("O"),
            };
            File.WriteAllText(path, JsonSerializer.Serialize(dto));
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[LiveShare] Write failed: {ex.Message}");
        }
    }

    private void TryDeleteStateFile(string folderPath)
    {
        try
        {
            var hash = FolderHash(folderPath);
            var mine = Path.Combine(_rootDir, $"{hash}-{_peerId}.json");
            if (File.Exists(mine)) File.Delete(mine);
        }
        catch { }
    }

    private static string FolderHash(string folderPath)
    {
        var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(Normalize(folderPath).ToLowerInvariant()));
        return Convert.ToHexString(bytes)[..16].ToLowerInvariant();
    }

    private static string Normalize(string p)
    {
        try { return Path.GetFullPath(p).TrimEnd('\\'); }
        catch { return p.Replace('/', '\\').TrimEnd('\\'); }
    }

    private sealed class LiveSharePeerStateDto
    {
        public string? PeerId { get; set; }
        public string? MachineName { get; set; }
        public string? FolderPath { get; set; }
        public string[]? SelectionPaths { get; set; }
        public string? CursorPath { get; set; }
        public string? UpdatedUtc { get; set; }
    }
}
