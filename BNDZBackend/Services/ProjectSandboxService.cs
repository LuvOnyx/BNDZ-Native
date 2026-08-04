using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BNDZ.Services;

public sealed class ProjectSandboxService
{
    private static readonly Lazy<ProjectSandboxService> Lazy = new(() => new ProjectSandboxService());
    public static ProjectSandboxService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly JsonSerializerOptions JsonCompact = new()
    {
        WriteIndented = false,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string _root;
    private readonly object _lock = new();
    private readonly Dictionary<string, SandboxSession> _sessions = new(StringComparer.OrdinalIgnoreCase);
    private FileTransferQueueService? _queue;

    private ProjectSandboxService()
    {
        _root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Sandbox");
        Directory.CreateDirectory(_root);
        LoadExistingSessions();
    }

    public void SetTransferQueue(FileTransferQueueService queue) => _queue = queue;

    private void LoadExistingSessions()
    {
        try
        {
            foreach (var dir in Directory.EnumerateDirectories(_root))
            {
                var sessionFile = Path.Combine(dir, "session.json");
                if (!File.Exists(sessionFile)) continue;
                try
                {
                    var text = File.ReadAllText(sessionFile);
                    var session = JsonSerializer.Deserialize<SandboxSession>(text, Json);
                    if (session != null)
                        _sessions[session.Id] = session;
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Sandbox] Failed to load session from {dir}: {ex.Message}");
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sandbox] Failed to enumerate existing sessions: {ex.Message}");
        }
    }

    public SandboxSessionDto StartSession(string rootWinPath, string? name = null)
    {
        var normalized = NormalizePath(rootWinPath);
        if (!Directory.Exists(normalized))
            throw new DirectoryNotFoundException($"Root path does not exist: {normalized}");

        lock (_lock)
        {
            var active = _sessions.Values.FirstOrDefault(s => s.Status == "active");
            if (active != null)
                throw new InvalidOperationException($"Session '{active.Id}' is already active. Commit or discard it first.");

            var id = Guid.NewGuid().ToString("N")[..12];
            var session = new SandboxSession
            {
                Id = id,
                RootWinPath = normalized,
                Name = name ?? Path.GetFileName(normalized.TrimEnd('\\', '/')) ?? id,
                CreatedUtc = DateTime.UtcNow.ToString("O"),
                Status = "active",
            };

            var sessionDir = SessionDir(id);
            Directory.CreateDirectory(sessionDir);
            var shadowDir = Path.Combine(sessionDir, "shadow");
            Directory.CreateDirectory(shadowDir);
            PersistSession(session);
            _sessions[id] = session;
            try { ProjFsSandboxHost.TryStartSession(id, normalized, shadowDir); } catch { /* optional */ }
            return ToDto(session);
        }
    }

    public SandboxSessionDto? GetActiveSession()
    {
        lock (_lock)
        {
            var s = _sessions.Values.FirstOrDefault(s => s.Status == "active");
            return s != null ? ToDto(s) : null;
        }
    }

    public List<SandboxSessionDto> ListSessions()
    {
        lock (_lock)
            return _sessions.Values.OrderByDescending(s => s.CreatedUtc).Select(ToDto).ToList();
    }

    public SandboxSessionDto? GetSession(string sessionId)
    {
        lock (_lock)
            return _sessions.TryGetValue(sessionId, out var s) ? ToDto(s) : null;
    }

    public void RecordIntent(
        string opId,
        string kind,
        IEnumerable<string> sources,
        string? dest,
        Action? snapshotBeforeMutate = null,
        IEnumerable<string>? explicitDestinations = null)
    {
        lock (_lock)
        {
            var session = _sessions.Values.FirstOrDefault(s => s.Status == "active");
            if (session == null) return;

            var srcList = sources.Select(NormalizePath).ToList();
            var normalizedRoot = session.RootWinPath;

            var relevant = srcList.Where(p => p.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase)).ToList();
            if (relevant.Count == 0
                && (dest == null || !NormalizePath(dest).StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
                && (explicitDestinations == null
                    || !explicitDestinations.Any(d => NormalizePath(d).StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))))
                return;

            var shadowDir = Path.Combine(SessionDir(session.Id), "shadow");
            var shadowRelPaths = new List<string>();

            foreach (var src in relevant)
            {
                if (!File.Exists(src)) continue;
                try
                {
                    var relPath = Path.GetRelativePath(normalizedRoot, src);
                    var shadowPath = Path.Combine(shadowDir, relPath);
                    var shadowParent = Path.GetDirectoryName(shadowPath);
                    if (!string.IsNullOrEmpty(shadowParent))
                        Directory.CreateDirectory(shadowParent);

                    if (!File.Exists(shadowPath))
                        File.Copy(src, shadowPath, overwrite: false);
                    shadowRelPaths.Add(relPath);
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Sandbox] Shadow copy failed for {src}: {ex.Message}");
                }
            }

            snapshotBeforeMutate?.Invoke();

            var destinations = explicitDestinations != null
                ? explicitDestinations.Select(NormalizePath).ToList()
                : ExpandDestinations(kind, srcList, dest);

            var entry = new JournalEntry
            {
                OpId = opId,
                Kind = kind,
                Sources = srcList,
                Destinations = destinations,
                ShadowRelPaths = shadowRelPaths,
                Utc = DateTime.UtcNow.ToString("O"),
            };

            var journalPath = Path.Combine(SessionDir(session.Id), "journal.jsonl");
            var line = JsonSerializer.Serialize(entry, JsonCompact);
            File.AppendAllText(journalPath, line + "\n");
        }
    }

    public SandboxOperationResult Commit(string sessionId)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(sessionId, out var session))
                throw new KeyNotFoundException($"Session '{sessionId}' not found.");
            if (session.Status != "active")
                throw new InvalidOperationException($"Session '{sessionId}' is already {session.Status}.");

            var journal = ReadJournal(sessionId);
            var validationErrors = ValidateDestinations(journal, session.RootWinPath);
            if (validationErrors.Count > 0)
                return new SandboxOperationResult
                {
                    Ok = false,
                    Error = $"Commit refused: {validationErrors.Count} unsafe operation(s) detected.",
                    Details = validationErrors,
                    OpsProcessed = 0,
                };

            var shadowDir = Path.Combine(SessionDir(sessionId), "shadow");
            var pendingMerge = new List<(string Src, string Dest)>();
            if (Directory.Exists(shadowDir))
            {
                foreach (var file in Directory.EnumerateFiles(shadowDir, "*", SearchOption.AllDirectories))
                {
                    var rel = Path.GetRelativePath(shadowDir, file);
                    var dest = Path.Combine(session.RootWinPath, rel);
                    pendingMerge.Add((file, dest));
                }
            }

            // ProjFS / overlay Commit: merge shadow → live via transfer queue when present.
            if (pendingMerge.Count > 0 && _queue != null)
            {
                var opId = $"sandbox-commit-{sessionId}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
                _queue.RegisterJob(opId, "copy", $"Sandbox commit {session.Name ?? sessionId}", "sandbox",
                    pendingMerge.Count, "sandbox", FileTransferPriority.Normal, session.RootWinPath);
                _ = Task.Run(async () =>
                {
                    try
                    {
                        var ops = new FileOperationService();
                        foreach (var (src, dest) in pendingMerge)
                        {
                            var destDir = Path.GetDirectoryName(dest);
                            if (!string.IsNullOrEmpty(destDir)) Directory.CreateDirectory(destDir);
                            await ops.ExecuteOperationAsync(opId + "-" + Guid.NewGuid().ToString("N")[..8],
                                "copy", new List<string> { src }, destDir ?? session.RootWinPath, false).ConfigureAwait(false);
                        }
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine($"[Sandbox] Commit merge failed: {ex.Message}");
                    }
                });
            }

            try
            {
                if (Directory.Exists(shadowDir))
                    Directory.Delete(shadowDir, recursive: true);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Sandbox] Shadow cleanup failed: {ex.Message}");
            }

            try { ProjFsSandboxHost.StopSession(sessionId); } catch { /* optional */ }

            session.Status = "committed";
            PersistSession(session);

            return new SandboxOperationResult
            {
                Ok = true,
                OpsProcessed = journal.Count + pendingMerge.Count,
            };
        }
    }

    public SandboxOperationResult Discard(string sessionId)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(sessionId, out var session))
                throw new KeyNotFoundException($"Session '{sessionId}' not found.");
            if (session.Status != "active")
                throw new InvalidOperationException($"Session '{sessionId}' is already {session.Status}.");

            var journal = ReadJournal(sessionId);
            var shadowDir = Path.Combine(SessionDir(sessionId), "shadow");
            var failedOps = new List<string>();
            int reversed = 0;

            try { ProjFsSandboxHost.StopSession(sessionId); } catch { /* optional */ }

            for (int i = journal.Count - 1; i >= 0; i--)
            {
                var entry = journal[i];
                try
                {
                    switch (entry.Kind?.ToLowerInvariant())
                    {
                        case "copy":
                            foreach (var d in entry.Destinations)
                            {
                                if (string.IsNullOrWhiteSpace(d)) continue;

                                if (IsBatchRootMove(entry, d))
                                {
                                    failedOps.Add($"Skipped unsafe batch-root removal: {d}");
                                    continue;
                                }

                                if (File.Exists(d)) File.Delete(d);
                                else if (Directory.Exists(d)
                                    && entry.Sources.Any(s =>
                                        string.Equals(Path.GetFileName(s.TrimEnd('\\', '/')),
                                            Path.GetFileName(d.TrimEnd('\\', '/')),
                                            StringComparison.OrdinalIgnoreCase)))
                                {
                                    Directory.Delete(d, true);
                                }
                            }
                            reversed++;
                            break;

                        case "move":
                            for (int j = 0; j < entry.Sources.Count; j++)
                            {
                                var src = entry.Sources[j];
                                var dst = ResolveMoveDestination(entry, j);
                                if (string.IsNullOrEmpty(dst)) continue;
                                if (!(File.Exists(dst) || Directory.Exists(dst))) continue;

                                if (IsBatchRootMove(entry, dst))
                                {
                                    failedOps.Add($"Skipped unsafe batch-root move: {dst} → {src}");
                                    continue;
                                }

                                var parentDir = Path.GetDirectoryName(src);
                                if (!string.IsNullOrEmpty(parentDir))
                                    Directory.CreateDirectory(parentDir);
                                if (File.Exists(dst)) File.Move(dst, src, overwrite: true);
                                else if (Directory.Exists(dst)) Directory.Move(dst, src);
                            }
                            reversed++;
                            break;

                        case "delete":
                            foreach (var rel in entry.ShadowRelPaths)
                            {
                                var shadowFile = Path.Combine(shadowDir, rel);
                                var originalPath = Path.Combine(session.RootWinPath, rel);
                                if (File.Exists(shadowFile))
                                {
                                    var parentDir = Path.GetDirectoryName(originalPath);
                                    if (!string.IsNullOrEmpty(parentDir))
                                        Directory.CreateDirectory(parentDir);
                                    File.Copy(shadowFile, originalPath, overwrite: true);
                                }
                            }
                            reversed++;
                            break;

                        case "rename":
                            for (int j = 0; j < entry.Sources.Count; j++)
                            {
                                var dst = entry.Destinations.ElementAtOrDefault(j);
                                var src = entry.Sources[j];
                                if (!string.IsNullOrEmpty(dst) && File.Exists(dst))
                                    File.Move(dst, src);
                            }
                            reversed++;
                            break;

                        case "write":
                            foreach (var rel in entry.ShadowRelPaths)
                            {
                                var shadowFile = Path.Combine(shadowDir, rel);
                                var originalPath = Path.Combine(session.RootWinPath, rel);
                                if (File.Exists(shadowFile))
                                    File.Copy(shadowFile, originalPath, overwrite: true);
                                else if (File.Exists(originalPath))
                                    File.Delete(originalPath);
                            }
                            reversed++;
                            break;

                        default:
                            failedOps.Add($"Unknown op kind '{entry.Kind}' for {entry.OpId}");
                            break;
                    }
                }
                catch (Exception ex)
                {
                    failedOps.Add($"Op {entry.OpId} ({entry.Kind}): {ex.Message}");
                    Debug.WriteLine($"[Sandbox] Discard reversal failed for op {entry.OpId}: {ex.Message}");
                }
            }

            try
            {
                if (Directory.Exists(shadowDir))
                    Directory.Delete(shadowDir, recursive: true);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Sandbox] Shadow cleanup on discard failed: {ex.Message}");
            }

            session.Status = "discarded";
            PersistSession(session);

            return new SandboxOperationResult
            {
                Ok = failedOps.Count == 0,
                OpsProcessed = reversed,
                Details = failedOps,
                Error = failedOps.Count > 0
                    ? $"{failedOps.Count} operation(s) could not be fully reversed."
                    : null,
            };
        }
    }

    public SandboxCheckpointDto CreateCheckpoint(string sessionId, string name)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(sessionId, out var session))
                throw new KeyNotFoundException($"Session '{sessionId}' not found.");
            if (session.Status != "active")
                throw new InvalidOperationException("Only active sessions can be checkpointed.");

            var cpId = Guid.NewGuid().ToString("N")[..10];
            var cpDir = Path.Combine(SessionDir(sessionId), "checkpoints", cpId);
            Directory.CreateDirectory(cpDir);

            var journalSrc = Path.Combine(SessionDir(sessionId), "journal.jsonl");
            if (File.Exists(journalSrc))
                File.Copy(journalSrc, Path.Combine(cpDir, "journal.jsonl"));

            var shadowSrc = Path.Combine(SessionDir(sessionId), "shadow");
            if (Directory.Exists(shadowSrc))
                CopyDirectory(shadowSrc, Path.Combine(cpDir, "shadow"));

            var meta = new CheckpointMeta
            {
                Id = cpId,
                Name = name,
                CreatedUtc = DateTime.UtcNow.ToString("O"),
            };
            File.WriteAllText(
                Path.Combine(cpDir, "checkpoint.json"),
                JsonSerializer.Serialize(meta, Json));

            return new SandboxCheckpointDto
            {
                Id = meta.Id,
                Name = meta.Name,
                CreatedUtc = meta.CreatedUtc,
            };
        }
    }

    public List<SandboxCheckpointDto> ListCheckpoints(string sessionId)
    {
        lock (_lock)
        {
            var cpRoot = Path.Combine(SessionDir(sessionId), "checkpoints");
            if (!Directory.Exists(cpRoot)) return new List<SandboxCheckpointDto>();

            var result = new List<SandboxCheckpointDto>();
            foreach (var dir in Directory.EnumerateDirectories(cpRoot))
            {
                var metaFile = Path.Combine(dir, "checkpoint.json");
                if (!File.Exists(metaFile)) continue;
                try
                {
                    var meta = JsonSerializer.Deserialize<CheckpointMeta>(File.ReadAllText(metaFile), Json);
                    if (meta != null)
                        result.Add(new SandboxCheckpointDto { Id = meta.Id, Name = meta.Name, CreatedUtc = meta.CreatedUtc });
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Sandbox] Failed to read checkpoint meta in {dir}: {ex.Message}");
                }
            }
            return result.OrderByDescending(c => c.CreatedUtc).ToList();
        }
    }

    public void RestoreCheckpoint(string sessionId, string checkpointId)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(sessionId, out var session))
                throw new KeyNotFoundException($"Session '{sessionId}' not found.");
            if (session.Status != "active")
                throw new InvalidOperationException("Only active sessions can restore checkpoints.");

            var cpDir = Path.Combine(SessionDir(sessionId), "checkpoints", checkpointId);
            if (!Directory.Exists(cpDir))
                throw new KeyNotFoundException($"Checkpoint '{checkpointId}' not found.");

            var journalCp = Path.Combine(cpDir, "journal.jsonl");
            var journalDest = Path.Combine(SessionDir(sessionId), "journal.jsonl");
            if (File.Exists(journalCp))
                File.Copy(journalCp, journalDest, overwrite: true);
            else if (File.Exists(journalDest))
                File.Delete(journalDest);

            var shadowDest = Path.Combine(SessionDir(sessionId), "shadow");
            if (Directory.Exists(shadowDest))
                Directory.Delete(shadowDest, recursive: true);

            var shadowCp = Path.Combine(cpDir, "shadow");
            if (Directory.Exists(shadowCp))
                CopyDirectory(shadowCp, shadowDest);
            else
                Directory.CreateDirectory(shadowDest);
        }
    }

    public SandboxSessionStatusDto GetSessionStatus(string sessionId)
    {
        lock (_lock)
        {
            if (!_sessions.TryGetValue(sessionId, out var session))
                throw new KeyNotFoundException($"Session '{sessionId}' not found.");

            var journal = ReadJournal(sessionId);
            var cpRoot = Path.Combine(SessionDir(sessionId), "checkpoints");
            SandboxCheckpointDto? lastCp = null;

            if (Directory.Exists(cpRoot))
            {
                foreach (var dir in Directory.EnumerateDirectories(cpRoot).OrderByDescending(d => d))
                {
                    var metaFile = Path.Combine(dir, "checkpoint.json");
                    if (!File.Exists(metaFile)) continue;
                    try
                    {
                        var meta = JsonSerializer.Deserialize<CheckpointMeta>(File.ReadAllText(metaFile), Json);
                        if (meta != null)
                        {
                            lastCp = new SandboxCheckpointDto { Id = meta.Id, Name = meta.Name, CreatedUtc = meta.CreatedUtc };
                            break;
                        }
                    }
                    catch { }
                }
            }

            long shadowBytes = 0;
            var shadowDir = Path.Combine(SessionDir(sessionId), "shadow");
            if (Directory.Exists(shadowDir))
            {
                try
                {
                    foreach (var f in Directory.EnumerateFiles(shadowDir, "*", SearchOption.AllDirectories))
                    {
                        try { shadowBytes += new FileInfo(f).Length; } catch { }
                    }
                }
                catch { }
            }

            return new SandboxSessionStatusDto
            {
                SessionId = session.Id,
                Status = session.Status,
                RootWinPath = session.RootWinPath,
                Name = session.Name,
                CreatedUtc = session.CreatedUtc,
                PendingOpsCount = journal.Count,
                LastCheckpoint = lastCp,
                ShadowSizeBytes = shadowBytes,
            };
        }
    }

    /// <summary>
    /// Validate all journal destinations before commit — refuse if any destination
    /// points outside the session root (sandbox escape) or is a bare drive root.
    /// </summary>
    private static List<string> ValidateDestinations(List<JournalEntry> journal, string sessionRoot)
    {
        var errors = new List<string>();
        var normalizedRoot = NormalizePath(sessionRoot);

        foreach (var entry in journal)
        {
            foreach (var dest in entry.Destinations)
            {
                if (string.IsNullOrWhiteSpace(dest)) continue;
                var normDest = NormalizePath(dest);

                if (normDest.Length <= 3 && normDest.EndsWith(":\\", StringComparison.Ordinal))
                {
                    errors.Add($"Op {entry.OpId}: destination is a bare drive root ({normDest})");
                }
            }
        }

        return errors;
    }

    private static bool IsBatchRootMove(JournalEntry entry, string destPath)
    {
        if (entry.Sources.Count <= 1 || entry.Destinations.Count != 1) return false;
        return Directory.Exists(destPath)
            && string.Equals(
                NormalizePath(entry.Destinations[0]),
                NormalizePath(destPath),
                StringComparison.OrdinalIgnoreCase);
    }

    private static string? ResolveMoveDestination(JournalEntry entry, int sourceIndex)
    {
        if (sourceIndex < 0 || sourceIndex >= entry.Sources.Count) return null;
        var src = entry.Sources[sourceIndex];
        if (entry.Destinations.Count == entry.Sources.Count)
            return entry.Destinations[sourceIndex];
        if (entry.Destinations.Count != 1) return null;
        var only = entry.Destinations[0];
        if (entry.Sources.Count == 1) return only;
        // Legacy journal: only the target directory was stored.
        return NormalizePath(Path.Combine(only, Path.GetFileName(src.TrimEnd('\\', '/'))));
    }

    private string SessionDir(string sessionId) => Path.Combine(_root, sessionId);

    /// <summary>
    /// Expand a drop/copy/move destination into one concrete path per source.
    /// Storing only the target directory breaks Discard (would Move/Delete the whole folder).
    /// </summary>
    private static List<string> ExpandDestinations(string kind, List<string> sources, string? dest)
    {
        if (string.IsNullOrWhiteSpace(dest) || sources.Count == 0)
            return new List<string>();

        var destNorm = NormalizePath(dest);
        var kindLower = (kind ?? "").ToLowerInvariant();

        // Single-source rename/move onto an explicit file path.
        if (sources.Count == 1
            && (kindLower is "rename" or "move" or "copy")
            && !Directory.Exists(destNorm))
        {
            var parent = Path.GetDirectoryName(destNorm);
            if (!string.IsNullOrEmpty(parent) && (Directory.Exists(parent) || kindLower == "rename"))
                return new List<string> { destNorm };
        }

        // Directory target (or multi-source): one dest file/folder per source name.
        return sources
            .Select(s => NormalizePath(Path.Combine(destNorm, Path.GetFileName(s.TrimEnd('\\', '/')))))
            .ToList();
    }

    private void PersistSession(SandboxSession session)
    {
        var dir = SessionDir(session.Id);
        Directory.CreateDirectory(dir);
        File.WriteAllText(
            Path.Combine(dir, "session.json"),
            JsonSerializer.Serialize(session, Json));
    }

    private List<JournalEntry> ReadJournal(string sessionId)
    {
        var journalPath = Path.Combine(SessionDir(sessionId), "journal.jsonl");
        if (!File.Exists(journalPath)) return new List<JournalEntry>();

        var entries = new List<JournalEntry>();
        foreach (var line in File.ReadAllLines(journalPath))
        {
            if (string.IsNullOrWhiteSpace(line)) continue;
            try
            {
                var entry = JsonSerializer.Deserialize<JournalEntry>(line, JsonCompact);
                if (entry != null) entries.Add(entry);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Sandbox] Malformed journal line: {ex.Message}");
            }
        }
        return entries;
    }

    private static string NormalizePath(string path)
    {
        var full = Path.GetFullPath(path);
        if (full.Length > 3 && full.EndsWith('\\'))
            full = full.TrimEnd('\\');
        return full;
    }

    private static void CopyDirectory(string source, string destination)
    {
        Directory.CreateDirectory(destination);
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(source, file);
            var destFile = Path.Combine(destination, rel);
            var destDir = Path.GetDirectoryName(destFile);
            if (!string.IsNullOrEmpty(destDir))
                Directory.CreateDirectory(destDir);
            File.Copy(file, destFile, overwrite: true);
        }
    }

    private static SandboxSessionDto ToDto(SandboxSession s) => new()
    {
        Id = s.Id,
        RootWinPath = s.RootWinPath,
        Name = s.Name,
        CreatedUtc = s.CreatedUtc,
        Status = s.Status,
    };
}

public sealed class SandboxSession
{
    public string Id { get; set; } = "";
    public string RootWinPath { get; set; } = "";
    public string Name { get; set; } = "";
    public string CreatedUtc { get; set; } = "";
    public string Status { get; set; } = "active";
}

public sealed class SandboxSessionDto
{
    public string Id { get; set; } = "";
    public string RootWinPath { get; set; } = "";
    public string Name { get; set; } = "";
    public string CreatedUtc { get; set; } = "";
    public string Status { get; set; } = "";
}

public sealed class JournalEntry
{
    public string OpId { get; set; } = "";
    public string Kind { get; set; } = "";
    public List<string> Sources { get; set; } = new();
    public List<string> Destinations { get; set; } = new();
    public List<string> ShadowRelPaths { get; set; } = new();
    public string Utc { get; set; } = "";
}

public sealed class SandboxCheckpointDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string CreatedUtc { get; set; } = "";
}

public sealed class SandboxSessionStatusDto
{
    public string SessionId { get; set; } = "";
    public string Status { get; set; } = "";
    public string RootWinPath { get; set; } = "";
    public string Name { get; set; } = "";
    public string CreatedUtc { get; set; } = "";
    public int PendingOpsCount { get; set; }
    public SandboxCheckpointDto? LastCheckpoint { get; set; }
    public long ShadowSizeBytes { get; set; }
}

public sealed class SandboxOperationResult
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public int OpsProcessed { get; set; }
    public List<string> Details { get; set; } = new();
}

internal sealed class CheckpointMeta
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string CreatedUtc { get; set; } = "";
}
