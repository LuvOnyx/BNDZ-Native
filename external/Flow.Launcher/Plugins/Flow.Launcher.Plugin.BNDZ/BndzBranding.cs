using System;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using Flow.Launcher.Plugin;

namespace Flow.Launcher.Plugin.BNDZ
{
    /// <summary>Applies BNDZ icons at runtime (tray, title bars) without modifying Flow core source.</summary>
    internal static class BndzBranding
    {
        private static Icon? _trayIcon;

        public static void ScheduleApply(PluginInitContext context)
        {
            if (Application.Current == null) return;
            Application.Current.Dispatcher.BeginInvoke(DispatcherPriority.ApplicationIdle, new Action(() =>
            {
                Apply(context);
                Application.Current.Activated += (_, _) => Apply(context);

                var retries = 0;
                var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(400) };
                timer.Tick += (_, _) =>
                {
                    Apply(context);
                    if (++retries >= 8)
                        timer.Stop();
                };
                timer.Start();
            }));
        }

        public static void Apply(PluginInitContext? context)
        {
            try
            {
                var launcherDir = ResolveLauncherDirectory();
                var icoPath = Path.Combine(launcherDir, "Images", "app.ico");
                var pngPath = Path.Combine(launcherDir, "Images", "app.png");
                if (!File.Exists(icoPath) && !File.Exists(pngPath)) return;

                if (File.Exists(icoPath))
                {
                    _trayIcon?.Dispose();
                    _trayIcon = new Icon(icoPath);
                }

                foreach (Window window in Application.Current.Windows)
                    ApplyToWindow(window, icoPath, pngPath);
            }
            catch (Exception ex)
            {
                context?.API.LogError(nameof(BndzBranding), ex.Message);
            }
        }

        private static void ApplyToWindow(Window window, string icoPath, string pngPath)
        {
            var typeName = window.GetType().FullName ?? "";
            if (typeName.EndsWith("MainWindow", StringComparison.Ordinal))
                ApplyTrayIcon(window);

            if (typeName.EndsWith("MainWindow", StringComparison.Ordinal)
                || typeName.EndsWith("SettingWindow", StringComparison.Ordinal)
                || typeName.EndsWith("WelcomeWindow", StringComparison.Ordinal))
            {
                ApplyWindowIcon(window, icoPath, pngPath);
            }
        }

        private static void ApplyTrayIcon(Window mainWindow)
        {
            if (_trayIcon == null) return;
            try
            {
                var field = mainWindow.GetType().GetField("_notifyIcon", BindingFlags.Instance | BindingFlags.NonPublic);
                var notify = field?.GetValue(mainWindow);
                if (notify == null) return;
                var iconProp = notify.GetType().GetProperty("Icon");
                iconProp?.SetValue(notify, (Icon)_trayIcon.Clone());
                var textProp = notify.GetType().GetProperty("Text");
                textProp?.SetValue(notify, "BNDZ Launcher");
            }
            catch { }
        }

        private static void ApplyWindowIcon(Window window, string icoPath, string pngPath)
        {
            try
            {
                ImageSource? source = null;
                if (File.Exists(icoPath))
                {
                    using var fs = File.OpenRead(icoPath);
                    source = BitmapFrame.Create(fs, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
                }
                else if (File.Exists(pngPath))
                {
                    source = BitmapFrame.Create(new Uri(Path.GetFullPath(pngPath), UriKind.Absolute));
                }
                if (source == null) return;

                window.Icon = source;
                ApplyTitleBarIcon(window, source);
            }
            catch { }
        }

        private static void ApplyTitleBarIcon(Window window, ImageSource source)
        {
            try
            {
                var titleBarType = Type.GetType("Flow.Launcher.Resources.Controls.CustomWindowTitleBar, Flow.Launcher");
                if (titleBarType == null) return;
                var iconProp = titleBarType.GetProperty("IconSource");
                if (iconProp == null) return;
                foreach (var child in FindVisualChildren(window, titleBarType))
                    iconProp.SetValue(child, source);
            }
            catch { }
        }

        private static System.Collections.Generic.IEnumerable<object> FindVisualChildren(DependencyObject parent, Type targetType)
        {
            if (parent == null) yield break;
            var count = System.Windows.Media.VisualTreeHelper.GetChildrenCount(parent);
            for (var i = 0; i < count; i++)
            {
                var child = System.Windows.Media.VisualTreeHelper.GetChild(parent, i);
                if (targetType.IsInstanceOfType(child))
                    yield return child;
                foreach (var nested in FindVisualChildren(child, targetType))
                    yield return nested;
            }
        }

        private static string ResolveLauncherDirectory()
        {
            var pluginDir = Path.GetDirectoryName(typeof(BndzBranding).Assembly.Location) ?? "";
            var launcherDir = Directory.GetParent(pluginDir)?.Parent?.FullName;
            if (!string.IsNullOrEmpty(launcherDir) && Directory.Exists(launcherDir))
                return launcherDir;
            return AppDomain.CurrentDomain.BaseDirectory;
        }
    }
}
