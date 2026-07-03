namespace BNDZ.Services;

/// <summary>Coordinates the standalone launcher host with the optional BNDZ File Manager.</summary>
public sealed class BndzHostCoordinator
{
    public static BndzHostCoordinator Instance { get; } = new();

    public void ShowLauncher()
    {
        BndzFlowLauncherService.Instance.EnsureRunning();
        BndzLauncherShellService.Instance.Show();
    }

    public void EnsureLauncherRunning(string? bndzJson = null) =>
        BndzFlowLauncherService.Instance.ApplyConfigAndEnsureRunning(bndzJson);

    public void SyncLauncherSettings(string? bndzJson) =>
        BndzFlowLauncherService.Instance.ApplyConfigAndEnsureRunning(bndzJson);

    public void OpenPathInFileManager(string path) =>
        BndzFileManagerBridge.TryOpenPath(path);

    public void ShowFileManager() =>
        BndzFileManagerBridge.TryShowFileManager();

    public void Shutdown(string? bndzJson = null)
    {
        if (BndzLauncherSettingsBridge.ShouldExitLauncherWithBndz(bndzJson))
            BndzFlowLauncherService.Instance.Stop();
    }
}
