using System.Text.Json;

namespace BNDZ.Services;

/// <summary>Interval-based schedule triggers for armed automation pipelines.</summary>
public sealed class BndzAutomationSchedulerService : IDisposable
{
    private static readonly string PersistDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "BNDZ", "AutomationSchedules");

    private readonly AutomationRunnerDeps _runnerDeps;
    private readonly object _gate = new();
    private readonly Dictionary<string, ScheduleEntry> _schedules = new(StringComparer.Ordinal);
    private bool _disposed;

    public BndzAutomationSchedulerService(AutomationRunnerDeps runnerDeps)
    {
        _runnerDeps = runnerDeps;
    }

    public AutomationScheduleStatus SyncFromGraph(JsonElement graph)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            var pipelineId = graph.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "default" : "default";
            var desired = ParseSchedules(graph, pipelineId);
            var mine = _schedules.Where(kv => kv.Value.PipelineId == pipelineId).Select(kv => kv.Key).ToList();
            foreach (var id in mine)
            {
                if (!desired.ContainsKey(id))
                    RemoveSchedule(id);
            }

            foreach (var (id, meta) in desired)
            {
                if (_schedules.TryGetValue(id, out var existing))
                {
                    if (existing.IntervalMinutes != meta.IntervalMinutes)
                    {
                        RemoveSchedule(id);
                        AddSchedule(id, meta);
                    }
                    else
                    {
                        existing.GraphJson = meta.GraphJson;
                        existing.PipelineName = meta.PipelineName;
                    }
                    continue;
                }
                AddSchedule(id, meta);
            }

            PersistArmedState(pipelineId, graph);
            return BuildStatus();
        }
    }

    /// <summary>Restore schedules from %LocalAppData%/BNDZ/AutomationSchedules on host boot.</summary>
    public int RestorePersistedSchedules()
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            if (!Directory.Exists(PersistDir)) return 0;
            var count = 0;
            foreach (var file in Directory.EnumerateFiles(PersistDir, "*.json"))
            {
                try
                {
                    var json = File.ReadAllText(file);
                    using var doc = JsonDocument.Parse(json);
                    var graph = doc.RootElement;
                    var armed = graph.TryGetProperty("armed", out var armedEl) && armedEl.ValueKind == JsonValueKind.True;
                    if (!armed) { TryDeleteFile(file); continue; }
                    var pipelineId = graph.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "default" : "default";
                    var desired = ParseSchedules(graph, pipelineId);
                    foreach (var (key, meta) in desired)
                    {
                        if (!_schedules.ContainsKey(key))
                        {
                            AddSchedule(key, meta);
                            count++;
                        }
                    }
                }
                catch { /* skip corrupt */ }
            }
            return count;
        }
    }

    public AutomationScheduleStatus GetStatus()
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            return BuildStatus();
        }
    }

    public void StopAll()
    {
        lock (_gate)
        {
            foreach (var id in _schedules.Keys.ToList())
                RemoveSchedule(id);
        }
    }

    private AutomationScheduleStatus BuildStatus()
    {
        return new AutomationScheduleStatus
        {
            Schedules = _schedules.Values.Select(s => new AutomationScheduleInfo
            {
                NodeId = s.NodeId,
                PipelineName = s.PipelineName,
                IntervalMinutes = s.IntervalMinutes,
                Active = s.Timer != null,
                LastTriggeredAt = s.LastTriggeredAt,
                LastError = s.LastError,
            }).ToList(),
        };
    }

    private static Dictionary<string, ScheduleMeta> ParseSchedules(JsonElement graph, string pipelineId)
    {
        var result = new Dictionary<string, ScheduleMeta>(StringComparer.Ordinal);
        if (!graph.TryGetProperty("nodes", out var nodes) || nodes.ValueKind != JsonValueKind.Array)
            return result;

        var armed = graph.TryGetProperty("armed", out var armedEl) && armedEl.ValueKind == JsonValueKind.True;
        if (!armed) return result;

        var pipelineName = graph.TryGetProperty("name", out var nameEl) ? nameEl.GetString() ?? "Pipeline" : "Pipeline";
        var graphJson = graph.GetRawText();

        foreach (var n in nodes.EnumerateArray())
        {
            var type = n.TryGetProperty("type", out var typeEl) ? typeEl.GetString() : null;
            if (!string.Equals(type, "onSchedule", StringComparison.Ordinal)) continue;
            var id = n.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
            if (string.IsNullOrEmpty(id)) continue;
            if (!n.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object) continue;

            var enabled = true;
            if (data.TryGetProperty("enabled", out var en))
            {
                enabled = en.ValueKind switch
                {
                    JsonValueKind.False => false,
                    JsonValueKind.String => !string.Equals(en.GetString(), "false", StringComparison.OrdinalIgnoreCase),
                    _ => true,
                };
            }
            if (!enabled) continue;

            var minutes = 60;
            if (data.TryGetProperty("intervalMinutes", out var im))
            {
                if (im.ValueKind == JsonValueKind.Number && im.TryGetInt32(out var mins)) minutes = mins;
                else if (im.ValueKind == JsonValueKind.String && int.TryParse(im.GetString(), out var s)) minutes = s;
            }
            minutes = Math.Clamp(minutes, 1, 24 * 60);

            var key = $"{pipelineId}:{id}";
            result[key] = new ScheduleMeta
            {
                NodeId = id,
                PipelineId = pipelineId,
                GraphJson = graphJson,
                PipelineName = pipelineName,
                IntervalMinutes = minutes,
            };
        }

        return result;
    }

    private void AddSchedule(string id, ScheduleMeta meta)
    {
        var entry = new ScheduleEntry
        {
            NodeId = meta.NodeId,
            PipelineId = meta.PipelineId,
            PipelineName = meta.PipelineName,
            GraphJson = meta.GraphJson,
            IntervalMinutes = meta.IntervalMinutes,
        };
        var ms = Math.Max(60_000, meta.IntervalMinutes * 60_000);
        entry.Timer = new System.Threading.Timer(_ => RunScheduled(entry), null, ms, ms);
        _schedules[id] = entry;
    }

    private void RunScheduled(ScheduleEntry entry)
    {
        try
        {
            using var doc = JsonDocument.Parse(entry.GraphJson);
            var runner = new BndzAutomationRunnerService(_runnerDeps);
            var result = runner.Run(doc.RootElement);
            entry.LastTriggeredAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            entry.LastError = result.Ok ? null : result.Error;
        }
        catch (Exception ex)
        {
            entry.LastError = ex.Message;
        }
    }

    private void RemoveSchedule(string id)
    {
        if (!_schedules.TryGetValue(id, out var entry)) return;
        entry.Timer?.Dispose();
        _schedules.Remove(id);
    }

    private void PersistArmedState(string pipelineId, JsonElement graph)
    {
        try
        {
            Directory.CreateDirectory(PersistDir);
            var file = Path.Combine(PersistDir, $"{SanitizeFileName(pipelineId)}.json");
            var armed = graph.TryGetProperty("armed", out var armedEl) && armedEl.ValueKind == JsonValueKind.True;
            if (!armed) { TryDeleteFile(file); return; }
            File.WriteAllText(file, graph.GetRawText());
        }
        catch { /* best effort */ }
    }

    private static string SanitizeFileName(string name)
    {
        foreach (var c in Path.GetInvalidFileNameChars())
            name = name.Replace(c, '_');
        return name.Length > 80 ? name[..80] : name;
    }

    private static void TryDeleteFile(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { /* */ }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            foreach (var id in _schedules.Keys.ToList())
                RemoveSchedule(id);
        }
    }

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(BndzAutomationSchedulerService));
    }

    private sealed class ScheduleEntry
    {
        public string NodeId { get; set; } = "";
        public string PipelineId { get; set; } = "";
        public string PipelineName { get; set; } = "";
        public string GraphJson { get; set; } = "";
        public int IntervalMinutes { get; set; }
        public System.Threading.Timer? Timer { get; set; }
        public long? LastTriggeredAt { get; set; }
        public string? LastError { get; set; }
    }

    private sealed class ScheduleMeta
    {
        public string NodeId { get; set; } = "";
        public string PipelineId { get; set; } = "";
        public string GraphJson { get; set; } = "";
        public string PipelineName { get; set; } = "";
        public int IntervalMinutes { get; set; }
    }
}

public sealed class AutomationScheduleStatus
{
    public List<AutomationScheduleInfo> Schedules { get; set; } = [];
}

public sealed class AutomationScheduleInfo
{
    public string NodeId { get; set; } = "";
    public string PipelineName { get; set; } = "";
    public int IntervalMinutes { get; set; }
    public bool Active { get; set; }
    public long? LastTriggeredAt { get; set; }
    public string? LastError { get; set; }
}
