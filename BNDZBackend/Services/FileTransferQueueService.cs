using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

public enum FileTransferJobStatus
{
    Queued,
    Running,
    Paused,
    Completed,
    Failed,
    Cancelled,
}

public enum FileTransferPriority
{
    Low = -1,
    Normal = 0,
    High = 1,
}

public sealed class FileTransferJob
{
    public required string OperationId { get; init; }
    public required string Action { get; init; }
    public required string Label { get; init; }
    public string Engine { get; set; } = "bndz";
    public string Category { get; set; } = "fs";
    public FileTransferPriority Priority { get; set; } = FileTransferPriority.Normal;
    public FileTransferJobStatus Status { get; set; } = FileTransferJobStatus.Queued;
    public int Progress { get; set; }
    public string? CurrentFile { get; set; }
    public string? DestinationPath { get; set; }
    public string? Error { get; set; }
    public DateTime QueuedUtc { get; init; } = DateTime.UtcNow;
    public DateTime? StartedUtc { get; set; }
    public DateTime? CompletedUtc { get; set; }
    public int ItemsTotal { get; set; } = 1;
    public int ItemsCompleted { get; set; }
    public long BytesTransferred { get; set; }
    public long TotalBytes { get; set; }
    public double SpeedBytesPerSecond { get; set; }
    public int? EtaSeconds { get; set; }
    /// <summary>none | size | sha256 — how integrity was proven after copy.</summary>
    public string VerifyMode { get; set; } = "none";
    /// <summary>pending | verified | skipped | failed</summary>
    public string VerifyStatus { get; set; } = "pending";

    public object ToDto() => new
    {
        operationId = OperationId,
        action = Action,
        label = Label,
        engine = Engine,
        category = Category,
        priority = Priority.ToString().ToLowerInvariant(),
        status = Status.ToString().ToLowerInvariant(),
        progress = Progress,
        currentFile = CurrentFile,
        destinationPath = DestinationPath,
        error = Error,
        queuedUtc = QueuedUtc,
        startedUtc = StartedUtc,
        completedUtc = CompletedUtc,
        itemsTotal = ItemsTotal,
        itemsCompleted = ItemsCompleted,
        bytesTransferred = BytesTransferred,
        totalBytes = TotalBytes,
        speedBytesPerSecond = SpeedBytesPerSecond,
        etaSeconds = EtaSeconds,
        verifyMode = VerifyMode,
        verifyStatus = VerifyStatus,
    };
}

internal sealed class PersistedTransferJob
{
    public string OperationId { get; set; } = "";
    public string Action { get; set; } = "";
    public string Label { get; set; } = "";
    public string Engine { get; set; } = "bndz";
    public string Category { get; set; } = "fs";
    public string Priority { get; set; } = "normal";
    public string Status { get; set; } = "";
    public int Progress { get; set; }
    public string? CurrentFile { get; set; }
    public string? DestinationPath { get; set; }
    public string? Error { get; set; }
    public DateTime QueuedUtc { get; set; }
    public DateTime? StartedUtc { get; set; }
    public DateTime? CompletedUtc { get; set; }
    public int ItemsTotal { get; set; } = 1;
    public int ItemsCompleted { get; set; }
    public long BytesTransferred { get; set; }
    public long TotalBytes { get; set; }
}

/// <summary>
/// Serializes file operations with job tracking, cancellation, priority lanes, and optional persistence.
/// </summary>
public sealed class FileTransferQueueService
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _pendingLock = new();
    private readonly List<QueuedWork> _pending = new();
    private readonly ConcurrentDictionary<string, FileTransferJob> _jobs = new();
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _cancelSources = new();
    private readonly ConcurrentDictionary<string, Process> _attachedProcesses = new();
    private readonly string _persistPath;
    private readonly object _persistLock = new();
    private int _queuedCount;
    private int _activeCount;
    private bool _persistEnabled = true;
    private DateTime _lastPersistUtc = DateTime.MinValue;

    public event Action? QueueChanged;

    private sealed class QueuedWork
    {
        public required string OperationId { get; init; }
        public required Func<CancellationToken, Task> Work { get; init; }
        public required TaskCompletionSource<bool> Completion { get; init; }
        public FileTransferPriority Priority { get; init; } = FileTransferPriority.Normal;
        public DateTime EnqueuedUtc { get; init; } = DateTime.UtcNow;
    }

    public FileTransferQueueService()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var dir = Path.Combine(appData, "BNDZ64");
        Directory.CreateDirectory(dir);
        _persistPath = Path.Combine(dir, "file_transfer_queue.json");
    }

    public int QueuedCount => _queuedCount;
    public int ActiveCount => _activeCount;

    public void SetPersistenceEnabled(bool enabled) => _persistEnabled = enabled;

    public void LoadPersistedHistory()
    {
        if (!_persistEnabled || !File.Exists(_persistPath)) return;
        try
        {
            var json = File.ReadAllText(_persistPath);
            var loaded = JsonSerializer.Deserialize<List<PersistedTransferJob>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (loaded == null) return;

            foreach (var row in loaded.OrderByDescending(j => j.CompletedUtc ?? j.QueuedUtc).Take(48))
            {
                if (_jobs.ContainsKey(row.OperationId)) continue;
                var status = Enum.TryParse<FileTransferJobStatus>(row.Status, true, out var parsed)
                    ? parsed
                    : FileTransferJobStatus.Failed;
                if (status is FileTransferJobStatus.Queued or FileTransferJobStatus.Running)
                {
                    status = FileTransferJobStatus.Cancelled;
                    row.Error = "Interrupted — app was closed before this job finished.";
                }

                var job = new FileTransferJob
                {
                    OperationId = row.OperationId,
                    Action = row.Action,
                    Label = row.Label,
                    Engine = row.Engine,
                    Category = row.Category,
                    Priority = ParsePriority(row.Priority),
                    QueuedUtc = row.QueuedUtc,
                };
                job.Status = status;
                job.Progress = row.Progress;
                job.CurrentFile = row.CurrentFile;
                job.DestinationPath = row.DestinationPath;
                job.Error = row.Error;
                job.StartedUtc = row.StartedUtc;
                job.CompletedUtc = row.CompletedUtc ?? DateTime.UtcNow;
                job.ItemsTotal = row.ItemsTotal;
                job.ItemsCompleted = row.ItemsCompleted;
                job.BytesTransferred = row.BytesTransferred;
                job.TotalBytes = row.TotalBytes;
                _jobs[job.OperationId] = job;
            }
            NotifyChanged();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[FileTransferQueue] Load failed: {ex.Message}");
        }
    }

    public IReadOnlyList<object> GetSnapshot(int max = 32)
    {
        var cutoff = DateTime.UtcNow.AddSeconds(-45);
        return _jobs.Values
            .Where(j => j.Status is FileTransferJobStatus.Queued or FileTransferJobStatus.Running
                || (j.CompletedUtc.HasValue && j.CompletedUtc.Value >= cutoff))
            .OrderByDescending(j => j.Status == FileTransferJobStatus.Running)
            .ThenByDescending(j => j.Priority)
            .ThenByDescending(j => j.Status == FileTransferJobStatus.Queued)
            .ThenByDescending(j => j.QueuedUtc)
            .Take(max)
            .Select(j => j.ToDto())
            .ToList();
    }

    public object GetQueueState() => new
    {
        queuedCount = QueuedCount,
        activeCount = ActiveCount,
        jobs = GetSnapshot(),
    };

    public FileTransferJob RegisterJob(
        string operationId,
        string action,
        string label,
        string engine,
        int itemsTotal = 1,
        string category = "fs",
        FileTransferPriority priority = FileTransferPriority.Normal,
        string? destinationPath = null)
    {
        var job = new FileTransferJob
        {
            OperationId = operationId,
            Action = action,
            Label = label,
            Engine = engine,
            Category = category,
            Priority = priority,
            ItemsTotal = Math.Max(itemsTotal, 1),
            DestinationPath = string.IsNullOrWhiteSpace(destinationPath) ? null : destinationPath,
        };
        _jobs[operationId] = job;
        NotifyChanged();
        return job;
    }

    public bool TryGetJob(string operationId, out FileTransferJob? job) =>
        _jobs.TryGetValue(operationId, out job);

    public void UpdateProgress(string operationId, int progress, string? currentFile, int itemsCompleted, int itemsTotal, long bytesTransferred = 0, long totalBytes = 0, double speedBytesPerSecond = 0)
    {
        if (!_jobs.TryGetValue(operationId, out var job)) return;
        // Never show 100% while still Running — 100 is reserved for MarkCompleted.
        var clamped = Math.Clamp(progress, 0, 100);
        if (job.Status == FileTransferJobStatus.Running && clamped >= 100)
            clamped = 99;
        job.Progress = clamped;
        job.CurrentFile = currentFile;
        job.ItemsCompleted = itemsCompleted;
        job.ItemsTotal = Math.Max(itemsTotal, 1);
        job.BytesTransferred = bytesTransferred;
        job.TotalBytes = totalBytes;
        if (totalBytes > 0 && bytesTransferred > 0 && speedBytesPerSecond > 0)
        {
            var remaining = totalBytes - bytesTransferred;
            job.EtaSeconds = remaining > 0 ? (int)Math.Ceiling(remaining / speedBytesPerSecond) : 0;
        }
        else
        {
            job.EtaSeconds = null;
        }
        if (job.Status == FileTransferJobStatus.Queued)
        {
            job.Status = FileTransferJobStatus.Running;
            job.StartedUtc ??= DateTime.UtcNow;
        }
        NotifyChanged();
    }

    public void MarkCompleted(string operationId, string? verifyMode = null, string? verifyStatus = null)
    {
        if (!_jobs.TryGetValue(operationId, out var job)) return;
        job.Status = FileTransferJobStatus.Completed;
        job.Progress = 100;
        job.CompletedUtc = DateTime.UtcNow;
        if (!string.IsNullOrWhiteSpace(verifyMode)) job.VerifyMode = verifyMode!;
        if (!string.IsNullOrWhiteSpace(verifyStatus)) job.VerifyStatus = verifyStatus!;
        else if (string.Equals(job.Action, "copy", StringComparison.OrdinalIgnoreCase)
                 || string.Equals(job.Action, "move", StringComparison.OrdinalIgnoreCase))
        {
            // BNDZ buffered copy always SHA-256 verifies; mark verified unless already set.
            if (job.VerifyStatus is "pending" or null or "")
            {
                job.VerifyMode = "sha256";
                job.VerifyStatus = "verified";
            }
        }
        DetachProcess(operationId);
        _cancelSources.TryRemove(operationId, out var cts);
        cts?.Dispose();
        NotifyChanged();
    }

    public void MarkFailed(string operationId, string? error)
    {
        if (!_jobs.TryGetValue(operationId, out var job)) return;
        // Don't overwrite an intentional cancel with a failed status.
        if (job.Status == FileTransferJobStatus.Cancelled) return;
        job.Status = FileTransferJobStatus.Failed;
        job.Error = error;
        job.CompletedUtc = DateTime.UtcNow;
        if (!string.IsNullOrWhiteSpace(error) && error.Contains("verification", StringComparison.OrdinalIgnoreCase))
        {
            job.VerifyMode = "sha256";
            job.VerifyStatus = "failed";
        }
        DetachProcess(operationId);
        _cancelSources.TryRemove(operationId, out var cts);
        cts?.Dispose();
        NotifyChanged();
    }

    public void MarkCancelled(string operationId, string? reason = "Cancelled")
    {
        if (!_jobs.TryGetValue(operationId, out var job)) return;
        if (job.Status is FileTransferJobStatus.Completed or FileTransferJobStatus.Cancelled)
            return;
        job.Status = FileTransferJobStatus.Cancelled;
        job.Error = reason ?? "Cancelled";
        job.CompletedUtc = DateTime.UtcNow;
        DetachProcess(operationId);
        _cancelSources.TryRemove(operationId, out var cts);
        cts?.Dispose();
        NotifyChanged();
    }

    /// <summary>Track an external process (WinRAR / TeraCopy) so Cancel can kill it. Caller owns Process lifetime.</summary>
    public void AttachProcess(string operationId, Process process)
    {
        if (string.IsNullOrEmpty(operationId) || process == null) return;
        _attachedProcesses[operationId] = process;
        ProcessJobService.TryAttach(operationId, process);
    }

    public void DetachProcess(string operationId)
    {
        _attachedProcesses.TryRemove(operationId, out _);
        ProcessJobService.Release(operationId);
    }

    private void KillAttachedProcess(string operationId)
    {
        ProcessJobService.Terminate(operationId);
        if (!_attachedProcesses.TryRemove(operationId, out var proc)) return;
        try
        {
            if (!proc.HasExited)
            {
                try { proc.Kill(entireProcessTree: true); }
                catch { try { proc.Kill(); } catch { /* ignore */ } }
            }
        }
        catch { /* ignore */ }
    }

    public int ClearFinishedJobs()
    {
        var toRemove = _jobs
            .Where(kv => kv.Value.Status is FileTransferJobStatus.Completed
                or FileTransferJobStatus.Cancelled
                or FileTransferJobStatus.Failed)
            .Select(kv => kv.Key)
            .ToList();
        foreach (var id in toRemove)
            _jobs.TryRemove(id, out _);
        if (toRemove.Count > 0)
            NotifyChanged();
        return toRemove.Count;
    }

    public bool Cancel(string operationId)
    {
        lock (_pendingLock)
        {
            var pendingIdx = _pending.FindIndex(p => p.OperationId == operationId);
            if (pendingIdx >= 0)
            {
                _pending.RemoveAt(pendingIdx);
                Interlocked.Decrement(ref _queuedCount);
            }
        }

        KillAttachedProcess(operationId);

        if (_cancelSources.TryGetValue(operationId, out var cts))
        {
            try { cts.Cancel(); } catch { /* ignore */ }
            MarkCancelled(operationId);
            return true;
        }

        if (_jobs.TryGetValue(operationId, out var queued) && queued.Status == FileTransferJobStatus.Queued)
        {
            MarkCancelled(operationId);
            return true;
        }

        if (_jobs.TryGetValue(operationId, out var running) && running.Status == FileTransferJobStatus.Running)
        {
            MarkCancelled(operationId);
            return true;
        }

        if (_jobs.TryGetValue(operationId, out var paused) && paused.Status == FileTransferJobStatus.Paused)
        {
            MarkCancelled(operationId);
            return true;
        }

        return false;
    }

    /// <summary>Soft-pause a running/queued job — cancels in-flight work and parks status as Paused for resume.</summary>
    public bool Pause(string operationId)
    {
        if (!_jobs.TryGetValue(operationId, out var job)) return false;
        if (job.Status is not (FileTransferJobStatus.Queued or FileTransferJobStatus.Running))
            return false;

        lock (_pendingLock)
        {
            var pendingIdx = _pending.FindIndex(p => p.OperationId == operationId);
            if (pendingIdx >= 0)
            {
                _pending.RemoveAt(pendingIdx);
                Interlocked.Decrement(ref _queuedCount);
            }
        }

        if (_cancelSources.TryGetValue(operationId, out var cts))
        {
            try { cts.Cancel(); } catch { /* ignore */ }
        }

        job.Status = FileTransferJobStatus.Paused;
        job.Error = null;
        NotifyChanged();
        return true;
    }

    /// <summary>Resume a paused job by re-queuing a no-op completion marker — UI should re-enqueue real work.</summary>
    public bool Resume(string operationId)
    {
        if (!_jobs.TryGetValue(operationId, out var job)) return false;
        if (job.Status != FileTransferJobStatus.Paused) return false;
        job.Status = FileTransferJobStatus.Queued;
        NotifyChanged();
        return true;
    }

    public CancellationToken RegisterCancellation(string operationId)
    {
        var cts = new CancellationTokenSource();
        _cancelSources[operationId] = cts;
        return cts.Token;
    }

    public async Task EnqueueAsync(
        string operationId,
        Func<CancellationToken, Task> work,
        CancellationToken cancellationToken = default,
        FileTransferPriority priority = FileTransferPriority.Normal)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_pendingLock)
        {
            _pending.Add(new QueuedWork
            {
                OperationId = operationId,
                Work = work,
                Completion = tcs,
                Priority = priority,
            });
            _pending.Sort((a, b) =>
            {
                var byPriority = b.Priority.CompareTo(a.Priority);
                return byPriority != 0 ? byPriority : a.EnqueuedUtc.CompareTo(b.EnqueuedUtc);
            });
            Interlocked.Increment(ref _queuedCount);
        }
        NotifyChanged();
        _ = ProcessQueueAsync();
        using var reg = cancellationToken.Register(() => tcs.TrySetCanceled(cancellationToken));
        await tcs.Task.ConfigureAwait(false);
    }

    public async Task RunImmediateAsync(string operationId, Func<CancellationToken, Task> work, CancellationToken cancellationToken = default)
    {
        if (_jobs.TryGetValue(operationId, out var job))
        {
            job.Status = FileTransferJobStatus.Running;
            job.StartedUtc = DateTime.UtcNow;
        }
        Interlocked.Increment(ref _activeCount);
        NotifyChanged();
        var token = RegisterCancellation(operationId);
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(token, cancellationToken);
        try
        {
            await work(linked.Token).ConfigureAwait(false);
        }
        finally
        {
            _cancelSources.TryRemove(operationId, out var cts);
            cts?.Dispose();
            Interlocked.Decrement(ref _activeCount);
            NotifyChanged();
        }
    }

    private async Task ProcessQueueAsync()
    {
        if (!await _gate.WaitAsync(0).ConfigureAwait(false))
            return;

        try
        {
            while (true)
            {
                QueuedWork? item;
                lock (_pendingLock)
                {
                    if (_pending.Count == 0) break;
                    item = _pending[0];
                    _pending.RemoveAt(0);
                }

                Interlocked.Decrement(ref _queuedCount);
                if (_jobs.TryGetValue(item.OperationId, out var preJob) && preJob.Status == FileTransferJobStatus.Cancelled)
                {
                    item.Completion.TrySetCanceled();
                    continue;
                }
                Interlocked.Increment(ref _activeCount);
                if (_jobs.TryGetValue(item.OperationId, out var job) && job.Status == FileTransferJobStatus.Queued)
                {
                    job.Status = FileTransferJobStatus.Running;
                    job.StartedUtc = DateTime.UtcNow;
                }
                NotifyChanged();

                try
                {
                    var token = RegisterCancellation(item.OperationId);
                    await item.Work(token).ConfigureAwait(false);
                    item.Completion.TrySetResult(true);
                }
                catch (OperationCanceledException)
                {
                    MarkCancelled(item.OperationId);
                    item.Completion.TrySetCanceled();
                }
                catch (Exception ex)
                {
                    MarkFailed(item.OperationId, ex.Message);
                    item.Completion.TrySetException(ex);
                }
                finally
                {
                    Interlocked.Decrement(ref _activeCount);
                    NotifyChanged();
                }
            }
        }
        finally
        {
            _gate.Release();
            bool hasMore;
            lock (_pendingLock)
            {
                hasMore = _pending.Count > 0;
            }
            if (hasMore)
                _ = ProcessQueueAsync();
        }
    }

    private void NotifyChanged()
    {
        QueueChanged?.Invoke();
        MaybePersist();
    }

    private void MaybePersist()
    {
        if (!_persistEnabled) return;
        var now = DateTime.UtcNow;
        if ((now - _lastPersistUtc).TotalMilliseconds < 750) return;
        _lastPersistUtc = now;
        _ = Task.Run(PersistNow);
    }

    private void PersistNow()
    {
        lock (_persistLock)
        {
            try
            {
                var rows = _jobs.Values
                    .OrderByDescending(j => j.CompletedUtc ?? j.QueuedUtc)
                    .Take(64)
                    .Select(j => new PersistedTransferJob
                    {
                        OperationId = j.OperationId,
                        Action = j.Action,
                        Label = j.Label,
                        Engine = j.Engine,
                        Category = j.Category,
                        Priority = j.Priority.ToString().ToLowerInvariant(),
                        Status = j.Status.ToString(),
                        Progress = j.Progress,
                        CurrentFile = j.CurrentFile,
                        DestinationPath = j.DestinationPath,
                        Error = j.Error,
                        QueuedUtc = j.QueuedUtc,
                        StartedUtc = j.StartedUtc,
                        CompletedUtc = j.CompletedUtc,
                        ItemsTotal = j.ItemsTotal,
                        ItemsCompleted = j.ItemsCompleted,
                        BytesTransferred = j.BytesTransferred,
                        TotalBytes = j.TotalBytes,
                    })
                    .ToList();
                var json = JsonSerializer.Serialize(rows, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_persistPath, json);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[FileTransferQueue] Persist failed: {ex.Message}");
            }
        }
    }

    private static FileTransferPriority ParsePriority(string? value) =>
        value?.ToLowerInvariant() switch
        {
            "high" => FileTransferPriority.High,
            "low" => FileTransferPriority.Low,
            _ => FileTransferPriority.Normal,
        };
}
