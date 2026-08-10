using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Reflection;
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
        /// <summary>Second process launched via --stage-window (tear-off / Lens Stage).</summary>
        public static bool IsStageWindow { get; private set; }
        /// <summary>Second process launched via --plugin-window (plugin pop-out / sticky widget).</summary>
        public static bool IsPluginWindow { get; private set; }
        /// <summary>
        /// Comparison host: Files-like native chrome + full BNDZ React UI.
        /// Separate single-instance mutex so classic and native can run side by side.
        /// </summary>
        public static bool IsNativeShell { get; private set; }
        /// <summary>
        /// Embedded inside FilesMerge shell (HWND reparent). Full BNDZ UI, no outer chrome.
        /// Historical A/B only ΓÇö not architecture #3 product UX.
        /// </summary>
        public static bool IsEmbedded { get; private set; }
        /// <summary>WinUI shell reparent / FilesMerge host — same as IsEmbedded for classic WPF App.</summary>
        public static bool IsEmbeddedInWinUiShell => IsEmbedded;
        /// <summary>
        /// Architecture #3: full BNDZBackend brain for FilesMerge WinUI shell.
        /// Hidden window, services + host named pipe ΓÇö no nested classic FM UI.
        /// </summary>
        public static bool IsBackendHost { get; private set; }
        public static string? PluginWindowId { get; private set; }
        public static string? PluginStickyId { get; private set; }

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
                string assets  = Path.Combine(baseDir, "Assets");
                string ico     = Path.Combine(assets, "BNDZ.ico");
                // Use the square master PNG ΓÇö never the wide light banner.
                string? squarePng = null;
                foreach (var name in new[] { "bndz-square.png", "bndz-app.png" })
                {
                    var candidate = Path.Combine(assets, name);
                    if (File.Exists(candidate)) { squarePng = candidate; break; }
                }
                if (squarePng != null)
                    AppIconService.SaveIcoToDisk(squarePng, ico);
                Current.Shutdown();
                return;
            }

            AppIconService.EnsureApplicationIco();
            WindowsToastService.EnsureRegistered();

            // Headless shell verb ΓÇö must run before always-elevate / single-instance so Explorer
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
            // Debug builds skip relaunch so `dotnet run` from a terminal works without UAC handoff.
#if DEBUG
            const bool skipElevationRelaunch = true;
#else
            const bool skipElevationRelaunch = false;
#endif
            if (!skipElevationRelaunch
                && !HasArg(e.Args, "--skip-elevation")
                && ReadAlwaysRunElevatedSetting()
                && !IsProcessElevated()
                && !HasArg(e.Args, "--elevated"))
            {
                try
                {
                    if (TryRelaunchElevated(e.Args))
                    {
                        Current.Shutdown();
                        return;
                    }
                }
                catch (Win32Exception)
                {
                    // User cancelled UAC ΓÇö continue unelevated for this session.
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

            IsStageWindow = HasArg(e.Args, "--stage-window");
            IsNativeShell = HasArg(e.Args, "--native-shell");
            IsEmbedded = HasArg(e.Args, "--embedded");
            IsBackendHost = HasArg(e.Args, "--backend-host");
            PluginWindowId = ResolveArgValue(e.Args, "--plugin-window");
            PluginStickyId = ResolveArgValue(e.Args, "--sticky-id");
            IsPluginWindow = !string.IsNullOrWhiteSpace(PluginWindowId);
            var pluginTitle = ResolveArgValue(e.Args, "--plugin-title");

            var serviceCollection = new ServiceCollection();
            ConfigureServices(serviceCollection);
            ServiceProvider = serviceCollection.BuildServiceProvider();

            var mainWindow = ServiceProvider.GetRequiredService<MainWindow>();
            if (IsNativeShell)
                mainWindow.ApplyNativeShellMode();
            if (IsEmbedded)
                mainWindow.ApplyEmbeddedMode();
            if (IsBackendHost)
                mainWindow.ApplyBackendHostMode();
            var openPath = ResolveOpenPath(e.Args);
            if (!string.IsNullOrWhiteSpace(openPath))
                mainWindow.SetPendingOpenPath(openPath);
            var startupAction = ResolveStartupAction(e.Args);
            if (!string.IsNullOrWhiteSpace(startupAction))
                mainWindow.SetPendingStartupAction(startupAction);
            if (IsPluginWindow && !string.IsNullOrWhiteSpace(PluginWindowId))
                mainWindow.SetPendingPluginWindow(PluginWindowId!, PluginStickyId, pluginTitle);
            mainWindow.Show();

            BndzFileManagerIpcService.Instance.RegisterMain(mainWindow);
            BndzFileManagerIpcService.Instance.Start();

            if (IsBackendHost)
            {
                BndzBackendHostIpcService.Instance.RegisterMain(mainWindow);
                BndzBackendHostIpcService.Instance.Start();
            }

            try
            {
                var exe = ResolveAppExecutablePath();
                if (!string.IsNullOrEmpty(exe))
                    BndzNamespaceService.Instance.TryRegisterShellIntegration(exe);
            }
            catch { /* best effort */ }
        }

        /// <summary>
        /// Honor "Allow multiple instances". When disabled, activate the existing process instead.
        /// Stage Workspaces (--stage-window) and plugin pop-outs (--plugin-window) always open a
        /// second process so tear-off / sticky widgets are real.
        /// </summary>
        private static bool TryAcquireSingleInstance(string[] args)
        {
            try
            {
                if (HasArg(args, "--stage-window") || HasArg(args, "--plugin-window") || HasArg(args, "--embedded") || HasArg(args, "--backend-host") || ReadAllowMultipleInstances())
                    return true;

                // Classic and native-shell are separate products for A/B compare ΓÇö different mutexes.
                var name = HasArg(args, "--native-shell")
                    ? @"Local\BNDZ-FileManager-NativeShell-SingleInstance"
                    : @"Local\BNDZ-FileManager-SingleInstance";
                _instanceMutex = new Mutex(true, name, out var createdNew);
                if (createdNew) return true;

                // Activate the running instance (tray/minimized) even when no --open-path was passed.
                // Native-shell uses its own mutex; only classic activates the classic IPC instance.
                if (!HasArg(args, "--native-shell"))
                    BndzFileManagerIpcService.TrySendOpenPathToRunningInstance(ResolveOpenPath(args));
                try
                {
                    Console.WriteLine(HasArg(args, "--native-shell")
                        ? "BNDZ Native Shell is already running."
                        : "BNDZ is already running ΓÇö brought the existing window to the front.");
                }
                catch { }

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

        private static string? ResolveArgValue(string[] args, string flag)
        {
            for (int i = 0; i < args.Length; i++)
            {
                if (string.Equals(args[i], flag, StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                    return args[i + 1];
            }
            return null;
        }

        /// <summary>
        /// Resolve a stable EXE for UAC relaunch ΓÇö never re-elevate via dotnet.exe host.
        /// </summary>
        private static bool TryRelaunchElevated(string[] args)
        {
            var passthrough = string.Join(" ",
                args
                    .Where(a => !string.Equals(a, "--elevated", StringComparison.OrdinalIgnoreCase)
                        && !string.Equals(a, "--enable-always-elevated", StringComparison.OrdinalIgnoreCase)
                        && !string.Equals(a, "--skip-elevation", StringComparison.OrdinalIgnoreCase))
                    .Select(QuoteArg));
            var relaunchArgs = string.IsNullOrWhiteSpace(passthrough)
                ? "--elevated"
                : $"{passthrough} --elevated";

            var exe = ResolveAppExecutablePath();
            if (string.IsNullOrEmpty(exe)) return false;

            Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Arguments = relaunchArgs,
                Verb = "runas",
                UseShellExecute = true,
                WorkingDirectory = AppContext.BaseDirectory,
            });
            return true;
        }

        private static string? ResolveAppExecutablePath()
        {
            var processPath = Environment.ProcessPath;
            if (!string.IsNullOrEmpty(processPath)
                && !processPath.EndsWith("dotnet.exe", StringComparison.OrdinalIgnoreCase))
            {
                return processPath;
            }

            var asmName = Assembly.GetExecutingAssembly().GetName().Name ?? "BNDZ";
            var exeCandidate = Path.Combine(AppContext.BaseDirectory, asmName + ".exe");
            if (File.Exists(exeCandidate)) return exeCandidate;

            return processPath;
        }

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
                if (args[i] == "--open-url" && i + 1 < args.Length)
                {
                    var url = args[++i];
                    var pane = BndzNamespaceService.Instance.ResolveProtocolUrl(url);
                    if (!string.IsNullOrEmpty(pane)) return pane;
                }
            }

            foreach (var arg in args)
            {
                if (string.IsNullOrWhiteSpace(arg) || arg.StartsWith('-')) continue;
                try
                {
                    if (arg.StartsWith("bndz://", StringComparison.OrdinalIgnoreCase)
                        || arg.StartsWith("file://bndz/", StringComparison.OrdinalIgnoreCase))
                    {
                        var pane = BndzNamespaceService.Instance.ResolveProtocolUrl(arg);
                        if (!string.IsNullOrEmpty(pane)) return pane;
                    }
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
            services.AddSingleton<WindowsSearchService>();
            services.AddSingleton<GlobalHotkeyService>();
            
            // UI Windows
            services.AddTransient<MainWindow>();
        }
    }
}
