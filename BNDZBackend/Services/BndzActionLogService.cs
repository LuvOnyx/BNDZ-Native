using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>XYplorer-style action log with reversible undo/redo for BNDZ file operations.</summary>
public sealed class BndzActionLogService
{
    private readonly object _lock = new();
    private readonly List<ActionLogEntry> _undo = new();
    private readonly List<ActionLogEntry> _redo = new();
    private readonly string _persistPath;
    private int _maxEntries = 256;
    private bool _persistBetweenSessions;
    private bool _persistOnExitWithoutSaving;

    public BndzActionLogService()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var dir = Path.Combine(appData, "BNDZ64");
        Directory.CreateDirectory(dir);
        _persistPath = Path.Combine(dir, "action_log.json");
    }

    public void ConfigurePersistence(bool betweenSessions, bool onExitWithoutSaving)
    {
        lock (_lock)
        {
            _persistBetweenSessions = betweenSessions;
            _persistOnExitWithoutSaving = onExitWithoutSaving;
        }
    }

    public void SetMaxEntries(int max) => _maxEntries = Math.Clamp(max, 16, 4096);

    public void LoadPersistedIfEnabled()
    {
        lock (_lock)
        {
            if (!_persistBetweenSessions || !File.Exists(_persistPath)) return;
            try
            {
                var json = File.ReadAllText(_persistPath);
                var doc = JsonSerializer.Deserialize<PersistedActionLog>(json, JsonOptions);
                if (doc == null) return;
                _undo.Clear();
                _redo.Clear();
                foreach (var row in doc.Undo ?? new List<PersistedActionLogEntry>())
                {
                    var entry = row.ToEntry();
                    if (entry != null) _undo.Add(entry);
                }
                foreach (var row in doc.Redo ?? new List<PersistedActionLogEntry>())
                {
                    var entry = row.ToEntry();
                    if (entry != null) _redo.Add(entry);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ActionLog] Load failed: {ex.Message}");
            }
        }
    }

    public void PersistNow(bool force = false)
    {
        lock (_lock)
        {
            if (!force && !_persistBetweenSessions && !_persistOnExitWithoutSaving) return;
            try
            {
                var doc = new PersistedActionLog
                {
                    Version = 1,
                    Undo = _undo.Select(PersistedActionLogEntry.From).ToList(),
                    Redo = _redo.Select(PersistedActionLogEntry.From).ToList(),
                };
                var json = JsonSerializer.Serialize(doc, JsonOptions);
                File.WriteAllText(_persistPath, json);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ActionLog] Persist failed: {ex.Message}");
            }
        }
    }

    public void ClearPersisted()
    {
        try
        {
            if (File.Exists(_persistPath)) File.Delete(_persistPath);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ActionLog] Clear persisted failed: {ex.Message}");
        }
    }

    public IReadOnlyList<ActionLogEntryDto> GetRecent(int max = 64)
    {
        lock (_lock)
        {
            return _undo.TakeLast(max).Reverse().Select(ActionLogEntryDto.From).ToList();
        }
    }

    public bool CanUndo
    {
        get { lock (_lock) return _undo.Count > 0; }
    }

    public bool CanRedo
    {
        get { lock (_lock) return _redo.Count > 0; }
    }

    public DateTime? GetLastUndoEntryUtc()
    {
        lock (_lock) return _undo.Count > 0 ? _undo[^1].Utc : null;
    }

    public void Record(ActionLogEntry entry)
    {
        var maxItems = FileOperationPreferences.Current.MaxItemsPerLoggedAction;
        if (maxItems > 0)
        {
            if (entry.SourcePaths.Count > maxItems)
                entry.SourcePaths = entry.SourcePaths.Take(maxItems).ToList();
            if (entry.TargetPaths.Count > maxItems)
                entry.TargetPaths = entry.TargetPaths.Take(maxItems).ToList();
            if (entry.SourcePaths.Count == 0 && entry.TargetPaths.Count == 0)
                return;
        }

        lock (_lock)
        {
            _redo.Clear();
            _undo.Add(entry);
            while (_undo.Count > _maxEntries)
                _undo.RemoveAt(0);
        }
        if (_persistBetweenSessions) PersistNow();
    }

    public async Task<ActionLogResult> UndoAsync(FileOperationService fileOps)
    {
        ActionLogEntry? entry;
        lock (_lock)
        {
            if (_undo.Count == 0) return ActionLogResult.Failure("Nothing to undo.");
            entry = _undo[^1];
            _undo.RemoveAt(_undo.Count - 1);
        }

        try
        {
            await ApplyInverseAsync(fileOps, entry).ConfigureAwait(false);
            lock (_lock) _redo.Add(entry);
            if (_persistBetweenSessions) PersistNow();
            return ActionLogResult.Success($"Undid: {entry.Label}");
        }
        catch (Exception ex)
        {
            lock (_lock) _undo.Add(entry);
            return ActionLogResult.Failure(ex.Message);
        }
    }

    public async Task<ActionLogResult> RedoAsync(FileOperationService fileOps)
    {
        ActionLogEntry? entry;
        lock (_lock)
        {
            if (_redo.Count == 0) return ActionLogResult.Failure("Nothing to redo.");
            entry = _redo[^1];
            _redo.RemoveAt(_redo.Count - 1);
        }

        try
        {
            await ApplyForwardAsync(fileOps, entry).ConfigureAwait(false);
            lock (_lock) _undo.Add(entry);
            if (_persistBetweenSessions) PersistNow();
            return ActionLogResult.Success($"Redid: {entry.Label}");
        }
        catch (Exception ex)
        {
            lock (_lock) _redo.Add(entry);
            return ActionLogResult.Failure(ex.Message);
        }
    }

    private static async Task ApplyInverseAsync(FileOperationService fileOps, ActionLogEntry entry)
    {
        switch (entry.Kind)
        {
            case ActionKind.Move:
            case ActionKind.Rename:
            case ActionKind.BatchRename:
                for (int i = entry.SourcePaths.Count - 1; i >= 0; i--)
                {
                    var from = entry.TargetPaths.ElementAtOrDefault(i) ?? entry.TargetPaths.LastOrDefault() ?? "";
                    var to = entry.SourcePaths[i];
                    if (string.IsNullOrEmpty(from) || !File.Exists(from) && !Directory.Exists(from))
                        throw new FileNotFoundException($"Cannot undo — missing: {from}");
                    await fileOps.ExecuteOperationAsync(Guid.NewGuid().ToString("N"), "move",
                        new List<string> { from }, to, bypassRecycleBin: true, recordActionLog: false).ConfigureAwait(false);
                }
                break;

            case ActionKind.Copy:
                foreach (var created in entry.TargetPaths)
                {
                    if (File.Exists(created)) File.Delete(created);
                    else if (Directory.Exists(created)) Directory.Delete(created, true);
                }
                break;

            case ActionKind.CreateDirectory:
                foreach (var dir in entry.TargetPaths)
                {
                    if (Directory.Exists(dir) && !Directory.EnumerateFileSystemEntries(dir).Any())
                        Directory.Delete(dir, false);
                }
                break;

            case ActionKind.CreateFile:
            case ActionKind.CreateLink:
                foreach (var linkPath in entry.TargetPaths)
                {
                    if (File.Exists(linkPath)) File.Delete(linkPath);
                    else if (Directory.Exists(linkPath)) Directory.Delete(linkPath, false);
                }
                break;

            case ActionKind.SyncFolder:
            case ActionKind.ExtractArchive:
                foreach (var created in entry.TargetPaths)
                {
                    if (File.Exists(created)) File.Delete(created);
                    else if (Directory.Exists(created)) Directory.Delete(created, true);
                }
                break;

            case ActionKind.CreateArchive:
                foreach (var archive in entry.TargetPaths)
                {
                    if (File.Exists(archive)) File.Delete(archive);
                }
                break;

            case ActionKind.Delete:
                if (!entry.UsedRecycleBin)
                    throw new InvalidOperationException("Permanent deletes (Recycle Bin bypassed) cannot be undone.");
                var (restored, failed) = RecycleBinService.RestoreByOriginalPath(entry.SourcePaths);
                if (failed > 0)
                    throw new InvalidOperationException($"Restored {restored} of {entry.SourcePaths.Count} item(s) — the rest could not be located in the Recycle Bin (already purged, emptied, or restored elsewhere).");
                break;

            default:
                throw new NotSupportedException($"Undo not supported for {entry.Kind}.");
        }
    }

    private static async Task ApplyForwardAsync(FileOperationService fileOps, ActionLogEntry entry)
    {
        switch (entry.Kind)
        {
            case ActionKind.Move:
            case ActionKind.Rename:
            case ActionKind.BatchRename:
                for (int i = 0; i < entry.SourcePaths.Count; i++)
                {
                    var from = entry.SourcePaths[i];
                    var to = entry.TargetPaths.ElementAtOrDefault(i) ?? entry.TargetPaths.LastOrDefault() ?? "";
                    await fileOps.ExecuteOperationAsync(Guid.NewGuid().ToString("N"), "move",
                        new List<string> { from }, to, bypassRecycleBin: true, recordActionLog: false).ConfigureAwait(false);
                }
                break;

            case ActionKind.Copy:
                for (int i = 0; i < entry.SourcePaths.Count; i++)
                {
                    var src = entry.SourcePaths[i];
                    var dest = entry.TargetPaths.ElementAtOrDefault(i) ?? "";
                    var destDir = Path.GetDirectoryName(dest) ?? "";
                    await fileOps.ExecuteOperationAsync(Guid.NewGuid().ToString("N"), "copy",
                        new List<string> { src }, destDir, bypassRecycleBin: true, recordActionLog: false).ConfigureAwait(false);
                }
                break;

            case ActionKind.CreateDirectory:
                foreach (var dir in entry.TargetPaths)
                    await fileOps.ExecuteOperationAsync(Guid.NewGuid().ToString("N"), "create-dir",
                        new List<string>(), dir, bypassRecycleBin: true, recordActionLog: false).ConfigureAwait(false);
                break;

            case ActionKind.CreateFile:
                foreach (var file in entry.TargetPaths)
                    await fileOps.ExecuteOperationAsync(Guid.NewGuid().ToString("N"), "create-file",
                        new List<string>(), file, bypassRecycleBin: true, recordActionLog: false).ConfigureAwait(false);
                break;

            case ActionKind.CreateLink:
                for (int i = 0; i < entry.TargetPaths.Count; i++)
                {
                    var linkPath = entry.TargetPaths[i];
                    var target = entry.SourcePaths.ElementAtOrDefault(i) ?? entry.SourcePaths.LastOrDefault() ?? "";
                    if (string.IsNullOrEmpty(target)) continue;
                    new LinkService().CreateLink(linkPath, target, entry.LinkType ?? "symlink");
                }
                break;

            case ActionKind.CreateArchive:
                foreach (var archive in entry.TargetPaths)
                {
                    if (File.Exists(archive)) File.Delete(archive);
                }
                break;

            case ActionKind.ExtractArchive:
            case ActionKind.SyncFolder:
                throw new NotSupportedException($"Redo for {entry.Kind} is not supported — re-run the operation manually.");

            case ActionKind.Delete:
                await fileOps.ExecuteOperationAsync(Guid.NewGuid().ToString("N"), "delete",
                    entry.SourcePaths.ToList(), "", bypassRecycleBin: !entry.UsedRecycleBin, recordActionLog: false).ConfigureAwait(false);
                break;

            default:
                throw new NotSupportedException($"Redo not supported for {entry.Kind}.");
        }
    }

    public static ActionLogEntry ForMove(IReadOnlyList<string> sources, IReadOnlyList<string> targets, string? label = null)
    {
        var name = sources.FirstOrDefault() is { } s ? Path.GetFileName(s) : "item";
        return new ActionLogEntry
        {
            Kind = sources.Count == 1 && targets.Count == 1 &&
                   string.Equals(Path.GetDirectoryName(sources[0]), Path.GetDirectoryName(targets[0]), StringComparison.OrdinalIgnoreCase)
                ? ActionKind.Rename : ActionKind.Move,
            Label = label ?? $"Move {name}",
            SourcePaths = sources.ToList(),
            TargetPaths = targets.ToList(),
        };
    }

    public static ActionLogEntry ForBatchRename(IReadOnlyList<string> sources, IReadOnlyList<string> targets, string? label = null)
        => new()
        {
            Kind = ActionKind.BatchRename,
            Label = label ?? $"Batch rename ({sources.Count} items)",
            SourcePaths = sources.ToList(),
            TargetPaths = targets.ToList(),
        };

    public static ActionLogEntry ForCopy(IReadOnlyList<string> sources, IReadOnlyList<string> createdPaths)
        => new()
        {
            Kind = ActionKind.Copy,
            Label = $"Copy {sources.Count} item(s)",
            SourcePaths = sources.ToList(),
            TargetPaths = createdPaths.ToList(),
        };

    public static ActionLogEntry ForDelete(IReadOnlyList<string> paths, bool recycleBin)
        => new()
        {
            Kind = ActionKind.Delete,
            Label = $"Delete {paths.Count} item(s)",
            SourcePaths = paths.ToList(),
            UsedRecycleBin = recycleBin,
        };

    public static ActionLogEntry ForCreateDir(string path)
        => new()
        {
            Kind = ActionKind.CreateDirectory,
            Label = $"Create folder {Path.GetFileName(path.TrimEnd('\\', '/'))}",
            TargetPaths = new List<string> { path },
        };

    public static ActionLogEntry ForCreateFile(string path)
        => new()
        {
            Kind = ActionKind.CreateFile,
            Label = $"Create file {Path.GetFileName(path)}",
            TargetPaths = new List<string> { path },
        };

    public static ActionLogEntry ForCreateLink(string linkPath, string targetPath, string linkType)
        => new()
        {
            Kind = ActionKind.CreateLink,
            Label = $"Create {linkType} · {Path.GetFileName(linkPath)}",
            SourcePaths = new List<string> { targetPath },
            TargetPaths = new List<string> { linkPath },
            LinkType = linkType,
        };

    public static ActionLogEntry ForSyncFolder(string source, string target)
        => new()
        {
            Kind = ActionKind.SyncFolder,
            Label = $"Sync {Path.GetFileName(source.TrimEnd('\\', '/'))} → {Path.GetFileName(target.TrimEnd('\\', '/'))}",
            SourcePaths = new List<string> { source },
            TargetPaths = new List<string> { target },
        };

    public static ActionLogEntry ForCreateArchive(string archivePath, IReadOnlyList<string> sources)
        => new()
        {
            Kind = ActionKind.CreateArchive,
            Label = $"Create archive · {Path.GetFileName(archivePath)}",
            SourcePaths = sources.ToList(),
            TargetPaths = new List<string> { archivePath },
        };

    public static ActionLogEntry ForExtractArchive(string archivePath, string destination)
        => new()
        {
            Kind = ActionKind.ExtractArchive,
            Label = $"Extract · {Path.GetFileName(archivePath)}",
            SourcePaths = new List<string> { archivePath },
            TargetPaths = new List<string> { destination },
        };

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    };

    private sealed class PersistedActionLog
    {
        public int Version { get; set; }
        public List<PersistedActionLogEntry>? Undo { get; set; }
        public List<PersistedActionLogEntry>? Redo { get; set; }
    }

    private sealed class PersistedActionLogEntry
    {
        public string Id { get; set; } = "";
        public string Kind { get; set; } = "";
        public string Label { get; set; } = "";
        public string Utc { get; set; } = "";
        public List<string> SourcePaths { get; set; } = new();
        public List<string> TargetPaths { get; set; } = new();
        public bool UsedRecycleBin { get; set; }
        public string? LinkType { get; set; }

        public static PersistedActionLogEntry From(ActionLogEntry e) => new()
        {
            Id = e.Id,
            Kind = e.Kind.ToString(),
            Label = e.Label,
            Utc = e.Utc.ToString("O"),
            SourcePaths = e.SourcePaths,
            TargetPaths = e.TargetPaths,
            UsedRecycleBin = e.UsedRecycleBin,
            LinkType = e.LinkType,
        };

        public ActionLogEntry? ToEntry()
        {
            if (!Enum.TryParse<ActionKind>(Kind, true, out var kind)) return null;
            return new ActionLogEntry
            {
                Id = string.IsNullOrEmpty(Id) ? Guid.NewGuid().ToString("N") : Id,
                Kind = kind,
                Label = Label,
                Utc = DateTime.TryParse(Utc, out var dt) ? dt : DateTime.UtcNow,
                SourcePaths = SourcePaths ?? new List<string>(),
                TargetPaths = TargetPaths ?? new List<string>(),
                UsedRecycleBin = UsedRecycleBin,
                LinkType = LinkType,
            };
        }
    }
}

public enum ActionKind
{
    Move,
    Rename,
    BatchRename,
    Copy,
    Delete,
    CreateDirectory,
    CreateFile,
    CreateLink,
    SyncFolder,
    CreateArchive,
    ExtractArchive,
}

public sealed class ActionLogEntry
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public ActionKind Kind { get; set; }
    public string Label { get; set; } = "";
    public DateTime Utc { get; set; } = DateTime.UtcNow;
    public List<string> SourcePaths { get; set; } = new();
    public List<string> TargetPaths { get; set; } = new();
    public bool UsedRecycleBin { get; set; }
    public string? LinkType { get; set; }
}

public sealed class ActionLogEntryDto
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Label { get; set; } = "";
    public string Utc { get; set; } = "";
    public bool CanUndo { get; set; }

    public static ActionLogEntryDto From(ActionLogEntry e) => new()
    {
        Id = e.Id,
        Kind = e.Kind.ToString(),
        Label = e.Label,
        Utc = e.Utc.ToString("O"),
        CanUndo = e.Kind is not ActionKind.Delete || e.UsedRecycleBin,
    };
}

public sealed class ActionLogResult
{
    public bool Ok { get; init; }
    public string Message { get; init; } = "";

    public static ActionLogResult Success(string msg) => new() { Ok = true, Message = msg };
    public static ActionLogResult Failure(string msg) => new() { Ok = false, Message = msg };
}
