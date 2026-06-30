using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace BNDZ.Services;

/// <summary>Client for Flow plugin query bridge (\\.\pipe\BNDZ.Launcher.Shell).</summary>
public static class BndzShellQueryClient
{
    private const string PipeName = "BNDZ.Launcher.Shell";
    private const int QueryTimeoutMs = 6000;
    private const int ExecuteTimeoutMs = 8000;

    public static FlowQueryResult? QueryFlowPlugins(string? query, string phase = "all")
    {
        return Send<FlowQueryResult>("FLOW_QUERY", new { query = query ?? "", phase });
    }

    public static void WarmupFlowPlugins()
    {
        try { Send<FlowWarmupResult>("FLOW_WARMUP"); } catch { }
    }

    public static bool ExecuteFlowCommand(string commandId, string? query = null)
    {
        var res = Send<FlowExecuteResult>("FLOW_EXECUTE", new { commandId, query }, ExecuteTimeoutMs);
        return res?.ok == true;
    }

    public static PluginListResult? ListPlugins()
    {
        return Send<PluginListResult>("PLUGIN_LIST");
    }

    public static bool OpenPluginStore()
    {
        var res = Send<OpenStoreResult>("OPEN_PLUGIN_STORE");
        return res?.ok == true;
    }

    private static T? Send<T>(string type, object? extra = null, int timeoutMs = QueryTimeoutMs) where T : class
    {
        try
        {
            if (!BndzFlowLauncherService.Instance.IsRunning) return null;

            var requestId = $"{type}_{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
            using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
            client.Connect(timeoutMs);

            var requestObj = new Dictionary<string, object?> { ["type"] = type, ["requestId"] = requestId };
            if (extra != null)
            {
                foreach (var prop in JsonSerializer.Deserialize<Dictionary<string, object?>>(JsonSerializer.Serialize(extra))!)
                    requestObj[prop.Key] = prop.Value;
            }

            var requestJson = JsonSerializer.Serialize(requestObj) + "\n";
            var reqBytes = Encoding.UTF8.GetBytes(requestJson);
            client.Write(reqBytes, 0, reqBytes.Length);
            client.Flush();

            var responseLine = ReadLine(client, timeoutMs);
            if (string.IsNullOrWhiteSpace(responseLine)) return null;

            return JsonSerializer.Deserialize<T>(responseLine, new JsonSerializerOptions
            {
                PropertyNameCaseInsensitive = true,
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzShellQueryClient] {type}: {ex.Message}");
            return null;
        }
    }

    private static string? ReadLine(Stream stream, int timeoutMs)
    {
        var sb = new StringBuilder();
        var buffer = new byte[1];
        var deadline = Environment.TickCount64 + timeoutMs;
        while (Environment.TickCount64 < deadline)
        {
            if (stream.Read(buffer, 0, 1) == 0) break;
            var ch = (char)buffer[0];
            if (ch == '\n') break;
            if (ch != '\r') sb.Append(ch);
        }
        return sb.Length == 0 ? null : sb.ToString();
    }

    public sealed class FlowQueryResult
    {
        public string? type { get; set; }
        public string? requestId { get; set; }
        public List<FlowCommandDto> commands { get; set; } = [];
        public List<FlowSectionDto> sections { get; set; } = [];
    }

    public sealed class FlowCommandDto
    {
        public string id { get; set; } = "";
        public string title { get; set; } = "";
        public string? subtitle { get; set; }
        public string category { get; set; } = "extension";
        public string? iconUrl { get; set; }
        public string? pluginId { get; set; }
        public string? actionKeyword { get; set; }
        public string? openPath { get; set; }
        public string? previewPath { get; set; }
        public string? previewKind { get; set; }
    }

    public sealed class FlowSectionDto
    {
        public string title { get; set; } = "";
        public List<FlowCommandDto> items { get; set; } = [];
    }

    public sealed class FlowExecuteResult
    {
        public bool ok { get; set; }
        public string? error { get; set; }
    }

    public sealed class PluginListResult
    {
        public List<PluginInfoDto> plugins { get; set; } = [];
    }

    public sealed class PluginInfoDto
    {
        public string id { get; set; } = "";
        public string name { get; set; } = "";
        public string? version { get; set; }
        public string? author { get; set; }
        public string? description { get; set; }
        public string? actionKeyword { get; set; }
        public bool disabled { get; set; }
    }

    private sealed class OpenStoreResult
    {
        public bool ok { get; set; }
    }

    private sealed class FlowWarmupResult
    {
        public bool ok { get; set; }
    }
}
