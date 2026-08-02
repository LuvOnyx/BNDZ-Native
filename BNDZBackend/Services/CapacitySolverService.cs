using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;

namespace BNDZ.Services;

public sealed class CapacityAction
{
    public string Id { get; set; } = "";
    public string Actuator { get; set; } = "";
    public string Title { get; set; } = "";
    public string Detail { get; set; } = "";
    public long EstimatedBytes { get; set; }
    public List<string> PathsSample { get; set; } = new();
}

public sealed class CapacityPlan
{
    public string Path { get; set; } = "";
    public long FreeBytes { get; set; }
    public long TotalBytes { get; set; }
    public long TargetFreeBytes { get; set; }
    public long DeficitBytes { get; set; }
    public List<CapacityAction> Actions { get; set; } = new();
}

public sealed class CapacitySolverService
{
    private static readonly Lazy<CapacitySolverService> Lazy = new(() => new CapacitySolverService());
    public static CapacitySolverService Instance => Lazy.Value;

    private CapacitySolverService() { }

    public CapacityPlan BuildPlan(string volumeOrFolderWinPath, long? targetFreeBytes = null)
    {
        var fullPath = Path.GetFullPath(volumeOrFolderWinPath);
        var root = Path.GetPathRoot(fullPath) ?? fullPath;

        var driveInfo = new DriveInfo(root);
        long free = driveInfo.IsReady ? driveInfo.AvailableFreeSpace : 0;
        long total = driveInfo.IsReady ? driveInfo.TotalSize : 0;
        long target = targetFreeBytes ?? (long)(total * 0.10);
        long deficit = Math.Max(0, target - free);

        var plan = new CapacityPlan
        {
            Path = fullPath,
            FreeBytes = free,
            TotalBytes = total,
            TargetFreeBytes = target,
            DeficitBytes = deficit,
            Actions = new List<CapacityAction>()
        };

        try { plan.Actions.AddRange(SuggestDuplicates(fullPath)); } catch (Exception ex) { Debug.WriteLine($"[CapSolver] dup: {ex.Message}"); }
        try { plan.Actions.AddRange(SuggestGhostOffload(fullPath)); } catch (Exception ex) { Debug.WriteLine($"[CapSolver] ghost: {ex.Message}"); }
        try { plan.Actions.AddRange(SuggestEmptyDirs(fullPath)); } catch (Exception ex) { Debug.WriteLine($"[CapSolver] empty: {ex.Message}"); }
        try { plan.Actions.AddRange(SuggestArchiveOld(fullPath)); } catch (Exception ex) { Debug.WriteLine($"[CapSolver] archive: {ex.Message}"); }

        plan.Actions = plan.Actions
            .OrderByDescending(a => a.EstimatedBytes)
            .ToList();

        return plan;
    }

    private static List<CapacityAction> SuggestDuplicates(string pathPrefix)
    {
        var actions = new List<CapacityAction>();
        try
        {
            var idx = BndzFileIndexService.Instance;
            var large = idx.GetLargeFiles(limit: 200, minBytes: 1024 * 1024);

            var sizeGroups = new Dictionary<long, List<string>>();
            foreach (dynamic f in large)
            {
                try
                {
                    long sz = (long)f.size;
                    string p = (string)f.path;
                    if (sz <= 0) continue;
                    if (!sizeGroups.TryGetValue(sz, out var list))
                    {
                        list = new List<string>();
                        sizeGroups[sz] = list;
                    }
                    list.Add(p);
                }
                catch { }
            }

            long reclaimable = 0;
            var sample = new List<string>();
            int groupCount = 0;
            foreach (var (sz, paths) in sizeGroups.Where(g => g.Value.Count >= 2))
            {
                reclaimable += sz * (paths.Count - 1);
                groupCount++;
                if (sample.Count < 5)
                    sample.Add(paths[0]);
            }

            if (reclaimable > 0)
            {
                actions.Add(new CapacityAction
                {
                    Id = "delete-duplicates",
                    Actuator = "DuplicateFinderService",
                    Title = "Remove duplicate files",
                    Detail = $"{groupCount} same-size group(s) found among large indexed files — full hash verification recommended before deletion.",
                    EstimatedBytes = reclaimable,
                    PathsSample = sample.Take(5).ToList()
                });
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[CapSolver/Dup] {ex.Message}");
        }
        return actions;
    }

    private static List<CapacityAction> SuggestGhostOffload(string pathPrefix)
    {
        var actions = new List<CapacityAction>();
        try
        {
            var idx = BndzFileIndexService.Instance;
            var large = idx.GetLargeFiles(limit: 300, minBytes: 50 * 1024 * 1024);

            var prefixNorm = pathPrefix.Replace('\\', '/').ToLowerInvariant().TrimEnd('/');

            var cold = new List<(string path, long size)>();
            var cutoff = DateTimeOffset.UtcNow.AddDays(-90).ToUnixTimeSeconds();

            foreach (dynamic f in large)
            {
                try
                {
                    string p = (string)f.path;
                    long sz = (long)f.size;
                    string mod = (string)f.modified;
                    if (string.IsNullOrEmpty(p) || sz <= 0) continue;

                    var pNorm = p.Replace('\\', '/').ToLowerInvariant();
                    if (!pNorm.StartsWith(prefixNorm, StringComparison.Ordinal) &&
                        !("/" + pNorm).StartsWith(prefixNorm, StringComparison.Ordinal))
                        continue;

                    if (DateTimeOffset.TryParse(mod, out var dto) && dto.ToUnixTimeSeconds() < cutoff)
                        cold.Add((p, sz));
                }
                catch { }
            }

            if (cold.Count > 0)
            {
                long total = cold.Sum(c => c.size);
                actions.Add(new CapacityAction
                {
                    Id = "ghost-offload",
                    Actuator = "GhostStagingService",
                    Title = "Offload large cold files to RAM/Ghost staging",
                    Detail = $"{cold.Count} file(s) over 50 MB not modified in 90+ days under {pathPrefix}.",
                    EstimatedBytes = total,
                    PathsSample = cold.Take(5).Select(c => c.path).ToList()
                });
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[CapSolver/Ghost] {ex.Message}");
        }
        return actions;
    }

    private static List<CapacityAction> SuggestEmptyDirs(string pathPrefix)
    {
        var actions = new List<CapacityAction>();
        try
        {
            if (!Directory.Exists(pathPrefix)) return actions;

            int count = 0;
            var sample = new List<string>();
            var opts = new EnumerationOptions
            {
                IgnoreInaccessible = true,
                RecurseSubdirectories = true,
                MaxRecursionDepth = 6
            };

            foreach (var dir in Directory.EnumerateDirectories(pathPrefix, "*", opts))
            {
                if (count >= 500) break;
                try
                {
                    if (!Directory.EnumerateFileSystemEntries(dir).Any())
                    {
                        count++;
                        if (sample.Count < 5) sample.Add(dir);
                    }
                }
                catch { }
            }

            if (count > 0)
            {
                actions.Add(new CapacityAction
                {
                    Id = "delete-empty",
                    Actuator = "FileOperationService",
                    Title = "Delete empty directories",
                    Detail = $"{count} empty folder(s) under {pathPrefix}.",
                    EstimatedBytes = count * 4096L,
                    PathsSample = sample
                });
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[CapSolver/Empty] {ex.Message}");
        }
        return actions;
    }

    private static List<CapacityAction> SuggestArchiveOld(string pathPrefix)
    {
        var actions = new List<CapacityAction>();
        try
        {
            var idx = BndzFileIndexService.Instance;
            var large = idx.GetLargeFiles(limit: 300, minBytes: 10 * 1024 * 1024);

            var prefixNorm = pathPrefix.Replace('\\', '/').ToLowerInvariant().TrimEnd('/');
            var cutoff = DateTimeOffset.UtcNow.AddDays(-180).ToUnixTimeSeconds();

            var old = new List<(string path, long size)>();
            foreach (dynamic f in large)
            {
                try
                {
                    string p = (string)f.path;
                    long sz = (long)f.size;
                    string mod = (string)f.modified;
                    if (string.IsNullOrEmpty(p) || sz <= 0) continue;

                    var pNorm = p.Replace('\\', '/').ToLowerInvariant();
                    if (!pNorm.StartsWith(prefixNorm, StringComparison.Ordinal) &&
                        !("/" + pNorm).StartsWith(prefixNorm, StringComparison.Ordinal))
                        continue;

                    if (DateTimeOffset.TryParse(mod, out var dto) && dto.ToUnixTimeSeconds() < cutoff)
                        old.Add((p, sz));
                }
                catch { }
            }

            if (old.Count > 0)
            {
                long total = old.Sum(o => o.size);
                actions.Add(new CapacityAction
                {
                    Id = "archive-old",
                    Actuator = "ArchiveService",
                    Title = "Archive files older than 180 days",
                    Detail = $"{old.Count} file(s) over 10 MB not modified in 180+ days under {pathPrefix}.",
                    EstimatedBytes = total,
                    PathsSample = old.Take(5).Select(o => o.path).ToList()
                });
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[CapSolver/Archive] {ex.Message}");
        }
        return actions;
    }
}
