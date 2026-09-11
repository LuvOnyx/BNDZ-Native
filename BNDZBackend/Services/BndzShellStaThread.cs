using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>
/// Dedicated STA thread for shell COM enumeration (Recycle Bin, shell folders).
/// Vanara ShellFolder/RecycleBin APIs require STA — MTA Task.Run yields empty lists.
/// </summary>
internal static class BndzShellStaThread
{
    private sealed class WorkItem
    {
        internal required Action Action { get; init; }
        internal ManualResetEventSlim? Done { get; init; }
        internal Action<Exception>? CaptureError { get; init; }
    }

    private static Thread? _thread;
    private static BlockingCollection<WorkItem>? _queue;
    private static readonly object Gate = new();
    private static int _threadId;

    private const uint COINIT_APARTMENTTHREADED = 0x2;

    [DllImport("ole32.dll")]
    private static extern int CoInitializeEx(IntPtr reserved, uint coInit);

    [DllImport("ole32.dll")]
    private static extern int OleInitialize(IntPtr reserved);

    internal static void WarmUp() => Run(static () => { }, block: false);

    internal static void Run(Action action, bool block = true)
    {
        if (action is null) return;
        EnsureStarted();

        if (Environment.CurrentManagedThreadId == _threadId)
        {
            action();
            return;
        }

        if (!block)
        {
            _queue!.Add(new WorkItem { Action = action });
            return;
        }

        using var done = new ManualResetEventSlim(false);
        Exception? err = null;
        _queue!.Add(new WorkItem
        {
            Action = action,
            Done = done,
            CaptureError = ex => err = ex,
        });
        if (!done.Wait(TimeSpan.FromMinutes(2)))
            throw new TimeoutException("BNDZ shell STA invoke timed out.");
        if (err != null)
            throw err;
    }

    internal static Task<T> RunAsync<T>(Func<T> func)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        Run(() =>
        {
            try { tcs.TrySetResult(func()); }
            catch (Exception ex) { tcs.TrySetException(ex); }
        });
        return tcs.Task;
    }

    private static void EnsureStarted()
    {
        lock (Gate)
        {
            if (_thread != null) return;
            _queue = new BlockingCollection<WorkItem>();
            _thread = new Thread(ThreadMain)
            {
                IsBackground = true,
                Name = "BNDZ-Shell-STA",
            };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();
        }
    }

    private static void ThreadMain()
    {
        _threadId = Environment.CurrentManagedThreadId;
        try
        {
            var hr = CoInitializeEx(IntPtr.Zero, COINIT_APARTMENTTHREADED);
            if (hr < 0 && hr != unchecked((int)0x80010106)) // RPC_E_CHANGED_MODE
                Debug.WriteLine($"[BndzShellStaThread] CoInitializeEx hr=0x{hr:X8}");
            var oleHr = OleInitialize(IntPtr.Zero);
            if (oleHr < 0 && oleHr != 1) // S_FALSE = already initialized
                Debug.WriteLine($"[BndzShellStaThread] OleInitialize hr=0x{oleHr:X8}");

            foreach (var item in _queue!.GetConsumingEnumerable())
            {
                try
                {
                    item.Action();
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[BndzShellStaThread] {ex.Message}");
                    item.CaptureError?.Invoke(ex);
                }
                finally
                {
                    try { item.Done?.Set(); } catch { /* ignore */ }
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzShellStaThread] thread exit: {ex.Message}");
        }
    }
}
