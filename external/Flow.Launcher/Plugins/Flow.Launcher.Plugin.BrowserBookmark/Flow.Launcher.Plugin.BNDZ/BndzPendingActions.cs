using System;
using System.IO;
using System.Text.Json;
using Flow.Launcher.Plugin;

namespace Flow.Launcher.Plugin.BNDZ
{
    internal static class BndzPendingActions
    {
        public static void Process(PluginInitContext context)
        {
            var path = Path.Combine(ResolveUserDataDir(), "BNDZ", "pending-action.json");
            if (!File.Exists(path)) return;
            try
            {
                var json = File.ReadAllText(path);
                File.Delete(path);
                using var doc = JsonDocument.Parse(json);
                if (!doc.RootElement.TryGetProperty("action", out var actionEl)) return;
                var action = actionEl.GetString();
                if (action == "open_settings")
                    context.API.OpenSettingDialog();
            }
            catch (Exception ex)
            {
                context.API.LogError(nameof(BndzPendingActions), ex.Message);
            }
        }

        private static string ResolveUserDataDir()
        {
            var pluginDir = Path.GetDirectoryName(typeof(BndzPendingActions).Assembly.Location) ?? "";
            var launcherDir = Directory.GetParent(pluginDir)?.Parent?.FullName ?? pluginDir;
            return Path.Combine(launcherDir, "UserData");
        }
    }
}
