using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Timers;

namespace BNDZ.Services;

public class FolderSyncJob
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "Folder Sync";
    public string SourcePath { get; set; } = "";
    public string DestPath { get; set; } = "";
    public bool WatchEnabled { get; set; }
    public bool MirrorMode { get; set; }
    public bool Enabled { get; set; } = true;
    public DateTime? LastSyncUtc { get; set; }
    public string LastStatus { get; set; } = "idle";
    public string? LastError { get; set; }
    public int FilesCopied { get; set; }
}

public class FolderSyncProgress
{
    public string JobId { get; set; } = "";
    public string Status { get; set; } = "";
    public int Percent { get; set; }
    public string? CurrentFile { get; set; }
    public string? Message { get; set; }
}

public class FolderSyncPreview
{
    public List<string> WouldCopy { get; set; } = [];
    public List<string> WouldUpdate { get; set; } = [];
    public List<string> WouldSkip { get; set; } = [];
    public List<string> ExtraInDest { get; set; } = [];
    public string Summary { get; set; } = "";
}

/// <summary>
/// Watches source folders and syncs to destinations using robocopy (incremental) with debounced triggers.
/// </summary>
public sealed class FolderSyncService : IDisposable
{
    private readonly string _storePath;
    private readonly List<FolderSyncJob> _jobs = new();
    private readonly ConcurrentDictionary<string, FileSystemWatcher> _watchers = new();
    private readonly ConcurrentDictionary<string, System.Timers.Timer> _debounceTimers = new();
    private readonly ConcurrentDictionary<string, bool> _syncInFlight = new();
    private readonly object _saveLock = new();
    private Action<FolderSyncProgress>? _onProgress;

    public FolderSyncService()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var dir = Path.Combine(appData, "BNDZ64");
        Directory.CreateDirectory(dir);
        _storePath = Path.Combine(dir, "folder_sync_jobs.json");
        LoadJobs();
        RestoreWatchers();
    }

    public void SetProgressCallback(Action<FolderSyncProgress>? callback) => _onProgress = callback;

    public IReadOnlyList<FolderSyncJob> GetJobs() => _jobs.ToList();

    public void SaveJobs(IEnumerable<FolderSyncJob> jobs)
    {
        _jobs.Clear();
        _jobs.AddRange(jobs);
        Persist();
        RestoreWatchers();
    }

    public async Task<FolderSyncJob?> RunSyncAsync(string jobId, CancellationToken ct = default)
    {
        var job = _jobs.FirstOrDefault(j => j.Id == jobId);
        if (job == null || !job.Enabled) return null;
        if (_syncInFlight.TryAdd(jobId, true))
        {
            try
            {
                return await ExecuteSyncAsync(job, ct).ConfigureAwait(false);
            }
            finally
            {
                _syncInFlight.TryRemove(jobId, out _);
            }
        }
        return job;
    }

    public void SetWatch(string jobId, bool enabled)
    {
        var job = _jobs.FirstOrDefault(j => j.Id == jobId);
        if (job == null) return;
        job.WatchEnabled = enabled;
        Persist();
        if (enabled) StartWatcher(job);
        else StopWatcher(jobId);
    }

    public FolderSyncPreview? PreviewSync(string jobId)
    {
        var job = _jobs.FirstOrDefault(j => j.Id == jobId);
        if (job == null) return null;

        var src = Normalize(job.SourcePath);
        var dest = Normalize(job.DestPath);
        var preview = new FolderSyncPreview();
        if (string.IsNullOrEmpty(src) || !Directory.Exists(src))
        {
            preview.Summary = $"Source not found: {src}";
            return preview;
        }

        foreach (var file in Directory.EnumerateFiles(src, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(src, file).Replace('\\', '/');
            var destFile = Path.Combine(dest, rel.Replace('/', Path.DirectorySeparatorChar));
            if (!File.Exists(destFile))
            {
                preview.WouldCopy.Add(rel);
                continue;
            }
            var srcInfo = new FileInfo(file);
            var destInfo = new FileInfo(destFile);
            if (srcInfo.Length != destInfo.Length || srcInfo.LastWriteTimeUtc > destInfo.LastWriteTimeUtc)
                preview.WouldUpdate.Add(rel);
            else
                preview.WouldSkip.Add(rel);
        }

        if (job.MirrorMode && Directory.Exists(dest))
        {
            foreach (var file in Directory.EnumerateFiles(dest, "*", SearchOption.AllDirectories))
            {
                var rel = Path.GetRelativePath(dest, file).Replace('\\', '/');
                var srcFile = Path.Combine(src, rel.Replace('/', Path.DirectorySeparatorChar));
                if (!File.Exists(srcFile))
                    preview.ExtraInDest.Add(rel);
            }
        }

        preview.Summary =
            $"{preview.WouldCopy.Count} new, {preview.WouldUpdate.Count} updated, {preview.WouldSkip.Count} unchanged" +
            (job.MirrorMode ? $", {preview.ExtraInDest.Count} extra in destination" : "");
        return preview;
    }

    private void LoadJobs()
    {
        try
        {
            if (!File.Exists(_storePath)) return;
            var json = File.ReadAllText(_storePath);
            var loaded = JsonSerializer.Deserialize<List<FolderSyncJob>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (loaded != null)
            {
                _jobs.Clear();
                _jobs.AddRange(loaded);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[FolderSync] Load failed: {ex.Message}");
        }
    }

    private void Persist()
    {
        lock (_saveLock)
        {
            try
            {
                var json = JsonSerializer.Serialize(_jobs, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_storePath, json);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[FolderSync] Save failed: {ex.Message}");
            }
        }
    }

    private void RestoreWatchers()
    {
        foreach (var w in _watchers.Values) { try { w.Dispose(); } catch { } }
        _watchers.Clear();
        foreach (var job in _jobs.Where(j => j.WatchEnabled && j.Enabled))
            StartWatcher(job);
    }

    private void StartWatcher(FolderSyncJob job)
    {
        var src = Normalize(job.SourcePath);
        if (string.IsNullOrEmpty(src) || !Directory.Exists(src)) return;
        StopWatcher(job.Id);

        var watcher = new FileSystemWatcher(src)
        {
            IncludeSubdirectories = true,
            EnableRaisingEvents = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
        };

        void schedule()
        {
            if (_debounceTimers.TryGetValue(job.Id, out var existing))
            {
                existing.Stop();
                existing.Start();
                return;
            }
            var timer = new System.Timers.Timer(2000) { AutoReset = false };
            timer.Elapsed += async (_, _) =>
            {
                if (_syncInFlight.ContainsKey(job.Id)) return;
                try { await RunSyncAsync(job.Id).ConfigureAwait(false); }
                catch (Exception ex) { Debug.WriteLine($"[FolderSync] Watch sync: {ex.Message}"); }
            };
            _debounceTimers[job.Id] = timer;
            timer.Start();
        }

        watcher.Created += (_, _) => schedule();
        watcher.Changed += (_, _) => schedule();
        watcher.Deleted += (_, _) => schedule();
        watcher.Renamed += (_, _) => schedule();
        _watchers[job.Id] = watcher;
    }

    private void StopWatcher(string jobId)
    {
        if (_watchers.TryRemove(jobId, out var w))
        {
            try { w.EnableRaisingEvents = false; w.Dispose(); } catch { }
        }
        if (_debounceTimers.TryRemove(jobId, out var t))
        {
            try { t.Stop(); t.Dispose(); } catch { }
        }
    }

    private async Task<FolderSyncJob> ExecuteSyncAsync(FolderSyncJob job, CancellationToken ct)
    {
        var src = Normalize(job.SourcePath);
        var dest = Normalize(job.DestPath);
        if (string.IsNullOrEmpty(src) || !Directory.Exists(src))
            throw new DirectoryNotFoundException($"Source not found: {src}");
        Directory.CreateDirectory(dest);

        job.LastStatus = "syncing";
        job.LastError = null;
        Report(job.Id, "syncing", 5, null, "Starting sync…");

        var args = job.MirrorMode
            ? $"\"{src}\" \"{dest}\" /MIR /Z /R:2 /W:2 /NP /NDL /NFL /NJH /NJS"
            : $"\"{src}\" \"{dest}\" /E /XO /Z /R:2 /W:2 /NP /NDL /NFL /NJH /NJS";

        var exitCode = await RunRobocopyAsync(args, job.Id, ct).ConfigureAwait(false);
        var ok = exitCode >= 0 && exitCode < 8;

        job.LastSyncUtc = DateTime.UtcNow;
        job.LastStatus = ok ? "idle" : "error";
        if (!ok) job.LastError = $"Robocopy exited with code {exitCode}";
        Persist();

        Report(job.Id, job.LastStatus, 100, null, ok ? "Sync complete" : job.LastError);
        return job;
    }

    private async Task<int> RunRobocopyAsync(string arguments, string jobId, CancellationToken ct)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "robocopy",
            Arguments = arguments,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };

        using var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
        var tcs = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);

        proc.OutputDataReceived += (_, e) =>
        {
            if (!string.IsNullOrWhiteSpace(e.Data))
                Report(jobId, "syncing", 50, e.Data.Trim(), null);
        };
        proc.Exited += (_, _) => tcs.TrySetResult(proc.ExitCode);

        if (!proc.Start())
            throw new InvalidOperationException("Failed to start robocopy");

        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();

        using var reg = ct.Register(() =>
        {
            try { if (!proc.HasExited) proc.Kill(entireProcessTree: true); } catch { }
            tcs.TrySetCanceled(ct);
        });

        return await tcs.Task.ConfigureAwait(false);
    }

    private void Report(string jobId, string status, int percent, string? file, string? message)
    {
        _onProgress?.Invoke(new FolderSyncProgress
        {
            JobId = jobId,
            Status = status,
            Percent = percent,
            CurrentFile = file,
            Message = message,
        });
    }

    private static string Normalize(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        var p = path.Replace('/', '\\').Trim();
        if (p.StartsWith("\\") && p.Length > 2 && p[1] != '\\') p = p.TrimStart('\\');
        if (p.Length == 2 && p[1] == ':') p += "\\";
        return p;
    }

    public void Dispose()
    {
        foreach (var w in _watchers.Values) { try { w.Dispose(); } catch { } }
        _watchers.Clear();
        foreach (var t in _debounceTimers.Values) { try { t.Dispose(); } catch { } }
        _debounceTimers.Clear();
    }
}
