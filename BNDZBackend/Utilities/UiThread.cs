using System;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Windows.Threading;

namespace BNDZ.Utilities;

/// <summary>UI-thread marshaling and background task helpers (avoids CS4014 on Dispatcher.InvokeAsync).</summary>
internal static class UiThread
{
    public static void Marshal(Dispatcher dispatcher, Action action)
    {
        if (dispatcher.CheckAccess())
        {
            try { action(); }
            catch (Exception ex) { Debug.WriteLine($"[UiThread] {ex}"); }
            return;
        }

        dispatcher.BeginInvoke(() =>
        {
            try { action(); }
            catch (Exception ex) { Debug.WriteLine($"[UiThread] {ex}"); }
        });
    }

    public static Task MarshalAsync(Dispatcher dispatcher, Action action)
    {
        if (dispatcher.CheckAccess())
        {
            try { action(); }
            catch (Exception ex) { Debug.WriteLine($"[UiThread] {ex}"); }
            return Task.CompletedTask;
        }

        var tcs = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        dispatcher.BeginInvoke(() =>
        {
            try
            {
                action();
                tcs.TrySetResult();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[UiThread] {ex}");
                tcs.TrySetException(ex);
            }
        });
        return tcs.Task;
    }

    public static void RunFireAndForget(Func<Task> work, string context)
    {
        _ = Task.Run(async () =>
        {
            try { await work().ConfigureAwait(false); }
            catch (Exception ex) { Debug.WriteLine($"[{context}] {ex}"); }
        });
    }
}
