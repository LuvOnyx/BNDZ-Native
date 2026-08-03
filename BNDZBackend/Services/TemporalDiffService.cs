using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BNDZ.Services;

/// <summary>
/// Folder temporal diff — lightweight snapshots vs N minutes ago (mtime/size fingerprints).
/// API matches MainWindow IPC + BndzTemporalDiffView.
/// </summary>
public sealed class TemporalDiffService
{
    private static readonly Lazy<TemporalDiffService> Lazy = new(() => new TemporalDiffService());
    public static TemporalDiffService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = false,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string _root;
    private readonly object _lock = new();

    private TemporalDiffService()
    {
        _root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "TemporalDiff");
        Directory.CreateDirectory(_root);
    }

    /// <summary>Take a checkpoint; returns snapshot id.</summary>
    public string TakeSnapshot(string folderPath)
    {
        var norm = Normalize(folderPath);
        if (!Directory.Exists(norm))
            throw new DirectoryNotFoundException(norm);

        var entries = ScanFolder(norm);
        var snap = new TemporalSnapshot
        {
            Id = Guid.NewGuid().ToString("N")[..12],
            FolderPath = norm,
            TakenUtc = DateTime.UtcNow,
            Source = "checkpoint",
            Entries = entries,
        };

        lock (_lock)
        {
            var path = SnapshotFilePath(norm, snap.Id);
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, JsonSerializer.Serialize(snap, Json));
            PruneOld(norm, keep: 48);
        }

        return snap.Id;
    }

    public object Compare(string folderPath, int minutesAgo, string? checkpointId = null)
    {
        var norm = Normalize(folderPath);
        if (!Directory.Exists(norm))
            throw new DirectoryNotFoundException(norm);

        minutesAgo = Math.Clamp(minutesAgo, 1, 60 * 24 * 14);
        TemporalSnapshot? baseline = null;

        if (!string.IsNullOrWhiteSpace(checkpointId))
            baseline = LoadById(norm, checkpointId!);

        if (baseline == null)
        {
            var targetUtc = DateTime.UtcNow.AddMinutes(-minutesAgo);
            baseline = FindNearestSnapshot(norm, targetUtc);
        }

        if (baseline == null)
        {
            // Seed a baseline so subsequent compares work; first compare = empty → all added.
            var id = TakeSnapshot(norm);
            baseline = LoadById(norm, id) ?? new TemporalSnapshot
            {
                Id = id,
                FolderPath = norm,
                TakenUtc = DateTime.UtcNow,
                Source = "auto",
                Entries = [],
            };
            // Re-scan so "now" is after the seed snapshot for meaningful next call;
            // for this call treat baseline as empty for wow "everything new" first scrub.
            baseline = new TemporalSnapshot
            {
                Id = baseline.Id,
                FolderPath = norm,
                TakenUtc = DateTime.UtcNow.AddMinutes(-minutesAgo),
                Source = "auto-seed",
                Entries = [],
            };
        }

        var now = ScanFolder(norm);
        var before = baseline.Entries.ToDictionary(e => e.RelPath, StringComparer.OrdinalIgnoreCase);
        var after = now.ToDictionary(e => e.RelPath, StringComparer.OrdinalIgnoreCase);

        var added = new List<object>();
        var removed = new List<object>();
        var modified = new List<object>();

        foreach (var (rel, cur) in after)
        {
            if (!before.TryGetValue(rel, out var old))
            {
                added.Add(ToDto(cur));
                continue;
            }
            if (old.Size != cur.Size || old.LastWriteUtcTicks != cur.LastWriteUtcTicks || old.IsDirectory != cur.IsDirectory)
                modified.Add(ToDto(cur, old));
        }

        foreach (var (rel, old) in before)
        {
            if (!after.ContainsKey(rel))
                removed.Add(ToDto(old));
        }

        return new
        {
            rootPath = norm,
            snapshotId = baseline.Id,
            snapshotUtc = baseline.TakenUtc.ToString("o"),
            snapshotSource = baseline.Source,
            minutesAgo,
            usedUsn = false,
            added,
            removed,
            modified,
        };
    }

    public List<object> ListSnapshots(string folderPath, int limit = 20)
    {
        var norm = Normalize(folderPath);
        var dir = FolderDir(norm);
        if (!Directory.Exists(dir))
            return [];

        limit = Math.Clamp(limit, 1, 100);
        return Directory.GetFiles(dir, "*.json")
            .Select(f =>
            {
                try
                {
                    var s = JsonSerializer.Deserialize<TemporalSnapshot>(File.ReadAllText(f), Json);
                    if (s == null) return null;
                    return (object)new
                    {
                        id = s.Id,
                        takenUtc = s.TakenUtc.ToString("o"),
                        source = s.Source ?? "scan",
                        fileCount = s.Entries?.Count ?? 0,
                    };
                }
                catch { return null; }
            })
            .Where(x => x != null)
            .OrderByDescending(x => x!)
            .Take(limit)
            .Select(x => x!)
            .ToList();
    }

    private TemporalSnapshot? LoadById(string norm, string id)
    {
        var path = SnapshotFilePath(norm, id);
        if (!File.Exists(path)) return null;
        try
        {
            return JsonSerializer.Deserialize<TemporalSnapshot>(File.ReadAllText(path), Json);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[TemporalDiff] LoadById: {ex.Message}");
            return null;
        }
    }

    private TemporalSnapshot? FindNearestSnapshot(string norm, DateTime targetUtc)
    {
        var dir = FolderDir(norm);
        if (!Directory.Exists(dir)) return null;

        TemporalSnapshot? best = null;
        var bestDelta = TimeSpan.MaxValue;
        foreach (var f in Directory.GetFiles(dir, "*.json"))
        {
            try
            {
                var s = JsonSerializer.Deserialize<TemporalSnapshot>(File.ReadAllText(f), Json);
                if (s?.Entries == null) continue;
                var delta = s.TakenUtc <= targetUtc
                    ? targetUtc - s.TakenUtc
                    : s.TakenUtc - targetUtc + TimeSpan.FromDays(365);
                if (delta < bestDelta)
                {
                    bestDelta = delta;
                    best = s;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[TemporalDiff] read {f}: {ex.Message}");
            }
        }
        return best;
    }

    private void PruneOld(string norm, int keep)
    {
        var dir = FolderDir(norm);
        if (!Directory.Exists(dir)) return;
        foreach (var f in Directory.GetFiles(dir, "*.json").OrderByDescending(f => f).Skip(keep))
        {
            try { File.Delete(f); } catch { /* ignore */ }
        }
    }

    private static List<TemporalEntry> ScanFolder(string norm)
    {
        var list = new List<TemporalEntry>(256);
        try
        {
            foreach (var path in Directory.EnumerateFileSystemEntries(norm, "*", SearchOption.TopDirectoryOnly))
            {
                try
                {
                    var name = Path.GetFileName(path);
                    if (string.IsNullOrEmpty(name)) continue;
                    var isDir = Directory.Exists(path);
                    long size = 0;
                    long ticks;
                    if (isDir)
                    {
                        ticks = Directory.GetLastWriteTimeUtc(path).Ticks;
                    }
                    else
                    {
                        var fi = new FileInfo(path);
                        size = fi.Length;
                        ticks = fi.LastWriteTimeUtc.Ticks;
                    }
                    list.Add(new TemporalEntry
                    {
                        RelPath = name,
                        IsDirectory = isDir,
                        Size = size,
                        LastWriteUtcTicks = ticks,
                    });
                }
                catch { /* skip locked */ }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[TemporalDiff] Scan: {ex.Message}");
        }
        return list;
    }

    private static object ToDto(TemporalEntry e, TemporalEntry? old = null) => new
    {
        relPath = e.RelPath,
        size = e.Size,
        lastWriteUtc = new DateTime(e.LastWriteUtcTicks, DateTimeKind.Utc).ToString("o"),
        previousSize = old?.Size,
        previousLastWriteUtc = old != null
            ? new DateTime(old.LastWriteUtcTicks, DateTimeKind.Utc).ToString("o")
            : null,
        isDirectory = e.IsDirectory,
    };

    private string SnapshotFilePath(string norm, string id) =>
        Path.Combine(FolderDir(norm), id + ".json");

    private string FolderDir(string norm)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(norm.ToLowerInvariant()));
        var key = Convert.ToHexString(hash.AsSpan(0, 8));
        return Path.Combine(_root, key);
    }

    private static string Normalize(string path)
    {
        var p = path.Trim().Replace('/', '\\').TrimEnd('\\');
        return Path.GetFullPath(p);
    }

    private sealed class TemporalSnapshot
    {
        public string Id { get; set; } = "";
        public string FolderPath { get; set; } = "";
        public DateTime TakenUtc { get; set; }
        public string Source { get; set; } = "scan";
        public List<TemporalEntry> Entries { get; set; } = [];
    }

    private sealed class TemporalEntry
    {
        public string RelPath { get; set; } = "";
        public bool IsDirectory { get; set; }
        public long Size { get; set; }
        public long LastWriteUtcTicks { get; set; }
    }
}
