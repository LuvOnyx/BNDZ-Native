using System.Diagnostics;
using System.IO;
using System.Text.Json;

namespace BNDZ.Services;

public sealed class BndzAutomationRunnerService
{
    private static readonly HashSet<string> DefaultArchiveExts = new(StringComparer.OrdinalIgnoreCase)
    {
        "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz",
    };

    public AutomationRunResult Run(JsonElement graph)
    {
        var log = new List<string>();
        try
        {
            var nodes = ParseNodes(graph);
            var edges = ParseEdges(graph);
            if (nodes.Count == 0)
                return Fail(log, "Pipeline has no blocks.");

            var order = TopologicalSort(nodes, edges);
            if (order == null)
                return Fail(log, "Pipeline has a cycle — fix connections.");

            var files = new List<string>();
            foreach (var nodeId in order)
            {
                var node = nodes[nodeId];
                log.Add($"▶ {node.Type} ({nodeId})");
                switch (node.Type)
                {
                    case "watchFolder":
                        files = WatchFolder(node, log);
                        break;
                    case "filterExtension":
                        files = FilterExtension(files, node, log);
                        break;
                    case "filterArchive":
                        files = FilterArchive(files, node, log);
                        break;
                    case "copyTo":
                        CopyFiles(files, node, log, move: false);
                        break;
                    case "moveTo":
                        CopyFiles(files, node, log, move: true);
                        break;
                    case "rsyncDeploy":
                        RsyncDeploy(files, node, log);
                        break;
                    case "log":
                        log.Add($"  · {GetField(node, "message", "Checkpoint")}");
                        break;
                    default:
                        log.Add($"  ! Unknown block: {node.Type}");
                        break;
                }
            }

            log.Add("✓ Pipeline finished.");
            return new AutomationRunResult { Ok = true, Log = log };
        }
        catch (Exception ex)
        {
            log.Add($"✗ {ex.Message}");
            return new AutomationRunResult { Ok = false, Log = log, Error = ex.Message };
        }
    }

    private static List<string> WatchFolder(AutomationNode node, List<string> log)
    {
        var path = GetField(node, "path");
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
        {
            log.Add("  ! Watch folder path missing or not found.");
            return [];
        }

        var files = Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories).ToList();
        log.Add($"  · Found {files.Count} file(s) under {path}");
        return files;
    }

    private static List<string> FilterExtension(List<string> files, AutomationNode node, List<string> log)
    {
        var raw = GetField(node, "extensions", "*");
        var exts = raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(e => e.TrimStart('.').ToLowerInvariant())
            .ToHashSet();
        if (exts.Contains("*"))
        {
            log.Add($"  · Pass-through {files.Count} file(s)");
            return files;
        }
        var filtered = files.Where(f => exts.Contains(Path.GetExtension(f).TrimStart('.').ToLowerInvariant())).ToList();
        log.Add($"  · {filtered.Count} file(s) match extension filter");
        return filtered;
    }

    private static List<string> FilterArchive(List<string> files, AutomationNode node, List<string> log)
    {
        var raw = GetField(node, "extensions", "");
        var exts = string.IsNullOrWhiteSpace(raw)
            ? DefaultArchiveExts
            : raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                .Select(e => e.TrimStart('.').ToLowerInvariant())
                .ToHashSet(StringComparer.OrdinalIgnoreCase);

        var filtered = files.Where(f =>
        {
            var ext = Path.GetExtension(f).TrimStart('.').ToLowerInvariant();
            return exts.Contains(ext);
        }).ToList();
        log.Add($"  · {filtered.Count} archive file(s)");
        return filtered;
    }

    private static void CopyFiles(List<string> files, AutomationNode node, List<string> log, bool move)
    {
        var dest = GetField(node, "dest");
        if (string.IsNullOrWhiteSpace(dest))
        {
            log.Add($"  ! {(move ? "Move" : "Copy")} destination missing.");
            return;
        }
        Directory.CreateDirectory(dest);
        var count = 0;
        foreach (var src in files)
        {
            if (!File.Exists(src)) continue;
            var name = Path.GetFileName(src);
            var target = Path.Combine(dest, name);
            if (move)
            {
                if (File.Exists(target)) File.Delete(target);
                File.Move(src, target);
            }
            else
            {
                File.Copy(src, target, overwrite: true);
            }
            count++;
        }
        log.Add($"  · {(move ? "Moved" : "Copied")} {count} file(s) → {dest}");
    }

    private static void RsyncDeploy(List<string> files, AutomationNode node, List<string> log)
    {
        var remote = GetField(node, "remote");
        if (string.IsNullOrWhiteSpace(remote))
        {
            log.Add("  ! Deploy target missing (user@host:/path or local folder).");
            return;
        }

        var source = GetField(node, "source");
        var extra = GetField(node, "extraArgs", "");

        string? localSource = null;
        if (!string.IsNullOrWhiteSpace(source) && Directory.Exists(source))
            localSource = source;
        else if (files.Count > 0)
        {
            var staging = Path.Combine(Path.GetTempPath(), "BNDZ", "automation", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(staging);
            foreach (var f in files)
            {
                if (!File.Exists(f)) continue;
                File.Copy(f, Path.Combine(staging, Path.GetFileName(f)), overwrite: true);
            }
            localSource = staging;
        }

        if (string.IsNullOrWhiteSpace(localSource))
        {
            log.Add("  ! No local source folder or pipeline files for deploy.");
            return;
        }

        // Local folder → robocopy mirror (built into Windows).
        if (!remote.Contains('@'))
        {
            Directory.CreateDirectory(remote);
            RobocopyMirror(localSource, remote, log);
            return;
        }

        // Remote user@host:/path → OpenSSH scp (ships with Windows 10+).
        if (TryParseRemoteTarget(remote, out var userHost, out var remotePath))
        {
            var scp = ResolveOpenSshTool("scp.exe");
            if (scp != null)
            {
                var args = $"-r -q \"{localSource.TrimEnd('\\', '/')}/*\" {userHost}:{remotePath}";
                RunProcess(scp, args, log, successLabel: "SCP deploy completed.");
                return;
            }
        }

        // Optional rsync when present — never required.
        var rsync = ResolveExecutable("rsync.exe", "rsync");
        if (rsync != null)
        {
            var rsyncArgs = string.IsNullOrWhiteSpace(extra) ? "-avz" : extra;
            RunProcess(rsync, $"{rsyncArgs} \"{localSource.TrimEnd('\\', '/')}\"/ \"{remote}\"", log, successLabel: "Rsync deploy completed.");
            return;
        }

        log.Add("  ! Deploy failed: use user@host:/path with Windows OpenSSH, or a local folder path.");
    }

    private static void RobocopyMirror(string source, string dest, List<string> log)
    {
        Directory.CreateDirectory(dest);
        var args = $"\"{source}\" \"{dest}\" /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NJH /NJS /NP";
        RunProcess("robocopy.exe", args, log, successLabel: "Robocopy deploy completed.", robocopy: true);
    }

    private static bool TryParseRemoteTarget(string remote, out string userHost, out string remotePath)
    {
        userHost = "";
        remotePath = "";
        var idx = remote.IndexOf(':');
        if (idx <= 0) return false;
        userHost = remote[..idx];
        remotePath = remote[(idx + 1)..];
        if (string.IsNullOrWhiteSpace(userHost) || string.IsNullOrWhiteSpace(remotePath)) return false;
        if (!remotePath.StartsWith('/')) remotePath = "/" + remotePath;
        return true;
    }

    private static string? ResolveOpenSshTool(string name)
    {
        var win = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "System32", "OpenSSH", name);
        if (File.Exists(win)) return win;
        return ResolveExecutable(name, name);
    }

    private static void RunProcess(string exe, string args, List<string> log, string successLabel = "Completed.", bool robocopy = false)
    {
        using var proc = Process.Start(new ProcessStartInfo
        {
            FileName = exe,
            Arguments = args,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        });
        if (proc == null)
        {
            log.Add("  ! Failed to start process.");
            return;
        }
        var stdout = proc.StandardOutput.ReadToEnd();
        var stderr = proc.StandardError.ReadToEnd();
        proc.WaitForExit(600_000);
        if (!string.IsNullOrWhiteSpace(stdout))
            log.AddRange(stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => $"  {l.Trim()}"));
        var exitOk = robocopy ? proc.ExitCode < 8 : proc.ExitCode == 0;
        if (!exitOk)
            log.Add($"  ! Exit {proc.ExitCode}: {stderr.Trim()}");
        else
            log.Add($"  · {successLabel}");
    }

    private static string? ResolveExecutable(string winName, string unixName)
    {
        foreach (var name in new[] { winName, unixName })
        {
            var path = FindOnPath(name);
            if (path != null) return path;
        }
        return null;
    }

    private static string? FindOnPath(string fileName)
    {
        var pathEnv = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(pathEnv)) return null;
        foreach (var dir in pathEnv.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var full = Path.Combine(dir.Trim(), fileName);
                if (File.Exists(full)) return full;
            }
            catch { /* skip */ }
        }
        return null;
    }

    private static Dictionary<string, AutomationNode> ParseNodes(JsonElement graph)
    {
        var map = new Dictionary<string, AutomationNode>(StringComparer.Ordinal);
        if (!graph.TryGetProperty("nodes", out var nodes) || nodes.ValueKind != JsonValueKind.Array)
            return map;
        foreach (var n in nodes.EnumerateArray())
        {
            var id = n.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
            var type = n.TryGetProperty("type", out var typeEl) ? typeEl.GetString() : null;
            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(type)) continue;
            var data = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (n.TryGetProperty("data", out var dataEl) && dataEl.ValueKind == JsonValueKind.Object)
            {
                foreach (var prop in dataEl.EnumerateObject())
                    data[prop.Name] = prop.Value.ValueKind == JsonValueKind.String
                        ? prop.Value.GetString() ?? ""
                        : prop.Value.ToString();
            }
            map[id] = new AutomationNode(id, type, data);
        }
        return map;
    }

    private static List<(string Source, string Target)> ParseEdges(JsonElement graph)
    {
        var list = new List<(string, string)>();
        if (!graph.TryGetProperty("edges", out var edges) || edges.ValueKind != JsonValueKind.Array)
            return list;
        foreach (var e in edges.EnumerateArray())
        {
            var src = e.TryGetProperty("source", out var s) ? s.GetString() : null;
            var tgt = e.TryGetProperty("target", out var t) ? t.GetString() : null;
            if (!string.IsNullOrEmpty(src) && !string.IsNullOrEmpty(tgt))
                list.Add((src, tgt));
        }
        return list;
    }

    private static List<string>? TopologicalSort(Dictionary<string, AutomationNode> nodes, List<(string Source, string Target)> edges)
    {
        var indegree = nodes.Keys.ToDictionary(k => k, _ => 0, StringComparer.Ordinal);
        var adj = nodes.Keys.ToDictionary(k => k, _ => new List<string>(), StringComparer.Ordinal);
        foreach (var (s, t) in edges)
        {
            if (!nodes.ContainsKey(s) || !nodes.ContainsKey(t)) continue;
            adj[s].Add(t);
            indegree[t]++;
        }
        var queue = new Queue<string>(indegree.Where(kv => kv.Value == 0).Select(kv => kv.Key));
        var order = new List<string>();
        while (queue.Count > 0)
        {
            var n = queue.Dequeue();
            order.Add(n);
            foreach (var next in adj[n])
            {
                indegree[next]--;
                if (indegree[next] == 0) queue.Enqueue(next);
            }
        }
        return order.Count == nodes.Count ? order : null;
    }

    private static string GetField(AutomationNode node, string key, string fallback = "")
        => node.Data.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v) ? v : fallback;

    private static AutomationRunResult Fail(List<string> log, string error)
    {
        log.Add($"✗ {error}");
        return new AutomationRunResult { Ok = false, Log = log, Error = error };
    }

    private sealed record AutomationNode(string Id, string Type, Dictionary<string, string> Data);
}

public sealed class AutomationRunResult
{
    public bool Ok { get; set; }
    public List<string> Log { get; set; } = [];
    public string? Error { get; set; }
}
