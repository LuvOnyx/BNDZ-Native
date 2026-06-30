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
            if (e.Args.Length >= 1 && e.Args[0] == "--version")
            {
                Console.WriteLine(BndzUpdateService.GetCurrentVersion());
                Current.Shutdown();
                return;
            }

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
            var openPath = ResolveOpenPath(e.Args);
            if (!string.IsNullOrWhiteSpace(openPath))
                mainWindow.SetPendingOpenPath(openPath);
            var startupAction = ResolveStartupAction(e.Args);
            if (!string.IsNullOrWhiteSpace(startupAction))
                mainWindow.SetPendingStartupAction(startupAction);
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

        /// <summary>Accepts --open-path or a bare path from Explorer context menus ("BNDZ.exe" "%1").</summary>
        private static string? ResolveOpenPath(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--open-path" && i + 1 < args.Length)
                    return args[++i];
            }

            foreach (var arg in args)
            {
                if (string.IsNullOrWhiteSpace(arg) || arg.StartsWith('-')) continue;
                try
                {
                    if (File.Exists(arg) || Directory.Exists(arg))
                        return arg;
                }
                catch { }
            }

            return null;
        }

        /// <summary>CLI: --find "query", --catalog id, --dual-pane</summary>
        private static string? ResolveStartupAction(string[] args)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] == "--dual-pane") return "dual-pane";
                if (args[i] == "--find" && i + 1 < args.Length)
                    return $"find:{args[++i]}";
                if (args[i] == "--catalog" && i + 1 < args.Length)
                    return $"catalog:{args[++i]}";
            }
            return null;
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
