using System;

namespace BNDZ.Services;

/// <summary>Coordinates BNDZ main window with the Flow-based BNDZ Launcher process.</summary>
public sealed class BndzHostCoordinator
{
    public static BndzHostCoordinator Instance { get; } = new();

    private MainWindow? _main;

    public void RegisterMain(MainWindow main) => _main = main;

    public void ShowLauncher()
    {
        BndzFlowLauncherService.Instance.EnsureRunning();
        BndzLauncherShellService.Instance.Show();
    }

    public void EnsureLauncherRunning(string? bndzJson = null) =>
        BndzFlowLauncherService.Instance.ApplyConfigAndEnsureRunning(bndzJson);

    public void SyncLauncherSettings(string? bndzJson) =>
        BndzFlowLauncherService.Instance.ApplyConfigAndEnsureRunning(bndzJson);

    public void OpenPathInFileManager(string path)
    {
        System.Windows.Application.Current.Dispatcher.Invoke(() => _main?.OpenPathInManager(path));
    }

    public void ShowFileManager()
    {
        System.Windows.Application.Current.Dispatcher.Invoke(() => _main?.ShowAndActivate());
    }

    public void RequestClose(string source = "unknown")
    {
        System.Windows.Application.Current.Dispatcher.Invoke(() => _main?.RequestCloseFromUI(source));
    }

    public void Shutdown(string? bndzJson = null)
    {
        if (BndzLauncherSettingsBridge.ShouldExitLauncherWithBndz(bndzJson))
            BndzFlowLauncherService.Instance.Stop();
    }
}
