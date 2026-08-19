using System;
using System.Diagnostics;
using System.Threading;
using System.Windows.Threading;
using WpfApplication = System.Windows.Application;

namespace BNDZ.Services;

/// <summary>
/// STA dispatcher for WPF clipboard / shell context menu when there is no WPF MainWindow
/// (BNDZShell headless embed). Classic App.xaml hosts reuse <see cref="WpfApplication.Current"/>.
/// </summary>
internal static class BndzUiDispatcher
{
    private static readonly object Sync = new();
    private static Dispatcher? _dispatcher;
    private static Thread? _thread;

    public static void EnsureStarted()
    {
        if (TryBindExisting()) return;

        lock (Sync)
        {
            if (TryBindExisting()) return;

            var ready = new ManualResetEventSlim(false);
            Exception? bootError = null;

            _thread = new Thread(() =>
            {
                try
                {
                    // Creates Application.Current on this STA thread so Clipboard + Vanara menus work.
                    _ = new WpfApplication
                    {
                        ShutdownMode = System.Windows.ShutdownMode.OnExplicitShutdown
                    };
                    _dispatcher = Dispatcher.CurrentDispatcher;
                    ready.Set();
                    Dispatcher.Run();
                }
                catch (Exception ex)
                {
                    bootError = ex;
                    try { ready.Set(); } catch { /* ignore */ }
                }
            })
            {
                IsBackground = true,
                Name = "BNDZ-UI-STA"
            };
            _thread.SetApartmentState(ApartmentState.STA);
            _thread.Start();

            if (!ready.Wait(TimeSpan.FromSeconds(8)))
            {
                Debug.WriteLine("[BndzUiDispatcher] STA pump timed out");
                throw new TimeoutException("BNDZ UI dispatcher failed to start.");
            }

            if (bootError != null)
            {
                Debug.WriteLine($"[BndzUiDispatcher] STA pump failed: {bootError.Message}");
                throw new InvalidOperationException("BNDZ UI dispatcher failed.", bootError);
            }
        }
    }

    private static bool TryBindExisting()
    {
        if (_dispatcher is { HasShutdownStarted: false, HasShutdownFinished: false })
            return true;

        if (WpfApplication.Current?.Dispatcher is { HasShutdownStarted: false, HasShutdownFinished: false } appDisp)
        {
            _dispatcher = appDisp;
            return true;
        }

        return false;
    }

    private static Dispatcher Require()
    {
        EnsureStarted();
        return _dispatcher
            ?? WpfApplication.Current?.Dispatcher
            ?? throw new InvalidOperationException("No BNDZ UI dispatcher.");
    }

    public static T Invoke<T>(Func<T> func)
    {
        var d = Require();
        if (d.CheckAccess()) return func();
        return d.Invoke(func);
    }

    public static void Invoke(Action action) =>
        Invoke(() =>
        {
            action();
            return 0;
        });
}
