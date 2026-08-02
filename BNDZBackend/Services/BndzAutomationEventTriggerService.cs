using System.Collections.Concurrent;
using System.Text.Json;

namespace BNDZ.Services;

/// <summary>Fires armed automation pipelines for onStartup, indexChanged, and spatialPin triggers.</summary>
public sealed class BndzAutomationEventTriggerService
{
    private readonly AutomationRunnerDeps _runnerDeps;
    private readonly ConcurrentDictionary<string, ArmedGraph> _armed = new(StringComparer.Ordinal);
    private readonly HashSet<string> _startupFired = new(StringComparer.Ordinal);
    private readonly object _gate = new();

    public BndzAutomationEventTriggerService(AutomationRunnerDeps runnerDeps)
    {
        _runnerDeps = runnerDeps;
    }

    public void SyncFromGraph(JsonElement graph)
    {
        var id = graph.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "default" : "default";
        var name = graph.TryGetProperty("name", out var nameEl) ? nameEl.GetString() ?? id : id;
        var armed = graph.TryGetProperty("armed", out var armedEl) && armedEl.ValueKind == JsonValueKind.True;
        var hasStartup = false;
        var hasIndex = false;
        var hasSpatialPin = false;
        string? indexRoot = null;

        if (armed && graph.TryGetProperty("nodes", out var nodes) && nodes.ValueKind == JsonValueKind.Array)
        {
            foreach (var node in nodes.EnumerateArray())
            {
                var type = node.TryGetProperty("type", out var t) ? t.GetString() : null;
                if (type == "onStartup")
                {
                    var enabled = true;
                    if (node.TryGetProperty("data", out var data) && data.TryGetProperty("enabled", out var en))
                        enabled = en.ValueKind != JsonValueKind.False && en.GetString() is not ("false" or "0" or "no");
                    if (enabled) hasStartup = true;
                }
                if (type == "indexChanged")
                {
                    var enabled = true;
                    if (node.TryGetProperty("data", out var data))
                    {
                        if (data.TryGetProperty("enabled", out var en))
                            enabled = en.ValueKind != JsonValueKind.False && en.GetString() is not ("false" or "0" or "no");
                        if (data.TryGetProperty("root", out var rootEl))
                            indexRoot = rootEl.GetString();
                    }
                    if (enabled) hasIndex = true;
                }
                if (type == "spatialPin")
                {
                    hasSpatialPin = true;
                }
            }
        }

        if (!armed || (!hasStartup && !hasIndex && !hasSpatialPin))
        {
            _armed.TryRemove(id, out _);
            return;
        }

        _armed[id] = new ArmedGraph
        {
            Id = id,
            Name = name,
            GraphJson = graph.GetRawText(),
            HasStartup = hasStartup,
            HasIndexChanged = hasIndex,
            HasSpatialPin = hasSpatialPin,
            IndexRoot = string.IsNullOrWhiteSpace(indexRoot) ? null : indexRoot.Trim(),
        };
    }

    /// <summary>Run all armed onStartup pipelines once per session.</summary>
    public IReadOnlyList<AutomationRunResult> FireStartup()
    {
        var results = new List<AutomationRunResult>();
        foreach (var graph in _armed.Values.Where(g => g.HasStartup))
        {
            lock (_gate)
            {
                if (!_startupFired.Add(graph.Id)) continue;
            }
            results.Add(RunGraph(graph, triggerType: "onStartup", triggerFiles: null));
        }
        return results;
    }

    /// <summary>Run armed indexChanged pipelines after an index root finishes.</summary>
    public IReadOnlyList<AutomationRunResult> FireIndexChanged(string? indexedRoot)
    {
        var results = new List<AutomationRunResult>();
        var files = string.IsNullOrWhiteSpace(indexedRoot)
            ? Array.Empty<string>()
            : Directory.Exists(indexedRoot)
                ? Directory.EnumerateFiles(indexedRoot, "*", SearchOption.TopDirectoryOnly).Take(200).ToArray()
                : new[] { indexedRoot };

        foreach (var graph in _armed.Values.Where(g => g.HasIndexChanged))
        {
            if (!string.IsNullOrEmpty(graph.IndexRoot)
                && !string.IsNullOrEmpty(indexedRoot)
                && !indexedRoot.StartsWith(graph.IndexRoot, StringComparison.OrdinalIgnoreCase)
                && !graph.IndexRoot.StartsWith(indexedRoot, StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }
            results.Add(RunGraph(graph, triggerType: "indexChanged", triggerFiles: files));
        }
        return results;
    }

    public int CountArmedSpatialPins() => _armed.Values.Count(g => g.HasSpatialPin);

    /// <summary>Run armed spatialPin pipelines when Spatial Canvas pins / send-to-automation paths change.</summary>
    public IReadOnlyList<AutomationRunResult> FireSpatialPins(IReadOnlyList<string> paths)
    {
        var results = new List<AutomationRunResult>();
        var files = (paths ?? Array.Empty<string>())
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(p => p.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Take(500)
            .ToArray();
        if (files.Length == 0) return results;

        foreach (var graph in _armed.Values.Where(g => g.HasSpatialPin))
            results.Add(RunGraph(graph, triggerType: "spatialPin", triggerFiles: files));
        return results;
    }

    private AutomationRunResult RunGraph(ArmedGraph graph, string triggerType, IReadOnlyList<string>? triggerFiles)
    {
        try
        {
            using var doc = JsonDocument.Parse(graph.GraphJson);
            var root = doc.RootElement.Clone();
            // Inject triggerFiles into a mutable JSON object
            using var stream = new MemoryStream();
            using (var writer = new Utf8JsonWriter(stream))
            {
                writer.WriteStartObject();
                foreach (var prop in root.EnumerateObject())
                {
                    if (prop.NameEquals("triggerFiles")) continue;
                    prop.WriteTo(writer);
                }
                writer.WritePropertyName("triggerFiles");
                writer.WriteStartArray();
                if (triggerFiles != null)
                {
                    foreach (var f in triggerFiles)
                        writer.WriteStringValue(f);
                }
                writer.WriteEndArray();
                writer.WriteEndObject();
            }
            stream.Position = 0;
            using var injected = JsonDocument.Parse(stream);
            var runner = new BndzAutomationRunnerService(_runnerDeps);
            var result = runner.Run(injected.RootElement);
            result.Log.Insert(0, $"▶ {triggerType} · {graph.Name}");
            return result;
        }
        catch (Exception ex)
        {
            return new AutomationRunResult
            {
                Ok = false,
                Error = ex.Message,
                Log = [$"▶ {triggerType} · {graph.Name}", $"✗ {ex.Message}"],
            };
        }
    }

    private sealed class ArmedGraph
    {
        public string Id { get; init; } = "";
        public string Name { get; init; } = "";
        public string GraphJson { get; init; } = "";
        public bool HasStartup { get; init; }
        public bool HasIndexChanged { get; init; }
        public bool HasSpatialPin { get; init; }
        public string? IndexRoot { get; init; }
    }
}
