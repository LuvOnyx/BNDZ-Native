using System.Windows;
using BNDZ.Services;

namespace BNDZ.LauncherHost;

public partial class App : System.Windows.Application
{
    private void Application_Startup(object sender, StartupEventArgs e)
    {
        if (e.Args.Length >= 1 && e.Args[0] == "--version")
        {
            Console.WriteLine(typeof(App).Assembly.GetName().Version?.ToString() ?? "1.0.0");
            Shutdown();
            return;
        }

        BndzLauncherIpcService.Instance.Start();

        var settingsJson = new SettingsManager().LoadSettings();
        if (!Array.Exists(e.Args, a => a == "--no-flow"))
            BndzFlowLauncherService.Instance.ApplyConfigAndEnsureRunning(settingsJson);

        if (Array.Exists(e.Args, a => a == "--show"))
            BndzLauncherShellService.Instance.Show();
    }
}
