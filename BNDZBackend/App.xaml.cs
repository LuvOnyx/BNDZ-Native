using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Principal;
using System.Text.Json;
using System.Threading;
using System.Windows;
using Microsoft.Extensions.DependencyInjection;
using BNDZ.Services;

namespace BNDZ
{
    public partial class App : System.Windows.Application
    {
        public static ServiceProvider ServiceProvider { get; private set; } = null!;
        private static Mutex? _instanceMutex;

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

            // Headless shell verb — must run before always-elevate / single-instance so Explorer
            // Icon Studio apply does not trip UAC or hand off to the main window.
            if (e.Args.Length >= 3 && string.Equals(e.Args[0], "--apply-icon", StringComparison.OrdinalIgnoreCase))
            {
                string iconPath = e.Args[1];
                string targetPath = e.Args[2];
                string? exeDir = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);
                if (!string.IsNullOrEmpty(exeDir))
                    iconPath = iconPath.Replace("[ASSETS]", Path.Combine(exeDir, "Assets"));
                try
                {
                    if (!string.IsNullOrEmpty(iconPath)
                        && File.Exists(iconPath)
                        && !iconPath.EndsWith(".ico", StringComparison.OrdinalIgnoreCase))
                    {
                        var converted = new IconLibraryScanner().ConvertToIco(iconPath);
                        if (!string.IsNullOrEmpty(converted))
                            iconPath = converted;
                    }

                    var iconSvc = new IconStudioService();
                    if (Directory.Exists(targetPath))
                        iconSvc.ApplyFolderIcon(targetPath, iconPath);
                    else if (File.Exists(targetPath))
                        iconSvc.ApplyFileIcon(targetPath, iconPath);
                    BNDZ.Services.FolcolorPort.ResetIconCache();
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"[IconStudio] --apply-icon failed: {ex.Message}");
                }
                Current.Shutdown();
                return;
            }

            // Persist "always elevate" only after an elevated confirmation launch.
            if (HasArg(e.Args, "--enable-always-elevated") && IsProcessElevated())
                PersistAlwaysRunElevated(true);

            // Opt-in: Windows UAC Allow/Cancel on every launch when setting is confirmed.
            if (ReadAlwaysRunElevatedSetting() && !IsProcessElevated() && !HasArg(e.Args, "--elevated"))
            {
                try
                {
                    var exe = Process.GetCurrentProcess().MainModule?.FileName;
                    if (!string.IsNullOrEmpty(exe))
                    {
                        var passthrough = string.Join(" ",
                            e.Args
                                .Where(a => !string.Equals(a, "--elevated", StringComparison.OrdinalIgnoreCase)
                                    && !string.Equals(a, "--enable-always-elevated", StringComparison.OrdinalIgnoreCase)
                                    && !string.Equals(a, "--skip-elevation", StringComparison.OrdinalIgnoreCase))
                                .Select(QuoteArg));
                        var args = string.IsNullOrWhiteSpace(passthrough)
                            ? "--elevated"
                            : $"{passthrough} --elevated";
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = exe,
                            Arguments = args,
                            Verb = "runas",
                            UseShellExecute = true,
                        });
                        Current.Shutdown();
                        return;
                    }
                }
                catch (Win32Exception)
                {
                    // User cancelled UAC — continue unelevated for this session.
                }
                catch
                {
                    // Fall through unelevated.
                }
            }

            if (!TryAcquireSingleInstance(e.Args))
            {
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

            BndzFileManagerIpcService.Instance.RegisterMain(mainWindow);
            BndzFileManagerIpcService.Instance.Start();
        }

        /// <summary>
        /// Honor "Allow multiple instances". When disabled, activate the existing process instead.
        /// </summary>
        private static bool TryAcquireSingleInstance(string[] args)
        {
            try
            {
                if (ReadAllowMultipleInstances())
                    return true;

                const string name = @"Local\BNDZ-FileManager-SingleInstance";
                _instanceMutex = new Mutex(true, name, out var createdNew);
                if (createdNew) return true;

                // Hand off open-path to the running instance when possible.
                var openPath = ResolveOpenPath(args);
                if (!string.IsNullOrWhiteSpace(openPath))
                    BndzFileManagerIpcService.TrySendOpenPathToRunningInstance(openPath);

                return false;
            }
            catch
            {
                return true; // fail open
            }
        }

        private static bool ReadAllowMultipleInstances()
        {
            try
            {
                var json = new SettingsManager().LoadSettings();
                if (string.IsNullOrWhiteSpace(json)) return false;
                using var doc = JsonDocument.Parse(json);
                return doc.RootElement.TryGetProperty("allowMultipleInstances", out var el)
                    && el.ValueKind == JsonValueKind.True;
            }
            catch { }
            return false;
        }

        private static bool HasArg(string[] args, string flag) =>
            args.Any(a => string.Equals(a, flag, StringComparison.OrdinalIgnoreCase));

        private static string QuoteArg(string arg)
        {
            if (string.IsNullOrEmpty(arg)) return "\"\"";
            if (arg.Contains(' ') || arg.Contains('"'))
                return "\"" + arg.Replace("\"", "\\\"") + "\"";
            return arg;
        }

        private static bool IsProcessElevated()
        {
            try
            {
                using var identity = WindowsIdentity.GetCurrent();
                var principal = new WindowsPrincipal(identity);
                return principal.IsInRole(WindowsBuiltInRole.Administrator);
            }
            catch
            {
                return false;
            }
        }

        private static bool ReadAlwaysRunElevatedSetting()
        {
            try
            {
                var json = new SettingsManager().LoadSettings();
                if (string.IsNullOrWhiteSpace(json)) return false;
                using var doc = JsonDocument.Parse(json);
                // Require both flags so the setting is only active after confirmed elevation.
                return doc.RootElement.TryGetProperty("alwaysRunElevated", out var enabled)
                    && enabled.ValueKind == JsonValueKind.True
                    && doc.RootElement.TryGetProperty("alwaysRunElevatedConfirmed", out var conf)
                    && conf.ValueKind == JsonValueKind.True;
            }
            catch { }
            return false;
        }

        private static void PersistAlwaysRunElevated(bool enabled)
        {
            try
            {
                var mgr = new SettingsManager();
                var json = mgr.LoadSettings() ?? "{}";
                using var doc = JsonDocument.Parse(json);
                using var stream = new MemoryStream();
                using (var writer = new Utf8JsonWriter(stream))
                {
                    writer.WriteStartObject();
                    foreach (var p in doc.RootElement.EnumerateObject())
                    {
                        if (p.NameEquals("alwaysRunElevated") || p.NameEquals("alwaysRunElevatedConfirmed"))
                            continue;
                        p.WriteTo(writer);
                    }
                    writer.WriteBoolean("alwaysRunElevated", enabled);
                    writer.WriteBoolean("alwaysRunElevatedConfirmed", enabled);
                    writer.WriteEndObject();
                }
                mgr.SaveSettings(System.Text.Encoding.UTF8.GetString(stream.ToArray()));
            }
            catch { }
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
            services.AddSingleton<LocalAiService>();
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
