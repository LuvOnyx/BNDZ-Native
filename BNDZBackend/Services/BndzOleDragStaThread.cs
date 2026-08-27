using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>
/// Dedicated STA thread for modal ole32 DoDragDrop — never block the WinUI/WPF UI dispatcher.
/// </summary>
internal static class BndzOleDragStaThread
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

    [DllImport("ole32.dll")]
    private static extern int OleInitialize(IntPtr reserved);

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
        if (!done.Wait(TimeSpan.FromMinutes(10)))
            throw new TimeoutException("BNDZ OLE drag STA invoke timed out.");
        if (err != null)
            throw err;
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
                Name = "BNDZ-OLE-Drag-STA",
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
            var hr = OleInitialize(IntPtr.Zero);
            if (hr < 0)
                Debug.WriteLine($"[BndzOleDragStaThread] OleInitialize hr=0x{hr:X8}");
            try
            {
                WebView2DropTargetService.AppendOleDndLogPublic("OLE drag STA thread ready");
            }
            catch { /* ignore */ }

            foreach (var item in _queue!.GetConsumingEnumerable())
            {
                try
                {
                    item.Action();
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[BndzOleDragStaThread] {ex.Message}");
                    try { WebView2DropTargetService.AppendOleDndLogPublic($"OLE drag STA error {ex.Message}"); }
                    catch { /* ignore */ }
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
            Debug.WriteLine($"[BndzOleDragStaThread] thread exit: {ex.Message}");
        }
    }
}
