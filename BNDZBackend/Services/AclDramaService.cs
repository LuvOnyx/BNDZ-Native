using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text.Json;

namespace BNDZ.Services;

public sealed class AclSnapshot
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Path { get; set; } = "";
    public DateTime SnapshotUtc { get; set; } = DateTime.UtcNow;
    public string Owner { get; set; } = "";
    public List<string> Rules { get; set; } = new();
    public string Summary { get; set; } = "";
}

public sealed class AclDramaEntry
{
    public string SnapshotId { get; set; } = "";
    public DateTime SnapshotUtc { get; set; }
    public string Owner { get; set; } = "";
    public string Summary { get; set; } = "";
    public List<string> AddedRules { get; set; } = new();
    public List<string> RemovedRules { get; set; } = new();
    public string DramaLabel { get; set; } = "";
}

/// <summary>Snapshot ACL history and diff who changed permissions over time.</summary>
public sealed class AclDramaService
{
    private static readonly Lazy<AclDramaService> Lazy = new(() => new AclDramaService());
    public static AclDramaService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private readonly string _storeRoot;

    private AclDramaService()
    {
        _storeRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "AclDrama");
        Directory.CreateDirectory(_storeRoot);
    }

    public AclSnapshot Snapshot(string winPath)
    {
        var path = Path.GetFullPath(winPath);
        if (!File.Exists(path) && !Directory.Exists(path))
            throw new FileNotFoundException(path);

        var snap = CaptureAcl(path);
        var historyPath = HistoryFile(path);
        var history = LoadHistory(historyPath);
        history.Add(snap);
        SaveHistory(historyPath, history);
        return snap;
    }

    public List<AclDramaEntry> GetHistory(string winPath, int limit = 50)
    {
        var path = Path.GetFullPath(winPath);
        var history = LoadHistory(HistoryFile(path));
        if (history.Count == 0) return new List<AclDramaEntry>();

        var entries = new List<AclDramaEntry>();
        for (int i = 0; i < history.Count; i++)
        {
            var cur = history[i];
            var prev = i > 0 ? history[i - 1] : null;
            var added = prev == null ? cur.Rules : cur.Rules.Except(prev.Rules, StringComparer.OrdinalIgnoreCase).ToList();
            var removed = prev == null ? new List<string>() : prev.Rules.Except(cur.Rules, StringComparer.OrdinalIgnoreCase).ToList();
            var ownerChanged = prev != null && !string.Equals(prev.Owner, cur.Owner, StringComparison.OrdinalIgnoreCase);

            entries.Add(new AclDramaEntry
            {
                SnapshotId = cur.Id,
                SnapshotUtc = cur.SnapshotUtc,
                Owner = cur.Owner,
                Summary = cur.Summary,
                AddedRules = added,
                RemovedRules = removed,
                DramaLabel = BuildDramaLabel(cur, prev, added, removed, ownerChanged),
            });
        }

        return entries.OrderByDescending(e => e.SnapshotUtc).Take(limit).ToList();
    }

    private static AclSnapshot CaptureAcl(string path)
    {
        var snap = new AclSnapshot { Path = path, SnapshotUtc = DateTime.UtcNow };
        FileSystemSecurity? acl = null;
        if (File.Exists(path))
            acl = new FileInfo(path).GetAccessControl();
        else if (Directory.Exists(path))
            acl = new DirectoryInfo(path).GetAccessControl();

        if (acl == null) return snap;

        snap.Owner = acl.GetOwner(typeof(NTAccount))?.Value ?? "Unknown";
        bool canWrite = false;
        bool canExecute = false;
        foreach (FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(SecurityIdentifier)))
        {
            var identity = rule.IdentityReference?.Translate(typeof(NTAccount))?.Value
                ?? rule.IdentityReference?.Value ?? "Unknown";
            var rights = rule.FileSystemRights.ToString();
            var kind = rule.AccessControlType == AccessControlType.Allow ? "Allow" : "Deny";
            snap.Rules.Add($"{identity}: {rights} ({kind})");

            if (rule.AccessControlType == AccessControlType.Allow)
            {
                if ((rule.FileSystemRights & FileSystemRights.WriteData) == FileSystemRights.WriteData) canWrite = true;
                if ((rule.FileSystemRights & FileSystemRights.ExecuteFile) == FileSystemRights.ExecuteFile) canExecute = true;
            }
        }

        snap.Summary = (canWrite ? "W" : "") + (canExecute ? "X" : "");
        if (string.IsNullOrEmpty(snap.Summary)) snap.Summary = "R";
        return snap;
    }

    private static string BuildDramaLabel(
        AclSnapshot cur,
        AclSnapshot? prev,
        List<string> added,
        List<string> removed,
        bool ownerChanged)
    {
        if (prev == null) return "Baseline ACL snapshot";
        if (ownerChanged) return $"Owner changed: {prev.Owner} → {cur.Owner}";
        if (added.Count > 0 && removed.Count > 0) return $"{added.Count} rules added, {removed.Count} removed";
        if (added.Count > 0) return $"{added.Count} rule(s) added";
        if (removed.Count > 0) return $"{removed.Count} rule(s) removed";
        return "ACL unchanged (re-snapshot)";
    }

    private string HistoryFile(string path)
    {
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(path.ToLowerInvariant())));
        return Path.Combine(_storeRoot, hash + ".json");
    }

    private static List<AclSnapshot> LoadHistory(string file)
    {
        try
        {
            if (!File.Exists(file)) return new List<AclSnapshot>();
            return JsonSerializer.Deserialize<List<AclSnapshot>>(File.ReadAllText(file), Json) ?? new List<AclSnapshot>();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[AclDrama] Load failed: {ex.Message}");
            return new List<AclSnapshot>();
        }
    }

    private static void SaveHistory(string file, List<AclSnapshot> history)
    {
        try
        {
            File.WriteAllText(file, JsonSerializer.Serialize(history, Json));
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[AclDrama] Save failed: {ex.Message}");
        }
    }
}
