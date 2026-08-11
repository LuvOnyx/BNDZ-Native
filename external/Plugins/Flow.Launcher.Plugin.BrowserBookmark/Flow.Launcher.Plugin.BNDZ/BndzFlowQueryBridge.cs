using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Flow.Launcher.Plugin;

namespace Flow.Launcher.Plugin.BNDZ
{
    /// <summary>
    /// Bidirectional shell IPC — aggregates Flow plugin results for the BNDZ WebView2 launcher.
    /// Pipe: \\.\pipe\BNDZ.Launcher.Shell
    /// </summary>
    internal static class BndzFlowQueryBridge
    {
        private const string PipeName = "BNDZ.Launcher.Shell";
        private const string BndzPluginId = "Flow.Launcher.Plugin.BNDZ";
        private const string ProgramPluginId = "Flow.Launcher.Plugin.Program";
        private const string ExplorerPluginId = "Flow.Launcher.Plugin.Explorer";
        private const string WindowsSettingsPluginId = "Flow.Launcher.Plugin.WindowsSettings";
        private const string ShellPluginId = "Flow.Launcher.Plugin.Shell";
        private const string ProcessKillerPluginId = "Flow.Launcher.Plugin.ProcessKiller";

        private static readonly ConcurrentDictionary<string, Result> ResultCache = new(StringComparer.Ordinal);
        private static readonly ConcurrentDictionary<string, string> BndzOpenPathById = new(StringComparer.Ordinal);
        private static string _lastQueryText = "";
        private static readonly string[] PriorityPluginIds = [ProgramPluginId, ExplorerPluginId];
        private static readonly string[] SectionOrder = ["Applications", "BNDZ Launcher", "Apps & System", "Files", "Settings"];

        private static PluginInitContext? _context;
        private static CancellationTokenSource? _cts;

        public static void Start(PluginInitContext context)
        {
            _context = context;
            _cts?.Cancel();
            _cts = new CancellationTokenSource();
            _ = Task.Run(() => ListenLoopAsync(_cts.Token));
            _ = Task.Run(() => WarmupAsync());
        }

        public static void Stop()
        {
            try { _cts?.Cancel(); } catch { }
        }

        private static async Task WarmupAsync()
        {
            try
            {
                await Task.Delay(500);
                if (_context == null) return;
                var pair = _context.API.GetAllInitializedPlugins(includeFailed: false)
                    .FirstOrDefault(p => p.Metadata.ID == ProgramPluginId);
                if (pair == null) return;
                using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(8));
                var q = BuildQuery("");
                _ = await pair.Plugin.QueryAsync(q, cts.Token);
            }
            catch { }
        }

        private static async Task ListenLoopAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    await using var server = new NamedPipeServerStream(
                        PipeName,
                        PipeDirection.InOut,
                        NamedPipeServerStream.MaxAllowedServerInstances,
                        PipeTransmissionMode.Byte,
                        PipeOptions.Asynchronous);

                    await server.WaitForConnectionAsync(token);
                    var requestLine = await ReadLineAsync(server, token);
                    if (string.IsNullOrWhiteSpace(requestLine)) continue;

                    using var doc = JsonDocument.Parse(requestLine);
                    var response = Handle(doc.RootElement);
                    var responseJson = JsonSerializer.Serialize(response);
                    var bytes = Encoding.UTF8.GetBytes(responseJson + "\n");
                    await server.WriteAsync(bytes, token);
                    await server.FlushAsync(token);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex)
                {
                    _context?.API.LogError(nameof(BndzFlowQueryBridge), ex.Message);
                    await Task.Delay(200, token);
                }
            }
        }

        private static object Handle(JsonElement root)
        {
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : "";
            var requestId = root.TryGetProperty("requestId", out var rid) ? rid.GetString() : "";

            return type switch
            {
                "FLOW_QUERY" => FlowQuery(root, requestId),
                "FLOW_EXECUTE" => FlowExecute(root, requestId),
                "PLUGIN_LIST" => PluginList(requestId),
                "OPEN_PLUGIN_STORE" => OpenPluginStore(requestId),
                "FLOW_WARMUP" => Warmup(requestId),
                _ => new { type = $"{type}_RESULT", requestId, error = "unknown_type" },
            };
        }

        private static object Warmup(string? requestId)
        {
            _ = Task.Run(WarmupAsync);
            return new { type = "FLOW_WARMUP_RESULT", requestId, ok = true };
        }

        private static object FlowQuery(JsonElement root, string? requestId)
        {
            var queryText = root.TryGetProperty("query", out var q) ? q.GetString() ?? "" : "";
            _lastQueryText = queryText;
            var phase = root.TryGetProperty("phase", out var ph) ? ph.GetString() : "all";

            if (_context == null)
                return EmptyResult(requestId);

            var query = BuildQuery(queryText);
            var isHome = string.IsNullOrWhiteSpace(queryText.Trim());
            var plugins = _context.API.GetAllInitializedPlugins(includeFailed: false)
                .Where(p => p.Metadata.ID != BndzPluginId)
                .Where(p => !isHome || p.Metadata.ID != WindowsSettingsPluginId)
                .Where(p => ShouldQueryPlugin(p.Metadata.ID, queryText))
                .ToList();

            if (phase == "priority")
                plugins = plugins.Where(p => PriorityPluginIds.Contains(p.Metadata.ID)).ToList();
            else if (phase == "extensions")
                plugins = plugins.Where(p => !PriorityPluginIds.Contains(p.Metadata.ID)).ToList();

            var bag = new ConcurrentBag<(string section, object dto, int score)>();
            Parallel.ForEach(plugins, new ParallelOptions { MaxDegreeOfParallelism = 4 }, pair =>
            {
                try
                {
                    var timeoutMs = pair.Metadata.ID == ProgramPluginId ? 3500 : 1500;
                    using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(timeoutMs));
                    var task = pair.Plugin.QueryAsync(query, cts.Token);
                    if (!task.Wait(timeoutMs)) return;
                    var results = task.Result;
                    if (results == null || results.Count == 0) return;

                    var sectionName = MapSectionName(pair.Metadata);
                    var take = pair.Metadata.ID == ProgramPluginId ? 14 : 8;
                    foreach (var result in results.OrderByDescending(r => r.Score).Take(take))
                    {
                        var id = StableCommandId(pair, result);
                        ResultCache[id] = result;
                        var score = result.Score + ScoreBoost(pair.Metadata.ID, queryText);
                        bag.Add((sectionName, new
                        {
                            id,
                            title = result.Title,
                            subtitle = BndzBrandingText.Sanitize(result.SubTitle),
                            category = MapCategory(pair.Metadata.ID),
                            iconUrl = ResolveIconUrl(result, pair),
                            pluginId = pair.Metadata.ID,
                            actionKeyword = result.ActionKeywordAssigned,
                            score,
                            openPath = pair.Metadata.ID == ExplorerPluginId ? TryExtractExplorerPath(result) : null,
                            previewPath = pair.Metadata.ID == ExplorerPluginId ? TryExtractExplorerPath(result) : null,
                            previewKind = pair.Metadata.ID == ExplorerPluginId && TryExtractExplorerPath(result) is string ep && !string.IsNullOrWhiteSpace(ep)
                                ? (System.IO.File.Exists(ep) || System.IO.Directory.Exists(ep) ? InferPreviewKind(ep) : null)
                                : null,
                        }, score));

                        if (pair.Metadata.ID == ExplorerPluginId)
                        {
                            var filePath = TryExtractExplorerPath(result);
                            if (!string.IsNullOrWhiteSpace(filePath))
                            {
                                var bndzId = $"bndz-openpath-{filePath.GetHashCode(StringComparison.Ordinal):X8}";
                                BndzOpenPathById[bndzId] = filePath;
                                bag.Add((sectionName, new
                                {
                                    id = bndzId,
                                    title = $"Open in BNDZ — {result.Title}",
                                    subtitle = filePath,
                                    category = "bndz",
                                    iconUrl = ResolveIconUrl(result, pair),
                                    pluginId = BndzPluginId,
                                    actionKeyword = "",
                                    score = score + 9000,
                                    openPath = filePath,
                                    previewPath = filePath,
                                    previewKind = File.Exists(filePath) || Directory.Exists(filePath)
                                        ? BndzPreviewKind.Infer(filePath)
                                        : "unknown",
                                }, score + 9000));
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    _context.API.LogError(nameof(BndzFlowQueryBridge), $"{pair.Metadata.ID}: {ex.Message}");
                }
            });

            var sections = new Dictionary<string, List<object>>(StringComparer.OrdinalIgnoreCase);
            var items = bag.OrderByDescending(x => x.score).Select(x =>
            {
                if (!sections.ContainsKey(x.section))
                    sections[x.section] = new List<object>();
                sections[x.section].Add(x.dto);
                return x.dto;
            }).ToList();

            var sectionDtos = sections
                .OrderBy(kv => SectionSortKey(kv.Key))
                .Select(kv => new { title = kv.Key, items = kv.Value })
                .ToList();
            return new { type = "FLOW_QUERY_RESULT", requestId, commands = items, sections = sectionDtos };
        }

        private static bool ShouldQueryPlugin(string pluginId, string queryText)
        {
            var q = (queryText ?? "").Trim();
            if (string.IsNullOrEmpty(q)) return true;

            var simpleAppQuery = IsSimpleAppQuery(q);

            if (pluginId == ShellPluginId)
                return !simpleAppQuery || q.Contains('>') || q.Contains('|') || q.StartsWith("cmd", StringComparison.OrdinalIgnoreCase);

            if (pluginId == ProcessKillerPluginId)
                return !simpleAppQuery || q.Contains("kill", StringComparison.OrdinalIgnoreCase) || q.Contains("process", StringComparison.OrdinalIgnoreCase);

            if (pluginId == ExplorerPluginId && simpleAppQuery)
                return q.Contains('\\') || q.Contains('/') || q.Contains('.') || q.Length > 12;

            return true;
        }

        private static bool IsSimpleAppQuery(string q)
        {
            if (q.Length == 0 || q.Length > 48) return false;
            if (q.Contains('>') || q.Contains('|') || q.Contains('*') || q.Contains('?')) return false;
            return q.All(ch => char.IsLetterOrDigit(ch) || ch == ' ' || ch == '-' || ch == '_' || ch == '.');
        }

        private static int ScoreBoost(string pluginId, string queryText)
        {
            if (pluginId == ProgramPluginId) return 50_000;
            if (pluginId == ExplorerPluginId && !IsSimpleAppQuery(queryText)) return 5_000;
            if (pluginId == WindowsSettingsPluginId) return 2_000;
            if (pluginId == ShellPluginId || pluginId == ProcessKillerPluginId) return -10_000;
            return 0;
        }

        private static int SectionSortKey(string title)
        {
            var idx = Array.IndexOf(SectionOrder, title);
            return idx >= 0 ? idx : 100 + title.GetHashCode(StringComparison.OrdinalIgnoreCase);
        }

        private static object EmptyResult(string? requestId) =>
            new { type = "FLOW_QUERY_RESULT", requestId, commands = Array.Empty<object>(), sections = Array.Empty<object>() };

        private static string MapSectionName(PluginMetadata meta) => meta.ID switch
        {
            ProgramPluginId => "Applications",
            ExplorerPluginId => "Files",
            WindowsSettingsPluginId => "Settings",
            _ => BndzBrandingText.Sanitize(meta.Name) ?? meta.ID,
        };

        private static string MapCategory(string pluginId) => pluginId switch
        {
            ProgramPluginId => "app",
            ExplorerPluginId => "file",
            WindowsSettingsPluginId => "system",
            _ => "extension",
        };

        private static object FlowExecute(JsonElement root, string? requestId)
        {
            var commandId = root.TryGetProperty("commandId", out var cid) ? cid.GetString() ?? "" : "";

            if (commandId.StartsWith("bndz-openpath-", StringComparison.Ordinal))
            {
                if (BndzOpenPathById.TryGetValue(commandId, out var openPath) && !string.IsNullOrWhiteSpace(openPath))
                {
                    var ok = BndzIpcClient.TrySendOpenPath(openPath);
                    return new { type = "FLOW_EXECUTE_RESULT", requestId, ok };
                }
                return new { type = "FLOW_EXECUTE_RESULT", requestId, ok = false, error = "path_not_found" };
            }

            if (!ResultCache.TryGetValue(commandId, out var result))
            {
                var retryQuery = root.TryGetProperty("query", out var qEl) ? qEl.GetString() : null;
                if (string.IsNullOrWhiteSpace(retryQuery)) retryQuery = _lastQueryText;
                if (!string.IsNullOrWhiteSpace(retryQuery) && TryRecoverFromCacheMiss(commandId, retryQuery!, out result))
                {
                    // recovered
                }
                else
                    return new { type = "FLOW_EXECUTE_RESULT", requestId, ok = false, error = "not_found" };
            }

            try
            {
                var ctx = new ActionContext();
                var executed = result.ExecuteAsync(ctx).AsTask().GetAwaiter().GetResult();
                return new { type = "FLOW_EXECUTE_RESULT", requestId, ok = executed };
            }
            catch (Exception ex)
            {
                _context?.API.LogError(nameof(BndzFlowQueryBridge), ex.Message);
                return new { type = "FLOW_EXECUTE_RESULT", requestId, ok = false, error = ex.Message };
            }
        }

        private static object PluginList(string? requestId)
        {
            if (_context == null)
                return new { type = "PLUGIN_LIST_RESULT", requestId, plugins = Array.Empty<object>() };

            var plugins = _context.API.GetAllInitializedPlugins(includeFailed: true)
                .Where(p => p.Metadata.ID != BndzPluginId)
                .Select(p => new
                {
                    id = p.Metadata.ID,
                    name = BndzBrandingText.Sanitize(p.Metadata.Name),
                    version = p.Metadata.Version,
                    author = p.Metadata.Author,
                    description = BndzBrandingText.Sanitize(p.Metadata.Description),
                    actionKeyword = p.Metadata.ActionKeyword,
                    disabled = p.Metadata.Disabled,
                })
                .OrderBy(p => p.name)
                .ToList();

            return new { type = "PLUGIN_LIST_RESULT", requestId, plugins };
        }

        private static object OpenPluginStore(string? requestId)
        {
            try
            {
                _context?.API.OpenSettingDialog();
                return new { type = "OPEN_PLUGIN_STORE_RESULT", requestId, ok = true };
            }
            catch (Exception ex)
            {
                return new { type = "OPEN_PLUGIN_STORE_RESULT", requestId, ok = false, error = ex.Message };
            }
        }

        private static Query BuildQuery(string text)
        {
            var trimmed = (text ?? "").Trim();
            var terms = string.IsNullOrEmpty(trimmed)
                ? Array.Empty<string>()
                : trimmed.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var query = (Query)System.Runtime.CompilerServices.RuntimeHelpers.GetUninitializedObject(typeof(Query));
            SetQueryProp(query, nameof(Query.OriginalQuery), text ?? "");
            SetQueryProp(query, nameof(Query.TrimmedQuery), trimmed);
            SetQueryProp(query, nameof(Query.Search), trimmed);
            SetQueryProp(query, nameof(Query.SearchTerms), terms);
            SetQueryProp(query, nameof(Query.IsHomeQuery), string.IsNullOrEmpty(trimmed));
            SetQueryProp(query, nameof(Query.ActionKeyword), "");
            return query;
        }

        private static void SetQueryProp(Query query, string name, object? value)
        {
            typeof(Query).GetProperty(name)?.SetValue(query, value);
        }

        private static string StableCommandId(PluginPair pair, Result result)
        {
            var key = $"{pair.Metadata.ID}|{result.Title}|{result.SubTitle}|{result.ActionKeywordAssigned}";
            return $"flow-{pair.Metadata.ID}-{key.GetHashCode(StringComparison.Ordinal):X8}";
        }

        private static bool TryRecoverFromCacheMiss(string commandId, string queryText, out Result result)
        {
            result = null!;
            if (_context == null || string.IsNullOrWhiteSpace(queryText)) return false;
            try
            {
                var query = BuildQuery(queryText);
                var plugins = _context.API.GetAllInitializedPlugins(includeFailed: false)
                    .Where(p => p.Metadata.ID != BndzPluginId)
                    .Where(p => ShouldQueryPlugin(p.Metadata.ID, queryText))
                    .ToList();

                foreach (var pair in plugins)
                {
                    try
                    {
                        using var cts = new CancellationTokenSource(TimeSpan.FromMilliseconds(2500));
                        var task = pair.Plugin.QueryAsync(query, cts.Token);
                        var results = task.GetAwaiter().GetResult();
                        foreach (var r in results)
                        {
                            var id = StableCommandId(pair, r);
                            ResultCache[id] = r;
                            if (id == commandId)
                            {
                                result = r;
                                return true;
                            }
                        }
                    }
                    catch { }
                }
            }
            catch { }
            return false;
        }

        private static string InferPreviewKind(string path)
        {
            if (Directory.Exists(path)) return "folder";
            if (!File.Exists(path)) return "unknown";
            var ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext is ".zip" or ".rar" or ".7z" or ".tar" or ".gz") return "archive";
            if (ext is ".pdf") return "pdf";
            if (ext is ".jpg" or ".jpeg" or ".png" or ".gif" or ".bmp" or ".webp" or ".ico" or ".svg") return "image";
            if (ext is ".mp4" or ".mkv" or ".avi" or ".mov" or ".webm") return "video";
            if (ext is ".mp3" or ".wav" or ".ogg" or ".flac" or ".m4a") return "audio";
            if (ext is ".txt" or ".md" or ".json" or ".xml" or ".csv") return "text";
            if (ext is ".js" or ".ts" or ".cs" or ".py" or ".html" or ".css") return "code";
            return "unknown";
        }

        private static string? TryExtractExplorerPath(Result result)
        {
            var sub = result.SubTitle?.Trim();
            if (string.IsNullOrWhiteSpace(sub)) return null;
            if (sub.Length >= 2 && sub[1] == ':') return sub;
            if (sub.StartsWith("\\\\", StringComparison.Ordinal)) return sub;
            try
            {
                if (File.Exists(sub) || Directory.Exists(sub)) return sub;
            }
            catch { }
            return null;
        }

        private static string? ResolveIconUrl(Result result, PluginPair pair)
        {
            try
            {
                var path = result.IcoPathAbsolute;
                if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                {
                    var rel = result.IcoPath;
                    if (!string.IsNullOrWhiteSpace(rel))
                    {
                        var pluginDir = pair.Metadata.PluginDirectory;
                        path = Path.Combine(pluginDir, rel.Replace('/', Path.DirectorySeparatorChar));
                    }
                }
                if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
                    return $"https://bndz.launcher.local/icon?path={Uri.EscapeDataString(path)}";
            }
            catch { }
            return null;
        }

        private static async Task<string?> ReadLineAsync(Stream stream, CancellationToken token)
        {
            var sb = new StringBuilder();
            var buffer = new byte[1];
            while (true)
            {
                var read = await stream.ReadAsync(buffer.AsMemory(0, 1), token);
                if (read == 0) break;
                var ch = (char)buffer[0];
                if (ch == '\n') break;
                if (ch != '\r') sb.Append(ch);
            }
            return sb.Length == 0 ? null : sb.ToString();
        }
    }
}
