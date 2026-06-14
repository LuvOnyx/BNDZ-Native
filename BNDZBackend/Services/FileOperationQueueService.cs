using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>
/// Serializes file copy/move/delete operations so concurrent pastes do not corrupt each other.
/// </summary>
public sealed class FileOperationQueueService
{
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConcurrentQueue<QueuedWork> _pending = new();
    private int _queuedCount;
    private int _activeCount;

    private sealed class QueuedWork
    {
        public required Func<CancellationToken, Task> Work { get; init; }
        public required TaskCompletionSource<bool> Completion { get; init; }
    }

    public int QueuedCount => _queuedCount;
    public int ActiveCount => _activeCount;

    public async Task EnqueueAsync(Func<CancellationToken, Task> work, CancellationToken cancellationToken = default)
    {
        var tcs = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
        _pending.Enqueue(new QueuedWork { Work = work, Completion = tcs });
        Interlocked.Increment(ref _queuedCount);
        _ = ProcessQueueAsync();
        using var reg = cancellationToken.Register(() => tcs.TrySetCanceled(cancellationToken));
        await tcs.Task.ConfigureAwait(false);
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
                Interlocked.Increment(ref _activeCount);
                try
                {
                    await item.Work(CancellationToken.None).ConfigureAwait(false);
                    item.Completion.TrySetResult(true);
                }
                catch (Exception ex)
                {
                    item.Completion.TrySetException(ex);
                }
                finally
                {
                    Interlocked.Decrement(ref _activeCount);
                }
            }
        }
        finally
        {
            _gate.Release();
        }
    }
}
