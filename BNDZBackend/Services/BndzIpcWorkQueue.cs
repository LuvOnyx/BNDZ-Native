using System;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>
/// Limits concurrent background IPC work so thumbnail/shell tasks cannot starve the thread pool
/// (nested Task.Run + Wait in extract paths used to queue thousands of blocked workers).
/// </summary>
public static class BndzIpcWorkQueue
{
    private static readonly SemaphoreSlim Thumbnails = new(6, 6);
    private static readonly SemaphoreSlim Metadata = new(3, 3);
    private static readonly SemaphoreSlim ShellIcons = new(8, 8);

    /// <summary>Wait up to <paramref name="waitMs"/> for a thumbnail slot; returns false if saturated.</summary>
    public static async Task<bool> TryRunThumbnailAsync(Func<Task> work, int waitMs = 3000, CancellationToken cancellationToken = default)
        => await TryRunAsync(Thumbnails, work, waitMs, cancellationToken).ConfigureAwait(false);

    public static Task RunThumbnailAsync(Func<Task> work, CancellationToken cancellationToken = default)
        => RunAsync(Thumbnails, work, cancellationToken);

    /// <summary>Wait up to <paramref name="waitMs"/> for a metadata slot; returns false if saturated.</summary>
    public static async Task<bool> TryRunMetadataAsync(Func<Task> work, int waitMs = 4000, CancellationToken cancellationToken = default)
        => await TryRunAsync(Metadata, work, waitMs, cancellationToken).ConfigureAwait(false);

    public static Task RunMetadataAsync(Func<Task> work, CancellationToken cancellationToken = default)
        => RunAsync(Metadata, work, cancellationToken);

    public static async Task<bool> TryRunShellIconAsync(Func<Task> work, int waitMs = 2500, CancellationToken cancellationToken = default)
        => await TryRunAsync(ShellIcons, work, waitMs, cancellationToken).ConfigureAwait(false);

    public static Task RunShellIconAsync(Func<Task> work, CancellationToken cancellationToken = default)
        => RunAsync(ShellIcons, work, cancellationToken);

    private static async Task<bool> TryRunAsync(SemaphoreSlim gate, Func<Task> work, int waitMs, CancellationToken cancellationToken)
    {
        if (!await gate.WaitAsync(Math.Clamp(waitMs, 100, 30_000), cancellationToken).ConfigureAwait(false))
            return false;
        try
        {
            await work().ConfigureAwait(false);
            return true;
        }
        finally
        {
            gate.Release();
        }
    }

    private static async Task RunAsync(SemaphoreSlim gate, Func<Task> work, CancellationToken cancellationToken)
    {
        await gate.WaitAsync(cancellationToken).ConfigureAwait(false);
        try
        {
            await work().ConfigureAwait(false);
        }
        finally
        {
            gate.Release();
        }
    }
}
