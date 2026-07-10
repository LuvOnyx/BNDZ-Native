using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>XYplorer-style action log with reversible undo/redo for BNDZ file operations.</summary>
public sealed class BndzActionLogService
{
    private readonly object _lock = new();
    private readonly List<ActionLogEntry> _undo = new();
    private readonly List<ActionLogEntry> _redo = new();
    private int _maxEntries = 256;

    public void SetMaxEntries(int max) => _maxEntries = Math.Clamp(max, 16, 4096);

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
        lock (_lock)
        {
            _redo.Clear();
            _undo.Add(entry);
            while (_undo.Count > _maxEntries)
                _undo.RemoveAt(0);
        }
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
                for (int i = 0; i < entry.SourcePaths.Count; i++)
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
                foreach (var file in entry.TargetPaths)
                {
                    if (File.Exists(file)) File.Delete(file);
                }
                break;

            case ActionKind.Delete:
                if (!entry.UsedRecycleBin)
                    throw new InvalidOperationException("Permanent deletes (Recycle Bin bypassed) cannot be undone.");
                // Restore each deleted item from the Recycle Bin by matching its original
                // pre-deletion path (PKEY_Recycle_DeletedFrom) — not the same identifier the
                // Recycle Bin panel's Restore button uses, since that one only knows the item's
                // own Recycle Bin storage location, not where it came from.
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
}

public enum ActionKind
{
    Move,
    Rename,
    Copy,
    Delete,
    CreateDirectory,
    CreateFile,
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
