using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using BNDZ.Services;
using System.IO;

namespace BNDZ
{
    public partial class App : System.Windows.Application
    {
        public static ServiceProvider ServiceProvider { get; private set; }

        private void Application_Startup(object sender, StartupEventArgs e)
        {
            if (e.Args.Length >= 2 && e.Args[0] == "--restore-icon")
            {
                string targetPath = e.Args[1];
                try {
                    if (Directory.Exists(targetPath)) {
                        BNDZ.Services.FolcolorPort.RestoreFolder(targetPath);
                        BNDZ.Services.FolcolorPort.ResetIconCache();
                    }
                } catch {}
                Current.Shutdown();
                return;
            }

            if (e.Args.Length >= 1 && e.Args[0] == "--generate-icon")
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string light = Path.Combine(baseDir, "Assets", "BNDZ-light.png");
                string ico = Path.Combine(baseDir, "Assets", "BNDZ.ico");
                if (File.Exists(light))
                    AppIconService.SaveIcoToDisk(light, ico);
                Current.Shutdown();
                return;
            }

            AppIconService.EnsureApplicationIco();
            WindowsToastService.EnsureRegistered();

            if (e.Args.Length >= 3 && e.Args[0] == "--apply-icon")
            {
                string iconPath = e.Args[1];
                string targetPath = e.Args[2];
                if (iconPath.Contains("[ASSETS]")) {
                    string exeDir = System.IO.Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
                    iconPath = iconPath.Replace("[ASSETS]", System.IO.Path.Combine(exeDir, "Assets"));
                }
                try {
                    var iconSvc = new IconStudioService();
                    if (Directory.Exists(targetPath)) {
                        iconSvc.ApplyFolderIcon(targetPath, iconPath);
                    } else if (File.Exists(targetPath)) {
                        iconSvc.ApplyFileIcon(targetPath, iconPath);
                    }
                    BNDZ.Services.FolcolorPort.ResetIconCache();
                } catch {}
                Current.Shutdown();
                return;
            }

            var serviceCollection = new ServiceCollection();
            ConfigureServices(serviceCollection);
            ServiceProvider = serviceCollection.BuildServiceProvider();

            var mainWindow = ServiceProvider.GetRequiredService<MainWindow>();
            string? openPath = null;
            for (int i = 0; i < e.Args.Length; i++)
            {
                if (e.Args[i] == "--open-path" && i + 1 < e.Args.Length)
                    openPath = e.Args[++i];
            }
            if (!string.IsNullOrWhiteSpace(openPath))
                mainWindow.SetPendingOpenPath(openPath);
            mainWindow.Show();

            BndzLauncherIpcService.Instance.Start();

            if (!Array.Exists(e.Args, a => a == "--no-launcher"))
            {
                var settingsManager = new SettingsManager();
                var bndzJson = settingsManager.LoadSettings();
                if (BndzLauncherSettingsBridge.IsLauncherEnabled(bndzJson))
                    BndzHostCoordinator.Instance.EnsureLauncherRunning(bndzJson);
            }
        }

        private void ConfigureServices(IServiceCollection services)
        {
            // Core Application Services
            services.AddSingleton<FileManagementService>();
            services.AddSingleton<AiAssistantService>();
            services.AddSingleton<ShellIntegrationService>();
            services.AddSingleton<NativeShellService>();
            services.AddSingleton<IconStudioService>();
            services.AddSingleton<EverythingSearchService>();
            
            // UI Windows
            services.AddTransient<MainWindow>();
        }
    }
}
