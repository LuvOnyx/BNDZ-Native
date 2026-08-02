using System.Collections.Concurrent;
using System.IO;
using System.Text.Json;

namespace BNDZ.Services;

/// <summary>
/// Live folder watchers that trigger automation pipelines when files change.
/// Synced from the frontend graph whenever the pipeline is saved or armed.
/// </summary>
public sealed class BndzAutomationWatcherService : IDisposable
{
    private readonly AutomationRunnerDeps _runnerDeps;
    private readonly object _gate = new();
    private readonly Dictionary<string, WatcherEntry> _watchers = new(StringComparer.OrdinalIgnoreCase);
    private readonly ConcurrentDictionary<string, DebounceBucket> _debounce = new(StringComparer.OrdinalIgnoreCase);
    private bool _disposed;

    public BndzAutomationWatcherService(AutomationRunnerDeps runnerDeps)
    {
        _runnerDeps = runnerDeps;
    }

    public AutomationLiveStatus SyncFromGraph(JsonElement graph)
    {
        lock (_gate)
        {
            ThrowIfDisposed();
            var pipelineId = graph.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "default" : "default";
            var desired = ParseWatchTargets(graph, pipelineId);
            var mine = _watchers.Where(kv => kv.Value.PipelineId == pipelineId).Select(kv => kv.Key).ToList();
            foreach (var key in mine)
            {
                if (!desired.ContainsKey(key))
                    RemoveWatcher(key);
            }

            foreach (var (key, meta) in desired)
            {
                if (_watchers.TryGetValue(key, out var existing))
                {
                    existing.GraphJson = meta.GraphJson;
                    existing.PipelineName = meta.PipelineName;
                    continue;
                }
                TryAddWatcher(key, meta);
            }

            return BuildStatus();
        }
    }

    public AutomationLiveStatus GetStatus()
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
            foreach (var key in _watchers.Keys.ToList())
                RemoveWatcher(key);
        }
    }

    private AutomationLiveStatus BuildStatus()
    {
        return new AutomationLiveStatus
        {
            Watchers = _watchers.Values.Select(w => new AutomationWatcherInfo
            {
                Path = w.Path,
                PipelineName = w.PipelineName,
                Live = w.Watcher?.EnableRaisingEvents == true,
                LastTriggeredAt = w.LastTriggeredAt,
                LastError = w.LastError,
            }).ToList(),
        };
    }

    private static Dictionary<string, WatchTargetMeta> ParseWatchTargets(JsonElement graph, string pipelineId)
    {
        var result = new Dictionary<string, WatchTargetMeta>(StringComparer.OrdinalIgnoreCase);
        if (!graph.TryGetProperty("nodes", out var nodes) || nodes.ValueKind != JsonValueKind.Array)
            return result;

        var armed = graph.TryGetProperty("armed", out var armedEl) && armedEl.ValueKind == JsonValueKind.True;
        if (!armed) return result;

        var pipelineName = graph.TryGetProperty("name", out var nameEl) ? nameEl.GetString() ?? "Pipeline" : "Pipeline";
        var graphJson = graph.GetRawText();

        foreach (var n in nodes.EnumerateArray())
        {
            var type = n.TryGetProperty("type", out var typeEl) ? typeEl.GetString() : null;
            if (!string.Equals(type, "watchFolder", StringComparison.Ordinal)) continue;
            if (!n.TryGetProperty("data", out var data) || data.ValueKind != JsonValueKind.Object) continue;

            var live = false;
            if (data.TryGetProperty("liveWatch", out var lw))
            {
                live = lw.ValueKind switch
                {
                    JsonValueKind.True => true,
                    JsonValueKind.String => string.Equals(lw.GetString(), "true", StringComparison.OrdinalIgnoreCase),
                    _ => false,
                };
            }
            if (!live) continue;

            var path = data.TryGetProperty("path", out var pEl) ? pEl.GetString()?.Trim() : null;
            if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path)) continue;

            var key = $"{pipelineId}|{path}";
            result[key] = new WatchTargetMeta
            {
                Path = path,
                PipelineId = pipelineId,
                GraphJson = graphJson,
                PipelineName = pipelineName,
            };
        }

        return result;
    }

    private void TryAddWatcher(string key, WatchTargetMeta meta)
    {
        try
        {
            var fsw = new FileSystemWatcher(meta.Path)
            {
                IncludeSubdirectories = true,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.LastWrite | NotifyFilters.CreationTime | NotifyFilters.Size,
                EnableRaisingEvents = true,
            };
            var entry = new WatcherEntry
            {
                Path = meta.Path,
                PipelineId = meta.PipelineId,
                PipelineName = meta.PipelineName,
                GraphJson = meta.GraphJson,
                Watcher = fsw,
            };
            FileSystemEventHandler handler = (_, e) => OnFileEvent(entry, e.FullPath);
            RenamedEventHandler renameHandler = (_, e) => OnFileEvent(entry, e.FullPath);
            fsw.Created += handler;
            fsw.Changed += handler;
            fsw.Renamed += renameHandler;
            _watchers[key] = entry;
        }
        catch (Exception ex)
        {
            _watchers[key] = new WatcherEntry
            {
                Path = meta.Path,
                PipelineId = meta.PipelineId,
                PipelineName = meta.PipelineName,
                GraphJson = meta.GraphJson,
                LastError = ex.Message,
            };
        }
    }

    private void OnFileEvent(WatcherEntry entry, string fullPath)
    {
        if (string.IsNullOrWhiteSpace(fullPath) || Directory.Exists(fullPath)) return;
        var bucketKey = $"{entry.PipelineId}|{entry.Path}";
        var bucket = _debounce.GetOrAdd(bucketKey, _ => new DebounceBucket());
        lock (bucket.Gate)
        {
            bucket.Files.Add(fullPath);
            bucket.Timer?.Dispose();
            bucket.Timer = new System.Threading.Timer(_ => FlushDebounce(entry), null, 800, Timeout.Infinite);
        }
    }

    private void FlushDebounce(WatcherEntry entry)
    {
        var bucketKey = $"{entry.PipelineId}|{entry.Path}";
        if (!_debounce.TryGetValue(bucketKey, out var bucket)) return;
        List<string> files;
        lock (bucket.Gate)
        {
            files = bucket.Files.Distinct(StringComparer.OrdinalIgnoreCase).Where(File.Exists).ToList();
            bucket.Files.Clear();
            bucket.Timer?.Dispose();
            bucket.Timer = null;
        }
        if (files.Count == 0) return;

        try
        {
            using var doc = JsonDocument.Parse(entry.GraphJson);
            var root = doc.RootElement.Clone();
            using var ms = new MemoryStream();
            using (var writer = new Utf8JsonWriter(ms))
            {
                writer.WriteStartObject();
                foreach (var prop in root.EnumerateObject())
                {
                    if (prop.NameEquals("triggerFiles")) continue;
                    prop.WriteTo(writer);
                }
                writer.WritePropertyName("triggerFiles");
                writer.WriteStartArray();
                foreach (var f in files) writer.WriteStringValue(f);
                writer.WriteEndArray();
                writer.WriteEndObject();
            }
            ms.Position = 0;
            using var merged = JsonDocument.Parse(ms);
            var runner = new BndzAutomationRunnerService(_runnerDeps);
            var result = runner.Run(merged.RootElement);
            entry.LastTriggeredAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
            entry.LastError = result.Ok ? null : result.Error;
            entry.LastLog = result.Log;
        }
        catch (Exception ex)
        {
            entry.LastError = ex.Message;
        }
    }

    private void RemoveWatcher(string key)
    {
        if (!_watchers.TryGetValue(key, out var entry)) return;
        try
        {
            if (entry.Watcher != null)
            {
                entry.Watcher.EnableRaisingEvents = false;
                entry.Watcher.Dispose();
            }
        }
        catch { /* best effort */ }
        _watchers.Remove(key);
        if (_debounce.TryRemove(key, out var bucket))
        {
            lock (bucket.Gate)
            {
                bucket.Timer?.Dispose();
                bucket.Files.Clear();
            }
        }
    }

    public void Dispose()
    {
        lock (_gate)
        {
            if (_disposed) return;
            _disposed = true;
            foreach (var key in _watchers.Keys.ToList())
                RemoveWatcher(key);
        }
    }

    private void ThrowIfDisposed()
    {
        if (_disposed) throw new ObjectDisposedException(nameof(BndzAutomationWatcherService));
    }

    private sealed class WatcherEntry
    {
        public string Path { get; set; } = "";
        public string PipelineId { get; set; } = "";
        public string PipelineName { get; set; } = "";
        public string GraphJson { get; set; } = "";
        public FileSystemWatcher? Watcher { get; set; }
        public long? LastTriggeredAt { get; set; }
        public string? LastError { get; set; }
        public List<string>? LastLog { get; set; }
    }

    private sealed class WatchTargetMeta
    {
        public string Path { get; set; } = "";
        public string PipelineId { get; set; } = "";
        public string GraphJson { get; set; } = "";
        public string PipelineName { get; set; } = "";
    }

    private sealed class DebounceBucket
    {
        public object Gate { get; } = new();
        public HashSet<string> Files { get; } = new(StringComparer.OrdinalIgnoreCase);
        public System.Threading.Timer? Timer { get; set; }
    }
}

public sealed class AutomationLiveStatus
{
    public List<AutomationWatcherInfo> Watchers { get; set; } = [];
}

public sealed class AutomationWatcherInfo
{
    public string Path { get; set; } = "";
    public string PipelineName { get; set; } = "";
    public bool Live { get; set; }
    public long? LastTriggeredAt { get; set; }
    public string? LastError { get; set; }
}
