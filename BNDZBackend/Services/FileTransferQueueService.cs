using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

public enum FileTransferJobStatus
{
    Queued,
    Running,
    Completed,
    Failed,
    Cancelled,
}

public sealed class FileTransferJob
{
    public required string OperationId { get; init; }
    public required string Action { get; init; }
    public required string Label { get; init; }
    public string Engine { get; set; } = "bndz";
    public FileTransferJobStatus Status { get; set; } = FileTransferJobStatus.Queued;
    public int Progress { get; set; }
    public string? CurrentFile { get; set; }
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

    public object ToDto() => new
    {
        operationId = OperationId,
        action = Action,
        label = Label,
        engine = Engine,
        status = Status.ToString().ToLowerInvariant(),
        progress = Progress,
        currentFile = CurrentFile,
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
    };
}

/// <summary>
/// Serializes file operations with job tracking, cancellation, and queue visibility.
/// </summary>
public sealed class FileTransferQueueService
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConcurrentQueue<QueuedWork> _pending = new();
    private readonly ConcurrentDictionary<string, FileTransferJob> _jobs = new();
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _cancelSources = new();
    private int _queuedCount;
    private int _activeCount;

    public event Action? QueueChanged;

    private sealed class QueuedWork
    {
        public required string OperationId { get; init; }
        public required Func<CancellationToken, Task> Work { get; init; }
        public required TaskCompletionSource<bool> Completion { get; init; }
    }

    public int QueuedCount => _queuedCount;
    public int ActiveCount => _activeCount;

    public IReadOnlyList<object> GetSnapshot(int max = 32)
    {
        var cutoff = DateTime.UtcNow.AddSeconds(-45);
        return _jobs.Values
            .Where(j => j.Status is FileTransferJobStatus.Queued or FileTransferJobStatus.Running
                || (j.CompletedUtc.HasValue && j.CompletedUtc.Value >= cutoff))
            .OrderByDescending(j => j.Status == FileTransferJobStatus.Running)
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

    public FileTransferJob RegisterJob(string operationId, string action, string label, string engine, int itemsTotal = 1)
    {
        var job = new FileTransferJob
        {
            OperationId = operationId,
            Action = action,
            Label = label,
            Engine = engine,
            ItemsTotal = Math.Max(itemsTotal, 1),
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
        job.Progress = Math.Clamp(progress, 0, 100);
        job.CurrentFile = currentFile;
        job.ItemsCompleted = itemsCompleted;
        job.ItemsTotal = Math.Max(itemsTotal, 1);
        job.BytesTransferred = bytesTransferred;
        job.TotalBytes = totalBytes;
        job.SpeedBytesPerSecond = speedBytesPerSecond;
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

    public void MarkCompleted(string operationId)
    {
        if (!_jobs.TryGetValue(operationId, out var job)) return;
        job.Status = FileTransferJobStatus.Completed;
        job.Progress = 100;
        job.CompletedUtc = DateTime.UtcNow;
        _cancelSources.TryRemove(operationId, out var cts);
        cts?.Dispose();
        NotifyChanged();
    }

    public void MarkFailed(string operationId, string? error)
    {
        if (!_jobs.TryGetValue(operationId, out var job)) return;
        job.Status = FileTransferJobStatus.Failed;
        job.Error = error;
        job.CompletedUtc = DateTime.UtcNow;
        _cancelSources.TryRemove(operationId, out var cts);
        cts?.Dispose();
        NotifyChanged();
    }

    public bool Cancel(string operationId)
    {
        if (_cancelSources.TryGetValue(operationId, out var cts))
        {
            cts.Cancel();
            if (_jobs.TryGetValue(operationId, out var job))
            {
                job.Status = FileTransferJobStatus.Cancelled;
                job.CompletedUtc = DateTime.UtcNow;
                job.Error = "Cancelled";
            }
            NotifyChanged();
            return true;
        }

        if (_jobs.TryGetValue(operationId, out var queued) && queued.Status == FileTransferJobStatus.Queued)
        {
            queued.Status = FileTransferJobStatus.Cancelled;
            queued.CompletedUtc = DateTime.UtcNow;
            queued.Error = "Cancelled";
            NotifyChanged();
            return true;
        }

        return false;
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
        CancellationToken cancellationToken = default)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending.Enqueue(new QueuedWork { OperationId = operationId, Work = work, Completion = tcs });
        Interlocked.Increment(ref _queuedCount);
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
            while (_pending.TryDequeue(out var item))
            {
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
                    MarkFailed(item.OperationId, "Cancelled");
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
        }
    }

    private void NotifyChanged() => QueueChanged?.Invoke();
}
