using System.Windows;

namespace BNDZ.Services;

/// <summary>Hosts the SuperCmd-derived WebView2 BNDZ Launcher shell.</summary>
public sealed class BndzLauncherShellService
{
    private static readonly Lazy<BndzLauncherShellService> _instance = new(() => new BndzLauncherShellService());
    public static BndzLauncherShellService Instance => _instance.Value;

    private LauncherShellWindow? _window;

    private BndzLauncherShellService() { }

    public void EnsureWindow()
    {
        System.Windows.Application.Current.Dispatcher.Invoke(() =>
        {
            if (_window != null) return;
            _window = new LauncherShellWindow();
            _window.Closed += (_, _) => _window = null;
        });
    }

    public void Show()
    {
        BndzFlowLauncherService.Instance.EnsureRunning();
        System.Windows.Application.Current.Dispatcher.Invoke(() =>
        {
            EnsureWindow();
            _window?.ShowCentered();
            BndzActivationSound.PlayOpen();
        });
    }

    public void Hide()
    {
        System.Windows.Application.Current.Dispatcher.Invoke(() => _window?.Hide());
    }

    public bool IsVisible =>
        System.Windows.Application.Current.Dispatcher.Invoke(() => _window?.IsVisible == true);
}
