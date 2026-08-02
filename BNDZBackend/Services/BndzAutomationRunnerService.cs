using System.Diagnostics;
using System.IO;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

public sealed class AutomationRunnerDeps
{
    public GhostLink.GhostLinkService? GhostLink { get; init; }
    public RamStaging.RamStagingService? RamStaging { get; init; }
    public BndzTagSidecarStore? TagStore { get; init; }
    public ArchiveService? ArchiveService { get; init; }
    public ShellContextMenuService? ShellContext { get; init; }
    public IntPtr HostWindow { get; set; }
}

public sealed class BndzAutomationRunnerService
{
    private readonly AutomationRunnerDeps _deps;

    private static readonly HashSet<string> DefaultArchiveExts = new(StringComparer.OrdinalIgnoreCase)
    {
        "zip", "rar", "7z", "tar", "gz", "tgz", "bz2", "xz", "tar.gz", "tar.bz2", "tar.xz",
    };

    public BndzAutomationRunnerService(AutomationRunnerDeps deps)
    {
        _deps = deps;
    }

    public BndzAutomationRunnerService(GhostLink.GhostLinkService? ghostLink = null)
        : this(new AutomationRunnerDeps { GhostLink = ghostLink })
    {
    }

    public AutomationRunResult Run(JsonElement graph)
    {
        var log = new List<string>();
        try
        {
            var nodes = ParseNodes(graph);
            var edges = ParseEdges(graph);
            if (nodes.Count == 0)
                return Fail(log, "Pipeline has no blocks.");

            List<string>? triggerFiles = null;
            if (graph.TryGetProperty("triggerFiles", out var tf) && tf.ValueKind == JsonValueKind.Array)
            {
                triggerFiles = tf.EnumerateArray()
                    .Select(e => e.GetString() ?? "")
                    .Where(p => !string.IsNullOrWhiteSpace(p))
                    .ToList();
            }

            var triggers = nodes.Values.Where(n => BndzAutomationExtensions.IsTriggerType(n.Type)).ToList();
            if (triggers.Count == 0)
                return Fail(log, "Pipeline has no trigger block.");

            foreach (var trigger in triggers)
            {
                var files = ResolveTriggerFiles(trigger, triggerFiles, nodes, log);
                WalkFrom(trigger.Id, files, nodes, edges, log, new HashSet<string>(StringComparer.Ordinal));
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

    private void WalkFrom(
        string nodeId,
        List<string> files,
        Dictionary<string, AutomationNode> nodes,
        List<AutomationEdge> edges,
        List<string> log,
        HashSet<string> visited)
    {
        if (!nodes.TryGetValue(nodeId, out var node)) return;
        if (!visited.Add(nodeId))
        {
            log.Add($"  ! Cycle detected at {node.Type} ({nodeId}) — skipped.");
            return;
        }

        log.Add($"▶ {node.Type} ({nodeId})");
        files = ProcessNode(node, files, log);

        if (node.Type == "branch")
        {
            var (trueFiles, falseFiles) = SplitBranch(node, files, log);
            foreach (var edge in edges.Where(e => e.Source == nodeId && e.SourceHandle == "true"))
                WalkFrom(edge.Target, trueFiles, nodes, edges, log, new HashSet<string>(visited));
            foreach (var edge in edges.Where(e => e.Source == nodeId && e.SourceHandle == "false"))
                WalkFrom(edge.Target, falseFiles, nodes, edges, log, new HashSet<string>(visited));
            foreach (var edge in edges.Where(e => e.Source == nodeId && string.IsNullOrEmpty(e.SourceHandle)))
                WalkFrom(edge.Target, trueFiles, nodes, edges, log, new HashSet<string>(visited));
            return;
        }

        foreach (var edge in edges.Where(e => e.Source == nodeId))
            WalkFrom(edge.Target, files, nodes, edges, log, new HashSet<string>(visited));
    }

    private List<string> ResolveTriggerFiles(
        AutomationNode trigger,
        List<string>? injected,
        Dictionary<string, AutomationNode> nodes,
        List<string> log)
    {
        switch (trigger.Type)
        {
            case "watchFolder":
                return WatchFolder(trigger, injected, log);
            case "manualRun":
                return injected ?? [];
            case "spatialPin":
                return injected ?? ParsePathList(trigger, log);
            case "onStartup":
                if (injected is { Count: > 0 }) return injected;
                log.Add("  · Startup trigger — continuing with empty path set.");
                return [];
            case "indexChanged":
                if (injected is { Count: > 0 })
                {
                    log.Add($"  · Index changed: {injected.Count} path(s)");
                    return injected;
                }
                log.Add("  · Index changed trigger with no paths.");
                return [];
            case "onSchedule":
                {
                    // Prefer an explicit scan folder on the schedule node; otherwise
                    // reuse any watchFolder path already present in this graph.
                    var schedulePath = BndzAutomationExtensions.GetField(trigger.Data, "path");
                    if (string.IsNullOrWhiteSpace(schedulePath))
                    {
                        foreach (var n in nodes.Values)
                        {
                            if (!string.Equals(n.Type, "watchFolder", StringComparison.OrdinalIgnoreCase)) continue;
                            var p = BndzAutomationExtensions.GetField(n.Data, "path");
                            if (!string.IsNullOrWhiteSpace(p))
                            {
                                schedulePath = p;
                                break;
                            }
                        }
                    }
                    var scheduleData = new Dictionary<string, string>(trigger.Data, StringComparer.OrdinalIgnoreCase);
                    if (!string.IsNullOrWhiteSpace(schedulePath))
                        scheduleData["path"] = schedulePath!;
                    return WatchFolder(
                        new AutomationNode(trigger.Id, "watchFolder", scheduleData),
                        injected, log);
                }
            default:
                return injected ?? [];
        }
    }

    private static List<string> ParsePathList(AutomationNode node, List<string> log)
    {
        var raw = BndzAutomationExtensions.GetField(node.Data, "paths");
        if (string.IsNullOrWhiteSpace(raw))
        {
            log.Add("  · Spatial pin trigger: no paths configured.");
            return [];
        }
        var list = raw.Split(['\n', '\r', '|'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(p => File.Exists(p) || Directory.Exists(p))
            .ToList();
        log.Add($"  · Spatial pin trigger: {list.Count} path(s)");
        return list;
    }

    private List<string> ProcessNode(AutomationNode node, List<string> files, List<string> log)
    {
        switch (node.Type)
        {
            case "watchFolder":
            case "manualRun":
            case "onSchedule":
            case "onStartup":
            case "indexChanged":
            case "spatialPin":
            case "branch":
                return files;
            case "filterExtension":
                return FilterExtension(files, node, log);
            case "filterArchive":
                return FilterArchive(files, node, log);
            case "filterSize":
                return FilterSize(files, node, log);
            case "filterAge":
                return FilterAge(files, node, log);
            case "filterTag":
                return FilterTag(files, node, log);
            case "filterContent":
                return FilterContent(files, node, log);
            case "duplicatesOnly":
                return FilterDuplicates(files, node, log);
            case "copyTo":
                CopyFiles(files, node, log, move: false);
                return files;
            case "moveTo":
                CopyFiles(files, node, log, move: true);
                return [];
            case "rsyncDeploy":
                RsyncDeploy(files, node, log);
                return files;
            case "ghostLinkTo":
                GhostLinkOffload(files, node, log);
                return [];
            case "stageToRam":
                StageToRam(files, node, log);
                return files;
            case "recycleBin":
                RecycleFiles(files, node, log);
                return [];
            case "compressArchive":
                CompressFiles(files, node, log);
                return files;
            case "extractArchive":
                ExtractArchives(files, node, log);
                return files;
            case "syncFolders":
                SyncFolders(files, node, log);
                return files;
            case "generateThumbnail":
                GenerateThumbnails(files, node, log);
                return files;
            case "applyTag":
                ApplyTag(files, node, log);
                return files;
            case "notifyToast":
                NotifyToast(node, log);
                return files;
            case "runShell":
                RunShell(node, log);
                return files;
            case "delay":
                Delay(node, log);
                return files;
            case "stopAbort":
                AbortPipeline(node, log);
                return files;
            case "batchCounter":
                return BatchCounter(files, node, log);
            case "log":
                return LogCheckpoint(node, log, files);
            default:
                log.Add($"  ! Unknown block: {node.Type}");
                return files;
        }
    }

    private static List<string> LogCheckpoint(AutomationNode node, List<string> log, List<string> files)
    {
        var msg = BndzAutomationExtensions.GetField(node.Data, "message", "Checkpoint");
        log.Add($"  · {msg} ({files.Count} file(s) in pipeline)");
        return files;
    }

    private static List<string> WatchFolder(AutomationNode node, List<string>? injected, List<string> log)
    {
        if (injected is { Count: > 0 })
        {
            log.Add($"  · Live trigger: {injected.Count} changed file(s)");
            return injected.Where(File.Exists).ToList();
        }

        var path = BndzAutomationExtensions.GetField(node.Data, "path");
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
        {
            log.Add("  ! Watch folder path missing or not found.");
            return [];
        }

        var includeSubdirs = BndzAutomationExtensions.GetBool(node.Data, "includeSubdirs", true);
        var option = includeSubdirs ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
        var all = Directory.EnumerateFiles(path, "*", option).ToList();
        log.Add($"  · Scanned {all.Count} file(s) under {path}");
        return all;
    }

    private static List<string> FilterExtension(List<string> files, AutomationNode node, List<string> log)
    {
        var raw = BndzAutomationExtensions.GetField(node.Data, "extensions", "*");
        var exts = BndzAutomationExtensions.ParseExtensionList(raw, allowWildcard: true);
        if (exts.Contains("*"))
        {
            log.Add($"  · Pass-through {files.Count} file(s)");
            return files;
        }
        var filtered = files.Where(f => BndzAutomationExtensions.MatchesExtension(f, exts)).ToList();
        log.Add($"  · {filtered.Count} file(s) match extension filter");
        return filtered;
    }

    private static List<string> FilterArchive(List<string> files, AutomationNode node, List<string> log)
    {
        var raw = BndzAutomationExtensions.GetField(node.Data, "extensions", "");
        var exts = string.IsNullOrWhiteSpace(raw)
            ? DefaultArchiveExts
            : BndzAutomationExtensions.ParseExtensionList(raw);
        var filtered = files.Where(f => BndzAutomationExtensions.MatchesExtension(f, exts)).ToList();
        log.Add($"  · {filtered.Count} archive file(s)");
        return filtered;
    }

    private static List<string> FilterSize(List<string> files, AutomationNode node, List<string> log)
    {
        var minBytes = BndzAutomationExtensions.ParseSizeBytes(BndzAutomationExtensions.GetField(node.Data, "minSize"));
        var maxRaw = BndzAutomationExtensions.GetField(node.Data, "maxSize");
        var maxBytes = string.IsNullOrWhiteSpace(maxRaw) ? long.MaxValue : BndzAutomationExtensions.ParseSizeBytes(maxRaw);
        var filtered = files.Where(f =>
        {
            if (!File.Exists(f)) return false;
            try
            {
                var len = new FileInfo(f).Length;
                return len >= minBytes && len <= maxBytes;
            }
            catch { return false; }
        }).ToList();
        log.Add($"  · {filtered.Count} file(s) within size range");
        return filtered;
    }

    private static List<string> FilterAge(List<string> files, AutomationNode node, List<string> log)
    {
        var mode = BndzAutomationExtensions.GetField(node.Data, "mode", "olderThan");
        if (!int.TryParse(BndzAutomationExtensions.GetField(node.Data, "days", "7"), out var days) || days < 0)
            days = 7;
        var cutoff = DateTime.UtcNow.AddDays(-days);
        var filtered = files.Where(f =>
        {
            if (!File.Exists(f)) return false;
            try
            {
                var modified = File.GetLastWriteTimeUtc(f);
                return mode.Equals("newerThan", StringComparison.OrdinalIgnoreCase)
                    ? modified >= cutoff
                    : modified < cutoff;
            }
            catch { return false; }
        }).ToList();
        log.Add($"  · {filtered.Count} file(s) {mode} {days} day(s)");
        return filtered;
    }

    private List<string> FilterTag(List<string> files, AutomationNode node, List<string> log)
    {
        var required = BndzAutomationExtensions.GetField(node.Data, "tag");
        if (string.IsNullOrWhiteSpace(required))
        {
            log.Add("  ! Filter tag: no tag specified.");
            return files;
        }
        if (_deps.TagStore == null)
        {
            log.Add("  ! Tag store unavailable.");
            return [];
        }
        var filtered = files.Where(f =>
        {
            var entry = _deps.TagStore.Get(f);
            return entry?.Tags?.Any(t => t.Equals(required, StringComparison.OrdinalIgnoreCase)) == true;
        }).ToList();
        log.Add($"  · {filtered.Count} file(s) tagged '{required}'");
        return filtered;
    }

    private List<string> FilterContent(List<string> files, AutomationNode node, List<string> log)
    {
        var pattern = BndzAutomationExtensions.GetField(node.Data, "pattern");
        if (string.IsNullOrWhiteSpace(pattern))
        {
            log.Add("  ! Content filter: no pattern specified.");
            return files;
        }
        var useRegex = BndzAutomationExtensions.GetBool(node.Data, "regex");
        var filtered = new List<string>();
        foreach (var f in files)
        {
            if (!File.Exists(f)) continue;
            try
            {
                var fi = new FileInfo(f);
                if (fi.Length > 4 * 1024 * 1024) continue;
                var text = File.ReadAllText(f);
                var hit = useRegex
                    ? Regex.IsMatch(text, pattern, RegexOptions.IgnoreCase, TimeSpan.FromSeconds(2))
                    : text.Contains(pattern, StringComparison.OrdinalIgnoreCase);
                if (hit) filtered.Add(f);
            }
            catch { /* skip unreadable */ }
        }
        log.Add($"  · {filtered.Count} file(s) match content pattern");
        return filtered;
    }

    private static (List<string> TrueFiles, List<string> FalseFiles) SplitBranch(AutomationNode node, List<string> files, List<string> log)
    {
        var condition = BndzAutomationExtensions.GetField(node.Data, "condition", "anyFiles");
        return condition switch
        {
            "noFiles" => ([], files),
            "matchesExtension" => SplitByExtension(node, files, log),
            _ => files.Count > 0 ? (files, []) : ([], files),
        };
    }

    private static (List<string>, List<string>) SplitByExtension(AutomationNode node, List<string> files, List<string> log)
    {
        var exts = BndzAutomationExtensions.ParseExtensionList(
            BndzAutomationExtensions.GetField(node.Data, "extensions", "*"), allowWildcard: true);
        var yes = files.Where(f => BndzAutomationExtensions.MatchesExtension(f, exts)).ToList();
        var no = files.Except(yes, StringComparer.OrdinalIgnoreCase).ToList();
        log.Add($"  · Branch: {yes.Count} match / {no.Count} no-match");
        return (yes, no);
    }

    private static void CopyFiles(List<string> files, AutomationNode node, List<string> log, bool move)
    {
        var dest = BndzAutomationExtensions.GetField(node.Data, "dest");
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

    private void GhostLinkOffload(List<string> files, AutomationNode node, List<string> log)
    {
        var cold = BndzAutomationExtensions.GetField(node.Data, "coldStorageRoot");
        if (string.IsNullOrWhiteSpace(cold))
        {
            log.Add("  ! Ghost-Link cold storage root missing.");
            return;
        }
        if (_deps.GhostLink == null)
        {
            log.Add("  ! Ghost-Link service unavailable.");
            return;
        }
        var targets = BndzAutomationExtensions.ExistingFiles(files);
        if (targets.Count == 0)
        {
            log.Add("  ! No files to offload.");
            return;
        }
        try
        {
            var reclaimed = _deps.GhostLink.OffloadPathsAsync(targets, cold).GetAwaiter().GetResult();
            log.Add($"  · Ghost-Link offloaded {targets.Count} file(s), reclaimed {reclaimed} bytes");
        }
        catch (Exception ex)
        {
            log.Add($"  ! Ghost-Link offload failed: {ex.Message}");
        }
    }

    private void StageToRam(List<string> files, AutomationNode node, List<string> log)
    {
        if (_deps.RamStaging == null)
        {
            log.Add("  ! RAM Staging service unavailable.");
            return;
        }
        var targets = files.Where(p => File.Exists(p) || Directory.Exists(p)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        if (targets.Count == 0)
        {
            log.Add("  ! No files/folders to stage.");
            return;
        }
        try
        {
            var zoneId = BndzAutomationExtensions.GetField(node.Data, "zoneId");
            var zoneName = BndzAutomationExtensions.GetField(node.Data, "zoneName", "Automation Staging");
            var sizeRaw = BndzAutomationExtensions.GetField(node.Data, "sizeBudgetMb", "4096");
            long sizeMb = 4096;
            if (long.TryParse(sizeRaw.Trim().TrimEnd('M', 'B', 'm', 'b'), out var parsedMb) && parsedMb > 0)
                sizeMb = Math.Clamp(parsedMb, 256, 65536);
            if (string.IsNullOrWhiteSpace(zoneId))
            {
                var existing = _deps.RamStaging.ListZones().FirstOrDefault(z =>
                    !string.IsNullOrWhiteSpace(z.MountPath) && Directory.Exists(z.MountPath));
                if (existing != null) zoneId = existing.Id;
            }
            if (string.IsNullOrWhiteSpace(zoneId))
            {
                var zone = _deps.RamStaging.CreateZoneAsync(zoneName, sizeMb <= 0 ? 4096 : sizeMb, preferRam: true).GetAwaiter().GetResult();
                zoneId = zone.Id;
                log.Add($"  · Created staging zone {zone.Name} ({zone.Id})");
            }
            _deps.RamStaging.StagePathsAsync(zoneId!, targets).GetAwaiter().GetResult();
            log.Add($"  · Staged {targets.Count} item(s) → zone {zoneId}");
        }
        catch (Exception ex)
        {
            log.Add($"  ! RAM stage failed: {ex.Message}");
        }
    }

    private void RecycleFiles(List<string> files, AutomationNode node, List<string> log)
    {
        if (_deps.ShellContext == null)
        {
            log.Add("  ! Shell context unavailable for recycle.");
            return;
        }
        var targets = BndzAutomationExtensions.ExistingFiles(files);
        if (targets.Count == 0)
        {
            log.Add("  · Recycle: no files to delete.");
            return;
        }
        var ok = _deps.ShellContext.InvokeVerb(targets, "delete", _deps.HostWindow, bypassRecycleBin: false);
        log.Add(ok
            ? $"  · Sent {targets.Count} file(s) to Recycle Bin"
            : "  ! Recycle Bin delete failed");
    }

    private void CompressFiles(List<string> files, AutomationNode node, List<string> log)
    {
        if (_deps.ArchiveService == null)
        {
            log.Add("  ! Archive service unavailable.");
            return;
        }
        var dest = BndzAutomationExtensions.GetField(node.Data, "dest");
        var format = BndzAutomationExtensions.GetField(node.Data, "format", "zip");
        if (string.IsNullOrWhiteSpace(dest))
        {
            log.Add("  ! Compress: destination archive path missing.");
            return;
        }
        var targets = BndzAutomationExtensions.ExistingFiles(files);
        if (targets.Count == 0)
        {
            log.Add("  ! Compress: no files to archive.");
            return;
        }
        try
        {
            _deps.ArchiveService.CreateArchiveAsync(targets, dest, format).GetAwaiter().GetResult();
            log.Add($"  · Compressed {targets.Count} file(s) → {dest}");
        }
        catch (Exception ex)
        {
            log.Add($"  ! Compress failed: {ex.Message}");
        }
    }

    private void ExtractArchives(List<string> files, AutomationNode node, List<string> log)
    {
        if (_deps.ArchiveService == null)
        {
            log.Add("  ! Archive service unavailable.");
            return;
        }
        var dest = BndzAutomationExtensions.GetField(node.Data, "dest");
        if (string.IsNullOrWhiteSpace(dest))
        {
            log.Add("  ! Extract: destination folder missing.");
            return;
        }
        Directory.CreateDirectory(dest);
        var archives = BndzAutomationExtensions.ExistingFiles(files)
            .Where(f => DefaultArchiveExts.Contains(BndzAutomationExtensions.GetCompoundExtension(f))
                || DefaultArchiveExts.Contains(Path.GetExtension(f).TrimStart('.')))
            .ToList();
        if (archives.Count == 0)
        {
            log.Add("  · Extract: no archives in pipeline.");
            return;
        }
        foreach (var archive in archives)
        {
            try
            {
                var outDir = Path.Combine(dest, Path.GetFileNameWithoutExtension(archive));
                Directory.CreateDirectory(outDir);
                _deps.ArchiveService.ExtractArchiveAsync(archive, outDir).GetAwaiter().GetResult();
                log.Add($"  · Extracted {Path.GetFileName(archive)} → {outDir}");
            }
            catch (Exception ex)
            {
                log.Add($"  ! Extract failed ({Path.GetFileName(archive)}): {ex.Message}");
            }
        }
    }

    private static void SyncFolders(List<string> files, AutomationNode node, List<string> log)
    {
        var source = BndzAutomationExtensions.GetField(node.Data, "source");
        var dest = BndzAutomationExtensions.GetField(node.Data, "dest");
        if (string.IsNullOrWhiteSpace(dest))
        {
            log.Add("  ! Sync: destination missing.");
            return;
        }
        if (string.IsNullOrWhiteSpace(source))
        {
            var dirs = files.Where(Directory.Exists).ToList();
            var parents = files.Where(File.Exists).Select(f => Path.GetDirectoryName(f) ?? "").Where(d => !string.IsNullOrEmpty(d)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
            source = dirs.FirstOrDefault() ?? parents.FirstOrDefault() ?? "";
        }
        if (string.IsNullOrWhiteSpace(source) || !Directory.Exists(source))
        {
            log.Add("  ! Sync: source folder missing.");
            return;
        }
        Directory.CreateDirectory(dest);
        var copied = 0;
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            try
            {
                var rel = Path.GetRelativePath(source, file);
                var target = Path.Combine(dest, rel);
                var dir = Path.GetDirectoryName(target);
                if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
                File.Copy(file, target, overwrite: true);
                copied++;
            }
            catch { /* skip inaccessible */ }
        }
        log.Add($"  · Synced {copied} file(s) {source} → {dest}");
    }

    private static void GenerateThumbnails(List<string> files, AutomationNode node, List<string> log)
    {
        var dest = BndzAutomationExtensions.GetField(node.Data, "dest");
        if (string.IsNullOrWhiteSpace(dest))
        {
            log.Add("  ! Thumbnail: output folder missing.");
            return;
        }
        Directory.CreateDirectory(dest);
        var sizeRaw = BndzAutomationExtensions.GetField(node.Data, "size", "256");
        var size = int.TryParse(sizeRaw, out var s) ? Math.Clamp(s, 32, 1024) : 256;
        var written = 0;
        foreach (var file in BndzAutomationExtensions.ExistingFiles(files))
        {
            if (!SkiaThumbnailService.IsLikelyImage(file)) continue;
            var b64 = SkiaThumbnailService.TryEncodeThumbnailBase64(file, size);
            if (string.IsNullOrEmpty(b64)) continue;
            try
            {
                var outName = Path.GetFileNameWithoutExtension(file) + ".thumb.png";
                var outPath = Path.Combine(dest, outName);
                File.WriteAllBytes(outPath, Convert.FromBase64String(b64));
                written++;
            }
            catch { /* skip */ }
        }
        log.Add($"  · Wrote {written} thumbnail(s) → {dest}");
    }

    private static List<string> FilterDuplicates(List<string> files, AutomationNode node, List<string> log)
    {
        var minSize = BndzAutomationExtensions.ParseSizeBytes(BndzAutomationExtensions.GetField(node.Data, "minSize", "1KB"), 1024);
        var existing = BndzAutomationExtensions.ExistingFiles(files)
            .Where(f => { try { return new FileInfo(f).Length >= minSize; } catch { return false; } })
            .ToList();
        if (existing.Count < 2)
        {
            log.Add("  · Duplicates: need at least 2 files.");
            return [];
        }

        var bySize = existing.GroupBy(f => { try { return new FileInfo(f).Length; } catch { return -1L; } })
            .Where(g => g.Key > 0 && g.Count() > 1)
            .ToList();
        var dups = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var group in bySize)
        {
            var byHash = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
            foreach (var path in group)
            {
                try
                {
                    using var stream = File.OpenRead(path);
                    var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(stream));
                    if (!byHash.TryGetValue(hash, out var list)) byHash[hash] = list = [];
                    list.Add(path);
                }
                catch { /* skip */ }
            }
            foreach (var list in byHash.Values.Where(l => l.Count > 1))
            {
                foreach (var p in list) dups.Add(p);
            }
        }
        var result = existing.Where(dups.Contains).ToList();
        log.Add($"  · {result.Count} duplicate file(s)");
        return result;
    }

    private static List<string> BatchCounter(List<string> files, AutomationNode node, List<string> log)
    {
        var raw = BndzAutomationExtensions.GetField(node.Data, "limit", "50");
        var limit = int.TryParse(raw, out var n) ? Math.Max(0, n) : 50;
        var sliced = files.Take(limit).ToList();
        log.Add($"  · Batch counter: {sliced.Count} of {files.Count} file(s) (limit {limit})");
        return sliced;
    }

    private static void AbortPipeline(AutomationNode node, List<string> log)
    {
        var msg = BndzAutomationExtensions.GetField(node.Data, "message", "Stopped by pipeline");
        log.Add($"  ✗ Abort: {msg}");
        throw new InvalidOperationException(msg);
    }

    private void ApplyTag(List<string> files, AutomationNode node, List<string> log)
    {
        var tag = BndzAutomationExtensions.GetField(node.Data, "tag");
        if (string.IsNullOrWhiteSpace(tag))
        {
            log.Add("  ! Apply tag: no tag specified.");
            return;
        }
        if (_deps.TagStore == null)
        {
            log.Add("  ! Tag store unavailable.");
            return;
        }
        var targets = BndzAutomationExtensions.ExistingFiles(files);
        _deps.TagStore.ApplyTags(targets, [tag]);
        log.Add($"  · Applied tag '{tag}' to {targets.Count} file(s)");
    }

    private static void NotifyToast(AutomationNode node, List<string> log)
    {
        var title = BndzAutomationExtensions.GetField(node.Data, "title", "BNDZ Automation");
        var body = BndzAutomationExtensions.GetField(node.Data, "message", "Pipeline checkpoint");
        WindowsToastService.Show(title, body);
        log.Add($"  · Toast: {title}");
    }

    private static void RunShell(AutomationNode node, List<string> log)
    {
        var cmd = BndzAutomationExtensions.GetField(node.Data, "command");
        if (string.IsNullOrWhiteSpace(cmd))
        {
            log.Add("  ! Shell: no command specified.");
            return;
        }
        var blocked = new[] { "format ", "diskpart", "bcdedit", "reg delete", "del /f /s /q c:\\" };
        if (blocked.Any(b => cmd.Contains(b, StringComparison.OrdinalIgnoreCase)))
        {
            log.Add("  ! Shell: command blocked by safety policy.");
            return;
        }
        try
        {
            using var proc = Process.Start(new ProcessStartInfo
            {
                FileName = "cmd.exe",
                Arguments = $"/c {cmd}",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            });
            if (proc == null)
            {
                log.Add("  ! Shell: failed to start.");
                return;
            }
            var stdout = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit(120_000);
            if (!string.IsNullOrWhiteSpace(stdout))
                log.AddRange(stdout.Split('\n', StringSplitOptions.RemoveEmptyEntries).Select(l => $"    {l.Trim()}"));
            log.Add($"  · Shell exit {proc.ExitCode}");
        }
        catch (Exception ex)
        {
            log.Add($"  ! Shell failed: {ex.Message}");
        }
    }

    private static void Delay(AutomationNode node, List<string> log)
    {
        if (!int.TryParse(BndzAutomationExtensions.GetField(node.Data, "seconds", "1"), out var sec))
            sec = 1;
        sec = Math.Clamp(sec, 0, 300);
        if (sec > 0) Thread.Sleep(sec * 1000);
        log.Add($"  · Delayed {sec}s");
    }

    private static void RsyncDeploy(List<string> files, AutomationNode node, List<string> log)
    {
        var remote = BndzAutomationExtensions.GetField(node.Data, "remote");
        if (string.IsNullOrWhiteSpace(remote))
        {
            log.Add("  ! Deploy target missing (user@host:/path or local folder).");
            return;
        }

        var source = BndzAutomationExtensions.GetField(node.Data, "source");
        var extra = BndzAutomationExtensions.GetField(node.Data, "extraArgs", "");

        string? localSource = null;
        string? stagingDir = null;
        if (!string.IsNullOrWhiteSpace(source) && Directory.Exists(source))
            localSource = source;
        else if (files.Count > 0)
        {
            stagingDir = Path.Combine(Path.GetTempPath(), "BNDZ", "automation", Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(stagingDir);
            foreach (var f in files)
            {
                if (!File.Exists(f)) continue;
                File.Copy(f, Path.Combine(stagingDir, Path.GetFileName(f)), overwrite: true);
            }
            localSource = stagingDir;
        }

        try
        {
            if (string.IsNullOrWhiteSpace(localSource))
            {
                log.Add("  ! No local source folder or pipeline files for deploy.");
                return;
            }

            if (!remote.Contains('@'))
            {
                Directory.CreateDirectory(remote);
                RobocopyMirror(localSource, remote, log);
                return;
            }

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

            var rsync = ResolveExecutable("rsync.exe", "rsync");
            if (rsync != null)
            {
                var rsyncArgs = string.IsNullOrWhiteSpace(extra) ? "-avz" : extra;
                RunProcess(rsync, $"{rsyncArgs} \"{localSource.TrimEnd('\\', '/')}\"/ \"{remote}\"", log, successLabel: "Rsync deploy completed.");
                return;
            }

            log.Add("  ! Deploy failed: use user@host:/path with Windows OpenSSH, or a local folder path.");
        }
        finally
        {
            if (stagingDir != null)
            {
                try { Directory.Delete(stagingDir, recursive: true); }
                catch { /* best effort */ }
            }
        }
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

    private static List<AutomationEdge> ParseEdges(JsonElement graph)
    {
        var list = new List<AutomationEdge>();
        if (!graph.TryGetProperty("edges", out var edges) || edges.ValueKind != JsonValueKind.Array)
            return list;
        foreach (var e in edges.EnumerateArray())
        {
            var src = e.TryGetProperty("source", out var s) ? s.GetString() : null;
            var tgt = e.TryGetProperty("target", out var t) ? t.GetString() : null;
            var handle = e.TryGetProperty("sourceHandle", out var h) ? h.GetString() : null;
            if (!string.IsNullOrEmpty(src) && !string.IsNullOrEmpty(tgt))
                list.Add(new AutomationEdge(src, tgt, handle));
        }
        return list;
    }

    private static AutomationRunResult Fail(List<string> log, string error)
    {
        log.Add($"✗ {error}");
        return new AutomationRunResult { Ok = false, Log = log, Error = error };
    }

    private sealed record AutomationNode(string Id, string Type, Dictionary<string, string> Data);
    private sealed record AutomationEdge(string Source, string Target, string? SourceHandle);
}

public sealed class AutomationRunResult
{
    public bool Ok { get; set; }
    public List<string> Log { get; set; } = [];
    public string? Error { get; set; }
}
