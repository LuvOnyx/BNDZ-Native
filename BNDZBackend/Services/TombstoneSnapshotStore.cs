using System.Collections.Concurrent;
using System.Text.Json;

namespace BNDZ.Services;

/// <summary>
/// Snapshot list entries before destructive FS ops so failed move/delete can restore the listing instantly.
/// </summary>
public sealed class TombstoneSnapshotStore
{
    private static readonly Lazy<TombstoneSnapshotStore> Lazy = new(() => new TombstoneSnapshotStore());
    public static TombstoneSnapshotStore Instance => Lazy.Value;

    private readonly ConcurrentDictionary<string, TombstoneSnapshot> _byOp =
        new(StringComparer.OrdinalIgnoreCase);

    private readonly string _persistDir;

    private TombstoneSnapshotStore()
    {
        _persistDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Tombstones");
        Directory.CreateDirectory(_persistDir);
    }

    public sealed class TombstoneEntry
    {
        public string Path { get; set; } = "";
        public string Name { get; set; } = "";
        public string Type { get; set; } = "file";
        public long Size { get; set; }
        public string? Extension { get; set; }
        public string? ParentPath { get; set; }
        public string? Modified { get; set; }
    }

    public sealed class TombstoneSnapshot
    {
        public string OpId { get; set; } = "";
        public string Kind { get; set; } = ""; // delete | move | rename
        public DateTimeOffset CreatedUtc { get; set; } = DateTimeOffset.UtcNow;
        public List<TombstoneEntry> Entries { get; set; } = new();
    }

    public void Snapshot(string opId, string kind, IEnumerable<TombstoneEntry> entries)
    {
        if (string.IsNullOrWhiteSpace(opId)) return;
        var snap = new TombstoneSnapshot
        {
            OpId = opId,
            Kind = kind ?? "",
            Entries = entries?.Where(e => !string.IsNullOrWhiteSpace(e.Path)).ToList() ?? new(),
        };
        _byOp[opId] = snap;
        try
        {
            var file = Path.Combine(_persistDir, Sanitize(opId) + ".json");
            File.WriteAllText(file, JsonSerializer.Serialize(snap));
        }
        catch { /* best-effort */ }
    }

    public TombstoneSnapshot? Get(string opId)
    {
        if (string.IsNullOrWhiteSpace(opId)) return null;
        if (_byOp.TryGetValue(opId, out var hit)) return hit;
        try
        {
            var file = Path.Combine(_persistDir, Sanitize(opId) + ".json");
            if (!File.Exists(file)) return null;
            var snap = JsonSerializer.Deserialize<TombstoneSnapshot>(File.ReadAllText(file));
            if (snap != null) _byOp[opId] = snap;
            return snap;
        }
        catch
        {
            return null;
        }
    }

    public bool Clear(string opId)
    {
        if (string.IsNullOrWhiteSpace(opId)) return false;
        _byOp.TryRemove(opId, out _);
        try
        {
            var file = Path.Combine(_persistDir, Sanitize(opId) + ".json");
            if (File.Exists(file)) File.Delete(file);
        }
        catch { /* ignore */ }
        return true;
    }

    /// <summary>Return snapshot entries for FE to reinject into the listing on op failure.</summary>
    public TombstoneSnapshot? RestoreOnFailure(string opId)
    {
        var snap = Get(opId);
        // Keep on disk briefly so a second FE refresh can still recover; clear memory after handoff.
        return snap;
    }

    private static string Sanitize(string id)
    {
        foreach (var c in Path.GetInvalidFileNameChars())
            id = id.Replace(c, '_');
        return id.Length > 96 ? id[..96] : id;
    }
}
