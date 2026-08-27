using System.Collections.Concurrent;
using System.Timers;

namespace BNDZ.Services.Mesh;

/// <summary>Debounced local→remote mirror rules (on-save deploy).</summary>
public sealed class MeshSyncEngine : IDisposable
{
    private readonly MeshDatabase _db;
    private readonly BndzMeshOrchestrator _orchestrator;
    private readonly ConcurrentDictionary<string, FileSystemWatcher> _watchers = new();
    private readonly ConcurrentDictionary<string, System.Timers.Timer> _debounce = new();
    private readonly ConcurrentDictionary<string, bool> _inFlight = new();
    private Action<MeshSyncProgress>? _onProgress;

    public MeshSyncEngine(MeshDatabase db, BndzMeshOrchestrator orchestrator)
    {
        _db = db;
        _orchestrator = orchestrator;
    }

    public void SetProgressCallback(Action<MeshSyncProgress>? cb) => _onProgress = cb;

    public IReadOnlyList<MeshSyncRuleRecord> GetRules() => _db.ListSyncRules();

    public void SaveRules(IEnumerable<MeshSyncRuleRecord> rules)
    {
        _db.SaveSyncRules(rules);
        RestoreWatchers();
    }

    public void RestoreWatchers()
    {
        foreach (var w in _watchers.Values) { try { w.Dispose(); } catch { } }
        _watchers.Clear();
        foreach (var rule in _db.ListSyncRules().Where(r => r.Enabled && r.PushOnSave))
        {
            if (!Directory.Exists(rule.LocalPath)) continue;
            var watcher = new FileSystemWatcher(rule.LocalPath)
            {
                IncludeSubdirectories = true,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.Size,
            };
            watcher.Changed += (_, e) => QueueSync(rule, e.FullPath);
            watcher.Created += (_, e) => QueueSync(rule, e.FullPath);
            watcher.Renamed += (_, e) => QueueSync(rule, e.FullPath);
            watcher.EnableRaisingEvents = true;
            _watchers[rule.Id] = watcher;
        }
    }

    private void QueueSync(MeshSyncRuleRecord rule, string fullPath)
    {
        if (!File.Exists(fullPath)) return;
        if (!MatchesGlobs(rule, fullPath)) return;
        var key = rule.Id + ":" + fullPath;
        if (_debounce.TryGetValue(key, out var existing)) { existing.Stop(); existing.Dispose(); }
        var timer = new System.Timers.Timer(rule.DebounceMs) { AutoReset = false };
        timer.Elapsed += async (_, _) =>
        {
            _debounce.TryRemove(key, out _);
            await RunSingleFileAsync(rule, fullPath).ConfigureAwait(false);
        };
        _debounce[key] = timer;
        timer.Start();
    }

    private static bool MatchesGlobs(MeshSyncRuleRecord rule, string fullPath)
    {
        var name = Path.GetFileName(fullPath);
        var rel = Path.GetRelativePath(rule.LocalPath, fullPath).Replace('\\', '/');
        if (!string.IsNullOrWhiteSpace(rule.ExcludeGlob))
        {
            foreach (var pat in SplitGlobs(rule.ExcludeGlob))
            {
                if (GlobMatch(name, pat) || GlobMatch(rel, pat)) return false;
            }
        }
        if (!string.IsNullOrWhiteSpace(rule.IncludeGlob))
        {
            var any = false;
            foreach (var pat in SplitGlobs(rule.IncludeGlob))
            {
                if (GlobMatch(name, pat) || GlobMatch(rel, pat)) { any = true; break; }
            }
            if (!any) return false;
        }
        return true;
    }

    private static IEnumerable<string> SplitGlobs(string raw) =>
        raw.Split([';', '|', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static bool GlobMatch(string input, string pattern)
    {
        // Simple glob: * and ?
        var regex = "^" + System.Text.RegularExpressions.Regex.Escape(pattern)
            .Replace("\\*", ".*")
            .Replace("\\?", ".") + "$";
        return System.Text.RegularExpressions.Regex.IsMatch(input, regex,
            System.Text.RegularExpressions.RegexOptions.IgnoreCase | System.Text.RegularExpressions.RegexOptions.CultureInvariant);
    }

    public async Task<MeshSyncRuleRecord?> RunRuleAsync(string ruleId, CancellationToken ct = default)
    {
        var rule = _db.ListSyncRules().FirstOrDefault(r => r.Id == ruleId);
        if (rule == null || !rule.Enabled) return null;
        if (!_inFlight.TryAdd(ruleId, true))
            return rule;
        try
        {
            Emit(ruleId, "syncing", 0, null, "Scanning…");
            if (!Directory.Exists(rule.LocalPath)) throw new DirectoryNotFoundException(rule.LocalPath);
            var files = Directory.EnumerateFiles(rule.LocalPath, "*", SearchOption.AllDirectories)
                .Where(f => MatchesGlobs(rule, f))
                .ToList();
            var i = 0;
            foreach (var file in files)
            {
                ct.ThrowIfCancellationRequested();
                await PushFileAsync(rule, file, ct).ConfigureAwait(false);
                i++;
                Emit(ruleId, "syncing", files.Count > 0 ? (i * 100 / files.Count) : 100, file, null);
            }
            rule.LastSyncUtc = DateTime.UtcNow;
            rule.LastStatus = "ok";
            rule.LastError = null;
            _db.SaveSyncRules(_db.ListSyncRules().Select(r => r.Id == ruleId ? rule : r));
            Emit(ruleId, "ok", 100, null, "Sync complete");
            return rule;
        }
        catch (Exception ex)
        {
            rule.LastStatus = "error";
            rule.LastError = ex.Message;
            _db.SaveSyncRules(_db.ListSyncRules().Select(r => r.Id == ruleId ? rule : r));
            Emit(ruleId, "error", 0, null, ex.Message);
            return rule;
        }
        finally
        {
            _inFlight.TryRemove(ruleId, out _);
        }
    }

    private async Task RunSingleFileAsync(MeshSyncRuleRecord rule, string fullPath)
    {
        try
        {
            await PushFileAsync(rule, fullPath, CancellationToken.None).ConfigureAwait(false);
            rule.LastSyncUtc = DateTime.UtcNow;
            rule.LastStatus = "watching";
            rule.LastError = null;
            _db.SaveSyncRules(_db.ListSyncRules().Select(r => r.Id == rule.Id ? rule : r));
            Emit(rule.Id, "watching", 100, fullPath, "Pushed");
        }
        catch (Exception ex)
        {
            rule.LastStatus = "error";
            rule.LastError = ex.Message;
            _db.SaveSyncRules(_db.ListSyncRules().Select(r => r.Id == rule.Id ? rule : r));
            Emit(rule.Id, "error", 0, fullPath, ex.Message);
        }
    }

    private async Task PushFileAsync(MeshSyncRuleRecord rule, string localFile, CancellationToken ct)
    {
        var rel = Path.GetRelativePath(rule.LocalPath, localFile).Replace('\\', '/');
        var remote = rule.RemotePath.TrimEnd('/') + "/" + rel;
        await _orchestrator.UploadLocalToRemoteAsync(rule.RemoteHostId, remote, localFile, ct).ConfigureAwait(false);
    }

    private void Emit(string ruleId, string status, int pct, string? file, string? msg) =>
        _onProgress?.Invoke(new MeshSyncProgress { RuleId = ruleId, Status = status, Percent = pct, CurrentFile = file, Message = msg });

    public void Dispose()
    {
        foreach (var w in _watchers.Values) { try { w.Dispose(); } catch { } }
        foreach (var t in _debounce.Values) { try { t.Dispose(); } catch { } }
    }
}
