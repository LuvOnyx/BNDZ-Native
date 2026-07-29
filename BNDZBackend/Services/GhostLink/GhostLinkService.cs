using System.Diagnostics;

namespace BNDZ.Services.GhostLink;

/// <summary>Move inactive files to cold storage and replace with symlinks (Ghost Links).</summary>
public sealed class GhostLinkService
{
    private readonly GhostLinkDatabase _db = new();
    private readonly GhostLinkScanner _scanner = new();
    private readonly LinkService _linkService;
    private readonly FileTransferQueueService _queue;
    private Action<object>? _progressHandler;

    public GhostLinkService(LinkService linkService, FileTransferQueueService queue)
    {
        _linkService = linkService;
        _queue = queue;
    }

    public void SetProgressHandler(Action<object>? handler) => _progressHandler = handler;

    public List<GhostLinkRule> GetRules() => _db.GetRules();

    public void SaveRules(IEnumerable<GhostLinkRule> rules) => _db.SaveRules(rules);

    public GhostLinkStats GetStats() => _db.GetStats();

    public List<GhostLinkRecord> ListGhosts() => _db.ListGhosts();

    public bool IsGhostLink(string path) => _db.GetGhost(path) != null;

    public async Task<int> RunScanAsync(string? ruleId = null, CancellationToken ct = default)
    {
        var rules = _db.GetRules().Where(r => r.Enabled && (ruleId == null || r.Id == ruleId)).ToList();
        var candidates = new List<string>();
        foreach (var rule in rules)
            candidates.AddRange(_scanner.ScanRule(rule, ct));

        if (candidates.Count == 0) return 0;

        var operationId = Guid.NewGuid().ToString("N");
        _queue.RegisterJob(operationId, "ghost-offload", $"Ghost-Link scan ({candidates.Count} files)", "bndz",
            candidates.Count, "ghost-link", FileTransferPriority.Low);

        var sw = Stopwatch.StartNew();
        int done = 0;
        long reclaimed = 0;

        try
        {
            foreach (var file in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
            {
                ct.ThrowIfCancellationRequested();
                var rule = rules.FirstOrDefault(r => MatchesRule(r, file));
                if (rule == null) continue;

                var bytes = await OffloadFileAsync(file, rule, ct).ConfigureAwait(false);
                if (bytes > 0)
                {
                    reclaimed += bytes;
                    done++;
                }

                var pct = (int)Math.Clamp(done * 100.0 / candidates.Count, 0, 99);
                _queue.UpdateProgress(operationId, pct, file, done, candidates.Count, reclaimed, 0, reclaimed / Math.Max(sw.Elapsed.TotalSeconds, 0.1));
                _progressHandler?.Invoke(new { type = "GHOST_LINK_PROGRESS", payload = new { done, total = candidates.Count, reclaimed, current = file } });
            }

            _queue.MarkCompleted(operationId);
            return done;
        }
        catch (OperationCanceledException)
        {
            _queue.MarkCancelled(operationId);
            throw;
        }
        catch (Exception ex)
        {
            _queue.MarkFailed(operationId, ex.Message);
            throw;
        }
    }

    public async Task<long> OffloadPathsAsync(IReadOnlyList<string> paths, string coldStorageRoot, string? ruleId = null, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(coldStorageRoot))
            throw new ArgumentException("Cold storage root required");

        var operationId = Guid.NewGuid().ToString("N");
        _queue.RegisterJob(operationId, "ghost-offload", $"Ghost-Link ({paths.Count} items)", "bndz",
            paths.Count, "ghost-link", FileTransferPriority.Normal, coldStorageRoot);

        long reclaimed = 0;
        int done = 0;
        var sw = Stopwatch.StartNew();

        try
        {
            var rule = new GhostLinkRule { Id = ruleId ?? "manual", ColdStorageRoot = coldStorageRoot };
            foreach (var path in paths)
            {
                ct.ThrowIfCancellationRequested();
                if (File.Exists(path))
                {
                    reclaimed += await OffloadFileAsync(path, rule, ct).ConfigureAwait(false);
                    done++;
                }
                else if (Directory.Exists(path))
                {
                    foreach (var file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
                    {
                        reclaimed += await OffloadFileAsync(file, rule, ct).ConfigureAwait(false);
                        done++;
                    }
                }
                var pct = (int)Math.Clamp(done * 100.0 / paths.Count, 0, 99);
                _queue.UpdateProgress(operationId, pct, path, done, paths.Count, reclaimed, 0, reclaimed / Math.Max(sw.Elapsed.TotalSeconds, 0.1));
            }
            _queue.MarkCompleted(operationId);
            return reclaimed;
        }
        catch (Exception ex)
        {
            _queue.MarkFailed(operationId, ex.Message);
            throw;
        }
    }

    public async Task RestoreAsync(string originalPath, CancellationToken ct = default)
    {
        var ghost = _db.GetGhost(originalPath)
            ?? throw new InvalidOperationException("Not a ghost link");

        if (!File.Exists(ghost.OffloadPath) && !Directory.Exists(ghost.OffloadPath))
            throw new FileNotFoundException("Offloaded data missing", ghost.OffloadPath);

        if (File.Exists(originalPath) || Directory.Exists(originalPath))
            File.Delete(originalPath);

        if (File.Exists(ghost.OffloadPath))
            File.Move(ghost.OffloadPath, originalPath);
        else
            Directory.Move(ghost.OffloadPath, originalPath);

        _db.RemoveGhost(originalPath);
        await Task.CompletedTask;
    }

    private async Task<long> OffloadFileAsync(string file, GhostLinkRule rule, CancellationToken ct)
    {
        if (_db.GetGhost(file) != null) return 0;

        var fi = new FileInfo(file);
        var rel = file;
        foreach (var root in rule.SourceRoots.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (file.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            {
                rel = Path.GetRelativePath(root, file);
                break;
            }
        }

        var offloadPath = Path.Combine(rule.ColdStorageRoot, rel);
        var offloadDir = Path.GetDirectoryName(offloadPath);
        if (!string.IsNullOrEmpty(offloadDir)) Directory.CreateDirectory(offloadDir);

        await Task.Run(() => File.Move(file, offloadPath), ct).ConfigureAwait(false);

        var linkResult = _linkService.CreateLink(file, Path.GetFullPath(offloadPath), "symlink");
        if (!linkResult.Success)
        {
            File.Move(offloadPath, file);
            throw new InvalidOperationException(linkResult.Error ?? "Symlink creation failed");
        }

        _db.InsertGhost(new GhostLinkRecord
        {
            Id = Guid.NewGuid().ToString("N"),
            OriginalPath = file,
            OffloadPath = offloadPath,
            BytesSaved = fi.Length,
            RuleId = rule.Id,
        });

        return fi.Length;
    }

    private static bool MatchesRule(GhostLinkRule rule, string file)
    {
        foreach (var root in rule.SourceRoots.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            if (file.StartsWith(root, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }
}
