using System;
using System.Windows;
using System.Windows.Threading;
using Flow.Launcher.Plugin;

namespace Flow.Launcher.Plugin.BNDZ
{
    /// <summary>Hands off Flow MainWindow display to the BNDZ WebView2 launcher shell.</summary>
    internal static class BndzShellBridge
    {
        private static PluginInitContext? _context;

        public static void ScheduleHandoff(PluginInitContext context)
        {
            _context = context;
            BndzShellRedirect.TryRedirect = RedirectToBndzShell;
            BndzShellRedirect.TryToggle = ToggleBndzShell;

            if (Application.Current == null) return;
            Application.Current.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() =>
            {
                SuppressFlowMainWindow();
            }));
        }

        private static bool RedirectToBndzShell()
        {
            if (!BndzIpcClient.TrySendShowShell()) return false;
            SuppressFlowMainWindow();
            BndzActivationSound.PlayOpen();
            return true;
        }

        private static bool ToggleBndzShell()
        {
            if (!BndzIpcClient.TrySendToggleShell()) return false;
            SuppressFlowMainWindow();
            BndzActivationSound.PlayOpen();
            return true;
        }

        private static void SuppressFlowMainWindow()
        {
            try
            {
                _context?.API.HideMainWindow();
                foreach (Window window in Application.Current.Windows)
                {
                    var name = window.GetType().Name ?? "";
                    if (!name.EndsWith("MainWindow", StringComparison.Ordinal)) continue;
                    if (window.IsVisible) window.Hide();
                }
            }
            catch { }
        }
    }
}
