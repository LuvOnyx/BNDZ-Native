using System.IO;
using System.Text.Json;

namespace BNDZ.Services;

/// <summary>Signals the Flow plugin to perform actions (e.g. open settings dialog).</summary>
public static class BndzLauncherPendingActions
{
    public static void RequestOpenSettings()
    {
        var dir = Path.Combine(BndzFlowLauncherService.Instance.LauncherDirectory, "UserData", "BNDZ");
        Directory.CreateDirectory(dir);
        var path = Path.Combine(dir, "pending-action.json");
        File.WriteAllText(path, JsonSerializer.Serialize(new { action = "open_settings" }));
        BndzFlowLauncherService.Instance.EnsureRunning();
    }
}
