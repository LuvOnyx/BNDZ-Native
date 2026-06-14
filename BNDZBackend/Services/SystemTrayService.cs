using System;
using System.Drawing;
using System.IO;
using System.Windows;
using System.Windows.Forms;

namespace BNDZ.Services;

/// <summary>Native system tray icon — show/restore/hide and tray menu.</summary>
public sealed class SystemTrayService : IDisposable
{
    private readonly Window _window;
    private NotifyIcon? _notifyIcon;
    private bool _disposed;

    public SystemTrayService(Window window)
    {
        _window = window;
    }

    public void EnsureVisible()
    {
        if (_notifyIcon != null) return;

        try
        {
            var icoPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets", "BNDZ.ico");
            Icon? icon = null;
            if (File.Exists(icoPath))
                icon = new Icon(icoPath);
            else
            {
                var light = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets", "BNDZ-light.png");
                var dark = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets", "BNDZ-dark.png");
                var png = File.Exists(light) ? light : dark;
                if (File.Exists(png))
                    icon = Icon.FromHandle(((Bitmap)Image.FromFile(png)).GetHicon());
            }

            _notifyIcon = new NotifyIcon
            {
                Text = "BNDZ",
                Icon = icon ?? SystemIcons.Application,
                Visible = true,
            };

            _notifyIcon.DoubleClick += (_, _) => RestoreMainWindow();
            var menu = new ContextMenuStrip();
            menu.Items.Add("Open Launcher", null, (_, _) => RequestLauncher());
            menu.Items.Add("Open File Manager", null, (_, _) => RestoreMainWindow());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Exit BNDZ", null, (_, _) => RequestQuit());
            _notifyIcon.ContextMenuStrip = menu;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"SystemTrayService.EnsureVisible: {ex.Message}");
        }
    }

    public void HideToTray()
    {
        EnsureVisible();
        _window.Dispatcher.Invoke(() =>
        {
            _window.ShowInTaskbar = false;
            _window.Hide();
        });
    }

    public void RestoreMainWindow()
    {
        _window.Dispatcher.Invoke(() =>
        {
            _window.ShowInTaskbar = true;
            _window.Show();
            _window.WindowState = WindowState.Normal;
            _window.Activate();
        });
    }

    public event Action? QuitRequested;
    public event Action? LauncherRequested;

    private void RequestQuit()
    {
        QuitRequested?.Invoke();
    }

    private void RequestLauncher()
    {
        LauncherRequested?.Invoke();
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_notifyIcon != null)
        {
            _notifyIcon.Visible = false;
            _notifyIcon.Dispose();
            _notifyIcon = null;
        }
    }
}
