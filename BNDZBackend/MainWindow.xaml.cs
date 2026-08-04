using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Input;
using System.Threading;
using System.Threading.Tasks;
using System.Text.Json;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Timers;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using BNDZ.Services;
using BNDZ.Services.Mesh;
using BNDZ.Services.MeshDrop;
using BNDZ.Services.GhostLink;
using BNDZ.Services.RamStaging;
using BNDZ.Utilities;
using Microsoft.Web.WebView2.Core;

namespace BNDZ
{
    public partial class MainWindow : Window
    {
        [DllImport("user32.dll")]
        private static extern bool ReleaseCapture();
        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);
        private const int WM_NCLBUTTONDOWN = 0xA1;
        private const int HTCAPTION = 0x2;

        private readonly FileManagementService _fileService;
        private readonly AiAssistantService _aiService;
        private readonly LocalAiService _localAi;
        private readonly ShellIntegrationService _shellIntegrationService;
        private readonly IconStudioService _iconStudioService;
        private readonly FileOperationService _fileOperationService;
        private readonly NativeShellFileOperationService _nativeFileOperationService = new();
        private readonly FileTransferQueueService _fileTransferQueue = new();
        private string? _activeFolderSyncTransferOpId;
        private readonly FolderSyncService _folderSyncService = new();
        private readonly SettingsManager _settingsManager;
        private readonly GlobalHotkeyService _globalHotkeys;
        private readonly NativeShellService _nativeShellService = new();
        private readonly ShellContextMenuService _shellContextMenuService = new();
        private readonly ArchiveService _archiveService = new();
        private readonly TorrentParserService _torrentParserService = new();
        private readonly LinkService _linkService = new();
        private readonly ExternalCopyHandlerService _externalCopyHandler = new();
        private readonly CloudStorageService _cloudStorageService = new();
        private readonly IconLibraryScanner _iconLibraryScanner = new();
        private readonly FolderSizeService _folderSizeService = new();
        private readonly DuplicateFinderService _duplicateFinderService = new();
        private readonly StorageCleanupScanService _storageCleanupScanService = new();
        private readonly NetworkLocationsService _networkLocationsService = new();
        private readonly BndzUpdateService _updateService = new();
        private readonly BndzCatalogStore _catalogStore = new();
        private readonly BndzTagSidecarStore _tagSidecarStore = new();
        private readonly BndzActionLogService _actionLogService = new();
        private readonly BndzMeshOrchestrator _meshOrchestrator = BndzMeshOrchestratorHolder.Instance;
        private readonly MeshTransferService _meshTransferService;
        private readonly MeshDropService _meshDropService;
        private readonly GhostLinkService _ghostLinkService;
        private readonly RamStagingService _ramStagingService;
        private readonly AutomationRunnerDeps _automationRunnerDeps;
        private readonly BndzAutomationWatcherService _automationWatcher;
        private readonly BndzAutomationSchedulerService _automationScheduler;
        private readonly BndzAutomationEventTriggerService _automationEventTriggers;
        private readonly DropMagnetService _dropMagnetService = DropMagnetService.Instance;
        private readonly TemporalDiffService _temporalDiffService = TemporalDiffService.Instance;

        private ConcurrentDictionary<string, FileSystemWatcher> _watchers = new();
        private ConcurrentQueue<object> _fseventBuffer = new();
        private System.Timers.Timer _debounceTimer = null!;

        // Using TaskCompletionSource to wait for frontend conflict resolution
        private ConcurrentDictionary<string, TaskCompletionSource<string>> _conflictResolvers = new();
        // When the user checks "Apply to remaining conflicts", subsequent conflicts within the
        // same operationId resolve immediately with this value instead of re-prompting the UI.
        private ConcurrentDictionary<string, string> _conflictBatchResolution = new();
        // Icon/thumb caches live in BndzHostCaches (BitFaster ConcurrentLru).
        // private ConcurrentDictionary kept removed — use BndzHostCaches.Icons / Thumbnails.

        private CoreWebView2Environment? _webViewEnvironment;
        /// <summary>JS innerWidth / WebView ActualWidth — corrects WPF→clientX drift at 125%+ DPI.</summary>
        private double _webviewJsScaleX = 1.0;
        private double _webviewJsScaleY = 1.0;
        private SystemTrayService? _trayService;
        private bool _allowClose;
        private string? _pendingOpenPath;
        private string? _pendingStartupAction;
        private string? _pendingPluginId;
        private string? _pendingStickyId;
        private string? _pendingPluginTitle;

        public MainWindow(FileManagementService fileService, AiAssistantService aiService, LocalAiService localAi, ShellIntegrationService shellIntegrationService)
        {
            InitializeComponent();
            // AllowExternalDrop=true: WebView2's own OLE target will be replaced by BNDZ's
            // native IDropTarget via RegisterWebView2OleDropTarget() after CoreWebView2 init.
            MainWebView.AllowExternalDrop = true;
            _fileService = fileService;
            _aiService = aiService;
            _localAi = localAi;
            _shellIntegrationService = shellIntegrationService;
            _iconStudioService = new IconStudioService();
            _fileOperationService = new FileOperationService();
            _fileOperationService.SetActionLog(_actionLogService);
            _meshTransferService = new MeshTransferService(_meshOrchestrator, _fileTransferQueue);
            _meshDropService = new MeshDropService(_fileTransferQueue);
            _ghostLinkService = new GhostLinkService(_linkService, _fileTransferQueue);
            _ghostLinkService.SetActionLog(_actionLogService);
            _ghostLinkService.StartIdleScanner();
            _ramStagingService = new RamStagingService(_fileTransferQueue);
            _automationRunnerDeps = new AutomationRunnerDeps
            {
                GhostLink = _ghostLinkService,
                RamStaging = _ramStagingService,
                TagStore = _tagSidecarStore,
                ArchiveService = _archiveService,
                ShellContext = _shellContextMenuService,
                HealthService = LibraryHealthService.Instance,
                SandboxService = ProjectSandboxService.Instance,
                BranchingService = BranchingTimeService.Instance,
                HostWindow = new System.Windows.Interop.WindowInteropHelper(this).Handle,
            };
            _automationWatcher = new BndzAutomationWatcherService(_automationRunnerDeps);
            _automationScheduler = new BndzAutomationSchedulerService(_automationRunnerDeps);
            _automationEventTriggers = new BndzAutomationEventTriggerService(_automationRunnerDeps);
            _ = Task.Run(() => _automationWatcher.RestorePersistedWatchers());
            _meshDropService.SetSessionChangedHandler(evt =>
            {
                PostToUi(() =>
                {
                    try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(evt)); }
                    catch { }
                });
            });
            _ghostLinkService.SetProgressHandler(evt =>
            {
                PostToUi(() =>
                {
                    try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(evt)); }
                    catch { }
                });
            });
            _ramStagingService.SetZoneChangedHandler(evt =>
            {
                PostToUi(() =>
                {
                    try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(evt)); }
                    catch { }
                });
            });
            _settingsManager = new SettingsManager();
            _globalHotkeys = new GlobalHotkeyService();
            _globalHotkeys.HotkeyPressed += OnGlobalHotkeyPressed;
            try
            {
                var bootSettings = _settingsManager.LoadSettings();
                bootSettings = SanitizeThumbnailSettingsJson(bootSettings);
                FileOperationPreferences.ApplyFromJson(bootSettings);
                ApplyFileOperationPreferences();
                ApplyGlobalHotkeysFromSettingsJson(bootSettings);
                BndzMediaDiskCache.Instance.ApplySettingsJson(bootSettings);
                _actionLogService.LoadPersistedIfEnabled();
                _fileTransferQueue.LoadPersistedHistory();
            }
            catch { /* use defaults */ }
            _fileTransferQueue.QueueChanged += () =>
            {
                PostFileTransferQueueChanged();
            };
            _folderSyncService.SetProgressCallback(p =>
            {
                if (!string.IsNullOrEmpty(_activeFolderSyncTransferOpId))
                {
                    _fileTransferQueue.UpdateProgress(
                        _activeFolderSyncTransferOpId,
                        p.Percent,
                        p.CurrentFile,
                        Math.Max(p.Percent, 0),
                        100);
                }
                var evt = new { type = "FOLDER_SYNC_PROGRESS", payload = p };
                PostToUi(() =>
                {
                    try { MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt)); }
                    catch { }
                });
            });
            _meshOrchestrator.Sync.SetProgressCallback(p =>
            {
                var evt = new { type = "MESH_SYNC_PROGRESS", payload = p };
                PostToUi(() =>
                {
                    try { MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt)); }
                    catch { }
                });
            });
            _meshOrchestrator.Terminal.OnOutput += (sessionId, data) =>
            {
                var evt = new { type = "MESH_TERMINAL_OUTPUT", payload = new { sessionId, data } };
                PostToUi(() =>
                {
                    try { MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt)); }
                    catch { }
                });
            };
            BndzFileIndexService.Instance.ProgressCallback = p =>
            {
                var evt = new
                {
                    type = "INDEX_PROGRESS",
                    payload = new
                    {
                        currentPath = p.CurrentPath,
                        filesIndexed = p.FilesIndexed,
                        done = p.Done,
                        root = p.Root,
                        error = p.Error,
                    },
                };
                PostToUi(() =>
                {
                    try { MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt)); }
                    catch { }
                });
                if (p.Done && string.IsNullOrEmpty(p.Error))
                {
                    _ = Task.Run(() =>
                    {
                        try { _automationEventTriggers.FireIndexChanged(p.Root ?? p.CurrentPath); }
                        catch { /* best effort */ }
                    });
                }
            };
            AppIconService.ApplyToWindow(this);
            if (!App.IsPluginWindow)
            {
                _trayService = new SystemTrayService(this);
                _trayService.QuitRequested += () => Dispatcher.Invoke(() => RequestCloseFromUI("tray"));
                _trayService.EnsureVisible();
            }
            Closing += OnMainWindowClosing;
            StateChanged += (_, _) => PostWindowStateChanged();
            SourceInitialized += (_, _) => ApplyStartupWindowPlacement();
            
            SetupDebouncedWatcher();
            InitializeWebViewAsync();
            // Pre-warm the license cache so the first IPC message doesn't block on a cold license check.
            _ = Task.Run(() => { try { LicenseService.GetStatusCached(); } catch { } });
        }

        private void ApplyStartupWindowPlacement()
        {
            try
            {
                if (App.IsPluginWindow)
                {
                    ApplyPluginWindowPlacement();
                    return;
                }

                var json = _settingsManager.LoadSettings();
                if (string.IsNullOrWhiteSpace(json)) return;
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                var state = root.TryGetProperty("startupWindowState", out var sw)
                    ? (sw.GetString() ?? "Normal")
                    : "Normal";
                if (string.Equals(state, "false", StringComparison.OrdinalIgnoreCase) || string.IsNullOrWhiteSpace(state))
                    state = "Normal";

                if (root.TryGetProperty("windowPlacement", out var place) && place.ValueKind == JsonValueKind.Object)
                {
                    var left = place.TryGetProperty("left", out var l) ? l.GetDouble() : double.NaN;
                    var top = place.TryGetProperty("top", out var t) ? t.GetDouble() : double.NaN;
                    var width = place.TryGetProperty("width", out var w) ? w.GetDouble() : double.NaN;
                    var height = place.TryGetProperty("height", out var h) ? h.GetDouble() : double.NaN;
                    var maximized = place.TryGetProperty("maximized", out var m) && m.ValueKind == JsonValueKind.True;

                    if (!double.IsNaN(width) && width >= MinWidth) Width = width;
                    if (!double.IsNaN(height) && height >= MinHeight) Height = height;
                    if (!double.IsNaN(left) && !double.IsNaN(top))
                    {
                        // Keep on-screen if possible
                        Left = left;
                        Top = top;
                        WindowStartupLocation = WindowStartupLocation.Manual;
                    }

                    if (maximized && string.Equals(state, "Normal", StringComparison.OrdinalIgnoreCase))
                        state = "Maximized";
                }

                switch (state)
                {
                    case "Maximized":
                        WindowState = WindowState.Maximized;
                        break;
                    case "Minimized":
                        WindowState = WindowState.Minimized;
                        break;
                    case "Fullscreen":
                        WindowState = WindowState.Maximized;
                        WindowStyle = WindowStyle.None;
                        break;
                    default:
                        WindowState = WindowState.Normal;
                        break;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Window] ApplyStartupWindowPlacement: {ex.Message}");
            }
        }

        private void ApplyPluginWindowPlacement()
        {
            var stickyMode = !string.IsNullOrWhiteSpace(_pendingStickyId)
                || string.Equals(_pendingPluginId, "sticky-note", StringComparison.OrdinalIgnoreCase);
            WindowStartupLocation = WindowStartupLocation.CenterScreen;
            WindowState = WindowState.Normal;
            Width = stickyMode ? 380 : 820;
            Height = stickyMode ? 440 : 580;
            MinWidth = stickyMode ? 280 : 480;
            MinHeight = stickyMode ? 240 : 360;
            var label = !string.IsNullOrWhiteSpace(_pendingPluginTitle)
                ? _pendingPluginTitle
                : stickyMode
                    ? "Sticky"
                    : (!string.IsNullOrWhiteSpace(_pendingPluginId) ? _pendingPluginId : "Plugin");
            Title = $"BNDZ · {label}";
            // Sticky widgets behave like desktop notes — stay above other windows.
            Topmost = stickyMode;
        }

        private void PersistWindowPlacementIntoSettings()
        {
            if (App.IsPluginWindow) return;
            try
            {
                var json = _settingsManager.LoadSettings() ?? "{}";
                using var doc = JsonDocument.Parse(json);
                using var stream = new MemoryStream();
                using (var writer = new Utf8JsonWriter(stream))
                {
                    writer.WriteStartObject();
                    foreach (var p in doc.RootElement.EnumerateObject())
                    {
                        if (p.NameEquals("windowPlacement")) continue;
                        p.WriteTo(writer);
                    }

                    var bounds = WindowState == WindowState.Normal
                        ? new Rect(Left, Top, Width, Height)
                        : RestoreBounds;

                    writer.WritePropertyName("windowPlacement");
                    writer.WriteStartObject();
                    writer.WriteNumber("left", bounds.Left);
                    writer.WriteNumber("top", bounds.Top);
                    writer.WriteNumber("width", Math.Max(bounds.Width, MinWidth));
                    writer.WriteNumber("height", Math.Max(bounds.Height, MinHeight));
                    writer.WriteBoolean("maximized", WindowState == WindowState.Maximized);
                    writer.WriteEndObject();
                    writer.WriteEndObject();
                }
                _settingsManager.SaveSettings(Encoding.UTF8.GetString(stream.ToArray()));
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[Window] PersistWindowPlacement: {ex.Message}");
            }
        }

        private void OnMainWindowClosing(object? sender, CancelEventArgs e)
        {
            if (_allowClose || App.IsPluginWindow)
            {
                if (App.IsPluginWindow) _allowClose = true;
                return;
            }
            e.Cancel = true;
            RequestCloseFromUI("x");
        }

        public void RequestCloseFromUI(string source = "x")
        {
            try
            {
                if (!IsVisible || WindowState == WindowState.Minimized)
                {
                    ShowInTaskbar = true;
                    Show();
                    WindowState = WindowState.Normal;
                    Activate();
                }
                if (MainWebView?.CoreWebView2 == null) return;
                MainWebView.CoreWebView2.PostWebMessageAsJson(
                    JsonSerializer.Serialize(new { type = "CLOSE_REQUEST", payload = new { source } }));
            }
            catch { }
        }

        public void SetPendingOpenPath(string path) => _pendingOpenPath = path;

        public void SetPendingStartupAction(string action) => _pendingStartupAction = action;

        public void SetPendingPluginWindow(string pluginId, string? stickyId, string? title)
        {
            _pendingPluginId = pluginId;
            _pendingStickyId = stickyId;
            _pendingPluginTitle = title;
        }

        private void PostToUi(Action action) => UiThread.Marshal(Dispatcher, action);

        private static readonly JsonSerializerOptions MeshJsonOpts = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

        private void PostMeshIpcResult(string? id, string resultType, object payload)
        {
            var response = new { type = resultType, id, payload };
            PostToUi(() =>
            {
                try { MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, MeshJsonOpts)); }
                catch { }
            });
        }

        private void BroadcastMeshHostsChanged()
        {
            var evt = new { type = "MESH_HOSTS_CHANGED", payload = _meshOrchestrator.ListHosts() };
            PostToUi(() =>
            {
                try { MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt, MeshJsonOpts)); }
                catch { }
            });
        }

        private Task PostToUiAsync(Action action) => UiThread.MarshalAsync(Dispatcher, action);

        public void OpenPathInManager(string path)
        {
            try
            {
                ShowAndActivate();
                if (MainWebView?.CoreWebView2 == null)
                {
                    _pendingOpenPath = path;
                    return;
                }
                MainWebView.CoreWebView2.PostWebMessageAsJson(
                    JsonSerializer.Serialize(new { type = "BNDZ_OPEN_PATH", payload = new { path } }));
            }
            catch { }
        }

        public void ShowAndActivate()
        {
            try
            {
                ShowInTaskbar = true;
                Show();
                WindowState = WindowState.Normal;
                Activate();
            }
            catch { }
        }

        private void FlushPendingStartupAction()
        {
            if (string.IsNullOrWhiteSpace(_pendingStartupAction)) return;
            var action = _pendingStartupAction;
            _pendingStartupAction = null;
            try
            {
                MainWebView.CoreWebView2?.PostWebMessageAsJson(
                    JsonSerializer.Serialize(new { type = "BNDZ_STARTUP_ACTION", payload = action }));
            }
            catch { }
        }

        private void FlushPendingOpenPath()
        {
            if (string.IsNullOrWhiteSpace(_pendingOpenPath)) return;
            var path = _pendingOpenPath;
            _pendingOpenPath = null;
            OpenPathInManager(path);
        }

        private void FlushPendingPluginWindow()
        {
            if (string.IsNullOrWhiteSpace(_pendingPluginId) && !App.IsPluginWindow) return;
            var pluginId = _pendingPluginId ?? App.PluginWindowId;
            if (string.IsNullOrWhiteSpace(pluginId)) return;
            try
            {
                MainWebView.CoreWebView2?.PostWebMessageAsJson(
                    JsonSerializer.Serialize(new
                    {
                        type = "BNDZ_PLUGIN_WINDOW",
                        payload = new
                        {
                            pluginId,
                            stickyId = _pendingStickyId ?? App.PluginStickyId,
                            title = _pendingPluginTitle,
                        },
                    }));
            }
            catch { }
        }

        protected override void OnClosed(EventArgs e)
        {
            try
            {
                var prefs = FileOperationPreferences.Current;
                if (prefs.RememberActionLogBetweenSessions || prefs.PersistActionLogOnExit)
                    _actionLogService.PersistNow(force: true);
            }
            catch { /* best effort */ }
            BndzFileManagerIpcService.Instance.Dispose();
            _automationWatcher.Dispose();
            _automationScheduler.Dispose();
            try { _ramStagingService?.Dispose(); } catch { /* best effort flush */ }
            _trayService?.Dispose();
            base.OnClosed(e);
        }

        private void PostWindowStateChanged()
        {
            try
            {
                if (MainWebView?.CoreWebView2 == null) return;
                var payload = new { type = "WINDOW_STATE_CHANGED", payload = new { maximized = WindowState == WindowState.Maximized } };
                MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(payload));
            }
            catch { }
        }

        private void BeginWindowDrag()
        {
            var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
            ReleaseCapture();
            SendMessage(hwnd, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
        }

        protected override void OnSourceInitialized(EventArgs e)
        {
            base.OnSourceInitialized(e);
            AppIconService.ApplyToWindow(this);
            var source = System.Windows.Interop.HwndSource.FromHwnd(new System.Windows.Interop.WindowInteropHelper(this).Handle);
            source?.AddHook(WndProc);
        }

        private IntPtr WndProc(IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled)
        {
            const int WM_DEVICECHANGE = 0x0219;
            if (msg == WM_DEVICECHANGE)
            {
                PushDrivesUpdate();
            }
            return IntPtr.Zero;
        }

        private static string NormalizeFsPath(string path)
        {
            if (string.IsNullOrEmpty(path)) return "";
            if (path.StartsWith("::{")) return path;
            if (path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase)) return path;
            if (path.StartsWith("/")) path = path.Substring(1);
            path = path.Replace("/", "\\");
            while (path.Contains("\\\\")) path = path.Replace("\\\\", "\\");
            if (path.StartsWith("\\") && path.Length >= 3 && char.IsLetter(path[1]) && path[2] == ':')
                path = path.TrimStart('\\');
            if (path.EndsWith(":") && path.Length == 2) path += "\\";
            return path;
        }

        private static string ExpandShellTemplate(string template, string workingDir, string itemPath, string command)
        {
            if (string.IsNullOrEmpty(template)) return template ?? "";
            return template
                .Replace("%WD%", workingDir ?? "", StringComparison.OrdinalIgnoreCase)
                .Replace("%PATH%", itemPath ?? "", StringComparison.OrdinalIgnoreCase)
                .Replace("%CMD%", command ?? "", StringComparison.OrdinalIgnoreCase);
        }

        private static void StartShellProcess(string workingDir, string? command, JsonElement? shellElement)
        {
            string fileName = "cmd.exe";
            string arguments = string.IsNullOrWhiteSpace(command) ? "" : "/c " + command;
            var windowStyle = string.IsNullOrWhiteSpace(command)
                ? ProcessWindowStyle.Normal
                : ProcessWindowStyle.Hidden;

            if (shellElement is JsonElement shell && shell.ValueKind == JsonValueKind.Object
                && shell.TryGetProperty("useCustom", out var useCustom) && useCustom.GetBoolean()
                && shell.TryGetProperty("interpreter", out var interpEl))
            {
                var interpreter = interpEl.GetString() ?? "";
                if (!string.IsNullOrWhiteSpace(interpreter))
                {
                    fileName = interpreter;
                    var argsTemplate = shell.TryGetProperty("args", out var argsEl) ? argsEl.GetString() ?? "" : "";
                    if (!string.IsNullOrWhiteSpace(argsTemplate))
                    {
                        arguments = ExpandShellTemplate(argsTemplate, workingDir, workingDir, command ?? "");
                    }
                    else if (!string.IsNullOrWhiteSpace(command))
                    {
                        arguments = "/c " + command;
                    }
                }
            }

            var psi = new ProcessStartInfo
            {
                FileName = fileName,
                UseShellExecute = true,
                WindowStyle = windowStyle,
            };
            if (!string.IsNullOrWhiteSpace(arguments)) psi.Arguments = arguments;
            if (!string.IsNullOrEmpty(workingDir) && Directory.Exists(workingDir))
                psi.WorkingDirectory = workingDir;
            Process.Start(psi);
        }

        /// <summary>Ask the AI service to propose new names for a batch of files, returning
        /// {originalName, newName, reason} operations. Returns an empty list if AI is
        /// unavailable or the response cannot be parsed.</summary>
        private async Task<List<object>> GenerateBatchRenameAsync(List<string> filenames, string instructions)
        {
            var results = new List<object>();
            if (filenames.Count == 0) return results;

            var sb = new StringBuilder();
            sb.AppendLine("You are a file renaming assistant. Given a list of filenames and instructions, propose a new name for each file.");
            sb.AppendLine("Respond with ONLY a JSON array (no markdown fences) of objects with keys: originalName, newName, reason.");
            sb.AppendLine("Keep file extensions unless the instructions say otherwise. Do not include paths, only file names.");
            sb.AppendLine();
            sb.AppendLine("Instructions: " + (string.IsNullOrWhiteSpace(instructions) ? "Clean up and standardize the names." : instructions));
            sb.AppendLine();
            sb.AppendLine("Filenames:");
            foreach (var name in filenames) sb.AppendLine("- " + name);

            var raw = await _aiService.GenerateResponseAsync(sb.ToString());
            if (!string.IsNullOrWhiteSpace(raw))
            {
                var json = ExtractJsonArray(raw);
                if (json != null)
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(json);
                        if (doc.RootElement.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var el in doc.RootElement.EnumerateArray())
                            {
                                var originalName = el.TryGetProperty("originalName", out var o) ? o.GetString() ?? "" : "";
                                var newName = el.TryGetProperty("newName", out var n) ? n.GetString() ?? "" : "";
                                var reason = el.TryGetProperty("reason", out var r) ? r.GetString() ?? "" : "";
                                if (originalName.Length == 0 || newName.Length == 0) continue;
                                results.Add(new { originalName, newName, reason });
                            }
                            if (results.Count > 0) return results;
                        }
                    }
                    catch { /* fall through to rules */ }
                }
            }

            return AiRulesEngine.BatchRename(filenames, instructions);
        }

        /// <summary>Extract the first JSON array from a model response, tolerating ```json fences.</summary>
        private static string? ExtractJsonArray(string text)
        {
            var start = text.IndexOf('[');
            var end = text.LastIndexOf(']');
            if (start < 0 || end <= start) return null;
            return text.Substring(start, end - start + 1);
        }

        private DateTime _lastExternalDropUtc = DateTime.MinValue;
        private string? _lastExternalDropFingerprint;
        private double? _lastExternalDragWebViewX;
        private double? _lastExternalDragWebViewY;
        /// <summary>Environment.TickCount64 at the last PostExternalFileDragHover call — throttle guard.</summary>
        private long _lastHoverTickMs;

        // AllowExternalDrop stays true so WebView2 does not install a blocking target
        // before we call RegisterDragDrop on its HWND (see SetupNativeFileDrop /
        // RegisterWebView2OleDropTarget).  The WPF Preview* handlers below remain
        // as a fallback for drops over non-WebView2 areas (sidebar, toolbar, tabs).
        private void SyncAllowExternalDrop()
        {
            try { MainWebView.AllowExternalDrop = true; }
            catch (Exception ex) { Debug.WriteLine($"[Drop] AllowExternalDrop: {ex.Message}"); }
        }

        private void PostNavigationFileDrop(string localPath)
        {
            if (string.IsNullOrWhiteSpace(localPath)) return;
            var fallbackX = MainWebView.ActualWidth > 0 ? MainWebView.ActualWidth / 2 : 400;
            var fallbackY = MainWebView.ActualHeight > 0 ? MainWebView.ActualHeight / 2 : 300;
            var pt = ResolveDropCoords(new System.Windows.Point(
                _lastExternalDragWebViewX ?? fallbackX,
                _lastExternalDragWebViewY ?? fallbackY));
            PostExternalFileDrop(new[] { localPath }, pt.X, pt.Y, "copy", "navigation");
        }

        private bool IsValidWebViewCoord(double x, double y)
        {
            if (MainWebView.ActualWidth <= 0 || MainWebView.ActualHeight <= 0) return false;
            return x >= 0 && y >= 0 && x <= MainWebView.ActualWidth && y <= MainWebView.ActualHeight;
        }

        private System.Windows.Point ResolveDropCoords(System.Windows.Point dropPt)
        {
            if (IsValidWebViewCoord(dropPt.X, dropPt.Y))
                return dropPt;
            if (_lastExternalDragWebViewX is double lx && _lastExternalDragWebViewY is double ly
                && IsValidWebViewCoord(lx, ly))
                return new System.Windows.Point(lx, ly);
            return dropPt;
        }

        private string ResolveCoordSource(System.Windows.Point dropPt, System.Windows.Point resolved)
        {
            if (IsValidWebViewCoord(dropPt.X, dropPt.Y)) return "drop";
            if (resolved.X == dropPt.X && resolved.Y == dropPt.Y) return "fallback";
            return "lastHover";
        }

        private System.Windows.Point MapDropPointToWebView(System.Windows.DragEventArgs e)
        {
            var pt = e.GetPosition(MainWebView);
            if (MainWebView.ActualWidth > 0 && MainWebView.ActualHeight > 0
                && pt.X >= 0 && pt.Y >= 0
                && pt.X <= MainWebView.ActualWidth && pt.Y <= MainWebView.ActualHeight)
            {
                return pt;
            }
            try
            {
                var windowPt = e.GetPosition(this);
                var origin = MainWebView.TransformToAncestor(this).Transform(new System.Windows.Point(0, 0));
                return new System.Windows.Point(windowPt.X - origin.X, windowPt.Y - origin.Y);
            }
            catch
            {
                return pt;
            }
        }

        /// <summary>Map WPF drop coords to WebView2 JS clientX/clientY (ZoomFactor + viewport scale).</summary>
        private System.Windows.Point MapDropPointToWebViewClient(System.Windows.DragEventArgs e)
        {
            var pt = MapDropPointToWebView(e);
            try
            {
                var zoom = MainWebView.ZoomFactor;
                if (zoom > 0.01 && Math.Abs(zoom - 1.0) > 0.001)
                    pt = new System.Windows.Point(pt.X / zoom, pt.Y / zoom);
            }
            catch { /* best-effort */ }

            if (Math.Abs(_webviewJsScaleX - 1.0) > 0.02 || Math.Abs(_webviewJsScaleY - 1.0) > 0.02)
            {
                pt = new System.Windows.Point(
                    pt.X * _webviewJsScaleX,
                    pt.Y * _webviewJsScaleY);
            }
            return pt;
        }

        private void UpdateWebViewJsViewportScale(double innerWidth, double innerHeight)
        {
            var aw = MainWebView.ActualWidth;
            var ah = MainWebView.ActualHeight;
            if (aw > 1 && ah > 1 && innerWidth > 1 && innerHeight > 1)
            {
                _webviewJsScaleX = innerWidth / aw;
                _webviewJsScaleY = innerHeight / ah;
                Debug.WriteLine($"[Drop] Viewport scale X={_webviewJsScaleX:F3} Y={_webviewJsScaleY:F3} (js {innerWidth}x{innerHeight}, wv {aw}x{ah})");
            }
        }
        /// <summary>True while BNDZ-initiated DoDragDrop is running (OLE re-entry into our window).</summary>
        private bool _bndzOleDragActive;

        /// <summary>
        /// Attach a shell drag image via IDragSourceHelper::InitializeFromWindow (Explorer-class ghost).
        /// </summary>
        private void AttachShellDragImage(System.Windows.DataObject dataObject, string[] paths)
        {
            if (dataObject == null || paths == null || paths.Length == 0) return;
            try
            {
                var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                if (hwnd == IntPtr.Zero) return;

                var clsid = Type.GetTypeFromCLSID(new Guid("DE5BF786-477A-11D2-839D-00C04FD918D0"));
                if (clsid == null) return;
                var helperObj = Activator.CreateInstance(clsid);
                if (helperObj is not Vanara.PInvoke.Shell32.IDragSourceHelper helper) return;

                var oleUnk = System.Runtime.InteropServices.Marshal.GetIUnknownForObject(dataObject);
                try
                {
                    var comData = (System.Runtime.InteropServices.ComTypes.IDataObject)
                        System.Runtime.InteropServices.Marshal.GetObjectForIUnknown(oleUnk);
                    helper.InitializeFromWindow(new Vanara.PInvoke.HWND(hwnd), IntPtr.Zero, comData);
                }
                finally
                {
                    System.Runtime.InteropServices.Marshal.Release(oleUnk);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[START_DRAG] IDragSourceHelper: {ex.Message}");
            }
        }

        private void PostExternalFileDragHover(double webViewX, double webViewY)
        {
            // Throttle: at most one hover message per ~16 ms (~60 fps). Without this guard,
            // rapid DragOver floods the JS side with hundreds of messages per second.
            var now = Environment.TickCount64;
            if (now - _lastHoverTickMs < 16) return;
            _lastHoverTickMs = now;

            var msg = new
            {
                type = "EXTERNAL_FILES_DRAG_HOVER",
                payload = new { webViewX, webViewY },
            };
            var json = JsonSerializer.Serialize(msg, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(json));
        }

        private void PostExternalFileDropFailed(string[] formats, string reason)
        {
            var msg = new
            {
                type = "EXTERNAL_FILES_DROP_FAILED",
                payload = new { formats, reason },
            };
            var json = JsonSerializer.Serialize(msg, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(json));
            Debug.WriteLine($"[Drop] Failed: {reason} formats=[{string.Join(", ", formats)}]");
        }

        private void PostExternalFileDrop(string[] paths, double? webViewX = null, double? webViewY = null, string preferredEffect = "copy", string coordSource = "drop")
        {
            if (paths == null || paths.Length == 0) return;
            var fingerprint = string.Join('|', paths);
            var now = DateTime.UtcNow;
            if (fingerprint == _lastExternalDropFingerprint && (now - _lastExternalDropUtc).TotalMilliseconds < 400)
                return;
            _lastExternalDropFingerprint = fingerprint;
            _lastExternalDropUtc = now;

            var effect = string.Equals(preferredEffect, "move", StringComparison.OrdinalIgnoreCase) ? "move" : "copy";
            var msg = new
            {
                type = "EXTERNAL_FILES_DROPPED",
                payload = new
                {
                    paths,
                    webViewX,
                    webViewY,
                    preferredEffect = effect,
                    fromBndzOle = _bndzOleDragActive,
                    coordSource,
                },
            };
            var json = JsonSerializer.Serialize(msg, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(json));
        }

        private void SetupNativeFileDrop()
        {
            AllowDrop = true;
            MainWebView.AllowDrop = true;

            // ── WPF fallback: handles drops over non-WebView2 areas (sidebar, tabs, toolbar).
            // The native OLE path below owns drops over the WebView2 HWND; these handlers
            // are the safety net for anything outside it (and for the rare case where
            // RegisterDragDrop on the Chrome HWND could not be completed).

            string ResolvePreferredDropEffect(System.Windows.DragEventArgs e)
            {
                if ((e.KeyStates & System.Windows.DragDropKeyStates.ControlKey) != 0)
                    return "copy";
                if ((e.KeyStates & System.Windows.DragDropKeyStates.ShiftKey) != 0
                    && (e.AllowedEffects & System.Windows.DragDropEffects.Move) != 0)
                    return "move";
                if (_bndzOleDragActive && (e.AllowedEffects & System.Windows.DragDropEffects.Move) != 0)
                    return "move";
                return "copy";
            }

            void AcceptFileDrag(System.Windows.DragEventArgs e)
            {
                if (!ExternalDropHelper.IsLikelyExternalFileDrag(e.Data))
                {
                    e.Effects = System.Windows.DragDropEffects.None;
                    e.Handled = true;
                    return;
                }
                var preferred = ResolvePreferredDropEffect(e);
                var want = preferred == "move"
                    ? System.Windows.DragDropEffects.Move
                    : System.Windows.DragDropEffects.Copy;
                var allowed = e.AllowedEffects & want;
                if (allowed == System.Windows.DragDropEffects.None)
                    allowed = e.AllowedEffects & (System.Windows.DragDropEffects.Copy | System.Windows.DragDropEffects.Move | System.Windows.DragDropEffects.Link);
                e.Effects = allowed == System.Windows.DragDropEffects.None
                    ? System.Windows.DragDropEffects.Copy
                    : allowed;
                e.Handled = true;
                var pt = MapDropPointToWebViewClient(e);
                _lastExternalDragWebViewX = pt.X;
                _lastExternalDragWebViewY = pt.Y;
                PostExternalFileDragHover(pt.X, pt.Y);
            }

            void OnWpfDrop(object sender, System.Windows.DragEventArgs e)
            {
                try
                {
                    var files = ExternalDropHelper.ExtractPaths(e.Data);
                    if (files.Length > 0)
                    {
                        var preferred = ResolvePreferredDropEffect(e);
                        var rawPt = MapDropPointToWebView(e);
                        var pt = ResolveDropCoords(MapDropPointToWebViewClient(e));
                        var coordSource = ResolveCoordSource(rawPt, pt);
                        PostExternalFileDrop(files, pt.X, pt.Y, preferred, coordSource);
                        e.Handled = true;
                    }
                    else
                    {
                        var formats = ExternalDropHelper.GetAvailableFormats(e.Data);
                        PostExternalFileDropFailed(formats, "No extractable paths in drop payload (WPF path).");
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Drop/WPF] {ex.Message}");
                    PostExternalFileDropFailed(Array.Empty<string>(), ex.Message);
                }
            }

            AddHandler(System.Windows.DragDrop.PreviewDragEnterEvent, new System.Windows.DragEventHandler((_, e) => AcceptFileDrag(e)), true);
            AddHandler(System.Windows.DragDrop.PreviewDragOverEvent,  new System.Windows.DragEventHandler((_, e) => AcceptFileDrag(e)), true);
            AddHandler(System.Windows.DragDrop.PreviewDropEvent,       new System.Windows.DragEventHandler(OnWpfDrop), true);

            // ── Native OLE path: register our IDropTarget on the WebView2 child HWND.
            // Must run after CoreWebView2 is initialized (HWND exists).
            RegisterWebView2OleDropTarget();

            // Re-register after navigation that might recreate the HWND, and eagerly on idle.
            MainWebView.CoreWebView2.NavigationCompleted += (_, __) => SyncAllowExternalDrop();
            _ = Dispatcher.BeginInvoke(new Action(RegisterWebView2OleDropTarget),
                System.Windows.Threading.DispatcherPriority.ApplicationIdle);
        }

        /// <summary>
        /// (Re)register BNDZ's native OLE <c>IDropTarget</c> on the WebView2 child HWND.
        /// Safe to call multiple times — revokes any previous registration first.
        /// Must be called on the UI thread after CoreWebView2 is initialized.
        /// </summary>
        private void RegisterWebView2OleDropTarget()
        {
            var windowHwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
            if (windowHwnd == IntPtr.Zero) return;

            // Screen-coords → WebView2-client-coords (handles DPI + ZoomFactor + JS scale).
            System.Windows.Point OleScreenToWebViewClient(double screenX, double screenY)
            {
                var wvPt = MainWebView.PointFromScreen(new System.Windows.Point(screenX, screenY));
                try
                {
                    var zoom = MainWebView.ZoomFactor;
                    if (zoom > 0.01 && Math.Abs(zoom - 1.0) > 0.001)
                        wvPt = new System.Windows.Point(wvPt.X / zoom, wvPt.Y / zoom);
                }
                catch { /* best-effort */ }
                if (Math.Abs(_webviewJsScaleX - 1.0) > 0.02 || Math.Abs(_webviewJsScaleY - 1.0) > 0.02)
                    wvPt = new System.Windows.Point(wvPt.X * _webviewJsScaleX, wvPt.Y * _webviewJsScaleY);
                return wvPt;
            }

            // onHover: throttled, dispatched to UI thread (already on UI thread via STA OLE).
            void OleHover(double screenX, double screenY)
            {
                var now = Environment.TickCount64;
                if (now - _lastHoverTickMs < 16) return;
                _lastHoverTickMs = now;

                var pt = OleScreenToWebViewClient(screenX, screenY);
                _lastExternalDragWebViewX = pt.X;
                _lastExternalDragWebViewY = pt.Y;
                PostExternalFileDragHover(pt.X, pt.Y);
            }

            // onDrop: convert coords, apply dedup guard, post EXTERNAL_FILES_DROPPED.
            void OleDrop(string[] paths, double screenX, double screenY, uint grfEffect, bool fromBndzOle)
            {
                var pt = OleScreenToWebViewClient(screenX, screenY);
                var resolved = ResolveDropCoords(pt);
                var effect = grfEffect == 2u ? "move" : "copy"; // DROPEFFECT_MOVE=2
                PostExternalFileDrop(paths, resolved.X, resolved.Y, effect, "ole");
            }

            WebView2DropTargetService.Register(
                windowHwnd,
                OleDrop,
                OleHover,
                () => _bndzOleDragActive);
        }

        private void PostIconResult(string? id, string? payload)
        {
            var response = new { type = "SHELL_ICON_RESULT", id, payload };
            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            string responseJson = JsonSerializer.Serialize(response, jsonOptions);
            PostToUi(() => {
                try {
                    MainWebView.CoreWebView2?.PostWebMessageAsJson(responseJson);
                } catch { }
            });
        }

        private void PostThumbnailResult(string? id, string? payload)
        {
            var response = new { type = "THUMBNAIL_RESULT", id, payload };
            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            string responseJson = JsonSerializer.Serialize(response, jsonOptions);
            PostToUi(() =>
            {
                try { MainWebView.CoreWebView2?.PostWebMessageAsJson(responseJson); }
                catch { }
            });
        }

        private void PostExtendedMetadataResult(string? id, object? payload)
        {
            var response = new { type = "EXTENDED_METADATA_RESULT", id, payload };
            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            string responseJson = JsonSerializer.Serialize(response, jsonOptions);
            PostToUi(() =>
            {
                try { MainWebView.CoreWebView2?.PostWebMessageAsJson(responseJson); }
                catch { }
            });
        }

        private void PostExtendedMetadataBatchResult(string? id, object? payload)
        {
            var response = new { type = "EXTENDED_METADATA_BATCH_RESULT", id, payload };
            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            string responseJson = JsonSerializer.Serialize(response, jsonOptions);
            PostToUi(() =>
            {
                try { MainWebView.CoreWebView2?.PostWebMessageAsJson(responseJson); }
                catch { }
            });
        }

        private static object DirEntryToLegacy(DirListingSharedBuffer.DirEntryDto e) => new
        {
            id = e.Id,
            name = e.Name,
            type = e.Type,
            path = e.Path,
            size = e.Size,
            extension = e.Extension,
            modified = e.ModifiedUtc.ToString("O"),
            created = e.CreatedUtc.ToString("O"),
            attributes = DirListingSharedBuffer.AttrNamesFrom(e.AttrBits),
            label = e.Label,
            comment = e.Comment,
            tags = e.Tags,
            isShellItem = e.IsShellItem,
        };

        private void PostDirContentsJson(string? id, List<DirListingSharedBuffer.DirEntryDto> entries)
        {
            var legacy = entries.Select(DirEntryToLegacy).ToList();
            var response = new { type = "DIR_CONTENTS_RESULT", id, payload = legacy };
            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
        }

        private void PostDirContentsError(string? id, string path, string error)
        {
            var response = new
            {
                type = "DIR_CONTENTS_RESULT",
                id,
                payload = new { error, path = path.Replace('\\', '/'), items = Array.Empty<object>() },
            };
            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
        }

        private void PostDirContentsJsonAppend(string? id, string folderPath, List<DirListingSharedBuffer.DirEntryDto> entries)
        {
            var legacy = entries.Select(DirEntryToLegacy).ToList();
            var response = new
            {
                type = "DIR_CONTENTS_APPEND",
                id,
                path = folderPath.Replace('\\', '/'),
                payload = legacy,
            };
            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
        }

        private void PostDirContentsJsonStream(string? id, string folderPath, List<DirListingSharedBuffer.DirEntryDto> entries)
        {
            var legacy = entries.Select(DirEntryToLegacy).ToList();
            var response = new
            {
                type = "DIR_CONTENTS_STREAM",
                id,
                path = folderPath.Replace('\\', '/'),
                payload = legacy,
            };
            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
        }

        private async Task PostDirListingPageAsync(string? idProp, string path, List<DirListingSharedBuffer.DirEntryDto> page, bool partial)
        {
            await PostToUiAsync(() =>
            {
                var env = _webViewEnvironment;
                var wv = MainWebView.CoreWebView2;
                if (env == null || wv == null)
                {
                    PostDirContentsJson(idProp, page);
                    return;
                }
                if (!DirListingSharedBuffer.TryPost(env, wv, "DIR_CONTENTS_RESULT", idProp, page, path, partial))
                    PostDirContentsJson(idProp, page);
            }).ConfigureAwait(false);
        }

        private async Task PostDirListingStreamAsync(string? idProp, string path, List<DirListingSharedBuffer.DirEntryDto> chunk)
        {
            await PostToUiAsync(() =>
            {
                var env = _webViewEnvironment;
                var wv = MainWebView.CoreWebView2;
                if (env == null || wv == null)
                {
                    PostDirContentsJsonStream(idProp, path, chunk);
                    return;
                }
                if (!DirListingSharedBuffer.TryPost(env, wv, "DIR_CONTENTS_STREAM", idProp, chunk, path, partial: true))
                    PostDirContentsJsonStream(idProp, path, chunk);
            }).ConfigureAwait(false);
        }

        private async Task PostDirListingAppendAsync(string? idProp, string path, List<DirListingSharedBuffer.DirEntryDto> entries)
        {
            await PostToUiAsync(() =>
            {
                var env = _webViewEnvironment;
                var wv = MainWebView.CoreWebView2;
                if (env == null || wv == null)
                {
                    PostDirContentsJsonAppend(idProp, path, entries);
                    return;
                }
                if (!DirListingSharedBuffer.TryPost(env, wv, "DIR_CONTENTS_APPEND", idProp, entries, path, partial: false))
                    PostDirContentsJsonAppend(idProp, path, entries);
            }).ConfigureAwait(false);
        }

        private void EnrichDirListingEntries(List<DirListingSharedBuffer.DirEntryDto> entries)
        {
            DirListingSharedBuffer.EnrichWithTags(entries, _tagSidecarStore);
            DirListingSharedBuffer.EnrichWithReparseLinks(entries, p => _ghostLinkService.IsGhostLink(p));
        }

        private async Task StreamDirContentsAsync(string path, string? idProp, CancellationToken ct)
        {
            var resolvedForGate = ShellPathResolver.ResolveForShell(path);
            if (string.IsNullOrEmpty(resolvedForGate)) resolvedForGate = ShellPathResolver.NormalizeIncoming(path);
            if (!string.IsNullOrWhiteSpace(resolvedForGate)
                && HelloGateService.Instance.IsBlocked(resolvedForGate))
            {
                var gatePath = HelloGateService.Instance.GetBlockingGatePath(resolvedForGate) ?? resolvedForGate;
                await PostToUiAsync(() => PostDirContentsError(idProp, path, $"HELLO_GATE_BLOCKED:{gatePath}")).ConfigureAwait(false);
                return;
            }

            var firstPaint = DirListingSharedBuffer.FirstPaintPageSize;
            var streamChunk = DirListingSharedBuffer.StreamChunkSize;
            var all = new List<DirListingSharedBuffer.DirEntryDto>();
            var pending = new List<DirListingSharedBuffer.DirEntryDto>(firstPaint);
            var firstPosted = false;

            await foreach (var entry in _fileService.EnumerateDirEntriesAsync(path, ct).ConfigureAwait(false))
            {
                all.Add(entry);
                pending.Add(entry);

                if (!firstPosted && pending.Count >= firstPaint)
                {
                    firstPosted = true;
                    await PostDirListingPageAsync(idProp, path, pending, partial: true).ConfigureAwait(false);
                    pending = new List<DirListingSharedBuffer.DirEntryDto>(streamChunk);
                }
                else if (firstPosted && pending.Count >= streamChunk)
                {
                    await PostDirListingStreamAsync(idProp, path, pending).ConfigureAwait(false);
                    pending = new List<DirListingSharedBuffer.DirEntryDto>(streamChunk);
                }
            }

            if (!firstPosted)
            {
                await PostDirListingPageAsync(idProp, path, all, partial: false).ConfigureAwait(false);
                EnrichDirListingEntries(all);
                if (all.Count > 0)
                    await PostDirListingAppendAsync(idProp, path, all).ConfigureAwait(false);
                return;
            }

            if (pending.Count > 0)
                await PostDirListingStreamAsync(idProp, path, pending).ConfigureAwait(false);

            EnrichDirListingEntries(all);
            await PostDirListingAppendAsync(idProp, path, all).ConfigureAwait(false);
        }

        private void PushDrivesUpdate()
        {
            _ = Task.Run(() =>
            {
                try
                {
                    var drives = _cloudStorageService.GetAnnotatedDrives();
                    var evt = new { type = "DRIVES_CHANGED", payload = drives };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    string json = JsonSerializer.Serialize(evt, jsonOptions);
                    PostToUi(() =>
                    {
                        try { MainWebView.CoreWebView2?.PostWebMessageAsJson(json); }
                        catch { }
                    });
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[PushDrivesUpdate] {ex.Message}");
                }
            });
        }

        private void SetupDebouncedWatcher()
        {
            _debounceTimer = new System.Timers.Timer(150); // 150ms debounce window to batch rapid SSD events
            _debounceTimer.AutoReset = true;
            _debounceTimer.Elapsed += (s, e) => FlushFsEvents();
            _debounceTimer.Start();
        }

        private void MonitorDirectory(string path)
        {
            // Normalize path for Windows FileSystemWatcher
            path = path.Replace("/", "\\");
            if (!Directory.Exists(path)) return;
            
            if (_watchers.ContainsKey(path)) return;

            var watcher = new FileSystemWatcher(path)
            {
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite,
                EnableRaisingEvents = true
            };

            watcher.Created += (s, e) => QueueFsEvent("Created", path, e.Name);
            watcher.Deleted += (s, e) => QueueFsEvent("Deleted", path, e.Name);
            watcher.Changed += (s, e) => QueueFsEvent("Changed", path, e.Name);
            watcher.Renamed += (s, e) => QueueFsEvent("Renamed", path, e.Name, e.OldName);

            _watchers[path] = watcher;
        }

        /// <summary>Opt-in IPC tracing: set BNDZ_IPC_LOG=1 to enable. Off by default to avoid
        /// unbounded ipc_log.txt growth and synchronous disk writes on the dispatcher thread.</summary>
        private static readonly bool _ipcLogEnabled =
            Environment.GetEnvironmentVariable("BNDZ_IPC_LOG") == "1";

        private static void IpcDebugLog(string line)
        {
            if (!_ipcLogEnabled) return;
            try { System.IO.File.AppendAllText("ipc_log.txt", line + "\n"); } catch { }
        }

        private void QueueFsEvent(string type, string dir, string? name, string? oldName = null)
        {
            _fseventBuffer.Enqueue(new { type, dir = dir.Replace("\\", "/"), name, oldName });
        }

        private void FlushFsEvents()
        {
            if (_fseventBuffer.IsEmpty) return;

            var batch = new List<object>();
            while (_fseventBuffer.TryDequeue(out var ev))
            {
                batch.Add(ev);
            }

            foreach (var raw in batch)
            {
                try
                {
                    var evJson = JsonSerializer.Serialize(raw);
                    using var doc = JsonDocument.Parse(evJson);
                    var root = doc.RootElement;
                    var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
                    var dir = root.TryGetProperty("dir", out var d) ? d.GetString() : null;
                    var name = root.TryGetProperty("name", out var n) ? n.GetString() : null;
                    var oldName = root.TryGetProperty("oldName", out var o) ? o.GetString() : null;
                    if (!string.IsNullOrEmpty(type) && !string.IsNullOrEmpty(dir) && !string.IsNullOrEmpty(name))
                        BndzFileIndexService.Instance.ApplyFsEvent(type, dir, name, oldName);
                }
                catch { }
            }

            var payload = new { type = "FS_EVENT_BATCH", payload = batch };
            var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

            PostToUi(() => 
            {
                // Send batched payload back to the React frontend
                MainWebView.CoreWebView2.PostWebMessageAsJson(json);
            });
        }

        private async void InitializeWebViewAsync()
        {
            try
            {
            // WebView2 uses D3D11 compositing by default; prefer explicit GPU rasterization for smooth panel resize/scroll.
            // --disable-frame-rate-limit unlocks Chromium's internal 60fps cap so the compositor follows monitor Hz.
            // --disable-smooth-scrolling keeps wheel input 1:1 (Explorer-like), not eased browser smooth-scroll.
            // CanvasOopRasterization / gpu-compositing keep paint off the UI thread when the adapter allows it.
            // Custom scheme for local file streaming — WebResourceRequested does NOT fire on SetVirtualHostNameToFolderMapping hosts.
            var streamScheme = new CoreWebView2CustomSchemeRegistration(LocalStreamService.CustomScheme)
            {
                TreatAsSecure = true,
                HasAuthorityComponent = true,
            };
            streamScheme.AllowedOrigins.Add("http://bndz.local");
            streamScheme.AllowedOrigins.Add("https://bndz.local");

            // CustomSchemeRegistrations is ctor-only (read-only property). Passing null leaves
            // the getter returning null, so .Add would NullReferenceException at startup.
            var webEnvOptions = new CoreWebView2EnvironmentOptions(
                additionalBrowserArguments:
                    "--enable-gpu --enable-gpu-rasterization --enable-gpu-compositing --enable-zero-copy " +
                    "--enable-features=CanvasOopRasterization " +
                    "--disable-features=CalculateNativeWinOcclusion " +
                    "--disable-frame-rate-limit --disable-smooth-scrolling --ignore-gpu-blocklist",
                customSchemeRegistrations: new List<CoreWebView2CustomSchemeRegistration> { streamScheme });

            var localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var profileDir = App.IsPluginWindow
                ? Path.Combine(localAppData, "BNDZ", "WebView2", $"Plugin-{Process.GetCurrentProcess().Id}")
                : App.IsStageWindow
                ? Path.Combine(localAppData, "BNDZ", "WebView2", $"Stage-{Process.GetCurrentProcess().Id}")
                : Path.Combine(localAppData, "BNDZ", "WebView2", "Main");
            Directory.CreateDirectory(profileDir);

            var webEnv = await CoreWebView2Environment.CreateAsync(null, profileDir, webEnvOptions);
            _webViewEnvironment = webEnv;
            // Keep AllowExternalDrop=true so WebView2 does not install a *blocking* OLE target
            // before RegisterWebView2OleDropTarget can replace it with BNDZ's own IDropTarget.
            MainWebView.AllowExternalDrop = true;
            await MainWebView.EnsureCoreWebView2Async(webEnv);
            SyncAllowExternalDrop(); // now sets true

            if (MainWebView.CoreWebView2 == null)
                throw new InvalidOperationException("WebView2 initialized but CoreWebView2 is still null.");

            // Suppress Edge/WebView2 default context menus — BNDZ uses custom React menus only
            MainWebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            MainWebView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            // Match chrome so compositor never flashes white behind the UI (native feel).
            try { MainWebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(255, 22, 24, 31); } catch { /* older runtimes */ }
            MainWebView.ZoomFactor = 1.0;
            MainWebView.ZoomFactorChanged += (_, _) =>
            {
                if (Math.Abs(MainWebView.ZoomFactor - 1.0) > 0.001)
                    MainWebView.ZoomFactor = 1.0;
            };
            MainWebView.CoreWebView2.ContextMenuRequested += (_, e) => e.Handled = true;

            string uiPath = System.IO.Path.Combine(AppContext.BaseDirectory, "Assets", "ui");
            if (!System.IO.Directory.Exists(uiPath)) {
                System.IO.Directory.CreateDirectory(uiPath);
            }

            // Map virtual host to the UI folder for all static assets (index.html, JS, CSS, PNG icons)
            MainWebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "bndz.local", uiPath,
                Microsoft.Web.WebView2.Core.CoreWebView2HostResourceAccessKind.Allow);

            // Register WebResourceRequested BEFORE navigation so it can intercept asset requests
            MainWebView.CoreWebView2.AddWebResourceRequestedFilter(
                "http://bndz.local/assets/native-icon/*",
                Microsoft.Web.WebView2.Core.CoreWebView2WebResourceContext.All);
            var allSources = Microsoft.Web.WebView2.Core.CoreWebView2WebResourceRequestSourceKinds.All;
            // Local file streaming via custom scheme (not under bndz.local folder mapping)
            MainWebView.CoreWebView2.AddWebResourceRequestedFilter(
                $"{LocalStreamService.CustomScheme}:*",
                Microsoft.Web.WebView2.Core.CoreWebView2WebResourceContext.All,
                allSources);
            // Legacy filters kept so old cached UI builds still hit the handler if they somehow resolve
            MainWebView.CoreWebView2.AddWebResourceRequestedFilter(
                "http://bndz.local/local-stream/*",
                Microsoft.Web.WebView2.Core.CoreWebView2WebResourceContext.All,
                allSources);
            MainWebView.CoreWebView2.AddWebResourceRequestedFilter(
                "https://bndz.local/local-stream/*",
                Microsoft.Web.WebView2.Core.CoreWebView2WebResourceContext.All,
                allSources);
            MainWebView.CoreWebView2.WebResourceRequested += CoreWebView2_WebResourceRequested;

            MainWebView.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;
            MainWebView.CoreWebView2.ProcessFailed += CoreWebView2_ProcessFailed;

            SetupNativeFileDrop();

            MainWebView.CoreWebView2.NavigationStarting += (s, e) =>
            {
                if (!e.Uri.StartsWith("file:", StringComparison.OrdinalIgnoreCase)) return;
                e.Cancel = true;
                try
                {
                    PostNavigationFileDrop(new Uri(e.Uri).LocalPath);
                }
                catch { }
            };

            MainWebView.CoreWebView2.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                try
                {
                    if (string.IsNullOrEmpty(e.Uri) || !e.Uri.StartsWith("file:", StringComparison.OrdinalIgnoreCase)) return;
                    PostNavigationFileDrop(new Uri(e.Uri).LocalPath);
                }
                catch { }
            };

#if DEBUG
            MainWebView.CoreWebView2.OpenDevToolsWindow();
#endif

            // Navigate to the React frontend served from the virtual host, bypassing cache
            var navUrl = $"http://bndz.local/index.html?t={DateTime.Now.Ticks}";
            if (App.IsPluginWindow && !string.IsNullOrWhiteSpace(_pendingPluginId ?? App.PluginWindowId))
            {
                var pluginId = Uri.EscapeDataString(_pendingPluginId ?? App.PluginWindowId!);
                navUrl += $"&pluginWindow={pluginId}";
                var sticky = _pendingStickyId ?? App.PluginStickyId;
                if (!string.IsNullOrWhiteSpace(sticky))
                    navUrl += $"&stickyId={Uri.EscapeDataString(sticky)}";
                if (!string.IsNullOrWhiteSpace(_pendingPluginTitle))
                    navUrl += $"&title={Uri.EscapeDataString(_pendingPluginTitle)}";
            }
            MainWebView.CoreWebView2.Navigate(navUrl);
            MainWebView.CoreWebView2.NavigationCompleted += (_, _) => FlushPendingStartupAction();
            }
            catch (Exception ex)
            {
                Dispatcher.Invoke(() =>
                {
                    var detail = ex is Microsoft.Web.WebView2.Core.WebView2RuntimeNotFoundException
                        ? "Microsoft Edge WebView2 Runtime is not installed or could not be found."
                        : $"{ex.GetType().Name}: {ex.Message}";
                    System.Windows.MessageBox.Show(
                        "BNDZ could not start the WebView2 UI host.\n\n" +
                        (ex is Microsoft.Web.WebView2.Core.WebView2RuntimeNotFoundException
                            ? "Install Microsoft Edge WebView2 Runtime, then restart BNDZ.\n\n"
                            : "WebView2 appears installed, but initialization failed. See details below.\n\n") +
                        $"Details: {detail}",
                        "WebView2 Startup Failed",
                        MessageBoxButton.OK,
                        MessageBoxImage.Error);
                });
            }
        }

        private void CoreWebView2_ProcessFailed(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2ProcessFailedEventArgs e)
        {
            PostToUi(() => {
                System.Windows.MessageBox.Show($"WebView2 Process Failed: {e.ProcessFailedKind}\nReason: {e.Reason}", "Renderer Crash or IPC Bridge Timeout", MessageBoxButton.OK, MessageBoxImage.Error);
                // Attempt recovery by reloading, then re-register our drop target once
                // the new renderer HWND is live.
                try
                {
                    void ReregisterOnNavComplete(object? s, CoreWebView2NavigationCompletedEventArgs _ev)
                    {
                        MainWebView.CoreWebView2.NavigationCompleted -= ReregisterOnNavComplete;
                        RegisterWebView2OleDropTarget();
                    }
                    MainWebView.CoreWebView2.NavigationCompleted += ReregisterOnNavComplete;
                    MainWebView.Reload();
                }
                catch { }
            });
        }

        private async void CoreWebView2_WebMessageReceived(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            string messageStr = "";
            try
            {
                messageStr = e.WebMessageAsJson;
                
                // If it was sent as a JSON string instead of an object, it'll have double quotes around it and be escaped
                if (messageStr.StartsWith("\"") && messageStr.EndsWith("\"")) {
                    try { messageStr = System.Text.Json.JsonSerializer.Deserialize<string>(messageStr) ?? messageStr; } catch { }
                }
                
                if (string.IsNullOrEmpty(messageStr)) return;
                IpcDebugLog($"[RECV] {messageStr}");

                using var doc = JsonDocument.Parse(messageStr);
                var root = doc.RootElement;
                if (!root.TryGetProperty("type", out var typeProp)) return;

                string? type = typeProp.GetString();
                if (string.IsNullOrEmpty(type)) return;

                var reqId = root.TryGetProperty("id", out var earlyIdEl) ? earlyIdEl.GetString() : null;

                // Fast-path: keep the WebView message pump responsive. Never block here on
                // DriveInfo / license IO — those hangs cascade into mass IPC timeouts.
                if (TryHandleFastIpc(type, reqId, root))
                    return;

                if (type == "EXTERNAL_DRAG_HOVER_REPORT")
                {
                    try
                    {
                        if (root.TryGetProperty("payload", out var hoverPayload)
                            && hoverPayload.ValueKind == JsonValueKind.Object
                            && hoverPayload.TryGetProperty("webViewX", out var hxEl)
                            && hoverPayload.TryGetProperty("webViewY", out var hyEl))
                        {
                            var hx = hxEl.GetDouble();
                            var hy = hyEl.GetDouble();
                            _lastExternalDragWebViewX = hx;
                            _lastExternalDragWebViewY = hy;
                            PostExternalFileDragHover(hx, hy);
                        }
                    }
                    catch { /* best-effort */ }
                    return;
                }

                // Native license gate: when trial is expired / unlicensed, only allow license + bootstrap IPC.
                bool canUseApp = true;
                try { canUseApp = LicenseService.GetStatusCached().CanUseApp; }
                catch { canUseApp = true; /* fail open for IPC pump */ }

                if (!canUseApp && !LicenseService.IsIpcAllowedWhenUnlicensed(type))
                {
                    var blockedPayload = new
                    {
                        error = "License required. Activate BNDZ to continue.",
                        licenseRequired = true,
                    };
                    var blockedResultType = LicenseService.ResolveIpcResultType(type);
                    var blockedResponse = new { type = blockedResultType, id = reqId, payload = blockedPayload };
                    var blockedJson = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() =>
                        MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(blockedResponse, blockedJson)));
                    return;
                }

                if (type == "BNDZ_UI_READY")
                {
                    try
                    {
                        if (root.TryGetProperty("payload", out var readyPayload)
                            && readyPayload.ValueKind == JsonValueKind.Object)
                        {
                            if (readyPayload.TryGetProperty("innerWidth", out var iwEl)
                                && readyPayload.TryGetProperty("innerHeight", out var ihEl))
                            {
                                UpdateWebViewJsViewportScale(iwEl.GetDouble(), ihEl.GetDouble());
                            }
                        }
                    }
                    catch { /* best-effort */ }
                    PostToUi(FlushPendingOpenPath);
                    PostToUi(FlushPendingPluginWindow);
                    PushDrivesUpdate();
                    // Offload I/O-bound startup work off the UI/IPC thread to avoid hitching
                    // the WebView message pump at first paint.
                    _ = Task.Run(() =>
                    {
                        try { InboundVolumeService.Instance.StartWatching(); } catch { }
                        try { InboundVolumeService.Instance.PurgeExpired(); } catch { }
                    });
                }
                else if (type == "EXECUTE_BATCH_RENAME")
                {
                    var payload = root.GetProperty("payload");
                    string operationId = payload.TryGetProperty("operationId", out var opEl) ? opEl.GetString() ?? Guid.NewGuid().ToString() : Guid.NewGuid().ToString();
                    string? label = payload.TryGetProperty("label", out var labelEl) ? labelEl.GetString() : null;
                    var renames = new List<(string Source, string Target)>();
                    if (payload.TryGetProperty("renames", out var renamesEl) && renamesEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var row in renamesEl.EnumerateArray())
                        {
                            var src = row.TryGetProperty("source", out var sEl) ? NormalizeFsPath(sEl.GetString() ?? "") : "";
                            var dst = row.TryGetProperty("target", out var tEl) ? NormalizeFsPath(tEl.GetString() ?? "") : "";
                            if (!string.IsNullOrEmpty(src) && !string.IsNullOrEmpty(dst))
                                renames.Add((src, dst));
                        }
                    }
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = HandleExecuteBatchRenameAsync(operationId, renames, label, idProp);
                }
                else if (type == "EXECUTE_FS_OPERATION")
                {
                    var payload = root.GetProperty("payload");
                    string operationId = payload.GetProperty("operationId").GetString() ?? Guid.NewGuid().ToString();
                    string action = payload.GetProperty("action").GetString() ?? "copy";
                    
                    List<string> sources = new List<string>();
                    var sourceProp = payload.GetProperty("source");
                    if (sourceProp.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in sourceProp.EnumerateArray())
                        {
                            sources.Add(NormalizeFsPath(el.GetString() ?? ""));
                        }
                    }
                    else
                    {
                        sources.Add(NormalizeFsPath(sourceProp.GetString() ?? ""));
                    }
                    
                    string target = NormalizeFsPath(payload.GetProperty("target").GetString() ?? "");
                    bool bypassRecycleBin = payload.TryGetProperty("bypassRecycleBin", out var brProp) ? brProp.GetBoolean() : false;
                    string? label = payload.TryGetProperty("label", out var labelProp) ? labelProp.GetString() : null;
                    var priority = ParseTransferPriority(payload);
                    bool recreateSourceStructure = payload.TryGetProperty("recreateSourceStructure", out var rsProp)
                        && rsProp.ValueKind == JsonValueKind.True;

                    if (action == "undo")
                    {
                        _ = HandleUndoRedoAsync(undo: true, idProp: root.TryGetProperty("id", out var uid) ? uid.GetString() : null);
                        return;
                    }
                    if (action == "redo")
                    {
                        _ = HandleUndoRedoAsync(undo: false, idProp: root.TryGetProperty("id", out var rid) ? rid.GetString() : null);
                        return;
                    }

                    var fsOpIdProp = root.TryGetProperty("id", out var fsOpIdEl) ? fsOpIdEl.GetString() : null;
                    _ = HandleExecuteFsOperationAsync(operationId, action, sources, target, bypassRecycleBin, label, priority, recreateSourceStructure, fsOpIdProp);
                }
                else if (type == "GET_FILE_TRANSFER_QUEUE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var response = new { type = "FILE_TRANSFER_QUEUE_RESULT", id = idProp, payload = _fileTransferQueue.GetQueueState() };
                            PostToUi(() =>
                            {
                                try { MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response)); }
                                catch { }
                            });
                        }
                        catch (Exception ex)
                        {
                            var response = new
                            {
                                type = "FILE_TRANSFER_QUEUE_RESULT",
                                id = idProp,
                                payload = new { queuedCount = 0, activeCount = 0, jobs = Array.Empty<object>(), error = ex.Message },
                            };
                            PostToUi(() =>
                            {
                                try { MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response)); }
                                catch { }
                            });
                        }
                    });
                }
                else if (type == "CANCEL_FILE_TRANSFER")
                {
                    var payload = root.GetProperty("payload");
                    string opId = payload.TryGetProperty("operationId", out var opProp) ? opProp.GetString() ?? "" : "";
                    bool cancelled = !string.IsNullOrEmpty(opId) && _fileTransferQueue.Cancel(opId);
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var response = new { type = "CANCEL_FILE_TRANSFER_RESULT", id = idProp, payload = new { ok = cancelled, operationId = opId } };
                    PostToUi(() =>
                    {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
                    });
                }
                else if (type == "PAUSE_FILE_TRANSFER")
                {
                    var payload = root.GetProperty("payload");
                    string opId = payload.TryGetProperty("operationId", out var opProp) ? opProp.GetString() ?? "" : "";
                    bool ok = !string.IsNullOrEmpty(opId) && _fileTransferQueue.Pause(opId);
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var response = new { type = "PAUSE_FILE_TRANSFER_RESULT", id = idProp, payload = new { ok, operationId = opId } };
                    PostToUi(() =>
                    {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
                    });
                }
                else if (type == "RESUME_FILE_TRANSFER")
                {
                    var payload = root.GetProperty("payload");
                    string opId = payload.TryGetProperty("operationId", out var opProp) ? opProp.GetString() ?? "" : "";
                    bool ok = !string.IsNullOrEmpty(opId) && _fileTransferQueue.Resume(opId);
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var response = new { type = "RESUME_FILE_TRANSFER_RESULT", id = idProp, payload = new { ok, operationId = opId } };
                    PostToUi(() =>
                    {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
                    });
                }
                else if (type == "CLEAR_FILE_TRANSFER_HISTORY")
                {
                    var cleared = _fileTransferQueue.ClearFinishedJobs();
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var response = new { type = "CLEAR_FILE_TRANSFER_HISTORY_RESULT", id = idProp, payload = new { cleared } };
                    PostToUi(() =>
                    {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
                    });
                }
                else if (type == "START_DRAG")
                {
                    var payload = root.GetProperty("payload");
                    var paths = new List<string>();
                    if (payload.TryGetProperty("paths", out var pathsEl) && pathsEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var p in pathsEl.EnumerateArray())
                        {
                            var s = p.GetString();
                            if (!string.IsNullOrWhiteSpace(s)) paths.Add(NormalizeFsPath(s));
                        }
                    }
                    else if (payload.TryGetProperty("path", out var pathEl))
                    {
                        var single = pathEl.GetString() ?? "";
                        if (!string.IsNullOrWhiteSpace(single)) paths.Add(NormalizeFsPath(single));
                    }
                    if (paths.Count == 0) return;
                    var pathArray = paths.ToArray();

                    // DoDragDrop must run synchronously while the mouse button is still down.
                    void RunOleDrag()
                    {
                        try
                        {
                            // _bndzOleDragActive lets our IDropTarget recognise internal re-entry
                            // and honour move intent when the drag lands back on BNDZ.
                            _bndzOleDragActive = true;
                            var dataObject = new System.Windows.DataObject();
                            dataObject.SetData(System.Windows.DataFormats.FileDrop, pathArray);
                            // Explorer interop: Preferred DropEffect = Copy|Link (5). Ctrl/Shift still toggle.
                            dataObject.SetData("Preferred DropEffect", new System.IO.MemoryStream(BitConverter.GetBytes(5)));
                            try
                            {
                                // Shell multi-file drag image when available (IDragSourceHelper).
                                AttachShellDragImage(dataObject, pathArray);
                            }
                            catch (Exception dragImgEx)
                            {
                                Debug.WriteLine($"[START_DRAG] drag image: {dragImgEx.Message}");
                            }
                            System.Windows.DragDrop.DoDragDrop(this, dataObject, System.Windows.DragDropEffects.Copy | System.Windows.DragDropEffects.Move | System.Windows.DragDropEffects.Link);
                        }
                        catch (Exception ex)
                        {
                            Debug.WriteLine($"[START_DRAG] {ex.Message}");
                        }
                        finally
                        {
                            _bndzOleDragActive = false;
                        }
                    }

                    if (Dispatcher.CheckAccess())
                        RunOleDrag();
                    else
                        Dispatcher.Invoke(RunOleDrag);
                }
                else if (type == "CLEAR_THUMBNAIL_CACHE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        var result = ThumbnailCacheService.ClearAll();
                        var response = new
                        {
                            type = "CLEAR_THUMBNAIL_CACHE_RESULT",
                            id = idProp,
                            payload = new { success = result.Success, filesRemoved = result.FilesRemoved, bytesFreed = result.BytesFreed, error = result.Error },
                        };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "RESOLVE_CONFLICT")
                {
                    var payload = root.GetProperty("payload");
                    string operationId = payload.TryGetProperty("operationId", out var opIdEl) ? (opIdEl.GetString() ?? "") : "";
                    string fileName = payload.TryGetProperty("fileName", out var fnEl) ? (fnEl.GetString() ?? "") : "";
                    string resolution = payload.TryGetProperty("resolution", out var resEl) ? (resEl.GetString() ?? "skip") : "skip"; // "replace", "skip", "keepboth"
                    bool applyToAll = payload.TryGetProperty("applyToAll", out var allEl) && allEl.ValueKind == JsonValueKind.True;
                    string conflictKey = $"{operationId}:{fileName}";

                    if (applyToAll && !string.IsNullOrEmpty(operationId))
                    {
                        _conflictBatchResolution[operationId] = resolution;
                    }

                    if (_conflictResolvers.TryGetValue(conflictKey, out var tcs))
                    {
                        tcs.SetResult(resolution);
                        _conflictResolvers.TryRemove(conflictKey, out _);
                    }
                    else
                    {
                        Console.WriteLine($"[RESOLVE_CONFLICT] No pending resolver for key '{conflictKey}' — the conflict prompt UI likely sent a stale or missing operationId.");
                    }
                }
                else if (type == "SHELL_EXECUTE")
                {
                    var payload = root.GetProperty("payload");
                    string action = payload.GetProperty("action").GetString() ?? "";
                    
                    var pathElement = payload.GetProperty("path");
                    var paths = new List<string>();
                    if (pathElement.ValueKind == JsonValueKind.Array) {
                        foreach (var el in pathElement.EnumerateArray()) {
                            paths.Add(NormalizeFsPath(el.GetString() ?? ""));
                        }
                    } else {
                        paths.Add(NormalizeFsPath(pathElement.GetString() ?? ""));
                    }
                    paths = paths.Where(p => !string.IsNullOrEmpty(p)).ToList();
                    string path = paths.Count > 0 ? paths[0] : "";
                    
                    string workingDir = payload.TryGetProperty("workingDir", out var wdProp) ? wdProp.GetString() ?? "" : "";
                    JsonElement? shellElement = payload.TryGetProperty("shell", out var shellProp) ? shellProp : null;
                    
                    if (workingDir.StartsWith("/")) workingDir = workingDir.Substring(1);
                    workingDir = workingDir.Replace("/", "\\");
                    
                    if (action == "open")
                    {
                        _shellIntegrationService.ExecuteFile(path);
                    }
                    else if (action == "executeScript")
                    {
                        string scriptPath = path;
                        if (!Path.IsPathRooted(scriptPath))
                            scriptPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, scriptPath);
                        if (File.Exists(scriptPath))
                        {
                            try
                            {
                                var psi = new System.Diagnostics.ProcessStartInfo
                                {
                                    FileName = scriptPath,
                                    UseShellExecute = true,
                                };
                                if (!string.IsNullOrEmpty(workingDir) && Directory.Exists(workingDir))
                                    psi.WorkingDirectory = workingDir;
                                System.Diagnostics.Process.Start(psi);
                            }
                            catch { }
                        }
                    }
                    else if (action == "openTerminal")
                    {
                        var startPath = Directory.Exists(path) ? path : Path.GetDirectoryName(path);
                        if (!string.IsNullOrEmpty(startPath)) {
                            try { StartShellProcess(startPath, null, shellElement); } catch { }
                        }
                    }
                    else if (action == "runCommand")
                    {
                        // Raw user command from Shell Menus plugin — must not be path-normalized
                        string rawCmd = pathElement.ValueKind == JsonValueKind.String
                            ? pathElement.GetString() ?? ""
                            : path;
                        if (!string.IsNullOrWhiteSpace(rawCmd))
                        {
                            try
                            {
                                var startPath = !string.IsNullOrEmpty(workingDir) && Directory.Exists(workingDir)
                                    ? workingDir
                                    : (Directory.Exists(path) ? path : Path.GetDirectoryName(path) ?? "");
                                StartShellProcess(startPath, rawCmd, shellElement);
                            }
                            catch { }
                        }
                    }
                    else if (action == "openExplorer")
                    {
                        try
                        {
                            if (File.Exists(path))
                            {
                                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                                {
                                    FileName = "explorer.exe",
                                    Arguments = $"/select,\"{path}\"",
                                    UseShellExecute = true,
                                });
                            }
                            else
                            {
                                var startPath = Directory.Exists(path) ? path : Path.GetDirectoryName(path);
                                if (!string.IsNullOrEmpty(startPath) && Directory.Exists(startPath))
                                {
                                    System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                                    {
                                        FileName = "explorer.exe",
                                        Arguments = $"\"{startPath}\"",
                                        UseShellExecute = true,
                                    });
                                }
                            }
                        }
                        catch { }
                    }
                    else if (action == "openWith")
                    {
                        // Launch the shell Open With dialog natively
                        PostToUi(() => {
                            try {
                                var processInfo = new System.Diagnostics.ProcessStartInfo("Rundll32.exe", $"shell32.dll,OpenAs_RunDLL {path}");
                                processInfo.UseShellExecute = true;
                                System.Diagnostics.Process.Start(processInfo);
                            } catch {}
                        });
                    }
                    else if (action == "copyPath")
                    {
                        string clip = paths.Count > 1 ? string.Join(Environment.NewLine, paths) : path;
                        Dispatcher.Invoke(() => {
                           System.Windows.Clipboard.SetText(clip);
                        });
                    }
                    else if (action == "compress")
                    {
                        foreach (var p in paths)
                        {
                            if (File.Exists(p) || Directory.Exists(p))
                                _shellIntegrationService.ExecuteFile(p, "compress");
                        }
                    }
                    else if (action == "extract")
                    {
                        foreach (var p in paths)
                        {
                            if (File.Exists(p))
                                _shellIntegrationService.LaunchSystemTool("extract", p);
                        }
                    }
                    else if (action == "properties")
                    {
                        var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                        ShellPropertiesHelper.ShowProperties(path, hwnd);
                    }
                    else if (action.StartsWith("launch-") || action is "cmd" or "ps" or "taskmgr" or "regedit" or "map_network_drive" or "share" or "burn_disc" or "extract")
                    {
                        _shellIntegrationService.LaunchSystemTool(action, path);
                    }
                }
                else if (type == "CHECK_PATH_EXISTS")
                {
                    var payload = root.GetProperty("payload");
                    string path = payload.GetProperty("path").GetString() ?? "";
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;

                    bool exists = ShellPathResolver.PathExistsForShell(
                        ShellPathResolver.ResolveForShell(path));

                    var response = new { type = "CHECK_PATH_RESULT", id = idProp, payload = exists };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    var responseJson = JsonSerializer.Serialize(response, jsonOptions);

                    PostToUi(() => {
                        IpcDebugLog($"[SEND] {responseJson}");
                        MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                    });
                }
                else if (type == "EXPAND_ENVIRONMENT_PATH")
                {
                    var payload = root.GetProperty("payload");
                    string path = payload.GetProperty("path").GetString() ?? "";
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;

                    var resolved = ShellPathResolver.ResolveForShell(path);
                    // Prefer a real filesystem path for the address bar when shell: mapped.
                    var expanded = string.IsNullOrEmpty(resolved)
                        ? Environment.ExpandEnvironmentVariables(path.Trim())
                        : resolved;
                    if (ShellPathResolver.IsShellVirtualPath(expanded)
                        && !expanded.StartsWith("::{", StringComparison.Ordinal))
                    {
                        expanded = Environment.ExpandEnvironmentVariables(path.Trim());
                    }

                    var response = new { type = "EXPAND_ENVIRONMENT_PATH_RESULT", id = idProp, payload = expanded };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
                else if (type == "GET_DIR_CONTENTS")
                {
                    var payload = root.GetProperty("payload");
                    string path = payload.GetProperty("path").GetString() ?? "";
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;

                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(45));
                            await StreamDirContentsAsync(path, idProp, cts.Token).ConfigureAwait(false);
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"[GET_DIR_CONTENTS] {path}: {ex.Message}");
                            await PostToUiAsync(() => PostDirContentsError(idProp, path, ex.Message)).ConfigureAwait(false);
                        }
                    });
                }
                else if (type == "GET_SUB_DIRECTORIES")
                {
                    var payload = root.GetProperty("payload");
                    string rawTreePath = payload.GetProperty("path").GetString() ?? "";
                    string path = BNDZ.Services.ShellPathResolver.ResolveForShell(rawTreePath);
                    if (string.IsNullOrEmpty(path)) path = BNDZ.Services.ShellPathResolver.NormalizeIncoming(rawTreePath);
                    bool showHidden = payload.TryGetProperty("showHidden", out var shElement) && shElement.GetBoolean();
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;

                    _ = Task.Run(() => 
                    {
                        var results = new List<object>();
                        try
                        {
                            if (BNDZ.Services.ShellPathResolver.IsShellVirtualPath(path) || path == "\\\\")
                            {
                                // Virtual shell folders (Network, Libraries, This PC): enumerate via shell namespace
                                foreach (var item in BNDZ.Services.ShellFolderEnumerator.Enumerate(path))
                                {
                                    if (item is BNDZ.Services.ShellChildItem sci && sci.Type == "directory")
                                        results.Add(sci);
                                }
                            }
                            else if (Directory.Exists(path))
                            {
                                foreach (var dir in Directory.GetDirectories(path))
                                {
                                    var di = new DirectoryInfo(dir);
                                    if (!showHidden && (di.Attributes & FileAttributes.Hidden) == FileAttributes.Hidden) continue;

                                    results.Add(new {
                                        id = Guid.NewGuid().ToString(),
                                        name = di.Name,
                                        type = "directory",
                                        path = dir.Replace("\\", "/"),
                                        size = 0,
                                        modified = di.LastWriteTime.ToString("O")
                                    });
                                }
                            }
                        }
                        catch { }

                        var response = new { type = "SUBDIR_RESULT", id = idProp, payload = results };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        string responseJson = JsonSerializer.Serialize(response, jsonOptions);

                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                        });
                    });
                }
                else if (type == "SHOW_CONTEXT_MENU")
                {
                    var payload = root.GetProperty("payload");
                    var paths = new List<string>();
                    if (payload.TryGetProperty("paths", out var pathsEl) && pathsEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in pathsEl.EnumerateArray())
                        {
                            var p = NormalizeFsPath(el.GetString() ?? "");
                            if (!string.IsNullOrEmpty(p)) paths.Add(p);
                        }
                    }
                    if (paths.Count == 0 && payload.TryGetProperty("path", out var pathEl))
                    {
                        var single = NormalizeFsPath(pathEl.GetString() ?? "");
                        if (!string.IsNullOrEmpty(single)) paths.Add(single);
                    }
                    int x = payload.GetProperty("x").GetInt32();
                    int y = payload.GetProperty("y").GetInt32();

                    Dispatcher.Invoke(() => {
                        var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                        _shellContextMenuService.ShowNativeContextMenu(hwnd, paths, x, y);
                    });
                }
                else if (type == "SHOW_HOST_CONTEXT_MENU")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    int clientX = payload.TryGetProperty("clientX", out var cx) && cx.ValueKind == JsonValueKind.Number ? cx.GetInt32() : 0;
                    int clientY = payload.TryGetProperty("clientY", out var cy) && cy.ValueKind == JsonValueKind.Number ? cy.GetInt32() : 0;
                    var items = new List<HostContextMenuService.Item>();
                    if (payload.TryGetProperty("items", out var itemsEl) && itemsEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in itemsEl.EnumerateArray())
                        {
                            var sep = el.TryGetProperty("separator", out var sepEl) && sepEl.ValueKind == JsonValueKind.True;
                            items.Add(new HostContextMenuService.Item
                            {
                                Id = el.TryGetProperty("id", out var idItem) ? idItem.GetString() ?? "" : "",
                                Label = el.TryGetProperty("label", out var lab) ? lab.GetString() ?? "" : "",
                                Separator = sep,
                                Disabled = el.TryGetProperty("disabled", out var dis) && dis.ValueKind == JsonValueKind.True,
                                Danger = el.TryGetProperty("danger", out var dang) && dang.ValueKind == JsonValueKind.True,
                                Bold = el.TryGetProperty("bold", out var bold) && bold.ValueKind == JsonValueKind.True,
                            });
                        }
                    }

                    PostToUi(() =>
                    {
                        try
                        {
                            System.Windows.Point screenPt;
                            try
                            {
                                screenPt = MainWebView != null
                                    ? MainWebView.PointToScreen(new System.Windows.Point(clientX, clientY))
                                    : PointToScreen(new System.Windows.Point(clientX, clientY));
                            }
                            catch
                            {
                                var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                                var (sx, sy) = HostContextMenuService.ClientToScreenPoint(hwnd, clientX, clientY);
                                screenPt = new System.Windows.Point(sx, sy);
                            }

                            HostContextMenuService.Show(
                                this,
                                (int)Math.Round(screenPt.X),
                                (int)Math.Round(screenPt.Y),
                                items,
                                chosen =>
                                {
                                    var response = new { type = "HOST_CONTEXT_MENU_RESULT", id = idProp, payload = chosen };
                                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                                    PostToUi(() => MainWebView?.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                                });
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"[HostCtx] {ex.Message}");
                            var response = new { type = "HOST_CONTEXT_MENU_RESULT", id = idProp, payload = (string?)null };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            MainWebView?.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                        }
                    });
                }
                else if (type == "GET_CONTEXT_MENU_ITEMS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var paths = new List<string>();
                    try {
                        var payload = root.GetProperty("payload");
                        if (payload.TryGetProperty("paths", out var pathsEl) && pathsEl.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var el in pathsEl.EnumerateArray())
                            {
                                var p = NormalizeFsPath(el.GetString() ?? "");
                                if (!string.IsNullOrEmpty(p)) paths.Add(p);
                            }
                        }
                        if (paths.Count == 0 && payload.TryGetProperty("path", out var pathEl))
                        {
                            var single = NormalizeFsPath(pathEl.GetString() ?? "");
                            if (!string.IsNullOrEmpty(single)) paths.Add(single);
                        }
                    } catch { }

                    _ = Task.Run(() => 
                    {
                        object? payloadObj = null;
                        try {
                            payloadObj = _shellContextMenuService.GetContextMenuItems(paths)
                                .Select(MapContextMenuItemDto)
                                .ToList();
                        } catch (Exception ex) {
                            System.Diagnostics.Debug.WriteLine($"Failed GET_CONTEXT_MENU_ITEMS: {ex.Message}");
                        }

                        var response = new { type = "CONTEXT_MENU_ITEMS_RESULT", id = idProp, payload = payloadObj };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        string responseJson = JsonSerializer.Serialize(response, jsonOptions);

                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                        });
                    });
                }
                else if (type == "EXECUTE_UNDO")
                {
                    var idProp = root.TryGetProperty("id", out var uid) ? uid.GetString() : null;
                    string? entryId = null;
                    if (root.TryGetProperty("payload", out var undoPayload) && undoPayload.ValueKind == JsonValueKind.Object
                        && undoPayload.TryGetProperty("entryId", out var undoEntryEl))
                        entryId = undoEntryEl.GetString();
                    _ = HandleUndoRedoAsync(undo: true, idProp, entryId);
                }
                else if (type == "EXECUTE_REDO")
                {
                    var idProp = root.TryGetProperty("id", out var rid) ? rid.GetString() : null;
                    string? entryId = null;
                    if (root.TryGetProperty("payload", out var redoPayload) && redoPayload.ValueKind == JsonValueKind.Object
                        && redoPayload.TryGetProperty("entryId", out var redoEntryEl))
                        entryId = redoEntryEl.GetString();
                    _ = HandleUndoRedoAsync(undo: false, idProp, entryId);
                }
                else if (type == "GET_ACTION_LOG")
                {
                    var idProp = root.TryGetProperty("id", out var lid) ? lid.GetString() : null;
                    var max = 100;
                    if (root.TryGetProperty("payload", out var logPayload) && logPayload.ValueKind == JsonValueKind.Object
                        && logPayload.TryGetProperty("max", out var maxEl) && maxEl.TryGetInt32(out var maxVal))
                    {
                        max = Math.Clamp(maxVal, 1, 4096);
                    }
                    else
                    {
                        max = Math.Clamp(FileOperationPreferences.Current.MaxActionLogEntries, 1, 4096);
                    }
                    var items = _actionLogService.GetRecent(max);
                    var redoItems = _actionLogService.GetRedoRecent(max);
                    var response = new
                    {
                        type = "ACTION_LOG_RESULT",
                        id = idProp,
                        payload = new
                        {
                            items,
                            redoItems,
                            canUndo = _actionLogService.CanUndo,
                            canRedo = _actionLogService.CanRedo,
                            lastActionUtc = _actionLogService.GetLastUndoEntryUtc()?.ToString("O"),
                        },
                    };
                    MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
                }
                else if (type == "EXECUTE_CONTEXT_MENU_VERB")
                {
                    var payload = root.GetProperty("payload");
                    var pathElement = payload.GetProperty("path");
                    var paths = new List<string>();
                    
                    if (pathElement.ValueKind == JsonValueKind.Array) {
                        foreach (var el in pathElement.EnumerateArray()) {
                            paths.Add(NormalizeFsPath(el.GetString() ?? ""));
                        }
                    } else {
                        paths.Add(NormalizeFsPath(pathElement.GetString() ?? ""));
                    }
                    
                    string verb = payload.GetProperty("verb").GetString() ?? "";
                    bool bypassRecycle = payload.TryGetProperty("bypassRecycleBin", out var brEl) && brEl.GetBoolean();

                    Dispatcher.Invoke(() => {
                        var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                        string? sendToTarget = payload.TryGetProperty("sendToTarget", out var stEl) ? stEl.GetString() : null;
                        _shellContextMenuService.InvokeVerb(paths, verb, hwnd, bypassRecycle, sendToTarget);
                    });
                }
                else if (type == "SET_SHELL_CLIPBOARD")
                {
                    // Explorer-compatible CF_HDROP cut/copy so BNDZ ↔ Explorer paste works.
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var paths = new List<string>();
                    if (payload.TryGetProperty("paths", out var pathsEl) && pathsEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in pathsEl.EnumerateArray())
                        {
                            var p = NormalizeFsPath(el.GetString() ?? "");
                            if (!string.IsNullOrEmpty(p)) paths.Add(p);
                        }
                    }
                    bool cut = payload.TryGetProperty("cut", out var cutEl) && cutEl.ValueKind == JsonValueKind.True;
                    bool ok = false;
                    try
                    {
                        ok = Dispatcher.Invoke(() => _shellContextMenuService.TrySetShellClipboard(paths, cut));
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine($"SET_SHELL_CLIPBOARD failed: {ex.Message}");
                    }
                    PostMeshIpcResult(idProp, "SET_SHELL_CLIPBOARD_RESULT", new { ok, count = paths.Count, cut });
                }
                else if (type == "GET_SHELL_CLIPBOARD")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    try
                    {
                        var (paths, cut, ok) = Dispatcher.Invoke(() => _shellContextMenuService.TryGetShellClipboard());
                        PostMeshIpcResult(idProp, "GET_SHELL_CLIPBOARD_RESULT", new
                        {
                            ok,
                            cut,
                            paths = paths ?? new List<string>(),
                            action = !ok || paths == null || paths.Count == 0 ? "" : (cut ? "cut" : "copy"),
                        });
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine($"GET_SHELL_CLIPBOARD failed: {ex.Message}");
                        PostMeshIpcResult(idProp, "GET_SHELL_CLIPBOARD_RESULT", new { ok = false, cut = false, paths = Array.Empty<string>(), action = "", error = ex.Message });
                    }
                }
                else if (type == "CLEAR_SHELL_CLIPBOARD")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    bool ok = false;
                    try
                    {
                        ok = Dispatcher.Invoke(() => _shellContextMenuService.TryClearShellClipboard());
                    }
                    catch (Exception ex)
                    {
                        System.Diagnostics.Debug.WriteLine($"CLEAR_SHELL_CLIPBOARD failed: {ex.Message}");
                    }
                    PostMeshIpcResult(idProp, "CLEAR_SHELL_CLIPBOARD_RESULT", new { ok });
                }
                else if (type == "GET_SHARE_MENU_ITEMS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string path = "";
                    try {
                        var payload = root.GetProperty("payload");
                        path = NormalizeFsPath(payload.TryGetProperty("path", out var pathEl) ? pathEl.GetString() ?? "" : "");
                    } catch { }

                    _ = Task.Run(() =>
                    {
                        object? payloadObj = null;
                        try {
                            payloadObj = _shellContextMenuService.GetShareMenuItems(path, _cloudStorageService);
                        } catch (Exception ex) {
                            System.Diagnostics.Debug.WriteLine($"Failed GET_SHARE_MENU_ITEMS: {ex.Message}");
                        }

                        var response = new { type = "SHARE_MENU_ITEMS_RESULT", id = idProp, payload = payloadObj };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        string responseJson = JsonSerializer.Serialize(response, jsonOptions);

                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                        });
                    });
                }
                else if (type == "SYNC_FOLDERS")
                {
                    var payload = root.GetProperty("payload");
                    string source = NormalizeFsPath(payload.GetProperty("source").GetString() ?? "");
                    string target = NormalizeFsPath(payload.GetProperty("target").GetString() ?? "");
                    var idProp = root.TryGetProperty("id", out var idPropEl) ? idPropEl.GetString() : null;
                    string operationId = payload.TryGetProperty("operationId", out var opEl)
                        ? opEl.GetString() ?? $"sync-{DateTime.UtcNow.Ticks}"
                        : $"sync-{DateTime.UtcNow.Ticks}";
                    bool mirrorMode = payload.TryGetProperty("mirrorMode", out var mirrorEl) && mirrorEl.ValueKind == JsonValueKind.True;
                    _ = HandleSyncFoldersAsync(operationId, source, target, idProp, mirrorMode);
                }
                else if (type == "FOLDER_SYNC_GET_JOBS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var jobs = _folderSyncService.GetJobs();
                    var response = new { type = "FOLDER_SYNC_JOBS_RESULT", id = idProp, payload = jobs };
                    MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
                }
                else if (type == "FOLDER_SYNC_SAVE_JOBS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var jobs = JsonSerializer.Deserialize<List<FolderSyncJob>>(payload.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new List<FolderSyncJob>();
                    _folderSyncService.SaveJobs(jobs);
                    var response = new { type = "FOLDER_SYNC_SAVE_RESULT", id = idProp, payload = new { ok = true } };
                    MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
                }
                else if (type == "FOLDER_SYNC_RUN")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var jobId = root.GetProperty("payload").GetProperty("jobId").GetString() ?? "";
                    _ = HandleFolderSyncRunAsync(idProp, jobId);
                }
                else if (type == "FOLDER_SYNC_SET_WATCH")
                {
                    var payload = root.GetProperty("payload");
                    string jobId = payload.GetProperty("jobId").GetString() ?? "";
                    bool enabled = payload.GetProperty("enabled").GetBoolean();
                    _folderSyncService.SetWatch(jobId, enabled);
                }
                else if (type == "FOLDER_SYNC_PREVIEW")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var jobId = root.GetProperty("payload").GetProperty("jobId").GetString() ?? "";
                    var preview = _folderSyncService.PreviewSync(jobId);
                    var response = new { type = "FOLDER_SYNC_PREVIEW_RESULT", id = idProp, payload = preview };
                    MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
                }
                else if (type == "MESH_LIST_HOSTS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    try
                    {
                        var hosts = _meshOrchestrator.ListHosts();
                        PostMeshIpcResult(idProp, "MESH_LIST_HOSTS_RESULT", hosts);
                    }
                    catch (Exception ex)
                    {
                        PostMeshIpcResult(idProp, "MESH_LIST_HOSTS_RESULT", new { error = ex.Message, hosts = Array.Empty<MeshHostRecord>() });
                    }
                }
                else if (type == "MESH_IMPORT_SSH_CONFIG")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var count = _meshOrchestrator.ImportSshConfig();
                            BroadcastMeshHostsChanged();
                            PostMeshIpcResult(idProp, "MESH_IMPORT_SSH_CONFIG_RESULT", new { imported = count, hosts = _meshOrchestrator.ListHosts() });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_IMPORT_SSH_CONFIG_RESULT", new { imported = 0, hosts = _meshOrchestrator.ListHosts(), error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_UPSERT_HOST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    try
                    {
                        var hostJson = root.GetProperty("payload").GetRawText();
                        var host = JsonSerializer.Deserialize<MeshHostRecord>(hostJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
                            ?? throw new InvalidOperationException("Invalid host payload");
                        if (!string.IsNullOrEmpty(host.PasswordPlain))
                            host.ProtectedSecret = MeshCredentialVault.Protect(host.PasswordPlain);
                        host.PasswordPlain = null;
                        var saved = _meshOrchestrator.UpsertHost(host);
                        BroadcastMeshHostsChanged();
                        PostMeshIpcResult(idProp, "MESH_UPSERT_HOST_RESULT", saved);
                    }
                    catch (Exception ex)
                    {
                        PostMeshIpcResult(idProp, "MESH_UPSERT_HOST_RESULT", new { error = ex.Message });
                    }
                }
                else if (type == "MESH_DELETE_HOST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    try
                    {
                        var hostId = root.GetProperty("payload").GetProperty("hostId").GetString() ?? "";
                        _meshOrchestrator.DeleteHost(hostId);
                        BroadcastMeshHostsChanged();
                        PostMeshIpcResult(idProp, "MESH_DELETE_HOST_RESULT", new { ok = true });
                    }
                    catch (Exception ex)
                    {
                        PostMeshIpcResult(idProp, "MESH_DELETE_HOST_RESULT", new { ok = false, error = ex.Message });
                    }
                }
                else if (type == "MESH_CONNECT")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var hostId = root.GetProperty("payload").GetProperty("hostId").GetString() ?? "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await _meshOrchestrator.ConnectAsync(hostId).ConfigureAwait(false);
                            BroadcastMeshHostsChanged();
                            var connected = _meshOrchestrator.GetHost(hostId);
                            if (connected != null)
                                PostMeshIpcResult(idProp, "MESH_CONNECT_RESULT", connected);
                            else
                                PostMeshIpcResult(idProp, "MESH_CONNECT_RESULT", new { error = "Host not found after connect", id = hostId });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_CONNECT_RESULT", new { error = ex.Message, id = hostId });
                        }
                    });
                }
                else if (type == "MESH_DISCONNECT")
                {
                    var hostId = root.GetProperty("payload").GetProperty("hostId").GetString() ?? "";
                    _meshOrchestrator.Disconnect(hostId);
                }
                else if (type == "MESH_SYNC_GET_RULES")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var rules = _meshOrchestrator.Sync.GetRules();
                    var response = new { type = "MESH_SYNC_GET_RULES_RESULT", id = idProp, payload = rules };
                    MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
                }
                else if (type == "MESH_SYNC_SAVE_RULES")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var rulesJson = root.GetProperty("payload").GetRawText();
                    try
                    {
                        var rules = JsonSerializer.Deserialize<List<MeshSyncRuleRecord>>(rulesJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new List<MeshSyncRuleRecord>();
                        _meshOrchestrator.Sync.SaveRules(rules);
                        PostMeshIpcResult(idProp, "MESH_SYNC_SAVE_RULES_RESULT", new { ok = true });
                    }
                    catch (Exception ex)
                    {
                        PostMeshIpcResult(idProp, "MESH_SYNC_SAVE_RULES_RESULT", new { ok = false, error = ex.Message });
                    }
                }
                else if (type == "MESH_SYNC_RUN")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var ruleId = root.GetProperty("payload").GetProperty("ruleId").GetString() ?? "";
                    _ = Task.Run(async () =>
                    {
                        var result = await _meshOrchestrator.Sync.RunRuleAsync(ruleId).ConfigureAwait(false);
                        var response = new { type = "MESH_SYNC_RUN_RESULT", id = idProp, payload = result };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })));
                    });
                }
                else if (type == "MESH_TERMINAL_OPEN")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var hostId = payload.TryGetProperty("hostId", out var hEl) ? hEl.GetString() : null;
                    var cwd = payload.TryGetProperty("cwd", out var cEl) ? cEl.GetString() : null;
                    var local = payload.TryGetProperty("local", out var lEl) && lEl.GetBoolean();
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var session = local || string.IsNullOrEmpty(hostId)
                                ? _meshOrchestrator.Terminal.OpenLocal(cwd)
                                : _meshOrchestrator.Terminal.OpenSsh(hostId!, cwd);
                            PostMeshIpcResult(idProp, "MESH_TERMINAL_OPEN_RESULT", session);
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_TERMINAL_OPEN_RESULT", new { error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_TERMINAL_INPUT")
                {
                    var payload = root.GetProperty("payload");
                    var sessionId = payload.GetProperty("sessionId").GetString() ?? "";
                    var data = payload.GetProperty("data").GetString() ?? "";
                    _meshOrchestrator.Terminal.SendInput(sessionId, data);
                }
                else if (type == "MESH_TERMINAL_CLOSE")
                {
                    var sessionId = root.GetProperty("payload").GetProperty("sessionId").GetString() ?? "";
                    _meshOrchestrator.Terminal.Close(sessionId);
                }
                else if (type == "MESH_TRANSFER")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var operationId = payload.TryGetProperty("operationId", out var opEl) ? opEl.GetString() ?? Guid.NewGuid().ToString("N") : Guid.NewGuid().ToString("N");
                    var direction = payload.TryGetProperty("direction", out var dirEl) ? dirEl.GetString() ?? "upload" : "upload";
                    var hostId = payload.TryGetProperty("hostId", out var hidEl) ? hidEl.GetString() ?? "" : "";
                    var srcHostId = payload.TryGetProperty("srcHostId", out var shEl) ? shEl.GetString() ?? "" : "";
                    var destHostId = payload.TryGetProperty("destHostId", out var dhEl) ? dhEl.GetString() ?? "" : "";
                    var remoteDestDir = payload.TryGetProperty("remoteDestDir", out var rddEl) ? rddEl.GetString() ?? "/" : "/";
                    var localDestDir = payload.TryGetProperty("localDestDir", out var lddEl) ? lddEl.GetString() ?? "" : "";
                    var move = payload.TryGetProperty("move", out var mvEl) && mvEl.GetBoolean();
                    var localPaths = payload.TryGetProperty("localPaths", out var lpEl) && lpEl.ValueKind == JsonValueKind.Array
                        ? lpEl.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToList()
                        : new List<string>();
                    var meshPaths = payload.TryGetProperty("meshPaths", out var mpEl) && mpEl.ValueKind == JsonValueKind.Array
                        ? mpEl.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToList()
                        : new List<string>();

                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            switch (direction.ToLowerInvariant())
                            {
                                case "upload":
                                    await _meshTransferService.UploadAsync(operationId, hostId, localPaths, remoteDestDir).ConfigureAwait(false);
                                    break;
                                case "download":
                                    await _meshTransferService.DownloadAsync(operationId, hostId, meshPaths, localDestDir).ConfigureAwait(false);
                                    break;
                                case "replicate":
                                    await _meshTransferService.ReplicateRemoteAsync(operationId, hostId, meshPaths, remoteDestDir, move).ConfigureAwait(false);
                                    break;
                                case "relay":
                                    await _meshTransferService.RelayAsync(operationId, srcHostId, destHostId, meshPaths, remoteDestDir, move).ConfigureAwait(false);
                                    break;
                                default:
                                    throw new InvalidOperationException($"Unknown mesh transfer direction: {direction}");
                            }
                            PostMeshIpcResult(idProp, "MESH_TRANSFER_RESULT", new { ok = true, operationId });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_TRANSFER_RESULT", new { ok = false, operationId, error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_HYDRATE_PATHS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var paths = root.GetProperty("payload").TryGetProperty("paths", out var pEl) && pEl.ValueKind == JsonValueKind.Array
                        ? pEl.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToList()
                        : new List<string>();
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var localPaths = new List<string>();
                            foreach (var panePath in paths)
                            {
                                localPaths.Add(await _meshOrchestrator.HydrateToCacheAsync(panePath).ConfigureAwait(false));
                            }
                            PostMeshIpcResult(idProp, "MESH_HYDRATE_PATHS_RESULT", new { paths = localPaths });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_HYDRATE_PATHS_RESULT", new { error = ex.Message, paths = Array.Empty<string>() });
                        }
                    });
                }
                else if (type == "MESH_DROP_SET_CONFIG")
                {
                    var payload = root.GetProperty("payload");
                    var stunRaw = payload.TryGetProperty("stunServers", out var stunEl) ? stunEl.GetString() : null;
                    var stunServers = string.IsNullOrWhiteSpace(stunRaw)
                        ? null
                        : stunRaw.Split(new[] { ',', ';', '\n', '\r' }, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
                    var lanDiscovery = !payload.TryGetProperty("lanDiscovery", out var lanEl) || lanEl.GetBoolean();
                    var turnUrl = payload.TryGetProperty("turnUrl", out var turnUrlEl) ? turnUrlEl.GetString() : null;
                    var turnUser = payload.TryGetProperty("turnUsername", out var turnUserEl) ? turnUserEl.GetString() : null;
                    var turnCred = payload.TryGetProperty("turnCredential", out var turnCredEl) ? turnCredEl.GetString() : null;
                    _meshDropService.SetConfig(stunServers, lanDiscovery, turnUrl, turnUser, turnCred);
                }
                else if (type == "MESH_DROP_CREATE_OFFER")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var paths = payload.TryGetProperty("paths", out var pEl) && pEl.ValueKind == JsonValueKind.Array
                        ? pEl.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToList()
                        : new List<string>();
                    var label = payload.TryGetProperty("label", out var lEl) ? lEl.GetString() : null;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var (sessionId, meshCode, session) = await _meshDropService.CreateOfferAsync(paths, label).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "MESH_DROP_CREATE_OFFER_RESULT", new { ok = true, sessionId, meshCode, session = session.ToDto() });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_DROP_CREATE_OFFER_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_DROP_ACCEPT_OFFER")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var meshCode = payload.TryGetProperty("meshCode", out var mcEl) ? mcEl.GetString() ?? "" : "";
                    var destDir = payload.TryGetProperty("destDir", out var ddEl) ? ddEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var (sessionId, answerCode, session) = await _meshDropService.AcceptOfferAsync(meshCode, destDir).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "MESH_DROP_ACCEPT_OFFER_RESULT", new { ok = true, sessionId, answerCode, session = session.ToDto() });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_DROP_ACCEPT_OFFER_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_DROP_CONNECT")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var sessionId = payload.TryGetProperty("sessionId", out var sidEl) ? sidEl.GetString() ?? "" : "";
                    var answerCode = payload.TryGetProperty("answerCode", out var acEl) ? acEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await _meshDropService.ConnectWithAnswerAsync(sessionId, answerCode).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "MESH_DROP_CONNECT_RESULT", new { ok = true, sessionId });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_DROP_CONNECT_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_DROP_SEND")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var sessionId = payload.TryGetProperty("sessionId", out var sidEl) ? sidEl.GetString() ?? "" : "";
                    var operationId = payload.TryGetProperty("operationId", out var opEl) ? opEl.GetString() ?? Guid.NewGuid().ToString("N") : Guid.NewGuid().ToString("N");
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await _meshDropService.SendAsync(sessionId, operationId).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "MESH_DROP_SEND_RESULT", new { ok = true, operationId });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_DROP_SEND_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_DROP_CANCEL")
                {
                    var sessionId = root.GetProperty("payload").TryGetProperty("sessionId", out var sidEl) ? sidEl.GetString() ?? "" : "";
                    _meshDropService.Cancel(sessionId);
                }
                else if (type == "MESH_DROP_LIST_SESSIONS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var sessions = _meshDropService.ListSessions().Select(s => s.ToDto()).ToList();
                    PostMeshIpcResult(idProp, "MESH_DROP_LIST_SESSIONS_RESULT", new { sessions });
                }
                else if (type == "MESH_DROP_DISCOVER_LAN")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var peers = await _meshDropService.DiscoverLanAsync().ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "MESH_DROP_DISCOVER_LAN_RESULT", new { peers });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_DROP_DISCOVER_LAN_RESULT", new { peers = Array.Empty<object>(), error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_DROP_FETCH_LAN_OFFER")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var address = payload.TryGetProperty("address", out var aEl) ? aEl.GetString() ?? "" : "";
                    var port = payload.TryGetProperty("port", out var pEl) ? pEl.GetInt32() : 0;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var meshCode = await _meshDropService.FetchLanOfferAsync(address, port).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "MESH_DROP_FETCH_LAN_OFFER_RESULT", new { ok = meshCode != null, meshCode });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_DROP_FETCH_LAN_OFFER_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_DROP_RELAY_CREATE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var relayUrl = payload.TryGetProperty("relayUrl", out var ruEl) ? ruEl.GetString() ?? "" : "";
                    var meshCode = payload.TryGetProperty("meshCode", out var mcEl) ? mcEl.GetString() ?? "" : "";
                    var label = payload.TryGetProperty("label", out var lEl) ? lEl.GetString() : null;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var room = await _meshDropService.CreateRelayRoomAsync(relayUrl, meshCode, label).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "MESH_DROP_RELAY_CREATE_RESULT", new { ok = room != null, room });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_DROP_RELAY_CREATE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_DROP_RELAY_POLL")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var pollUrl = root.GetProperty("payload").TryGetProperty("pollUrl", out var pEl) ? pEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var answer = await _meshDropService.PollRelayAnswerAsync(pollUrl).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "MESH_DROP_RELAY_POLL_RESULT", new { ok = answer != null, answer });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_DROP_RELAY_POLL_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_DROP_RELAY_SUBMIT_ANSWER")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var relayUrl = payload.TryGetProperty("relayUrl", out var ruEl) ? ruEl.GetString() ?? "" : "";
                    var roomId = payload.TryGetProperty("roomId", out var ridEl) ? ridEl.GetString() ?? "" : "";
                    var answerCode = payload.TryGetProperty("answerCode", out var acEl) ? acEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var ok = await _meshDropService.SubmitRelayAnswerAsync(relayUrl, roomId, answerCode).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "MESH_DROP_RELAY_SUBMIT_ANSWER_RESULT", new { ok });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_DROP_RELAY_SUBMIT_ANSWER_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "MESH_DROP_RELAY_RESOLVE_OFFER")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var relayUrl = payload.TryGetProperty("relayUrl", out var ruEl) ? ruEl.GetString() ?? "" : "";
                    var roomId = payload.TryGetProperty("roomId", out var ridEl) ? ridEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var offer = await _meshDropService.ResolveRelayOfferAsync(relayUrl, roomId).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "MESH_DROP_RELAY_RESOLVE_OFFER_RESULT", new { ok = offer != null, meshCode = offer });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MESH_DROP_RELAY_RESOLVE_OFFER_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "GHOST_LINK_GET_RULES")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var rules = _ghostLinkService.GetRules();
                    PostMeshIpcResult(idProp, "GHOST_LINK_GET_RULES_RESULT", new { rules });
                }
                else if (type == "GHOST_LINK_SAVE_RULES")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var rulesJson = root.GetProperty("payload").GetRawText();
                    var rules = JsonSerializer.Deserialize<List<GhostLinkRule>>(rulesJson, new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new();
                    _ghostLinkService.SaveRules(rules);
                    PostMeshIpcResult(idProp, "GHOST_LINK_SAVE_RULES_RESULT", new { ok = true });
                }
                else if (type == "GHOST_LINK_RUN_SCAN")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var ruleId = root.GetProperty("payload").TryGetProperty("ruleId", out var ridEl) ? ridEl.GetString() : null;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var count = await _ghostLinkService.RunScanAsync(ruleId).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "GHOST_LINK_RUN_SCAN_RESULT", new { ok = true, count });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "GHOST_LINK_RUN_SCAN_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "GHOST_LINK_OFFLOAD_PATHS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var paths = payload.TryGetProperty("paths", out var pEl) && pEl.ValueKind == JsonValueKind.Array
                        ? pEl.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToList()
                        : new List<string>();
                    var coldRoot = payload.TryGetProperty("coldStorageRoot", out var crEl) ? crEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var reclaimed = await _ghostLinkService.OffloadPathsAsync(paths, coldRoot).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "GHOST_LINK_OFFLOAD_PATHS_RESULT", new { ok = true, reclaimed });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "GHOST_LINK_OFFLOAD_PATHS_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "GHOST_LINK_RESTORE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var path = root.GetProperty("payload").TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await _ghostLinkService.RestoreAsync(path).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "GHOST_LINK_RESTORE_RESULT", new { ok = true });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "GHOST_LINK_RESTORE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "GHOST_LINK_GET_STATS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var stats = _ghostLinkService.GetStats();
                            var ghosts = _ghostLinkService.ListGhosts();
                            PostMeshIpcResult(idProp, "GHOST_LINK_GET_STATS_RESULT", new { stats, ghosts });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "GHOST_LINK_GET_STATS_RESULT", new { error = ex.Message, stats = (object?)null, ghosts = Array.Empty<object>() });
                        }
                    });
                }
                else if (type == "RAM_STAGING_LIST_ZONES")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var zones = _ramStagingService.ListZones().Select(z => z.ToDto()).ToList();
                            var status = _ramStagingService.GetStatus();
                            PostMeshIpcResult(idProp, "RAM_STAGING_LIST_ZONES_RESULT", new { zones, status });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "RAM_STAGING_LIST_ZONES_RESULT", new
                            {
                                zones = Array.Empty<object>(),
                                status = new { error = ex.Message },
                                error = ex.Message,
                            });
                        }
                    });
                }
                else if (type == "RAM_STAGING_CREATE_ZONE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var name = payload.TryGetProperty("name", out var nEl) ? nEl.GetString() ?? "Staging Zone" : "Staging Zone";
                    var sizeMb = payload.TryGetProperty("sizeBudgetMb", out var sEl) ? sEl.GetInt64() : 4096L;
                    var preferRam = !payload.TryGetProperty("preferRam", out var prEl) || prEl.GetBoolean();
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var zone = await _ramStagingService.CreateZoneAsync(name, sizeMb, preferRam).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "RAM_STAGING_CREATE_ZONE_RESULT", new { ok = true, zone = zone.ToDto() });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "RAM_STAGING_CREATE_ZONE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "RAM_STAGING_DELETE_ZONE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var zoneId = payload.TryGetProperty("zoneId", out var zEl) ? zEl.GetString() ?? "" : "";
                    var flushFirst = !payload.TryGetProperty("flushFirst", out var ffEl) || ffEl.GetBoolean();
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await _ramStagingService.DeleteZoneAsync(zoneId, flushFirst).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "RAM_STAGING_DELETE_ZONE_RESULT", new { ok = true });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "RAM_STAGING_DELETE_ZONE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "RAM_STAGING_STAGE_PATHS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var zoneId = payload.TryGetProperty("zoneId", out var zEl) ? zEl.GetString() ?? "" : "";
                    var paths = payload.TryGetProperty("paths", out var pEl) && pEl.ValueKind == JsonValueKind.Array
                        ? pEl.EnumerateArray().Select(x => NormalizeFsPath(x.GetString() ?? "")).Where(s => s.Length > 0).ToList()
                        : new List<string>();
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await _ramStagingService.StagePathsAsync(zoneId, paths).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "RAM_STAGING_STAGE_PATHS_RESULT", new { ok = true });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "RAM_STAGING_STAGE_PATHS_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "RAM_STAGING_FLUSH_ZONE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var zoneId = root.GetProperty("payload").TryGetProperty("zoneId", out var zEl) ? zEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await _ramStagingService.FlushZoneAsync(zoneId).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "RAM_STAGING_FLUSH_ZONE_RESULT", new { ok = true });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "RAM_STAGING_FLUSH_ZONE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "RAM_STAGING_INSTALL_IMDISK")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var (ok, error) = await _ramStagingService.InstallImDiskAsync().ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "RAM_STAGING_INSTALL_IMDISK_RESULT", new { ok, error });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "RAM_STAGING_INSTALL_IMDISK_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "RAM_STAGING_INSTALL_AIM")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var (ok, error) = await _ramStagingService.InstallAimAsync().ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "RAM_STAGING_INSTALL_AIM_RESULT", new { ok, error });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "RAM_STAGING_INSTALL_AIM_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "RAM_STAGING_REMOUNT_ZONE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var zoneId = root.GetProperty("payload").TryGetProperty("zoneId", out var zEl) ? zEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var zone = await _ramStagingService.RemountZoneAsync(zoneId).ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "RAM_STAGING_REMOUNT_ZONE_RESULT", new { ok = true, zone = zone.ToDto() });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "RAM_STAGING_REMOUNT_ZONE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Phase 9+ selling-pillar IPC: Sandbox ──
                else if (type == "SANDBOX_START")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var rootPath = payload.TryGetProperty("rootPath", out var rpEl) ? rpEl.GetString() ?? "" : "";
                    var sbName = payload.TryGetProperty("name", out var nEl) ? nEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var session = ProjectSandboxService.Instance.StartSession(rootPath, sbName);
                            PostMeshIpcResult(idProp, "SANDBOX_START_RESULT", new { ok = true, sessionId = session.Id, session });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "SANDBOX_START_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "SANDBOX_GET_ACTIVE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        var active = ProjectSandboxService.Instance.GetActiveSession();
                        PostMeshIpcResult(idProp, "SANDBOX_GET_ACTIVE_RESULT", new { sessions = active != null ? new[] { active } : Array.Empty<SandboxSessionDto>() });
                    });
                }
                else if (type == "SANDBOX_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        PostMeshIpcResult(idProp, "SANDBOX_LIST_RESULT", new { sessions = ProjectSandboxService.Instance.ListSessions() });
                    });
                }
                else if (type == "SANDBOX_COMMIT")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var sessionId = root.GetProperty("payload").TryGetProperty("sessionId", out var sEl) ? sEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = ProjectSandboxService.Instance.Commit(sessionId);
                            PostMeshIpcResult(idProp, "SANDBOX_COMMIT_RESULT", new { ok = result.Ok, error = result.Error, opsProcessed = result.OpsProcessed, details = result.Details });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "SANDBOX_COMMIT_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "SANDBOX_DISCARD")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var sessionId = root.GetProperty("payload").TryGetProperty("sessionId", out var sEl) ? sEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = ProjectSandboxService.Instance.Discard(sessionId);
                            PostMeshIpcResult(idProp, "SANDBOX_DISCARD_RESULT", new { ok = result.Ok, error = result.Error, opsProcessed = result.OpsProcessed, details = result.Details });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "SANDBOX_DISCARD_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "SANDBOX_GET_STATUS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var sessionId = root.GetProperty("payload").TryGetProperty("sessionId", out var sEl) ? sEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var status = ProjectSandboxService.Instance.GetSessionStatus(sessionId);
                            PostMeshIpcResult(idProp, "SANDBOX_GET_STATUS_RESULT", status);
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "SANDBOX_GET_STATUS_RESULT", new { error = ex.Message });
                        }
                    });
                }
                else if (type == "SANDBOX_CHECKPOINT")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var sessionId = payload.TryGetProperty("sessionId", out var sEl) ? sEl.GetString() ?? "" : "";
                    var cpName = payload.TryGetProperty("name", out var cpnEl) ? cpnEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var dto = ProjectSandboxService.Instance.CreateCheckpoint(sessionId, cpName);
                            PostMeshIpcResult(idProp, "SANDBOX_CHECKPOINT_RESULT", new { ok = true, checkpointId = dto.Id, checkpoint = dto });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "SANDBOX_CHECKPOINT_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "SANDBOX_LIST_CHECKPOINTS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var sessionId = root.GetProperty("payload").TryGetProperty("sessionId", out var sEl) ? sEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        PostMeshIpcResult(idProp, "SANDBOX_LIST_CHECKPOINTS_RESULT", new { checkpoints = ProjectSandboxService.Instance.ListCheckpoints(sessionId) });
                    });
                }
                else if (type == "SANDBOX_RESTORE_CHECKPOINT")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var sessionId = payload.TryGetProperty("sessionId", out var sEl) ? sEl.GetString() ?? "" : "";
                    var checkpointId = payload.TryGetProperty("checkpointId", out var cpEl) ? cpEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            ProjectSandboxService.Instance.RestoreCheckpoint(sessionId, checkpointId);
                            PostMeshIpcResult(idProp, "SANDBOX_RESTORE_CHECKPOINT_RESULT", new { ok = true });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "SANDBOX_RESTORE_CHECKPOINT_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Branching Time (content-addressed time machine) ──
                else if (type == "BRANCH_WATCH")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var rootPath = root.GetProperty("payload").TryGetProperty("rootPath", out var rpEl) ? rpEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            BranchingTimeService.Instance.WatchRoot(rootPath);
                            PostMeshIpcResult(idProp, "BRANCH_WATCH_RESULT", new { ok = true, watched = BranchingTimeService.Instance.ListWatchedRoots() });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "BRANCH_WATCH_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "BRANCH_LIST_WATCHED")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        PostMeshIpcResult(idProp, "BRANCH_LIST_WATCHED_RESULT", new { watched = BranchingTimeService.Instance.ListWatchedRoots() });
                    });
                }
                else if (type == "BRANCH_CREATE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var rootPath = payload.TryGetProperty("rootPath", out var rpEl) ? rpEl.GetString() ?? "" : "";
                    var name = payload.TryGetProperty("name", out var nEl) ? nEl.GetString() ?? "" : "";
                    var parentId = payload.TryGetProperty("parentBranchId", out var pEl) ? pEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var branch = BranchingTimeService.Instance.CreateBranch(rootPath, name, parentId);
                            PostMeshIpcResult(idProp, "BRANCH_CREATE_RESULT", new { ok = true, branch });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "BRANCH_CREATE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "BRANCH_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var rootPath = root.GetProperty("payload").TryGetProperty("rootPath", out var rpEl) ? rpEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        PostMeshIpcResult(idProp, "BRANCH_LIST_RESULT", new { branches = BranchingTimeService.Instance.ListBranches(rootPath) });
                    });
                }
                else if (type == "BRANCH_PEEK")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var branchId = root.GetProperty("payload").TryGetProperty("branchId", out var bEl) ? bEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        var peek = BranchingTimeService.Instance.PeekBranch(branchId);
                        PostMeshIpcResult(idProp, "BRANCH_PEEK_RESULT", new { ok = peek != null, peek });
                    });
                }
                else if (type == "BRANCH_RESTORE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var branchId = payload.TryGetProperty("branchId", out var bEl) ? bEl.GetString() ?? "" : "";
                    string[]? relPaths = null;
                    if (payload.TryGetProperty("relPaths", out var pathsEl) && pathsEl.ValueKind == JsonValueKind.Array)
                    {
                        relPaths = pathsEl.EnumerateArray()
                            .Select(e => e.GetString() ?? "")
                            .Where(s => !string.IsNullOrWhiteSpace(s))
                            .ToArray();
                    }
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = BranchingTimeService.Instance.Restore(branchId, relPaths);
                            PostMeshIpcResult(idProp, "BRANCH_RESTORE_RESULT", result);
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "BRANCH_RESTORE_RESULT", new { ok = false, restored = 0, skipped = 0, errors = new[] { ex.Message } });
                        }
                    });
                }
                else if (type == "BRANCH_DELETE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var branchId = root.GetProperty("payload").TryGetProperty("branchId", out var bEl) ? bEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        var ok = BranchingTimeService.Instance.DeleteBranch(branchId);
                        PostMeshIpcResult(idProp, "BRANCH_DELETE_RESULT", new { ok });
                    });
                }
                // ── Drop Magnet Recipes ──
                else if (type == "MAGNET_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        PostMeshIpcResult(idProp, "MAGNET_LIST_RESULT", new { magnets = _dropMagnetService.ListMagnets() });
                    });
                }
                else if (type == "MAGNET_SAVE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var recipe = JsonSerializer.Deserialize<DropMagnetRecipe>(payload.GetRawText(), IpcJsonOptions)
                                ?? throw new InvalidOperationException("Invalid magnet payload.");
                            var saved = _dropMagnetService.SaveMagnet(recipe);
                            PostMeshIpcResult(idProp, "MAGNET_SAVE_RESULT", new { ok = true, magnet = saved });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "MAGNET_SAVE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "MAGNET_DELETE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var magnetId = root.GetProperty("payload").TryGetProperty("id", out var mEl) ? mEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        var ok = _dropMagnetService.DeleteMagnet(magnetId);
                        PostMeshIpcResult(idProp, "MAGNET_DELETE_RESULT", new { ok });
                    });
                }
                else if (type == "MAGNET_APPLY_DROP")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var magnetId = payload.TryGetProperty("magnetId", out var midEl) ? midEl.GetString() ?? "" : "";
                    var action = payload.TryGetProperty("action", out var actEl) ? actEl.GetString() ?? "copy" : "copy";
                    var sources = new List<string>();
                    if (payload.TryGetProperty("paths", out var pathsEl) && pathsEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in pathsEl.EnumerateArray())
                        {
                            var p = el.GetString();
                            if (!string.IsNullOrWhiteSpace(p)) sources.Add(NormalizeFsPath(p));
                        }
                    }
                    var operationId = payload.TryGetProperty("operationId", out var opEl) ? opEl.GetString() ?? Guid.NewGuid().ToString() : Guid.NewGuid().ToString();
                    _ = HandleMagnetApplyDropAsync(operationId, magnetId, sources, action, idProp);
                }
                // ── Temporal Diff Pane ──
                else if (type == "TEMPORAL_DIFF_SNAPSHOT")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var rootPath = root.GetProperty("payload").TryGetProperty("rootPath", out var rpEl) ? rpEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var snapshotId = _temporalDiffService.TakeSnapshot(rootPath);
                            PostMeshIpcResult(idProp, "TEMPORAL_DIFF_SNAPSHOT_RESULT", new { ok = true, snapshotId });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "TEMPORAL_DIFF_SNAPSHOT_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "TEMPORAL_DIFF_COMPARE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var rootPath = payload.TryGetProperty("rootPath", out var rpEl) ? rpEl.GetString() ?? "" : "";
                    var minutesAgo = payload.TryGetProperty("minutesAgo", out var mEl) && mEl.ValueKind == JsonValueKind.Number ? mEl.GetInt32() : 15;
                    var checkpointId = payload.TryGetProperty("checkpointId", out var cpEl) ? cpEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = _temporalDiffService.Compare(rootPath, minutesAgo, checkpointId);
                            PostMeshIpcResult(idProp, "TEMPORAL_DIFF_COMPARE_RESULT", new { ok = true, diff = result });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "TEMPORAL_DIFF_COMPARE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "TEMPORAL_DIFF_LIST_SNAPSHOTS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var rootPath = payload.TryGetProperty("rootPath", out var rpEl) ? rpEl.GetString() ?? "" : "";
                    var limit = payload.TryGetProperty("limit", out var limEl) && limEl.ValueKind == JsonValueKind.Number ? limEl.GetInt32() : 20;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var snapshots = _temporalDiffService.ListSnapshots(rootPath, limit);
                            PostMeshIpcResult(idProp, "TEMPORAL_DIFF_LIST_SNAPSHOTS_RESULT", new { ok = true, snapshots });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "TEMPORAL_DIFF_LIST_SNAPSHOTS_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Phase 9+ selling-pillar IPC: Health ──
                else if (type == "HEALTH_SCAN")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var rootPath = root.GetProperty("payload").TryGetProperty("rootPath", out var rpEl) ? rpEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await LibraryHealthService.Instance.ScanAsync(rootPath, null, CancellationToken.None).ConfigureAwait(false);
                            var count = LibraryHealthService.Instance.ListProblems(rootPath).Count;
                            PostMeshIpcResult(idProp, "HEALTH_SCAN_RESULT", new { ok = true, problemCount = count });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "HEALTH_SCAN_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "HEALTH_LIST_PROBLEMS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var rootPrefix = payload.TryGetProperty("rootPrefix", out var rpEl) ? rpEl.GetString() : null;
                    var hLimit = payload.TryGetProperty("limit", out var limEl) && limEl.ValueKind == JsonValueKind.Number ? limEl.GetInt32() : 500;
                    _ = Task.Run(() =>
                    {
                        PostMeshIpcResult(idProp, "HEALTH_LIST_PROBLEMS_RESULT", new { problems = LibraryHealthService.Instance.ListProblems(rootPrefix, hLimit) });
                    });
                }
                else if (type == "HEALTH_GET_SUMMARY")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        var summary = LibraryHealthService.Instance.GetSummary();
                        PostMeshIpcResult(idProp, "HEALTH_GET_SUMMARY_RESULT", new
                        {
                            total = summary.Total,
                            critical = summary.BySeverity.GetValueOrDefault("error"),
                            warning = summary.BySeverity.GetValueOrDefault("warning"),
                            info = summary.BySeverity.GetValueOrDefault("info"),
                        });
                    });
                }
                else if (type == "HEALTH_CLEAR")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var rootPrefix = root.GetProperty("payload").TryGetProperty("rootPrefix", out var rpEl) ? rpEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        LibraryHealthService.Instance.ClearProblems(rootPrefix);
                        PostMeshIpcResult(idProp, "HEALTH_CLEAR_RESULT", new { ok = true });
                    });
                }
                else if (type == "HEALTH_FIX_PROBLEM")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var problemId = root.GetProperty("payload").TryGetProperty("problemId", out var pEl) ? pEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = LibraryHealthService.Instance.FixProblem(problemId);
                            PostMeshIpcResult(idProp, "HEALTH_FIX_PROBLEM_RESULT", new { ok = result.Ok, action = result.Action, error = result.Error });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "HEALTH_FIX_PROBLEM_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Phase 9+ selling-pillar IPC: Lineage ──
                else if (type == "LINEAGE_GET")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var linPath = payload.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    var depth = payload.TryGetProperty("depth", out var dEl) && dEl.ValueKind == JsonValueKind.Number ? dEl.GetInt32() : 8;
                    _ = Task.Run(() =>
                    {
                        var lineage = FileLineageService.Instance.GetLineage(linPath, depth);
                        lineage.ContentDag = FileLineageService.Instance.GetContentDag(linPath, 4);
                        PostMeshIpcResult(idProp, "LINEAGE_GET_RESULT", lineage);
                    });
                }
                else if (type == "LINEAGE_GET_RECENT")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var linLimit = root.GetProperty("payload").TryGetProperty("limit", out var limEl) && limEl.ValueKind == JsonValueKind.Number ? limEl.GetInt32() : 50;
                    _ = Task.Run(() =>
                    {
                        PostMeshIpcResult(idProp, "LINEAGE_GET_RECENT_RESULT", new { edges = FileLineageService.Instance.GetRecent(linLimit) });
                    });
                }
                else if (type == "LINEAGE_CONTENT_DAG")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var dagPath = payload.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    var dagDepth = payload.TryGetProperty("depth", out var dEl) && dEl.ValueKind == JsonValueKind.Number ? dEl.GetInt32() : 4;
                    _ = Task.Run(() =>
                    {
                        var dag = FileLineageService.Instance.GetContentDag(dagPath, dagDepth);
                        PostMeshIpcResult(idProp, "LINEAGE_CONTENT_DAG_RESULT", dag);
                    });
                }
                else if (type == "LINEAGE_HASH_FILE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var hashPath = payload.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var hash = await FileLineageService.Instance.ComputeContentHashAsync(hashPath).ConfigureAwait(false);
                            if (!string.IsNullOrEmpty(hash))
                            {
                                var size = File.Exists(hashPath) ? new FileInfo(hashPath).Length : 0;
                                FileLineageService.Instance.RecordContentNode(hash, hashPath, size);
                            }
                            PostMeshIpcResult(idProp, "LINEAGE_HASH_FILE_RESULT", new { ok = true, hash = hash ?? "", path = hashPath });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "LINEAGE_HASH_FILE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Phase 9+ selling-pillar IPC: Capacity Solver ──
                else if (type == "CAPACITY_BUILD_PLAN")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var capPath = payload.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    long? targetFreeBytes = payload.TryGetProperty("targetFreeBytes", out var tfEl) && tfEl.ValueKind == JsonValueKind.Number ? tfEl.GetInt64() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var plan = CapacitySolverService.Instance.BuildPlan(capPath, targetFreeBytes);
                            PostMeshIpcResult(idProp, "CAPACITY_BUILD_PLAN_RESULT", new { ok = true, plan });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "CAPACITY_BUILD_PLAN_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "CAPACITY_WHAT_IF")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var capPath = payload.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    long? targetFreeBytes = payload.TryGetProperty("targetFreeBytes", out var tfEl) && tfEl.ValueKind == JsonValueKind.Number ? tfEl.GetInt64() : null;
                    var scrubbers = new WhatIfParams();
                    if (payload.TryGetProperty("scrubbers", out var sEl))
                    {
                        if (sEl.TryGetProperty("keepHotDays", out var kd) && kd.ValueKind == JsonValueKind.Number) scrubbers.KeepHotDays = kd.GetInt32();
                        if (sEl.TryGetProperty("recencyDays", out var rd) && rd.ValueKind == JsonValueKind.Number) scrubbers.RecencyDays = rd.GetInt32();
                        if (sEl.TryGetProperty("minFileSizeMb", out var ms) && ms.ValueKind == JsonValueKind.Number) scrubbers.MinFileSizeMb = ms.GetInt64();
                        if (sEl.TryGetProperty("includeDuplicates", out var id2)) scrubbers.IncludeDuplicates = id2.ValueKind != JsonValueKind.False;
                        if (sEl.TryGetProperty("includeGhostOffload", out var ig)) scrubbers.IncludeGhostOffload = ig.ValueKind != JsonValueKind.False;
                        if (sEl.TryGetProperty("includeArchive", out var ia)) scrubbers.IncludeArchive = ia.ValueKind != JsonValueKind.False;
                        if (sEl.TryGetProperty("includeEmptyDirs", out var ie)) scrubbers.IncludeEmptyDirs = ie.ValueKind != JsonValueKind.False;
                    }
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var projection = CapacitySolverService.Instance.WhatIf(capPath, scrubbers, targetFreeBytes);
                            PostMeshIpcResult(idProp, "CAPACITY_WHAT_IF_RESULT", new { ok = true, projection });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "CAPACITY_WHAT_IF_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "CAPACITY_APPROVE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var capPath = payload.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    var actionIds = new List<string>();
                    if (payload.TryGetProperty("actionIds", out var aEl) && aEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in aEl.EnumerateArray())
                        {
                            var s = item.GetString();
                            if (!string.IsNullOrEmpty(s)) actionIds.Add(s);
                        }
                    }
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = CapacitySolverService.Instance.Approve(capPath, actionIds);
                            PostMeshIpcResult(idProp, "CAPACITY_APPROVE_RESULT", new { ok = result.Ok, result.ActionsDispatched, result.BytesTargeted, result.DispatchedOperationIds, result.Error });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "CAPACITY_APPROVE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "BUDGET_GOVERNOR_GET_POLICIES")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            PostMeshIpcResult(idProp, "BUDGET_GOVERNOR_GET_POLICIES_RESULT", new { ok = true, policies = BudgetGovernorService.Instance.GetPolicies() });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "BUDGET_GOVERNOR_GET_POLICIES_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "BUDGET_GOVERNOR_SET_POLICY")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var volumeRoot = payload.TryGetProperty("volumeRoot", out var vr) ? vr.GetString() ?? "" : "";
                            var enforcement = payload.TryGetProperty("enforcement", out var ef) ? ef.GetString() ?? "off" : "off";
                            long softLimit = payload.TryGetProperty("softLimitBytes", out var sl) && sl.ValueKind == JsonValueKind.Number ? sl.GetInt64() : 0;
                            long hardLimit = payload.TryGetProperty("hardLimitBytes", out var hl) && hl.ValueKind == JsonValueKind.Number ? hl.GetInt64() : 0;
                            bool enabled = !payload.TryGetProperty("enabled", out var en) || en.ValueKind != JsonValueKind.False;

                            var policy = new VolumeQuotaPolicy
                            {
                                VolumeRoot = volumeRoot,
                                Enforcement = enforcement switch
                                {
                                    "soft" => QuotaEnforcement.Soft,
                                    "hard" => QuotaEnforcement.Hard,
                                    _ => QuotaEnforcement.Off,
                                },
                                SoftLimitBytes = softLimit,
                                HardLimitBytes = hardLimit,
                                Enabled = enabled,
                            };
                            BudgetGovernorService.Instance.SetPolicy(policy);
                            PostMeshIpcResult(idProp, "BUDGET_GOVERNOR_SET_POLICY_RESULT", new { ok = true });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "BUDGET_GOVERNOR_SET_POLICY_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "BUDGET_GOVERNOR_REMOVE_POLICY")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var volumeRoot = payload.TryGetProperty("volumeRoot", out var vr) ? vr.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            BudgetGovernorService.Instance.RemovePolicy(volumeRoot);
                            PostMeshIpcResult(idProp, "BUDGET_GOVERNOR_REMOVE_POLICY_RESULT", new { ok = true });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "BUDGET_GOVERNOR_REMOVE_POLICY_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "BUDGET_GOVERNOR_CHECK")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var targetPath = payload.TryGetProperty("targetPath", out var tp) ? tp.GetString() ?? "" : "";
                    long incomingBytes = payload.TryGetProperty("incomingBytes", out var ib) && ib.ValueKind == JsonValueKind.Number ? ib.GetInt64() : 0;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var check = BudgetGovernorService.Instance.CheckTransfer(targetPath, incomingBytes);
                            PostMeshIpcResult(idProp, "BUDGET_GOVERNOR_CHECK_RESULT", new
                            {
                                ok = true,
                                check.Allowed,
                                check.SoftWarning,
                                check.HardBlock,
                                check.Message,
                                check.CurrentUsedBytes,
                                check.AfterUsedBytes,
                                check.SoftLimitBytes,
                                check.HardLimitBytes,
                                check.TotalBytes,
                                check.AfterUsedPct,
                            });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "BUDGET_GOVERNOR_CHECK_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Policy Packs ──
                else if (type == "POLICY_PACK_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            PostMeshIpcResult(idProp, "POLICY_PACK_LIST_RESULT", new { ok = true, packs = PolicyPackService.Instance.ListPacks() });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "POLICY_PACK_LIST_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "POLICY_PACK_SAVE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var pack = JsonSerializer.Deserialize<PolicyPack>(payload.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                            if (pack == null) throw new InvalidOperationException("Invalid pack payload");
                            var saved = PolicyPackService.Instance.SavePack(pack);
                            PostMeshIpcResult(idProp, "POLICY_PACK_SAVE_RESULT", new { ok = true, pack = saved });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "POLICY_PACK_SAVE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "POLICY_PACK_APPLY")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var folder = payload.TryGetProperty("folderPath", out var fp) ? fp.GetString() ?? "" : "";
                    var packId = payload.TryGetProperty("packId", out var pid) ? pid.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            PolicyPackService.Instance.ApplyPackToFolder(folder, packId);
                            PostMeshIpcResult(idProp, "POLICY_PACK_APPLY_RESULT", new { ok = true });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "POLICY_PACK_APPLY_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "POLICY_PACK_VALIDATE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var dest = payload.TryGetProperty("destinationPath", out var dp) ? dp.GetString() ?? "" : "";
                    var sources = new List<string>();
                    if (payload.TryGetProperty("sourcePaths", out var sp) && sp.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in sp.EnumerateArray())
                        {
                            var s = item.GetString();
                            if (!string.IsNullOrEmpty(s)) sources.Add(s);
                        }
                    }
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = PolicyPackService.Instance.ValidateTransfer(dest, sources, _tagSidecarStore);
                            PostMeshIpcResult(idProp, "POLICY_PACK_VALIDATE_RESULT", new
                            {
                                ok = true,
                                allowed = result.Allowed,
                                packId = result.PackId,
                                packName = result.PackName,
                                violations = result.Violations,
                            });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "POLICY_PACK_VALIDATE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Path Healer ──
                else if (type == "PATH_HEALER_SCAN")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var rootPath = payload.TryGetProperty("path", out var rp) ? rp.GetString() ?? "" : "";
                    int max = payload.TryGetProperty("maxResults", out var mr) && mr.ValueKind == JsonValueKind.Number ? mr.GetInt32() : 200;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var issues = PathHealerService.Instance.Scan(rootPath, max);
                            PostMeshIpcResult(idProp, "PATH_HEALER_SCAN_RESULT", new { ok = true, issues });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "PATH_HEALER_SCAN_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "PATH_HEALER_APPLY")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var issueIds = new List<string>();
                    if (payload.TryGetProperty("issueIds", out var ids) && ids.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in ids.EnumerateArray())
                        {
                            var s = item.GetString();
                            if (!string.IsNullOrEmpty(s)) issueIds.Add(s);
                        }
                    }
                    var scanned = new List<PathHealIssue>();
                    if (payload.TryGetProperty("issues", out var iss) && iss.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in iss.EnumerateArray())
                        {
                            try
                            {
                                var issue = JsonSerializer.Deserialize<PathHealIssue>(item.GetRawText(), new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
                                if (issue != null) scanned.Add(issue);
                            }
                            catch { /* skip */ }
                        }
                    }
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = PathHealerService.Instance.Apply(issueIds, scanned);
                            PostMeshIpcResult(idProp, "PATH_HEALER_APPLY_RESULT", new { ok = result.Ok, applied = result.Applied, errors = result.Errors });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "PATH_HEALER_APPLY_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Zero-Knowledge Vault ──
                else if (type == "ZK_VAULT_CREATE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var folder = payload.TryGetProperty("folderPath", out var fp) ? fp.GetString() ?? "" : "";
                    var password = payload.TryGetProperty("password", out var pw) ? pw.GetString() ?? "" : "";
                    var mode = payload.TryGetProperty("mode", out var md) ? md.GetString() ?? "files" : "files";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var vaultId = ZkVaultService.Instance.CreateVault(folder, password, mode);
                            PostMeshIpcResult(idProp, "ZK_VAULT_CREATE_RESULT", new { ok = true, vaultId });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "ZK_VAULT_CREATE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "ZK_VAULT_UNLOCK")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var vaultPath = payload.TryGetProperty("vaultPath", out var vp) ? vp.GetString() ?? "" : "";
                    var password = payload.TryGetProperty("password", out var pw) ? pw.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var session = ZkVaultService.Instance.UnlockVault(vaultPath, password);
                            PostMeshIpcResult(idProp, "ZK_VAULT_UNLOCK_RESULT", new { ok = true, session });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "ZK_VAULT_UNLOCK_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "ZK_VAULT_LOCK")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var vaultId = payload.TryGetProperty("vaultId", out var vid) ? vid.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var ok = ZkVaultService.Instance.LockVault(vaultId);
                            PostMeshIpcResult(idProp, "ZK_VAULT_LOCK_RESULT", new { ok });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "ZK_VAULT_LOCK_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "ZK_VAULT_STATUS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var status = ZkVaultService.Instance.GetStatus();
                            PostMeshIpcResult(idProp, "ZK_VAULT_STATUS_RESULT", new { ok = true, status });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "ZK_VAULT_STATUS_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── ACL Drama ──
                else if (type == "ACL_DRAMA_SNAPSHOT")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var winPath = payload.TryGetProperty("path", out var pp) ? pp.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var snap = AclDramaService.Instance.Snapshot(winPath);
                            PostMeshIpcResult(idProp, "ACL_DRAMA_SNAPSHOT_RESULT", new { ok = true, snapshot = snap });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "ACL_DRAMA_SNAPSHOT_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "ACL_DRAMA_HISTORY")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var winPath = payload.TryGetProperty("path", out var pp) ? pp.GetString() ?? "" : "";
                    int limit = payload.TryGetProperty("limit", out var lim) && lim.ValueKind == JsonValueKind.Number ? lim.GetInt32() : 50;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var history = AclDramaService.Instance.GetHistory(winPath, limit);
                            PostMeshIpcResult(idProp, "ACL_DRAMA_HISTORY_RESULT", new { ok = true, history });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "ACL_DRAMA_HISTORY_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Namespace Portal ──
                else if (type == "NAMESPACE_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            PostMeshIpcResult(idProp, "NAMESPACE_LIST_RESULT", new { ok = true, roots = BndzNamespaceService.Instance.ListRoots() });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "NAMESPACE_LIST_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Shell Verb Forge ──
                else if (type == "VERB_FORGE_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            PostMeshIpcResult(idProp, "VERB_FORGE_LIST_RESULT", new { ok = true, verbs = ShellVerbForgeService.Instance.List() });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "VERB_FORGE_LIST_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "VERB_FORGE_SAVE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var entry = new ShellVerbForgeEntry
                            {
                                Id = payload.TryGetProperty("id", out var idEl2) ? idEl2.GetString() ?? "" : "",
                                Label = payload.TryGetProperty("label", out var lbl) ? lbl.GetString() ?? "" : "",
                                VerbKey = payload.TryGetProperty("verbKey", out var vk) ? vk.GetString() ?? "" : "",
                                TargetClass = payload.TryGetProperty("targetClass", out var tc) ? tc.GetString() ?? "*" : "*",
                                ArgTemplate = payload.TryGetProperty("argTemplate", out var at) ? at.GetString() ?? "--open-path \"%1\"" : "--open-path \"%1\"",
                                Icon = payload.TryGetProperty("icon", out var ic) ? ic.GetString() ?? "" : "",
                                Deployed = payload.TryGetProperty("deployed", out var dp) && dp.ValueKind != JsonValueKind.False,
                            };
                            var saved = ShellVerbForgeService.Instance.Save(entry);
                            PostMeshIpcResult(idProp, "VERB_FORGE_SAVE_RESULT", new { ok = true, verb = saved });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "VERB_FORGE_SAVE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "VERB_FORGE_DEPLOY")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var verbId = root.GetProperty("payload").TryGetProperty("id", out var vid) ? vid.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        var result = ShellVerbForgeService.Instance.Deploy(verbId);
                        PostMeshIpcResult(idProp, "VERB_FORGE_DEPLOY_RESULT", new { ok = result.Ok, message = result.Message });
                    });
                }
                else if (type == "VERB_FORGE_REMOVE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var verbId = payload.TryGetProperty("id", out var vid) ? vid.GetString() ?? "" : "";
                    var undeploy = payload.TryGetProperty("undeploy", out var ud) && ud.ValueKind != JsonValueKind.False;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            if (undeploy)
                                ShellVerbForgeService.Instance.Undeploy(verbId);
                            var removed = ShellVerbForgeService.Instance.Remove(verbId);
                            PostMeshIpcResult(idProp, "VERB_FORGE_REMOVE_RESULT", new { ok = removed });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "VERB_FORGE_REMOVE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Format Transcode Rack ──
                else if (type == "TRANSCODE_ENQUEUE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var paths = new List<string>();
                    if (payload.TryGetProperty("paths", out var pEl) && pEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in pEl.EnumerateArray())
                        {
                            var s = item.GetString();
                            if (!string.IsNullOrEmpty(s)) paths.Add(s);
                        }
                    }
                    var format = payload.TryGetProperty("format", out var fmt) ? fmt.GetString() ?? "jpeg" : "jpeg";
                    var quality = payload.TryGetProperty("quality", out var qEl) && qEl.ValueKind == JsonValueKind.Number ? qEl.GetInt32() : 90;
                    var destFolder = payload.TryGetProperty("destFolder", out var df) ? df.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var ids = TranscodeRackService.Instance.Enqueue(paths, format, quality, destFolder);
                            PostMeshIpcResult(idProp, "TRANSCODE_ENQUEUE_RESULT", new { ok = true, jobIds = ids });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "TRANSCODE_ENQUEUE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "TRANSCODE_STATUS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var status = TranscodeRackService.Instance.GetStatus();
                            PostMeshIpcResult(idProp, "TRANSCODE_STATUS_RESULT", new { ok = true, status });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "TRANSCODE_STATUS_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Semantic Desk ──
                else if (type == "SEMANTIC_DESK_CLUSTER")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var folder = payload.TryGetProperty("folder", out var fEl) ? fEl.GetString() ?? "" : "";
                    var paths = new List<string>();
                    if (payload.TryGetProperty("paths", out var pEl) && pEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in pEl.EnumerateArray())
                        {
                            var s = item.GetString();
                            if (!string.IsNullOrEmpty(s)) paths.Add(s);
                        }
                    }
                    int? desiredK = payload.TryGetProperty("clusterCount", out var kEl) && kEl.ValueKind == JsonValueKind.Number
                        ? kEl.GetInt32()
                        : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            SemanticDeskClusterResult result;
                            if (paths.Count > 0)
                                result = SemanticDeskService.Instance.ClusterPaths(paths, desiredK);
                            else
                                result = SemanticDeskService.Instance.ClusterFolder(folder, desiredK);
                            PostMeshIpcResult(idProp, "SEMANTIC_DESK_CLUSTER_RESULT", new { ok = true, result });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "SEMANTIC_DESK_CLUSTER_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Content DNA ──
                else if (type == "CONTENT_DNA_SCAN")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var folderPath = payload.TryGetProperty("folderPath", out var fpEl) ? fpEl.GetString() ?? "" : "";
                    var includeSub = !payload.TryGetProperty("includeSubfolders", out var subEl) || subEl.ValueKind != JsonValueKind.False;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = ContentDnaService.Instance.ScanFolder(folderPath, includeSub);
                            PostMeshIpcResult(idProp, "CONTENT_DNA_SCAN_RESULT", new { ok = result.Ok, scanned = result.Scanned, folder = result.Folder, error = result.Error });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "CONTENT_DNA_SCAN_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "CONTENT_DNA_FOR_PATH")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var path = payload.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    var maxResults = payload.TryGetProperty("maxResults", out var mEl) && mEl.ValueKind == JsonValueKind.Number ? mEl.GetInt32() : 12;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = ContentDnaService.Instance.GetRelativesForPath(path, maxResults);
                            PostMeshIpcResult(idProp, "CONTENT_DNA_FOR_PATH_RESULT", result);
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "CONTENT_DNA_FOR_PATH_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Twin Volume Chess ──
                else if (type == "TWIN_VOLUME_COMPARE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var leftRoot = payload.TryGetProperty("leftRoot", out var lEl) ? lEl.GetString() ?? "" : "";
                    var rightRoot = payload.TryGetProperty("rightRoot", out var rEl) ? rEl.GetString() ?? "" : "";
                    var useHashing = !payload.TryGetProperty("useHashing", out var hEl) || hEl.ValueKind != JsonValueKind.False;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = TwinVolumeService.Instance.Compare(leftRoot, rightRoot, useHashing);
                            PostMeshIpcResult(idProp, "TWIN_VOLUME_COMPARE_RESULT", result);
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "TWIN_VOLUME_COMPARE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "TWIN_VOLUME_RESOLVE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var leftRoot = payload.TryGetProperty("leftRoot", out var lEl) ? lEl.GetString() ?? "" : "";
                    var rightRoot = payload.TryGetProperty("rightRoot", out var rEl) ? rEl.GetString() ?? "" : "";
                    var relativePath = payload.TryGetProperty("relativePath", out var rpEl) ? rpEl.GetString() ?? "" : "";
                    var direction = payload.TryGetProperty("direction", out var dEl) ? dEl.GetString() ?? "leftToRight" : "leftToRight";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = TwinVolumeService.Instance.Resolve(leftRoot, rightRoot, relativePath, direction);
                            PostMeshIpcResult(idProp, "TWIN_VOLUME_RESOLVE_RESULT", result);
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "TWIN_VOLUME_RESOLVE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Job Tickets ──
                else if (type == "JOB_TICKET_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var folderPath = root.GetProperty("payload").TryGetProperty("folderPath", out var fpEl) ? fpEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var tickets = JobTicketService.Instance.List(string.IsNullOrWhiteSpace(folderPath) ? null : folderPath);
                            PostMeshIpcResult(idProp, "JOB_TICKET_LIST_RESULT", new { ok = true, tickets });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "JOB_TICKET_LIST_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "JOB_TICKET_LIST_OVERDUE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var paths = new List<string>();
                    if (root.GetProperty("payload").TryGetProperty("folderPaths", out var arr) && arr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var item in arr.EnumerateArray())
                        {
                            var s = item.GetString();
                            if (!string.IsNullOrEmpty(s)) paths.Add(s);
                        }
                    }
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var overdueMap = JobTicketService.Instance.GetOverdueMapForFolders(paths);
                            PostMeshIpcResult(idProp, "JOB_TICKET_LIST_OVERDUE_RESULT", new { ok = true, overdueMap });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "JOB_TICKET_LIST_OVERDUE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "JOB_TICKET_SAVE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var ticket = JsonSerializer.Deserialize<JobTicket>(payload.GetRawText(), IpcJsonOptions)
                                ?? throw new InvalidOperationException("Invalid ticket payload.");
                            var saved = JobTicketService.Instance.Save(ticket);
                            PostMeshIpcResult(idProp, "JOB_TICKET_SAVE_RESULT", new { ok = true, ticket = saved });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "JOB_TICKET_SAVE_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "JOB_TICKET_DELETE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var ticketId = root.GetProperty("payload").TryGetProperty("ticketId", out var tEl) ? tEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        var ok = JobTicketService.Instance.Delete(ticketId);
                        PostMeshIpcResult(idProp, "JOB_TICKET_DELETE_RESULT", new { ok });
                    });
                }
                // ── Phase 9+ selling-pillar IPC: Inbound Volume ──
                else if (type == "INBOUND_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        PostMeshIpcResult(idProp, "INBOUND_LIST_RESULT", new
                        {
                            entries = InboundVolumeService.Instance.ListEntries(),
                            watching = InboundVolumeService.Instance.IsWatching,
                        });
                    });
                }
                else if (type == "INBOUND_CAPTURE_NOW")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var entryId = InboundVolumeService.Instance.CaptureClipboardNow();
                            var entry = entryId != null
                                ? InboundVolumeService.Instance.ListEntries().FirstOrDefault(e => e.Id == entryId)
                                : null;
                            PostMeshIpcResult(idProp, "INBOUND_CAPTURE_NOW_RESULT", new { ok = true, entry });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "INBOUND_CAPTURE_NOW_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "INBOUND_START_WATCHING")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        InboundVolumeService.Instance.StartWatching();
                        PostMeshIpcResult(idProp, "INBOUND_START_WATCHING_RESULT", new { ok = true });
                    });
                }
                else if (type == "INBOUND_STOP_WATCHING")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        InboundVolumeService.Instance.StopWatching();
                        PostMeshIpcResult(idProp, "INBOUND_STOP_WATCHING_RESULT", new { ok = true });
                    });
                }
                else if (type == "INBOUND_DELETE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var entryIdVal = root.GetProperty("payload").TryGetProperty("id", out var entEl) ? entEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        InboundVolumeService.Instance.DeleteEntry(entryIdVal);
                        PostMeshIpcResult(idProp, "INBOUND_DELETE_RESULT", new { ok = true });
                    });
                }
                else if (type == "INBOUND_GET_PATHS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var entryIdVal = root.GetProperty("payload").TryGetProperty("id", out var entEl) ? entEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        PostMeshIpcResult(idProp, "INBOUND_GET_PATHS_RESULT", new { paths = InboundVolumeService.Instance.GetEntryPaths(entryIdVal) });
                    });
                }
                else if (type == "INBOUND_GET_ROOT")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var inboundRootPath = InboundVolumeService.Instance.GetInboundRootPath();
                    PostMeshIpcResult(idProp, "INBOUND_GET_ROOT_RESULT", new
                    {
                        path = inboundRootPath,
                        root = inboundRootPath,
                        watching = InboundVolumeService.Instance.IsWatching,
                    });
                }
                else if (type == "INBOUND_COPY_TO_LIBRARY")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var entryIdVal = payload.TryGetProperty("entryId", out var entEl) ? entEl.GetString() ?? "" : "";
                    var destDir = payload.TryGetProperty("destination", out var destEl) ? destEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var result = InboundVolumeService.Instance.CopyToLibrary(entryIdVal, destDir);
                            PostMeshIpcResult(idProp, "INBOUND_COPY_TO_LIBRARY_RESULT", new { ok = result.Ok, copiedCount = result.CopiedCount, failedCount = result.FailedCount, copiedNames = result.CopiedNames, errors = result.Errors, error = result.Error });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "INBOUND_COPY_TO_LIBRARY_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                // ── Capture Inbox (screenshot/clipboard → named PNG via OCR) ──
                else if (type == "CAPTURE_INBOX_STATUS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        var status = CaptureInboxService.Instance.GetStatus();
                        PostMeshIpcResult(idProp, "CAPTURE_INBOX_STATUS_RESULT", new
                        {
                            captureFolder = status.CaptureFolder,
                            watching = status.Watching,
                            captureCount = status.CaptureCount,
                            lastCapture = status.LastCapture,
                        });
                    });
                }
                else if (type == "CAPTURE_FROM_CLIPBOARD")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var entry = CaptureInboxService.Instance.CaptureFromClipboardNow();
                            PostMeshIpcResult(idProp, "CAPTURE_FROM_CLIPBOARD_RESULT", new { ok = entry != null, entry });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "CAPTURE_FROM_CLIPBOARD_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "CAPTURE_INBOX_SET_FOLDER")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var folder = payload.TryGetProperty("folder", out var fEl) ? fEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        var ok = CaptureInboxService.Instance.SetCaptureFolder(folder);
                        PostMeshIpcResult(idProp, "CAPTURE_INBOX_SET_FOLDER_RESULT", new { ok, captureFolder = CaptureInboxService.Instance.GetCaptureFolder() });
                    });
                }
                else if (type == "CAPTURE_INBOX_START_WATCHING")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        CaptureInboxService.Instance.StartWatching();
                        PostMeshIpcResult(idProp, "CAPTURE_INBOX_START_WATCHING_RESULT", new { ok = true });
                    });
                }
                else if (type == "CAPTURE_INBOX_STOP_WATCHING")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        CaptureInboxService.Instance.StopWatching();
                        PostMeshIpcResult(idProp, "CAPTURE_INBOX_STOP_WATCHING_RESULT", new { ok = true });
                    });
                }
                else if (type == "CAPTURE_INBOX_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var limit = payload.TryGetProperty("limit", out var limEl) && limEl.TryGetInt32(out var limVal) ? limVal : 50;
                    _ = Task.Run(() =>
                    {
                        PostMeshIpcResult(idProp, "CAPTURE_INBOX_LIST_RESULT", new
                        {
                            captures = CaptureInboxService.Instance.ListCaptures(limit),
                            watching = CaptureInboxService.Instance.IsWatching,
                            captureFolder = CaptureInboxService.Instance.GetCaptureFolder(),
                        });
                    });
                }
                // ── Reality Check Mode (project refs vs on-disk) ──
                else if (type == "REALITY_CHECK_SCAN")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var rootPath = payload.TryGetProperty("rootPath", out var rpEl) ? rpEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var result = await RealityCheckService.Instance.ScanAsync(rootPath);
                            PostMeshIpcResult(idProp, "REALITY_CHECK_SCAN_RESULT", new
                            {
                                ok = true,
                                rootPath = result.RootPath,
                                projectFileCount = result.ProjectFileCount,
                                totalRefs = result.TotalRefs,
                                missingCount = result.MissingCount,
                                okCount = result.OkCount,
                                scannedUtc = result.ScannedUtc,
                                references = result.References,
                            });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "REALITY_CHECK_SCAN_RESULT", new { ok = false, error = ex.Message });
                        }
                    });
                }
                else if (type == "REALITY_CHECK_SET_ACTIVE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var active = payload.TryGetProperty("active", out var actEl) && actEl.ValueKind == JsonValueKind.True;
                    _ = Task.Run(() =>
                    {
                        RealityCheckService.Instance.SetActive(active);
                        PostMeshIpcResult(idProp, "REALITY_CHECK_SET_ACTIVE_RESULT", new { ok = true, active });
                    });
                }
                else if (type == "REALITY_CHECK_GET_STATE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        var scan = RealityCheckService.Instance.GetLastScan();
                        PostMeshIpcResult(idProp, "REALITY_CHECK_GET_STATE_RESULT", new
                        {
                            active = RealityCheckService.Instance.IsActive,
                            missingPaths = RealityCheckService.Instance.GetMissingPaths(),
                            lastScan = scan,
                        });
                    });
                }
                else if (type == "AI_BATCH_RENAME")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var filenames = payload.TryGetProperty("filenames", out var fnEl) && fnEl.ValueKind == JsonValueKind.Array
                        ? fnEl.EnumerateArray().Select(x => x.GetString() ?? "").Where(s => s.Length > 0).ToList()
                        : new List<string>();
                    var instructions = payload.TryGetProperty("instructions", out var insEl)
                        ? insEl.GetString() ?? ""
                        : "";

                    _ = Task.Run(async () =>
                    {
                        var operations = await GenerateBatchRenameAsync(filenames, instructions);
                        var response = new { type = "AI_BATCH_RENAME_RESULT", id = idProp, payload = operations };
                        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)));
                    });
                }
                else if (type == "AI_GENERATE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var prompt = payload.TryGetProperty("prompt", out var pEl) ? pEl.GetString() ?? "" : "";

                    _ = Task.Run(async () =>
                    {
                        var text = await _aiService.GenerateResponseAsync(prompt);
                        var response = new { type = "AI_GENERATE_RESULT", id = idProp, payload = new { text } };
                        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)));
                    });
                }
                else if (type == "AI_GENERATE_STREAM")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var prompt = payload.TryGetProperty("prompt", out var pEl) ? pEl.GetString() ?? "" : "";
                    var requestId = idProp ?? Guid.NewGuid().ToString("N");

                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            await _aiService.StreamResponseAsync(
                                prompt,
                                chunk =>
                                {
                                    var evt = new { type = "AI_STREAM_CHUNK", requestId, chunk };
                                    PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt)));
                                },
                                CancellationToken.None);
                            var done = new { type = "AI_STREAM_DONE", requestId };
                            PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(done)));
                        }
                        catch (Exception ex)
                        {
                            var err = new { type = "AI_STREAM_ERROR", requestId, error = ex.Message };
                            PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(err)));
                        }
                    });
                }
                else if (type == "AI_MODEL_STATUS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var statusPayload = new
                    {
                        present = _localAi.IsModelPresent,
                        loaded = _localAi.IsLoaded,
                        downloading = _localAi.IsDownloading,
                        progress = _localAi.DownloadProgress,
                        modelName = LocalAiService.ModelDisplayName,
                        sizeLabel = LocalAiService.ModelSizeLabel,
                    };
                    var response = new { type = "AI_MODEL_STATUS_RESULT", id = idProp, payload = statusPayload };
                    var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)));
                }
                else if (type == "AI_DOWNLOAD_MODEL")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(async () =>
                    {
                        var ok = false;
                        try
                        {
                            var progress = new Progress<double>(p =>
                            {
                                var evt = new { type = "AI_DOWNLOAD_PROGRESS", payload = new { percent = p } };
                                var evtJson = JsonSerializer.Serialize(evt, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
                                PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(evtJson));
                            });
                            ok = await _localAi.DownloadModelAsync(progress);
                        }
                        catch { ok = false; }

                        var response = new { type = "AI_DOWNLOAD_MODEL_RESULT", id = idProp, payload = new { ok } };
                        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)));
                    });
                }
                else if (type == "WATCH_DIR")
                {
                    var payload = root.GetProperty("payload");
                    string path = payload.GetProperty("path").GetString() ?? "";
                    if (path.StartsWith("/")) path = path.Substring(1);
                    path = path.Replace("/", "\\");
                    if (path.EndsWith(":") && path.Length == 2) path += "\\";
                    MonitorDirectory(path);
                }
                else if (type == "PERFORM_GLOBAL_SEARCH")
                {
                    var payload = root.GetProperty("payload");
                    string query = payload.GetProperty("query").GetString() ?? "";
                    int limit = payload.TryGetProperty("limit", out var limitEl) && limitEl.ValueKind == JsonValueKind.Number ? limitEl.GetInt32() : 1000;
                    bool useRegex = payload.TryGetProperty("useRegex", out var regexEl) && regexEl.ValueKind == JsonValueKind.True;
                    bool useEverything = !payload.TryGetProperty("useEverything", out var evEl) || evEl.ValueKind != JsonValueKind.False;
                    bool searchContent = payload.TryGetProperty("searchContent", out var scEl) && scEl.ValueKind == JsonValueKind.True;
                    bool booleanMode = payload.TryGetProperty("booleanMode", out var bmEl) && bmEl.ValueKind == JsonValueKind.True;
                    bool preferBndzIndex = !payload.TryGetProperty("preferBndzIndex", out var biEl) || biEl.ValueKind != JsonValueKind.False;
                    string rootPath = payload.TryGetProperty("rootPath", out var rootEl) ? rootEl.GetString() ?? "" : "";
                    var rootPaths = new List<string>();
                    if (payload.TryGetProperty("rootPaths", out var rootsEl) && rootsEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var rp in rootsEl.EnumerateArray())
                        {
                            var s = rp.GetString();
                            if (!string.IsNullOrWhiteSpace(s)) rootPaths.Add(NormalizeFsPath(s));
                        }
                    }
                    if (!string.IsNullOrEmpty(rootPath))
                    {
                        rootPath = NormalizeFsPath(rootPath);
                        if (!rootPaths.Contains(rootPath, StringComparer.OrdinalIgnoreCase))
                            rootPaths.Insert(0, rootPath);
                    }
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;

                    _ = Task.Run(() => 
                    {
                        var searchSvc = new EverythingSearchService();
                        var (results, engine) = rootPaths.Count > 1 || booleanMode
                            ? searchSvc.SearchAdvanced(query, limit, useRegex, rootPaths, useEverything, searchContent, booleanMode, preferBndzIndex)
                            : searchSvc.Search(query, limit, useRegex, rootPath, useEverything, searchContent, preferBndzIndex);

                        var enrichedResults = BndzTagSidecarStore.EnrichDirResults(results, _tagSidecarStore);
                        var response = new { type = "GLOBAL_SEARCH_RESULT", id = idProp, payload = new { items = enrichedResults, engine } };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        string responseJson = JsonSerializer.Serialize(response, jsonOptions);

                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                        });
                    });
                }
                else if (type == "GET_THUMBNAIL")
                {
                    var payload = root.GetProperty("payload");
                    string path = payload.GetProperty("path").GetString() ?? "";
                    path = ShellPathResolver.ResolveForShell(path);
                    if (string.IsNullOrEmpty(path))
                    {
                        path = payload.GetProperty("path").GetString() ?? "";
                        if (path.StartsWith("/")) path = path.Substring(1);
                        path = path.Replace("/", "\\");
                        if (path.EndsWith(":") && path.Length == 2) path += "\\";
                    }
                    int thumbSize = 256;
                    if (payload.TryGetProperty("size", out var sizeEl) && sizeEl.ValueKind == JsonValueKind.Number)
                        thumbSize = sizeEl.GetInt32();
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var pathCopy = path;
                    var sizeCopy = thumbSize;

                    _ = Task.Run(async () =>
                    {
                        var ran = await BndzIpcWorkQueue.TryRunThumbnailAsync(() =>
                        {
                            string? base64 = null;
                            try
                            {
                                var nativeSvc = _nativeShellService;
                                base64 = BndzHostCaches.ResolveThumbnailBase64(
                                    pathCopy,
                                    sizeCopy,
                                    () => nativeSvc.GetNativeThumbnailBase64(pathCopy, sizeCopy) ?? "");
                            }
                            catch (Exception ex)
                            {
                                System.Diagnostics.Debug.WriteLine($"GET_THUMBNAIL failed for {pathCopy}: {ex.Message}");
                            }
                            PostThumbnailResult(idProp, string.IsNullOrEmpty(base64) ? null : base64);
                            return Task.CompletedTask;
                        }).ConfigureAwait(false);
                        if (!ran)
                            PostThumbnailResult(idProp, null);
                    });
                }
                else if (type == "GET_THUMBNAILS_BATCH")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var results = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
                    int thumbSize = 96;
                    List<string> paths = new();
                    try
                    {
                        var payload = root.GetProperty("payload");
                        if (payload.TryGetProperty("size", out var sizeEl) && sizeEl.ValueKind == JsonValueKind.Number)
                            thumbSize = sizeEl.GetInt32();
                        if (payload.TryGetProperty("paths", out var pathsEl) && pathsEl.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var p in pathsEl.EnumerateArray())
                            {
                                var raw = p.GetString() ?? "";
                                if (string.IsNullOrWhiteSpace(raw)) continue;
                                var resolved = ShellPathResolver.ResolveForShell(raw);
                                if (string.IsNullOrEmpty(resolved))
                                {
                                    resolved = raw.StartsWith("/") ? raw.Substring(1).Replace("/", "\\") : raw.Replace("/", "\\");
                                }
                                paths.Add(resolved);
                            }
                        }
                    }
                    catch { }

                    var pathsCopy = paths;
                    var sizeCopy = thumbSize;

                    _ = Task.Run(async () =>
                    {
                        var ran = await BndzIpcWorkQueue.TryRunThumbnailAsync(() =>
                        {
                            var nativeSvc = _nativeShellService;
                            foreach (var path in pathsCopy)
                            {
                                try
                                {
                                    var b64 = BndzHostCaches.ResolveThumbnailBase64(
                                        path,
                                        sizeCopy,
                                        () => nativeSvc.GetNativeThumbnailBase64(path, sizeCopy) ?? "");
                                    results[path] = string.IsNullOrEmpty(b64) ? null : b64;
                                }
                                catch
                                {
                                    results[path] = null;
                                }
                            }

                            var response = new { type = "THUMBNAILS_BATCH_RESULT", id = idProp, payload = results };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            string responseJson = JsonSerializer.Serialize(response, jsonOptions);
                            PostToUi(() =>
                            {
                                try { MainWebView.CoreWebView2?.PostWebMessageAsJson(responseJson); }
                                catch { }
                            });
                            return Task.CompletedTask;
                        }, waitMs: 8000).ConfigureAwait(false);

                        if (!ran)
                        {
                            var response = new { type = "THUMBNAILS_BATCH_RESULT", id = idProp, payload = results };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            string responseJson = JsonSerializer.Serialize(response, jsonOptions);
                            PostToUi(() =>
                            {
                                try { MainWebView.CoreWebView2?.PostWebMessageAsJson(responseJson); }
                                catch { }
                            });
                        }
                    });
                }
                else if (type == "GET_EXTENDED_METADATA")
                {
                    var payload = root.GetProperty("payload");
                    string path = payload.GetProperty("path").GetString() ?? "";
                    if (path.StartsWith("/")) path = path.Substring(1);
                    path = path.Replace("/", "\\");
                    if (path.EndsWith(":") && path.Length == 2) path += "\\";
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var pathCopy = path;

                    _ = Task.Run(async () =>
                    {
                        var ran = await BndzIpcWorkQueue.TryRunMetadataAsync(() =>
                        {
                            Dictionary<string, string> meta;
                            try
                            {
                                var nativeSvc = new NativeShellService();
                                meta = nativeSvc.GetExtendedMetadata(pathCopy);
                                EnrichMetadataWithAcl(pathCopy, meta);
                            }
                            catch (Exception ex)
                            {
                                System.Diagnostics.Debug.WriteLine($"GET_EXTENDED_METADATA failed for {pathCopy}: {ex.Message}");
                                meta = new Dictionary<string, string> { ["error"] = ex.Message };
                            }
                            PostExtendedMetadataResult(idProp, meta);
                            return Task.CompletedTask;
                        }, waitMs: 12000).ConfigureAwait(false);
                        if (!ran)
                            PostExtendedMetadataResult(idProp, new Dictionary<string, string> { ["_busy"] = "true" });
                    });
                }
                else if (type == "GET_EXTENDED_METADATA_BATCH")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var paths = new List<string>();
                    var max = 64;
                    try
                    {
                        var payload = root.GetProperty("payload");
                        if (payload.TryGetProperty("max", out var maxEl) && maxEl.ValueKind == JsonValueKind.Number)
                            max = Math.Clamp(maxEl.GetInt32(), 1, 64);
                        if (payload.TryGetProperty("paths", out var pathsEl) && pathsEl.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var p in pathsEl.EnumerateArray())
                            {
                                var raw = p.GetString() ?? "";
                                if (string.IsNullOrWhiteSpace(raw)) continue;
                                paths.Add(NormalizeFsPath(raw));
                            }
                        }
                    }
                    catch { }

                    var pathsCopy = paths;
                    var maxCopy = max;
                    _ = Task.Run(async () =>
                    {
                        var ran = await BndzIpcWorkQueue.TryRunMetadataAsync(() =>
                        {
                            Dictionary<string, Dictionary<string, string>> results;
                            try
                            {
                                var nativeSvc = new NativeShellService();
                                results = nativeSvc.GetExtendedMetadataBatch(pathsCopy, maxCopy);
                                foreach (var kv in results)
                                {
                                    try { EnrichMetadataWithAcl(kv.Key, kv.Value); }
                                    catch { }
                                }
                            }
                            catch (Exception ex)
                            {
                                System.Diagnostics.Debug.WriteLine($"GET_EXTENDED_METADATA_BATCH failed: {ex.Message}");
                                results = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
                            }
                            PostExtendedMetadataBatchResult(idProp, new { results });
                            return Task.CompletedTask;
                        }, waitMs: 60000).ConfigureAwait(false);
                        if (!ran)
                            PostExtendedMetadataBatchResult(idProp, new { results = new Dictionary<string, Dictionary<string, string>>() });
                    });
                }
                else if (type == "WRITE_MEDIA_TAGS")
                {
                    var payload = root.GetProperty("payload");
                    string path = NormalizeFsPath(payload.GetProperty("path").GetString() ?? "");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var fields = new Dictionary<string, string?>();
                    if (payload.TryGetProperty("fields", out var fieldsEl) && fieldsEl.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var prop in fieldsEl.EnumerateObject())
                            fields[prop.Name] = prop.Value.ValueKind == JsonValueKind.Null ? null : prop.Value.GetString();
                    }

                    _ = Task.Run(() =>
                    {
                        var (ok, error) = MediaTagMetadataService.TryWriteTags(path, fields);
                        var response = new { type = "WRITE_MEDIA_TAGS_RESULT", id = idProp, payload = new { ok, error } };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "GET_PERF_STATS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        var payload = BndzHostCaches.GetPerfSnapshot();
                        var response = new { type = "PERF_STATS_RESULT", id = idProp, payload };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "GET_MEDIA_BLOB")
                {
                    var payload = root.GetProperty("payload");
                    string rawPath = payload.GetProperty("path").GetString() ?? "";
                    string path = MeshPath.IsMeshPath(rawPath) ? rawPath : NormalizeFsPath(rawPath);
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    long maxBytes = payload.TryGetProperty("maxBytes", out var maxEl) ? maxEl.GetInt64() : 48L * 1024 * 1024;

                    _ = Task.Run(() =>
                    {
                        object resultPayload;
                        try
                        {
                            if (MeshPath.IsMeshPath(path))
                            {
                                path = _meshOrchestrator.HydrateToCacheAsync(path).GetAwaiter().GetResult();
                            }
                            if (!File.Exists(path))
                            {
                                resultPayload = new { error = "File not found", mime = LocalStreamService.GetContentType(path) };
                            }
                            else
                            {
                                var fi = new FileInfo(path);
                                if (fi.Length > maxBytes)
                                {
                                    resultPayload = new { error = "File too large for blob fallback", mime = LocalStreamService.GetContentType(path), size = fi.Length };
                                }
                                else
                                {
                                    byte[] bytes = File.ReadAllBytes(path);
                                    string mime = LocalStreamService.GetContentType(path);
                                    resultPayload = new { base64 = Convert.ToBase64String(bytes), mime, size = fi.Length };
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            resultPayload = new { error = ex.Message };
                        }

                        var response = new { type = "GET_MEDIA_BLOB_RESULT", id = idProp, payload = resultPayload };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        string responseJson = JsonSerializer.Serialize(response, jsonOptions);
                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                        });
                    });
                }
                else if (type == "GET_ASYNC_HASHES")
                {
                    var payload = root.GetProperty("payload");
                    string path = payload.GetProperty("path").GetString() ?? "";
                    if (path.StartsWith("/")) path = path.Substring(1);
                    path = path.Replace("/", "\\");
                    if (path.EndsWith(":") && path.Length == 2) path += "\\";
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;

                    _ = Task.Run(() => 
                    {
                        var hashes = new Dictionary<string, string>();
                        try {
                            if (File.Exists(path)) {
                                using (var md5 = System.Security.Cryptography.MD5.Create())
                                using (var stream = File.OpenRead(path))
                                {
                                    hashes["md5"] = BitConverter.ToString(md5.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                                }
                                using (var sha256 = System.Security.Cryptography.SHA256.Create())
                                using (var stream = File.OpenRead(path))
                                {
                                    hashes["sha256"] = BitConverter.ToString(sha256.ComputeHash(stream)).Replace("-", "").ToLowerInvariant();
                                }
                            }
                        } catch {}

                        var response = new { type = "ASYNC_HASHES_RESULT", id = idProp, payload = hashes };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        string responseJson = JsonSerializer.Serialize(response, jsonOptions);

                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                        });
                    });
                }
                else if (type == "GET_LENS_STAGE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string lensPath = "";
                    if (root.TryGetProperty("payload", out var lensPayload) && lensPayload.TryGetProperty("path", out var lpEl))
                        lensPath = lpEl.GetString() ?? "";

                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var stage = await BndzLensService.Instance.BuildLensStageAsync(lensPath).ConfigureAwait(false);
                            var response = new { type = "LENS_STAGE_RESULT", id = idProp, payload = stage };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                        }
                        catch (Exception ex)
                        {
                            var response = new { type = "LENS_STAGE_RESULT", id = idProp, payload = new { error = ex.Message } };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                        }
                    });
                }
                else if (type == "OPEN_PATH_IN_NEW_WINDOW")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string openPath = "";
                    if (root.TryGetProperty("payload", out var openPayload) && openPayload.TryGetProperty("path", out var opEl))
                        openPath = opEl.GetString() ?? "";
                    var winPath = NormalizeFsPath(openPath);
                    var ok = false;
                    var error = (string?)null;
                    try
                    {
                        if (string.IsNullOrWhiteSpace(winPath))
                            error = "Missing path.";
                        else
                        {
                            // Stage Workspaces: always spawn a new process for a true second stage.
                            var exe = Environment.ProcessPath
                                ?? System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName;
                            if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe))
                            {
                                error = "Could not resolve BNDZ executable for a Stage window.";
                            }
                            else
                            {
                                var args = $"--stage-window --open-path \"{winPath.Replace("\"", "\\\"")}\"";
                                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                                {
                                    FileName = exe,
                                    Arguments = args,
                                    WorkingDirectory = Path.GetDirectoryName(exe) ?? "",
                                    UseShellExecute = true,
                                });
                                ok = true;
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        error = ex.Message;
                    }
                    var response = new { type = "OPEN_PATH_IN_NEW_WINDOW_RESULT", id = idProp, payload = new { ok, error } };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
                else if (type == "OPEN_PLUGIN_WINDOW")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string pluginId = "";
                    string? stickyId = null;
                    string? title = null;
                    if (root.TryGetProperty("payload", out var pluginPayload) && pluginPayload.ValueKind == JsonValueKind.Object)
                    {
                        if (pluginPayload.TryGetProperty("pluginId", out var pidEl))
                            pluginId = pidEl.GetString() ?? "";
                        if (pluginPayload.TryGetProperty("stickyId", out var sidEl))
                            stickyId = sidEl.GetString();
                        if (pluginPayload.TryGetProperty("title", out var titleEl))
                            title = titleEl.GetString();
                    }
                    var ok = false;
                    var error = (string?)null;
                    try
                    {
                        if (string.IsNullOrWhiteSpace(pluginId))
                            error = "Missing pluginId.";
                        else
                        {
                            var exe = Environment.ProcessPath
                                ?? System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName;
                            if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe))
                            {
                                error = "Could not resolve BNDZ executable for a plugin window.";
                            }
                            else
                            {
                                var args = $"--plugin-window \"{pluginId.Replace("\"", "\\\"")}\"";
                                if (!string.IsNullOrWhiteSpace(stickyId))
                                    args += $" --sticky-id \"{stickyId.Replace("\"", "\\\"")}\"";
                                if (!string.IsNullOrWhiteSpace(title))
                                    args += $" --plugin-title \"{title.Replace("\"", "\\\"")}\"";
                                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                                {
                                    FileName = exe,
                                    Arguments = args,
                                    WorkingDirectory = Path.GetDirectoryName(exe) ?? "",
                                    UseShellExecute = true,
                                });
                                ok = true;
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        error = ex.Message;
                    }
                    var response = new { type = "OPEN_PLUGIN_WINDOW_RESULT", id = idProp, payload = new { ok, error } };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
                else if (type == "GET_ARCHIVE_CONTENTS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string path = NormalizeFsPath(payload.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "");
                    int limit = payload.TryGetProperty("limit", out var limEl) ? limEl.GetInt32() : 5000;

                    _ = Task.Run(() =>
                    {
                        var result = _archiveService.ListContents(path, limit);
                        var response = new { type = "ARCHIVE_CONTENTS_RESULT", id = idProp, payload = result };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "GET_TORRENT_INFO")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string path = NormalizeFsPath(payload.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "");

                    _ = Task.Run(() =>
                    {
                        var result = _torrentParserService.Parse(path);
                        var response = new { type = "TORRENT_INFO_RESULT", id = idProp, payload = result };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "SCAN_FOLDER_SIZES")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    bool forceRescan = payload.TryGetProperty("forceRescan", out var forceEl) && forceEl.GetBoolean();
                    var paths = new List<string>();
                    if (payload.TryGetProperty("paths", out var pathsEl))
                    {
                        foreach (var el in pathsEl.EnumerateArray())
                            paths.Add(NormalizeFsPath(el.GetString() ?? ""));
                    }

                    _ = Task.Run(async () =>
                    {
                        object resultPayload;
                        try
                        {
                            var scanResult = await _folderSizeService.ScanFoldersAsync(paths, forceRescan, prog =>
                            {
                                var evt = new { type = "FOLDER_SIZE_PROGRESS", payload = prog };
                                var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                                PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(evt, jsonOpts)));
                            });
                            resultPayload = scanResult;
                        }
                        catch (OperationCanceledException)
                        {
                            resultPayload = new FolderSizeResult { Cancelled = true };
                        }
                        catch (Exception ex)
                        {
                            resultPayload = new { error = ex.Message, sizes = new Dictionary<string, long>(), cancelled = false };
                        }

                        var response = new { type = "FOLDER_SIZE_RESULT", id = idProp, payload = resultPayload };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "CANCEL_FOLDER_SIZE_SCAN")
                {
                    _folderSizeService.CancelScan();
                }
                else if (type == "SHOW_NATIVE_NOTIFICATION")
                {
                    var payload = root.GetProperty("payload");
                    string title = payload.TryGetProperty("title", out var titleEl) ? titleEl.GetString() ?? "BNDZ" : "BNDZ";
                    string message = payload.TryGetProperty("message", out var msgEl) ? msgEl.GetString() ?? "" : "";
                    string? tag = payload.TryGetProperty("tag", out var tagEl) ? tagEl.GetString() : null;
                    _ = Task.Run(() => WindowsToastService.Show(title, message, tag));
                }
                else if (type == "SCAN_DUPLICATES")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string rootPath = payload.TryGetProperty("rootPath", out var rootEl) ? NormalizeFsPath(rootEl.GetString() ?? "") : "";
                    bool recursive = !payload.TryGetProperty("recursive", out var recEl) || recEl.GetBoolean();
                    long minSize = payload.TryGetProperty("minSizeBytes", out var minEl) && minEl.TryGetInt64(out var ms) ? ms : 1024;

                    _ = Task.Run(async () =>
                    {
                        object resultPayload;
                        try
                        {
                            var scanResult = await _duplicateFinderService.ScanAsync(rootPath, recursive, minSize, p =>
                            {
                                var progressEvt = new
                                {
                                    type = "DUPLICATE_SCAN_PROGRESS",
                                    payload = new
                                    {
                                        filesScanned = p.FilesScanned,
                                        totalFiles = p.TotalFiles,
                                        currentPath = p.CurrentPath,
                                        percent = p.Percent,
                                    },
                                };
                                var progressJson = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                                PostToUi(() =>
                                    MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(progressEvt, progressJson)));
                            });
                            resultPayload = scanResult;
                        }
                        catch (OperationCanceledException)
                        {
                            resultPayload = new DuplicateScanResult { Cancelled = true };
                        }
                        catch (Exception ex)
                        {
                            resultPayload = new { error = ex.Message, groups = new List<DuplicateGroup>(), cancelled = false };
                        }

                        var response = new { type = "DUPLICATE_SCAN_RESULT", id = idProp, payload = resultPayload };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "CANCEL_DUPLICATE_SCAN")
                {
                    _duplicateFinderService.CancelScan();
                }
                else if (type == "STORAGE_CLEANUP_SCAN")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var categoryIds = new List<string>();
                    if (payload.TryGetProperty("categoryIds", out var catEl) && catEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var c in catEl.EnumerateArray())
                        {
                            var s = c.GetString();
                            if (!string.IsNullOrWhiteSpace(s)) categoryIds.Add(s);
                        }
                    }
                    long largeMin = payload.TryGetProperty("largeFileMinBytes", out var lminEl) && lminEl.TryGetInt64(out var lmin) ? lmin : 100L * 1024 * 1024;
                    int largeLimit = payload.TryGetProperty("largeFileLimit", out var llimEl) && llimEl.TryGetInt32(out var llim) ? llim : 200;

                    _ = Task.Run(async () =>
                    {
                        object resultPayload;
                        try
                        {
                            var scanResult = await _storageCleanupScanService.ScanAsync(
                                categoryIds.Count > 0 ? categoryIds.ToArray() : null,
                                largeMin,
                                largeLimit,
                                p =>
                                {
                                    var progressEvt = new
                                    {
                                        type = "STORAGE_CLEANUP_SCAN_PROGRESS",
                                        payload = new { percent = p.Percent, phase = p.Phase, currentPath = p.CurrentPath },
                                    };
                                    var progressJson = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                                    PostToUi(() =>
                                        MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(progressEvt, progressJson)));
                                });
                            resultPayload = scanResult;
                        }
                        catch (OperationCanceledException)
                        {
                            resultPayload = new CleanupScanResult { Cancelled = true };
                        }
                        catch (Exception ex)
                        {
                            resultPayload = new { error = ex.Message, categories = new List<CleanupScanCategory>(), cancelled = false };
                        }

                        var response = new { type = "STORAGE_CLEANUP_SCAN_RESULT", id = idProp, payload = resultPayload };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "CANCEL_STORAGE_CLEANUP_SCAN")
                {
                    _storageCleanupScanService.CancelScan();
                }
                else if (type == "STORAGE_CLEANUP_EXECUTE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var items = new List<StorageCleanupScanService.CleanupExecuteItem>();
                    if (payload.TryGetProperty("items", out var itemsEl) && itemsEl.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var el in itemsEl.EnumerateArray())
                        {
                            items.Add(new StorageCleanupScanService.CleanupExecuteItem
                            {
                                CategoryId = el.TryGetProperty("categoryId", out var cid) ? cid.GetString() ?? "" : "",
                                Path = el.TryGetProperty("path", out var p) ? NormalizeFsPath(p.GetString() ?? "") : "",
                                IsDirectory = el.TryGetProperty("isDirectory", out var d) && d.GetBoolean(),
                                Size = el.TryGetProperty("size", out var sz) && sz.TryGetInt64(out var s) ? s : 0,
                            });
                        }
                    }

                    _ = Task.Run(async () =>
                    {
                        object resultPayload;
                        try
                        {
                            var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                            var exec = await StorageCleanupScanService.ExecuteCleanupAsync(items, hwnd);
                            resultPayload = exec;
                        }
                        catch (Exception ex)
                        {
                            resultPayload = new { processedCount = 0, freedBytes = 0L, errors = new[] { ex.Message } };
                        }

                        var response = new { type = "STORAGE_CLEANUP_EXECUTE_RESULT", id = idProp, payload = resultPayload };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "LIST_INSTALLED_APPS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    bool includeSystem = payload.TryGetProperty("includeSystemComponents", out var incEl) && incEl.GetBoolean();
                    _ = Task.Run(() =>
                    {
                        object resultPayload;
                        try
                        {
                            resultPayload = InstalledAppsService.ListApps(includeSystem);
                        }
                        catch (Exception ex)
                        {
                            resultPayload = new { apps = new List<InstalledAppEntry>(), totalCount = 0, error = ex.Message };
                        }
                        var response = new { type = "LIST_INSTALLED_APPS_RESULT", id = idProp, payload = resultPayload };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "UNINSTALL_APP")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string appId = payload.TryGetProperty("appId", out var aid) ? aid.GetString() ?? "" : "";
                    bool quiet = payload.TryGetProperty("quiet", out var qel) && qel.GetBoolean();
                    _ = Task.Run(() =>
                    {
                        var resultPayload = InstalledAppsService.Uninstall(appId, quiet);
                        var response = new { type = "UNINSTALL_APP_RESULT", id = idProp, payload = resultPayload };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "ARCHIVE_ADD_FILES")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string archivePath = NormalizeFsPath(payload.GetProperty("archivePath").GetString() ?? "");
                    var sources = new List<string>();
                    foreach (var el in payload.GetProperty("files").EnumerateArray())
                        sources.Add(NormalizeFsPath(el.GetString() ?? ""));
                    List<string>? entryNames = null;
                    if (payload.TryGetProperty("entryNames", out var namesEl) && namesEl.ValueKind == JsonValueKind.Array)
                    {
                        entryNames = new List<string>();
                        foreach (var el in namesEl.EnumerateArray())
                            entryNames.Add(el.GetString() ?? "");
                    }

                    _ = HandleArchiveAddFilesAsync(idProp, archivePath, sources, entryNames);
                }
                else if (type == "ARCHIVE_EXTRACT_ENTRY")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string archivePath = NormalizeFsPath(payload.GetProperty("archivePath").GetString() ?? "");
                    string entryPath = payload.GetProperty("entryPath").GetString() ?? "";
                    string destination = NormalizeFsPath(payload.GetProperty("destination").GetString() ?? "");

                    _ = HandleArchiveExtractEntryAsync(idProp, archivePath, entryPath, destination);
                }
                else if (type == "ARCHIVE_EXTRACT_ENTRY_TEMP")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string archivePath = NormalizeFsPath(payload.GetProperty("archivePath").GetString() ?? "");
                    string entryPath = payload.GetProperty("entryPath").GetString() ?? "";

                    _ = Task.Run(() =>
                    {
                        object resultPayload;
                        try
                        {
                            var extracted = _archiveService.ExtractEntryToTemp(archivePath, entryPath);
                            resultPayload = new { success = true, path = extracted };
                        }
                        catch (Exception ex)
                        {
                            resultPayload = new { success = false, error = ex.Message };
                        }
                        var response = new { type = "ARCHIVE_EXTRACT_ENTRY_TEMP_RESULT", id = idProp, payload = resultPayload };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "CREATE_ARCHIVE")
                {
                    var payload = root.GetProperty("payload");
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    string operationId = payload.TryGetProperty("operationId", out var opEl) ? opEl.GetString() ?? Guid.NewGuid().ToString() : Guid.NewGuid().ToString();
                    string target = NormalizeFsPath(payload.GetProperty("target").GetString() ?? "");
                    string format = payload.TryGetProperty("format", out var fmtEl) ? fmtEl.GetString() ?? "zip" : "zip";
                    var sources = new List<string>();
                    foreach (var el in payload.GetProperty("sources").EnumerateArray())
                        sources.Add(NormalizeFsPath(el.GetString() ?? ""));
                    _ = HandleCreateArchiveAsync(operationId, sources, target, format, idProp);
                }
                else if (type == "EXTRACT_ARCHIVE")
                {
                    var payload = root.GetProperty("payload");
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    string operationId = payload.TryGetProperty("operationId", out var opEl) ? opEl.GetString() ?? Guid.NewGuid().ToString() : Guid.NewGuid().ToString();
                    string archivePath = NormalizeFsPath(payload.GetProperty("path").GetString() ?? "");
                    string dest = NormalizeFsPath(payload.GetProperty("destination").GetString() ?? "");
                    _ = HandleExtractArchiveAsync(operationId, archivePath, dest, idProp);
                }
                else if (type == "CREATE_LINK")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string linkPath = NormalizeFsPath(payload.GetProperty("linkPath").GetString() ?? "");
                    string targetPath = NormalizeFsPath(payload.GetProperty("targetPath").GetString() ?? "");
                    string linkType = payload.TryGetProperty("linkType", out var ltEl) ? ltEl.GetString() ?? "symlink" : "symlink";
                    string operationId = payload.TryGetProperty("operationId", out var opEl)
                        ? opEl.GetString() ?? $"link-{DateTime.UtcNow.Ticks}"
                        : $"link-{DateTime.UtcNow.Ticks}";
                    _ = HandleCreateLinkAsync(operationId, linkPath, targetPath, linkType, idProp);
                }
                else if (type == "RESOLVE_SHORTCUT")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string path = NormalizeFsPath(payload.GetProperty("path").GetString() ?? "");
                    _ = Task.Run(() =>
                    {
                        object payloadObj;
                        try
                        {
                            payloadObj = _linkService.ResolveShortcut(path);
                        }
                        catch (Exception ex)
                        {
                            payloadObj = new LinkService.ShortcutResolveResult { Success = false, Error = ex.Message };
                        }
                        var response = new { type = "RESOLVE_SHORTCUT_RESULT", id = idProp, payload = payloadObj };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "SHELL_INTEGRATION")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string action = payload.GetProperty("action").GetString() ?? "";
                    // Copy values before Task.Run — JsonDocument is disposed when this handler returns.
                    bool enable = payload.TryGetProperty("enable", out var enableEl)
                        && enableEl.ValueKind == JsonValueKind.True;
                    string? extraArgs = null;
                    if (payload.TryGetProperty("extraArgs", out var extraArgsProp)
                        && extraArgsProp.ValueKind == JsonValueKind.String)
                        extraArgs = extraArgsProp.GetString();

                    _ = Task.Run(() =>
                    {
                        object resultPayload;
                        try
                        {
                            switch (action)
                            {
                                case "setContextMenu":
                                    resultPayload = _shellIntegrationService.SetInContextMenu(enable);
                                    break;
                                case "setDefault":
                                    resultPayload = _shellIntegrationService.SetAsDefaultFileManager(enable);
                                    break;
                                case "setWin11MoreOptions":
                                    resultPayload = _shellIntegrationService.SetWin11MoreOptions(enable);
                                    break;
                                case "relaunchAdmin":
                                    resultPayload = _shellIntegrationService.RelaunchAsAdministrator(extraArgs);
                                    break;
                                case "isElevated":
                                    resultPayload = new { elevated = _shellIntegrationService.IsElevated() };
                                    break;
                                case "getDefaultStatus":
                                    resultPayload = _shellIntegrationService.GetDefaultFileManagerStatus();
                                    break;
                                default:
                                    resultPayload = new { success = false, message = $"Unknown shell action: {action}" };
                                    break;
                            }
                        }
                        catch (Exception ex)
                        {
                            resultPayload = new { success = false, message = ex.Message, needsElevation = ex is UnauthorizedAccessException };
                        }

                        var response = new { type = "SHELL_INTEGRATION_RESULT", id = idProp, payload = resultPayload };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => {
                            try
                            {
                                MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                            }
                            catch { }
                        });
                    });
                }
                else if (type == "GET_ICON_LIBRARIES")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        var libs = _iconStudioService.GetLibrariesForFrontend();
                        var response = new { type = "ICON_LIBRARIES_RESULT", id = idProp, payload = libs };
                        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        string responseJson = JsonSerializer.Serialize(response, jsonOpts);
                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                        });
                    });
                }
                else if (type == "REFRESH_WORKSPACE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    // Reply immediately — drive rescans can hang on flaky volumes and must not block IPC.
                    var response = new { type = "REFRESH_WORKSPACE_RESULT", id = idProp, payload = true };
                    var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() =>
                    {
                        try { MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)); }
                        catch { }
                    });
                    PushDrivesUpdate();
                }
                else if (type == "SET_FILE_ATTRIBUTES")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string path = payload.GetProperty("path").GetString() ?? "";
                    if (path.StartsWith("/")) path = path.Substring(1);
                    path = path.Replace("/", "\\");

                    bool success = false;
                    try
                    {
                        if (File.Exists(path))
                        {
                            var attrs = File.GetAttributes(path);
                            var attrObj = payload.GetProperty("attributes");
                            if (attrObj.TryGetProperty("ReadOnly", out var ro) && ro.GetBoolean()) attrs |= FileAttributes.ReadOnly; else attrs &= ~FileAttributes.ReadOnly;
                            if (attrObj.TryGetProperty("Hidden", out var hi) && hi.GetBoolean()) attrs |= FileAttributes.Hidden; else attrs &= ~FileAttributes.Hidden;
                            if (attrObj.TryGetProperty("System", out var sy) && sy.GetBoolean()) attrs |= FileAttributes.System; else attrs &= ~FileAttributes.System;
                            if (attrObj.TryGetProperty("Archive", out var ar) && ar.GetBoolean()) attrs |= FileAttributes.Archive; else attrs &= ~FileAttributes.Archive;
                            File.SetAttributes(path, attrs);
                            success = true;
                        }
                    }
                    catch { }

                    var response = new { type = "SET_FILE_ATTRIBUTES_RESULT", id = idProp, payload = success };
                    var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts));
                    });
                }
                else if (type == "SAVE_SETTINGS")
                {
                    var idProp = root.TryGetProperty("id", out var sid) ? sid.GetString() : null;
                    var ok = true;
                    try
                    {
                        string jsonString = root.TryGetProperty("payload", out var payloadEl)
                            ? payloadEl.GetRawText()
                            : "{}";
                        _settingsManager.SaveSettings(jsonString);
                        FileOperationPreferences.ApplyFromJson(jsonString);
                        ApplyFileOperationPreferences();
                        ApplyGlobalHotkeysFromSettingsJson(jsonString);
                        BndzMediaDiskCache.Instance.ApplySettingsJson(jsonString);
                    }
                    catch (Exception ex)
                    {
                        ok = false;
                        Console.WriteLine($"Error saving settings: {ex.Message}");
                    }
                    if (!string.IsNullOrEmpty(idProp))
                    {
                        var response = new { type = "SAVE_SETTINGS_RESULT", id = idProp, payload = new { ok } };
                        PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response)));
                    }
                }
                else if (type == "LOAD_SETTINGS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    try
                    {
                        string? settingsJson = _settingsManager.LoadSettings();
                        if (string.IsNullOrEmpty(settingsJson)) settingsJson = "null";
                        FileOperationPreferences.ApplyFromJson(settingsJson == "null" ? null : settingsJson);
                        if (settingsJson != "null")
                            BndzMediaDiskCache.Instance.ApplySettingsJson(settingsJson);
                        ApplyFileOperationPreferences();
                        ApplyGlobalHotkeysFromSettingsJson(settingsJson == "null" ? null : settingsJson);
                        
                        var responseJson = "{\"type\":\"LOAD_SETTINGS_RESULT\",\"id\":\"" + idProp + "\",\"payload\":" + settingsJson + "}";
                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                        });
                    }
                    catch (Exception)
                    {
                        var responseJson = "{\"type\":\"LOAD_SETTINGS_RESULT\",\"id\":\"" + idProp + "\",\"payload\":null}";
                        PostToUi(() => { MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson); });
                    }
                }
                else if (type == "GET_CLOUD_PROVIDERS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var providers = _cloudStorageService.GetProviders();
                            var response = new { type = "CLOUD_PROVIDERS_RESULT", id = idProp, payload = providers };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            PostToUi(() =>
                            {
                                try { MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)); }
                                catch { }
                            });
                        }
                        catch (Exception ex)
                        {
                            var response = new { type = "CLOUD_PROVIDERS_RESULT", id = idProp, payload = Array.Empty<object>(), error = ex.Message };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            PostToUi(() =>
                            {
                                try { MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)); }
                                catch { }
                            });
                        }
                    });
                }
                else if (type == "GET_SHELL_ICON")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string path = "";
                    bool isDirectory = false;
                    try {
                        var payload = root.GetProperty("payload");
                        path = payload.TryGetProperty("path", out var pathEl) ? pathEl.GetString() ?? "" : "";
                        path = ShellPathResolver.ResolveForShell(path);
                        isDirectory = payload.TryGetProperty("isDirectory", out var dirElem) && dirElem.GetBoolean();
                    } catch { }

                    var pathCopy = path;
                    var isDirCopy = isDirectory;

                    _ = Task.Run(async () =>
                    {
                        await BndzIpcWorkQueue.RunShellIconAsync(() =>
                        {
                            string? extractedBase64 = null;
                            try
                            {
                                extractedBase64 = BndzHostCaches.ResolveIconBase64(
                                    pathCopy,
                                    isDirCopy,
                                    () => _nativeShellService.GetNativeShellIconBase64(pathCopy, isDirCopy) ?? "");
                            }
                            catch (Exception ex)
                            {
                                System.Diagnostics.Debug.WriteLine($"Failed to get shell icon for {pathCopy}: {ex.Message}");
                            }

                            PostIconResult(idProp, string.IsNullOrEmpty(extractedBase64) ? null : extractedBase64);
                            return Task.CompletedTask;
                        }).ConfigureAwait(false);
                    });
                }
                else if (type == "GET_SHELL_ICONS_BATCH")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var results = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);

                    _ = Task.Run(() =>
                    {
                        try
                        {
                            if (root.TryGetProperty("payload", out var batchPayload)
                                && batchPayload.TryGetProperty("items", out var itemsEl))
                            {
                                foreach (var item in itemsEl.EnumerateArray())
                                {
                                    string rawPath = item.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                                    bool isDir = item.TryGetProperty("isDirectory", out var dEl) && dEl.GetBoolean();
                                    string path = ShellPathResolver.ResolveForShell(rawPath);
                                    if (string.IsNullOrEmpty(path)) continue;

                                    if (System.Text.RegularExpressions.Regex.IsMatch(path, @"^[A-Za-z]:\\?$"))
                                        isDir = false;

                                    string? extracted = null;
                                    try
                                    {
                                        extracted = BndzHostCaches.ResolveIconBase64(
                                            path,
                                            isDir,
                                            () => _nativeShellService.GetNativeShellIconBase64(path, isDir) ?? "");
                                    }
                                    catch { }

                                    results[path] = string.IsNullOrEmpty(extracted) ? null : extracted;
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"Batch icon error: {ex.Message}");
                        }

                        var response = new { type = "SHELL_ICONS_BATCH_RESULT", id = idProp, payload = results };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        string responseJson = JsonSerializer.Serialize(response, jsonOptions);
                        PostToUi(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(responseJson); }
                            catch { }
                        });
                    });
                }
                else if (type == "CLEAR_ICON_CACHE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    BndzHostCaches.ClearAll(includeDisk: true);
                    var response = new { type = "CLEAR_ICON_CACHE_RESULT", id = idProp };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                    });
                }
                else if (type == "SET_SYSTEM_ICON")
                {
                    var payload = root.GetProperty("payload");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    // Extract before Task.Run — JsonDocument is disposed when handler returns
                    string targetPathRaw = payload.GetProperty("targetPath").GetString() ?? "";
                    string targetTypeRaw = payload.GetProperty("targetType").GetString() ?? "file";
                    string customIcoPathRaw = payload.GetProperty("customIcoPath").GetString() ?? "";
                    bool allowGlobalRaw = payload.TryGetProperty("allowGlobal", out var agEl) && agEl.ValueKind == JsonValueKind.True;

                    _ = Task.Run(async () => {
                        bool success = false;
                        string? error = null;
                        try {
                            string targetPath = NormalizeFsPath(targetPathRaw);
                            string targetType = targetTypeRaw;
                            string customIcoPath = NormalizeFsPath(customIcoPathRaw);
                            bool allowGlobal = allowGlobalRaw;

                            if (customIcoPath.Contains("[ASSETS]")) {
                                string exeDir = System.IO.Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location) ?? "";
                                customIcoPath = customIcoPath.Replace("[ASSETS]", System.IO.Path.Combine(exeDir, "Assets"));
                            }

                            // "shell32.dll,5" style resources: validate the file portion, skip conversion
                            var (icoFile, icoIndex) = BNDZ.Services.IconStudioService.ParseIconResource(customIcoPath);
                            bool isIconContainer = icoFile.EndsWith(".ico", StringComparison.OrdinalIgnoreCase)
                                || icoFile.EndsWith(".dll", StringComparison.OrdinalIgnoreCase)
                                || icoFile.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)
                                || icoFile.EndsWith(".icl", StringComparison.OrdinalIgnoreCase);

                            if (!string.IsNullOrEmpty(icoFile) && File.Exists(icoFile) && !isIconContainer)
                            {
                                var converted = await Task.Run(() => _iconLibraryScanner.ConvertToIco(icoFile));
                                if (!string.IsNullOrEmpty(converted) && File.Exists(converted))
                                    customIcoPath = converted;
                            }

                            bool isPlainFileTarget = !Directory.Exists(targetPath)
                                && !targetPath.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase)
                                && targetType != "extension";

                            if (string.IsNullOrEmpty(targetPath))
                                error = "Target path is empty.";
                            else if (string.IsNullOrEmpty(icoFile) || !File.Exists(icoFile))
                                error = "Icon file not found or could not be converted to .ico.";
                            else if (isPlainFileTarget && !allowGlobal)
                                error = "File icons apply to ALL files of that extension. Enable \"Allow global icon overwrite\" in Settings > Icons first.";
                            else if (targetType == "folder" || Directory.Exists(targetPath)) {
                                _iconStudioService.ApplyFolderIcon(targetPath, customIcoPath, icoIndex);
                                var iniPath = Path.Combine(targetPath, "desktop.ini");
                                success = Directory.Exists(targetPath) && File.Exists(iniPath);
                                if (!success) error = "Could not apply folder icon — check folder permissions.";
                            } else if (targetType == "shortcut" || targetPath.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase)) {
                                _iconStudioService.ApplyFileIcon(targetPath, customIcoPath);
                                success = File.Exists(targetPath);
                            } else if (targetType == "file" || File.Exists(targetPath)) {
                                _iconStudioService.ApplyFileIcon(targetPath, customIcoPath);
                                success = File.Exists(targetPath);
                            } else if (targetType == "extension") {
                                string ext = targetPath.StartsWith(".") ? targetPath : Path.GetExtension(targetPath);
                                if (!string.IsNullOrEmpty(ext)) {
                                    using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey($@"Software\Classes\{ext}");
                                    using var defaultIconKey = key?.CreateSubKey("DefaultIcon");
                                    if (defaultIconKey != null) {
                                        defaultIconKey.SetValue("", customIcoPath + ",0");
                                        success = true;
                                    }
                                }
                            } else {
                                error = "Target not found.";
                            }
                            
                            if (success) {
                                BNDZ.Services.FolcolorPort.ResetIconCache();
                                BndzHostCaches.ClearAll();
                            } else if (error == null) {
                                error = "Apply failed — check permissions (OneDrive folders may need to be available offline).";
                            }
                        } catch (Exception ex) {
                            success = false;
                            error = ex.Message;
                        } finally {
                            var response = new { type = "SET_SYSTEM_ICON_RESULT", id = idProp, payload = new { success, error } };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            await PostToUiAsync(() => {
                                try {
                                    MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                                } catch { }
                            });
                        }
                    });
                }
                else if (type == "RESTORE_SYSTEM_ICON")
                {
                    var payload = root.GetProperty("payload");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string restoreTargetPath = NormalizeFsPath(payload.GetProperty("targetPath").GetString() ?? "");
                    string restoreTargetType = (payload.GetProperty("targetType").GetString() ?? "folder").ToLowerInvariant();

                    _ = Task.Run(async () => {
                        string targetPath = restoreTargetPath;
                        string targetType = restoreTargetType;
                        bool success = false;
                        try {
                            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(12));
                            await Task.Run(() =>
                            {
                                // Directory check first — handles dotted folder names regardless of declared type
                                if (Directory.Exists(targetPath))
                                {
                                    BNDZ.Services.FolcolorPort.RestoreFolder(targetPath);
                                    success = true;
                                }
                                else if (targetPath.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase) && File.Exists(targetPath))
                                {
                                    _iconStudioService.RestoreShortcutIcon(targetPath);
                                    success = true;
                                }
                                else if (File.Exists(targetPath))
                                {
                                    success = _iconStudioService.RestoreFileExtensionIcon(targetPath);
                                }
                                if (success) BNDZ.Services.FolcolorPort.ResetIconCache();
                            }, cts.Token);
                        } catch {
                            success = false;
                        } finally {
                            var response = new { type = "RESTORE_SYSTEM_ICON_RESULT", id = idProp, payload = success };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            await PostToUiAsync(() => {
                                try {
                                    MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                                } catch { }
                            });
                        }
                    });
                }
                else if (type == "WINDOW_CHROME")
                {
                    var payload = root.GetProperty("payload");
                    string action = payload.GetProperty("action").GetString() ?? "";
                    Dispatcher.Invoke(() =>
                    {
                        switch (action.ToLowerInvariant())
                        {
                            case "minimize":
                                WindowState = WindowState.Minimized;
                                break;
                            case "maximize":
                                WindowState = WindowState == WindowState.Maximized ? WindowState.Normal : WindowState.Maximized;
                                PostWindowStateChanged();
                                break;
                            case "close":
                                if (App.IsPluginWindow)
                                {
                                    _allowClose = true;
                                    Close();
                                }
                                else
                                {
                                    RequestCloseFromUI("x");
                                }
                                break;
                            case "drag":
                                BeginWindowDrag();
                                break;
                            case "alwaysontop":
                                Topmost = payload.TryGetProperty("enabled", out var en) && en.GetBoolean();
                                break;
                        }
                    });
                }
                else if (type == "WINDOW_CLOSE_RESOLVE")
                {
                    var payload = root.GetProperty("payload");
                    string action = payload.GetProperty("action").GetString() ?? "";
                    Dispatcher.Invoke(() =>
                    {
                        switch (action.ToLowerInvariant())
                        {
                            case "tray":
                                PersistWindowPlacementIntoSettings();
                                _trayService?.HideToTray();
                                break;
                            case "quit":
                                PersistWindowPlacementIntoSettings();
                                _allowClose = true;
                                Close();
                                break;
                        }
                    });
                }
                else if (type == "TRAY_RESTORE")
                {
                    Dispatcher.Invoke(() => _trayService?.RestoreMainWindow());
                }
                else if (type == "REQUEST_CLOSE")
                {
                    var payload = root.GetProperty("payload");
                    string source = payload.TryGetProperty("source", out var src) ? src.GetString() ?? "menu" : "menu";
                    if (string.Equals(source, "exit-without-saving", StringComparison.OrdinalIgnoreCase))
                    {
                        Dispatcher.Invoke(() =>
                        {
                            _allowClose = true;
                            Close();
                        });
                    }
                    else
                    {
                        Dispatcher.Invoke(() => RequestCloseFromUI(source));
                    }
                }
                else if (type == "RESTART_APP")
                {
                    var payload = root.TryGetProperty("payload", out var pl) ? pl : default;
                    // save flag reserved for future session-persist control; restart always relaunches cleanly
                    _ = payload;
                    Dispatcher.Invoke(() =>
                    {
                        try
                        {
                            string exePath = System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName
                                ?? Environment.ProcessPath
                                ?? "";
                            if (!string.IsNullOrWhiteSpace(exePath))
                            {
                                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                                {
                                    FileName = exePath,
                                    UseShellExecute = true,
                                    WorkingDirectory = System.IO.Path.GetDirectoryName(exePath) ?? Environment.CurrentDirectory,
                                });
                            }
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"RESTART_APP failed: {ex.Message}");
                        }
                        _allowClose = true;
                        Close();
                    });
                }
                else if (type == "GET_WINDOW_STATE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var response = new { type = "WINDOW_STATE_RESULT", id = idProp, payload = new { maximized = WindowState == WindowState.Maximized } };
                    MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
                }
                else if (type == "READ_TEXT_FILE")
                {
                    var payload = root.GetProperty("payload");
                    string path = NormalizeFsPath(payload.GetProperty("path").GetString() ?? "");
                    long maxBytes = payload.TryGetProperty("maxBytes", out var mb) ? mb.GetInt64() : 2L * 1024 * 1024;
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        object resultPayload;
                        try
                        {
                            if (!File.Exists(path))
                                resultPayload = new { error = "File not found" };
                            else if (new FileInfo(path).Length > maxBytes)
                                resultPayload = new { error = "File too large to edit in preview" };
                            else
                            {
                                string text = File.ReadAllText(path, Encoding.UTF8);
                                resultPayload = new { content = text };
                            }
                        }
                        catch (Exception ex)
                        {
                            resultPayload = new { error = ex.Message };
                        }
                        var response = new { type = "READ_TEXT_FILE_RESULT", id = idProp, payload = resultPayload };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })));
                    });
                }
                else if (type == "WRITE_TEXT_FILE")
                {
                    var payload = root.GetProperty("payload");
                    string path = NormalizeFsPath(payload.GetProperty("path").GetString() ?? "");
                    string content = payload.GetProperty("content").GetString() ?? "";
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        bool ok = false;
                        try
                        {
                            var dir = Path.GetDirectoryName(path);
                            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                                Directory.CreateDirectory(dir);
                            File.WriteAllText(path, content, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
                            ok = true;
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"WRITE_TEXT_FILE failed: {ex.Message}");
                        }
                        var response = new { type = "WRITE_TEXT_FILE_RESULT", id = idProp, payload = ok };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })));
                    });
                }
                else if (type == "WRITE_BINARY_FILE")
                {
                    var payload = root.GetProperty("payload");
                    string path = NormalizeFsPath(payload.GetProperty("path").GetString() ?? "");
                    string base64 = payload.TryGetProperty("base64", out var b64El) ? b64El.GetString() ?? "" : "";
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        bool ok = false;
                        try
                        {
                            var dir = Path.GetDirectoryName(path);
                            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
                                Directory.CreateDirectory(dir);
                            var bytes = Convert.FromBase64String(base64);
                            File.WriteAllBytes(path, bytes);
                            ok = true;
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"WRITE_BINARY_FILE failed: {ex.Message}");
                        }
                        var response = new { type = "WRITE_BINARY_FILE_RESULT", id = idProp, payload = ok };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase })));
                    });
                }
                else if (type == "SYNC_ICON_LIBRARIES")
                {
                    var payload = root.GetProperty("payload");
                    var libraries = payload.GetProperty("libraries");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string librariesJson = libraries.GetRawText();

                    _ = Task.Run(() => {
                        bool success = false;
                        try {
                            using var libDoc = JsonDocument.Parse(librariesJson);
                            success = _iconStudioService.SaveLibrariesFromJson(libDoc.RootElement);
                            if (success)
                            {
                                _ = Task.Run(() =>
                                {
                                    try { _iconStudioService.RebuildExplorerContextMenu(); }
                                    catch (Exception ex) { System.Diagnostics.Debug.WriteLine($"[IconStudio] menu rebuild: {ex.Message}"); }
                                });
                            }
                        } catch (Exception ex) {
                            System.Diagnostics.Debug.WriteLine($"SYNC_ICON_LIBRARIES failed: {ex.Message}");
                            success = false;
                        }

                        var response = new { type = "SYNC_ICON_LIBRARIES_RESULT", id = idProp, payload = success };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                        });
                    });
                }
                else if (type == "UPDATE_GLOBAL_CONTEXT_MENU")
                {
                    var payload = root.GetProperty("payload");
                    var actions = payload.GetProperty("actions");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    
                    _ = Task.Run(() => {
                        bool success = false;
                        try {
                            const string AllRoot = @"*\shell\BNDZ";
                            const string DirRoot = @"Directory\shell\BNDZ";
                            const string BgRoot = @"Directory\Background\shell\BNDZ";

                            // Per-user registry — no admin rights required, Explorer merges HKCU classes
                            using var classes = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(@"Software\Classes");

                            // Remove previous deployment entirely so deleted items don't linger
                            foreach (var r in new[] { AllRoot, DirRoot, BgRoot })
                            {
                                try { classes.DeleteSubKeyTree(r, false); } catch { }
                            }
                            // Legacy cleanup: older builds wrote to HKCR (machine-wide) — best effort
                            try { Microsoft.Win32.Registry.ClassesRoot.DeleteSubKeyTree(AllRoot, false); } catch { }
                            try { Microsoft.Win32.Registry.ClassesRoot.DeleteSubKeyTree(DirRoot, false); } catch { }

                            string exePath = System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName
                                ?? Environment.ProcessPath
                                ?? AppDomain.CurrentDomain.FriendlyName;
                            var byRoot = new Dictionary<string, List<(string Label, string Command, string Icon)>>
                            {
                                [AllRoot] = new(),
                                [DirRoot] = new(),
                                [BgRoot] = new(),
                            };

                            foreach (var action in actions.EnumerateArray())
                            {
                                string actionId = action.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? "" : "";
                                string actionLabel = action.TryGetProperty("label", out var labelEl) ? labelEl.GetString() ?? actionId : actionId;
                                string customCommand = action.TryGetProperty("command", out var cmdEl) ? cmdEl.GetString() ?? "" : "";
                                string iconPath = action.TryGetProperty("icon", out var iconEl) ? iconEl.GetString() ?? "" : "";
                                string targetMode = action.TryGetProperty("targetMode", out var tmEl) ? tmEl.GetString() ?? "all" : "all";

                                string commandStr;
                                if (actionId.Equals("bndz-open-path", StringComparison.OrdinalIgnoreCase)
                                    || actionLabel.Equals("Open in BNDZ", StringComparison.OrdinalIgnoreCase))
                                {
                                    commandStr = $"\"{exePath}\" --open-path \"%1\"";
                                }
                                else if (!string.IsNullOrWhiteSpace(customCommand))
                                {
                                    commandStr = customCommand.Contains("\"%1\"")
                                        ? customCommand
                                        : customCommand.Replace("%1", "\"%1\"");
                                }
                                else
                                {
                                    commandStr = $"\"{exePath}\" --{actionId.ToLower().Replace(" ", "-")} \"%1\"";
                                }

                                switch (targetMode)
                                {
                                    case "directory":
                                        byRoot[DirRoot].Add((actionLabel, commandStr, iconPath));
                                        break;
                                    case "background":
                                        // Folder background has no selected item — %V is the folder path
                                        byRoot[BgRoot].Add((actionLabel, commandStr.Replace("\"%1\"", "\"%V\"").Replace("%1", "\"%V\""), iconPath));
                                        break;
                                    default:
                                        byRoot[AllRoot].Add((actionLabel, commandStr, iconPath));
                                        byRoot[DirRoot].Add((actionLabel, commandStr, iconPath));
                                        break;
                                }
                            }

                            foreach (var (rootPath, items) in byRoot)
                            {
                                if (items.Count == 0) continue;
                                using var rootKey = classes.CreateSubKey(rootPath);
                                rootKey.SetValue("MUIVerb", "BNDZ Actions");
                                rootKey.SetValue("SubCommands", "");
                                rootKey.SetValue("Icon", $"\"{exePath}\",0");
                                using var shellKey = rootKey.CreateSubKey("shell");
                                int index = 1;
                                foreach (var (label, command, icon) in items)
                                {
                                    using var actKey = shellKey.CreateSubKey($"cmd{index}");
                                    actKey.SetValue("MUIVerb", label);
                                    if (!string.IsNullOrWhiteSpace(icon) && File.Exists(icon.Split(',')[0]))
                                        actKey.SetValue("Icon", icon);
                                    using var cmdKey = actKey.CreateSubKey("command");
                                    cmdKey.SetValue("", command);
                                    index++;
                                }
                            }
                            success = true;
                        } catch (UnauthorizedAccessException) {
                            PostToUi(() => {
                                var evt = new {
                                    type = "ELEVATION_REQUIRED",
                                    payload = new {
                                        title = "Administrator approval required",
                                        message = "Could not write the context menu registry entries. Restart BNDZ as administrator to continue.",
                                        context = "globalContextMenu",
                                    }
                                };
                                MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt));
                            });
                            success = false; 
                        } catch {
                            success = false; 
                        }

                        var response = new { type = "UPDATE_GLOBAL_CONTEXT_MENU_RESULT", id = idProp, payload = success };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                        });
                    });
                }
                else if (type == "MATERIALIZE_ICONIFY")
                {
                    var payload = root.GetProperty("payload");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string iconId = payload.TryGetProperty("iconId", out var iconEl) ? iconEl.GetString() ?? "" : "";

                    _ = Task.Run(async () => {
                        string? icoPath = null;
                        try
                        {
                            if (!string.IsNullOrWhiteSpace(iconId))
                            {
                                string cacheDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ64", "iconify-cache");
                                Directory.CreateDirectory(cacheDir);
                                string safe = System.Text.RegularExpressions.Regex.Replace(iconId, @"[^\w\-.:]+", "_");
                                string pngPath = Path.Combine(cacheDir, safe + ".png");
                                string cachedIco = Path.Combine(cacheDir, safe + ".ico");

                                if (File.Exists(cachedIco))
                                {
                                    icoPath = cachedIco;
                                }
                                else
                                {
                                    if (!File.Exists(pngPath))
                                    {
                                        using var http = new System.Net.Http.HttpClient();
                                        http.Timeout = TimeSpan.FromSeconds(30);
                                        var url = $"https://api.iconify.design/{iconId}.png?width=128";
                                        var bytes = await http.GetByteArrayAsync(url);
                                        await File.WriteAllBytesAsync(pngPath, bytes);
                                    }
                                    icoPath = _iconLibraryScanner.ConvertToIco(pngPath) ?? cachedIco;
                                }
                            }
                        }
                        catch (Exception ex)
                        {
                            System.Diagnostics.Debug.WriteLine($"Materialize iconify failed: {ex.Message}");
                        }

                        var response = new { type = "MATERIALIZE_ICONIFY_RESULT", id = idProp, payload = icoPath?.Replace("\\", "/") };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)); } catch { }
                        });
                    });
                }
                else if (type == "CONVERT_TO_ICO")
                {
                    var payload = root.GetProperty("payload");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    
                    _ = Task.Run(async () => {
                        string path = payload.TryGetProperty("path", out var pathEl) ? pathEl.GetString() ?? "" : "";
                        path = NormalizeFsPath(path);
                        string? icoPath = null;
                        
                        try {
                            if (!string.IsNullOrEmpty(path) && File.Exists(path))
                            {
                                var convertTask = Task.Run(() => _iconLibraryScanner.ConvertToIco(path));
                                var completed = await Task.WhenAny(convertTask, Task.Delay(20000));
                                if (completed == convertTask)
                                    icoPath = await convertTask;
                            }
                        } catch {
                             icoPath = null;
                        }

                        var response = new { type = "CONVERT_TO_ICO_RESULT", id = idProp, payload = icoPath?.Replace("\\", "/") };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        await PostToUiAsync(() => {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)); } catch { }
                        });
                    });
                }
                else if (type == "OPEN_FILE_DIALOG")
                {
                    var payload = root.GetProperty("payload");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    
                    PostToUi(() => {
                        var openFileDialog = new Microsoft.Win32.OpenFileDialog();
                        openFileDialog.Multiselect = true;
                        openFileDialog.Filter = payload.TryGetProperty("filter", out var filterElement) ? filterElement.GetString() : "All files (*.*)|*.*";
                        
                        string[] files = new string[0];
                        if (openFileDialog.ShowDialog() == true)
                        {
                            files = openFileDialog.FileNames;
                        }
                        
                        var response = new { type = "OPEN_FILE_DIALOG_RESULT", id = idProp, payload = files };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                    });
                }
                else if (type == "OPEN_FOLDER_DIALOG")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var payload = root.TryGetProperty("payload", out var payloadEl) ? payloadEl : default;
                    string description = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("description", out var descEl)
                        ? descEl.GetString() ?? "Select a folder"
                        : "Select a folder";

                    Dispatcher.Invoke(() => {
                        string selectedPath = "";
                        var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                        Activate();
                        NativeDialogHelper.FocusOwner(hwnd);
                        var dialog = new Ookii.Dialogs.Wpf.VistaFolderBrowserDialog
                        {
                            Description = description,
                            UseDescriptionForTitle = true,
                            ShowNewFolderButton = true,
                        };
                        if (dialog.ShowDialog(hwnd) == true)
                            selectedPath = dialog.SelectedPath ?? "";

                        var response = new { type = "OPEN_FOLDER_DIALOG_RESULT", id = idProp, payload = selectedPath };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                    });
                }
                else if (type == "SCAN_ICON_FOLDER")
                {
                    var payload = root.GetProperty("payload");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string folderPath = payload.TryGetProperty("folderPath", out var fpEl) ? fpEl.GetString() ?? "" : "";
                    folderPath = NormalizeFsPath(folderPath);
                    bool autoConvert = !payload.TryGetProperty("autoConvert", out var acEl) || acEl.ValueKind != JsonValueKind.False;

                    _ = Task.Run(() => {
                        var icons = _iconLibraryScanner.ScanFolder(folderPath, autoConvert);
                        var response = new { type = "SCAN_ICON_FOLDER_RESULT", id = idProp, payload = icons };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                        });
                    });
                }
                else if (type == "GET_APP_VERSION")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var response = new { type = "APP_VERSION_RESULT", id = idProp, payload = BndzUpdateService.GetCurrentVersion() };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                    });
                }
                else if (type == "GET_APP_RUNTIME_INFO")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var response = new { type = "APP_RUNTIME_INFO_RESULT", id = idProp, payload = _settingsManager.GetRuntimeInfo() };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                    });
                }
                else if (type == "CHECK_FOR_UPDATES")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string? manifestUrl = null;
                    if (root.TryGetProperty("payload", out var updPayload)
                        && updPayload.TryGetProperty("manifestUrl", out var urlEl))
                        manifestUrl = urlEl.GetString();

                    _ = Task.Run(async () =>
                    {
                        var result = await _updateService.CheckAsync(manifestUrl).ConfigureAwait(false);
                        var response = new { type = "CHECK_FOR_UPDATES_RESULT", id = idProp, payload = result };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                        });
                    });
                }
                else if (type == "GET_INDEXED_ENTRY")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string panePath = "";
                    if (root.TryGetProperty("payload", out var idxPayload) && idxPayload.TryGetProperty("path", out var pathEl))
                        panePath = pathEl.GetString() ?? "";

                    _ = Task.Run(() =>
                    {
                        var meta = BndzFileIndexService.Instance.GetEntry(panePath);
                        var response = new { type = "INDEXED_ENTRY_RESULT", id = idProp, payload = meta };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() =>
                        {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                        });
                    });
                }
                else if (type == "GET_VIRTUAL_VIEW_CONTENTS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string view = "";
                    int limit = 500;
                    if (root.TryGetProperty("payload", out var viewPayload))
                    {
                        if (viewPayload.TryGetProperty("view", out var viewEl))
                            view = viewEl.GetString() ?? "";
                        if (viewPayload.TryGetProperty("limit", out var limEl) && limEl.ValueKind == JsonValueKind.Number)
                            limit = limEl.GetInt32();
                    }

                    _ = Task.Run(() =>
                    {
                        var svc = BndzFileIndexService.Instance;
                        List<object> rawItems = view switch
                        {
                            "recent" => svc.GetRecentFiles(limit),
                            "media" => svc.GetMediaFiles(limit),
                            "audio" => svc.GetAudioFiles(limit),
                            "documents" => svc.GetDocumentFiles(limit),
                            "large" => svc.GetLargeFiles(limit),
                            "problems" => LibraryHealthService.Instance.ListProblems(null, limit)
                                .Select(p => (object)new
                                {
                                    id = p.Id,
                                    name = Path.GetFileName(p.Path) is { Length: > 0 } n ? n : p.Path,
                                    type = "file",
                                    path = p.Path,
                                    size = 0L,
                                    modified = p.ScannedUtc,
                                    extension = "",
                                    detail = p.Detail,
                                    kind = p.Kind,
                                    severity = p.Severity,
                                }).ToList(),
                            "inbound" => InboundVolumeService.Instance.ListEntries()
                                .Select(e => (object)new
                                {
                                    id = e.Id,
                                    name = e.Name,
                                    type = e.Type == "files" ? "directory" : "file",
                                    path = e.Path,
                                    size = e.Size,
                                    modified = e.CreatedUtc,
                                    extension = "",
                                }).ToList(),
                            "portal-health" => BndzNamespaceService.Instance.ResolvePortalView("health", limit),
                            "portal-magnets" => BndzNamespaceService.Instance.ResolvePortalView("magnets", limit),
                            "portal-sandboxes" => BndzNamespaceService.Instance.ResolvePortalView("sandboxes", limit),
                            "portal-capture" => BndzNamespaceService.Instance.ResolvePortalView("capture", limit),
                            _ => [],
                        };
                        var items = BndzTagSidecarStore.EnrichDirResults(rawItems, _tagSidecarStore);
                        var response = new { type = "VIRTUAL_VIEW_CONTENTS_RESULT", id = idProp, payload = new { items } };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() =>
                        {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                        });
                    });
                }
                else if (type == "INDEX_BNDZ_LOCATION")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string panePath = "";
                    if (root.TryGetProperty("payload", out var idxPayload) && idxPayload.TryGetProperty("path", out var pathEl))
                        panePath = pathEl.GetString() ?? "";

                    var win = panePath.Replace("/", "\\").TrimStart('\\');
                    if (win.Length >= 2 && win[0] == '\\' && char.IsLetter(win[1]) && win.Length >= 3 && win[2] == ':')
                        win = win.Substring(1);

                    if (string.IsNullOrWhiteSpace(win) || !Directory.Exists(win))
                    {
                        var bad = new { type = "INDEX_BNDZ_LOCATION_RESULT", id = idProp, payload = new { ok = false, error = "Folder not found." } };
                        var badOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(bad, badOpts)));
                    }
                    else
                    {
                        var ack = new { type = "INDEX_BNDZ_LOCATION_RESULT", id = idProp, payload = new { ok = true, started = true } };
                        var ackOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(ack, ackOpts)));

                        _ = Task.Run(() =>
                        {
                            try
                            {
                                BndzFileIndexService.Instance.IndexLocation(win, CancellationToken.None, maxDepth: 8);
                            }
                            catch { /* progress event carries error */ }
                        });
                    }
                }
                else if (type == "GET_INDEX_STATUS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var status = BndzFileIndexService.Instance.GetIndexStatus();
                            var response = new { type = "INDEX_STATUS_RESULT", id = idProp, payload = status };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                        }
                        catch (Exception ex)
                        {
                            var response = new { type = "INDEX_STATUS_RESULT", id = idProp, payload = new { error = ex.Message } };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                        }
                    });
                }
                else if (type == "GET_HOME_DECK")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    int continuumLimit = 28;
                    int orbitLimit = 6;
                    string? sinceFingerprint = null;
                    bool pulseOnly = false;
                    if (root.TryGetProperty("payload", out var homePayload))
                    {
                        if (homePayload.TryGetProperty("continuumLimit", out var clEl) && clEl.ValueKind == JsonValueKind.Number)
                            continuumLimit = clEl.GetInt32();
                        if (homePayload.TryGetProperty("orbitLimit", out var olEl) && olEl.ValueKind == JsonValueKind.Number)
                            orbitLimit = olEl.GetInt32();
                        if (homePayload.TryGetProperty("sinceFingerprint", out var fpEl))
                            sinceFingerprint = fpEl.GetString();
                        if (homePayload.TryGetProperty("pulseOnly", out var poEl) && (poEl.ValueKind == JsonValueKind.True || poEl.ValueKind == JsonValueKind.False))
                            pulseOnly = poEl.GetBoolean();
                    }

                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var svc = BndzFileIndexService.Instance;
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            var fingerprint = svc.GetContinuumFingerprint();
                            var status = svc.GetIndexStatus();
                            var queue = _fileTransferQueue.GetQueueState();
                            var drives = _cloudStorageService.GetAnnotatedDrives();

                            var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).Replace("\\", "/");
                            var pictures = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures).Replace("\\", "/");
                            var galleryPath = pictures;
                            var gallerySub = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Gallery");
                            if (Directory.Exists(gallerySub))
                                galleryPath = gallerySub.Replace("\\", "/");

                            static string ToPaneFs(string win) =>
                                "/" + win.Replace("\\", "/").TrimStart('/');

                            var places = new List<object>
                            {
                                new { name = Environment.UserName,  path = ToPaneFs(userProfile), icon = "home", letter = string.IsNullOrEmpty(Environment.UserName) ? "U" : Environment.UserName[0].ToString().ToUpperInvariant(), hint = "User profile" },
                                new { name = "Desktop",  path = ToPaneFs(Environment.GetFolderPath(Environment.SpecialFolder.Desktop)), icon = "desktop", letter = "D", hint = "Desktop" },
                                new { name = "Documents", path = ToPaneFs(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)), icon = "documents", letter = "O", hint = "Documents" },
                                new { name = "Downloads", path = ToPaneFs(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads")), icon = "downloads", letter = "W", hint = "Downloads" },
                                new { name = "Pictures", path = ToPaneFs(pictures), icon = "pictures", letter = "P", hint = "Pictures" },
                                new { name = "Music",    path = ToPaneFs(Environment.GetFolderPath(Environment.SpecialFolder.MyMusic)), icon = "music", letter = "M", hint = "Music" },
                                new { name = "Videos",   path = ToPaneFs(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos)), icon = "videos", letter = "V", hint = "Videos" },
                                new { name = "Gallery",  path = ToPaneFs(galleryPath), icon = "gallery", letter = "G", hint = "Gallery" },
                            };

                            var activeCount = _fileTransferQueue.ActiveCount;
                            var queuedCount = Math.Max(0, _fileTransferQueue.QueuedCount);
                            string? transferLabel = null;
                            try
                            {
                                var qJson = JsonSerializer.Serialize(queue);
                                using var qDoc = JsonDocument.Parse(qJson);
                                if (qDoc.RootElement.TryGetProperty("jobs", out var jobs) && jobs.ValueKind == JsonValueKind.Array)
                                {
                                    foreach (var job in jobs.EnumerateArray())
                                    {
                                        var st = job.TryGetProperty("status", out var stEl) ? stEl.GetString() ?? "" : "";
                                        if (st.Equals("running", StringComparison.OrdinalIgnoreCase)
                                            || st.Equals("active", StringComparison.OrdinalIgnoreCase)
                                            || st.Equals("copying", StringComparison.OrdinalIgnoreCase)
                                            || st.Equals("moving", StringComparison.OrdinalIgnoreCase)
                                            || st.Equals("paused", StringComparison.OrdinalIgnoreCase))
                                        {
                                            transferLabel = job.TryGetProperty("label", out var lb) ? lb.GetString() : null;
                                            break;
                                        }
                                    }
                                }
                            }
                            catch { }

                            var pulseLabel = activeCount > 0
                                ? (string.IsNullOrWhiteSpace(transferLabel)
                                    ? $"{activeCount} transfer{(activeCount == 1 ? "" : "s")} active"
                                    : transferLabel!)
                                : queuedCount > 0
                                    ? $"{queuedCount} queued"
                                    : "Idle";

                            var bodyUnchanged = !string.IsNullOrEmpty(sinceFingerprint)
                                && string.Equals(sinceFingerprint, fingerprint, StringComparison.Ordinal);

                            if (pulseOnly || bodyUnchanged)
                            {
                                var partial = new
                                {
                                    unchanged = bodyUnchanged,
                                    pulseOnly,
                                    continuumFingerprint = fingerprint,
                                    places,
                                    drives,
                                    index = status,
                                    pulse = new
                                    {
                                        activeCount,
                                        queuedCount,
                                        label = pulseLabel,
                                        transferLabel,
                                        queue,
                                    },
                                    generatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                                };
                                var partialResponse = new { type = "HOME_DECK_RESULT", id = idProp, payload = partial };
                                PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(partialResponse, jsonOptions)));
                                return;
                            }

                            var recent = svc.GetContinuumFiles(Math.Clamp(continuumLimit, 8, 64));
                            var library = svc.GetLibraryPulse();
                            var mostOpened = svc.GetMostOpenedFiles(12);

                            var orbitMap = new Dictionary<string, object[]>(StringComparer.OrdinalIgnoreCase);
                            foreach (var item in recent.Take(14))
                            {
                                var itemPath = item.GetType().GetProperty("path")?.GetValue(item) as string;
                                if (string.IsNullOrWhiteSpace(itemPath) || orbitMap.ContainsKey(itemPath)) continue;
                                orbitMap[itemPath] = svc.GetOrbitSiblings(itemPath, Math.Clamp(orbitLimit, 4, 8)).ToArray();
                            }

                            var payload = new
                            {
                                continuum = recent,
                                places,
                                drives,
                                index = status,
                                library,
                                mostOpened,
                                continuumFingerprint = fingerprint,
                                pulse = new
                                {
                                    activeCount,
                                    queuedCount,
                                    label = pulseLabel,
                                    transferLabel,
                                    queue,
                                },
                                orbits = orbitMap,
                                generatedAt = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                            };
                            var response = new { type = "HOME_DECK_RESULT", id = idProp, payload };
                            PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                        }
                        catch (Exception ex)
                        {
                            var response = new { type = "HOME_DECK_RESULT", id = idProp, payload = new { error = ex.Message } };
                            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                            PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                        }
                    });
                }
                else if (type == "ENSURE_FFMPEG_TOOLS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(async () =>
                    {
                        var (ok, error) = await BndzAudioTrimService.EnsureFfmpegAsync().ConfigureAwait(false);
                        var response = new { type = "FFMPEG_TOOLS_RESULT", id = idProp, payload = new { ok, error } };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "RECORD_PATH_OPEN")
                {
                    string openPath = "";
                    if (root.TryGetProperty("payload", out var openPayload) && openPayload.TryGetProperty("path", out var opEl))
                        openPath = NormalizeFsPath(opEl.GetString() ?? "");
                    try
                    {
                        if (!string.IsNullOrWhiteSpace(openPath))
                            BndzFileIndexService.Instance.RecordPathOpen(openPath);
                    }
                    catch { /* best effort */ }
                }
                else if (type == "GET_BNDZ_META")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string metaKey = "";
                    if (root.TryGetProperty("payload", out var metaPayload) && metaPayload.TryGetProperty("key", out var mkEl))
                        metaKey = mkEl.GetString() ?? "";
                    try
                    {
                        var value = BndzFileIndexService.Instance.TryGetMeta(metaKey);
                        var response = new { type = "BNDZ_META_RESULT", id = idProp, payload = new { value } };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    }
                    catch (Exception ex)
                    {
                        var response = new { type = "BNDZ_META_RESULT", id = idProp, payload = new { error = ex.Message } };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    }
                }
                else if (type == "SET_BNDZ_META")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string metaKey = "";
                    string metaValue = "";
                    if (root.TryGetProperty("payload", out var metaPayload))
                    {
                        if (metaPayload.TryGetProperty("key", out var mkEl)) metaKey = mkEl.GetString() ?? "";
                        if (metaPayload.TryGetProperty("value", out var mvEl)) metaValue = mvEl.GetString() ?? "";
                    }
                    var keyCopy = metaKey;
                    var valueCopy = metaValue;

                    _ = Task.Run(() =>
                    {
                        object resultPayload;
                        try
                        {
                            BndzFileIndexService.Instance.SetMeta(keyCopy, valueCopy);
                            resultPayload = new { ok = true };
                        }
                        catch (Exception ex)
                        {
                            resultPayload = new { ok = false, error = ex.Message };
                        }
                        var response = new { type = "BNDZ_META_SET_RESULT", id = idProp, payload = resultPayload };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        string responseJson = JsonSerializer.Serialize(response, jsonOptions);
                        PostToUi(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(responseJson); }
                            catch { }
                        });
                    });
                }
                else if (type == "TRIM_AUDIO_FILE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string audioPath = "";
                    double startSec = 0;
                    double endSec = 0;
                    if (root.TryGetProperty("payload", out var trimPayload))
                    {
                        if (trimPayload.TryGetProperty("path", out var pEl)) audioPath = NormalizeFsPath(pEl.GetString() ?? "");
                        if (trimPayload.TryGetProperty("startSec", out var sEl) && sEl.TryGetDouble(out var s)) startSec = s;
                        if (trimPayload.TryGetProperty("endSec", out var eEl) && eEl.TryGetDouble(out var endVal)) endSec = endVal;
                    }
                    _ = Task.Run(async () =>
                    {
                        var (ok, outPath, error) = await BndzAudioTrimService.TrimAsync(audioPath, startSec, endSec).ConfigureAwait(false);
                        var response = new { type = "TRIM_AUDIO_RESULT", id = idProp, payload = new { ok, path = outPath, error } };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "RUN_AUTOMATION_GRAPH")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    JsonElement graphEl = default;
                    if (root.TryGetProperty("payload", out var graphPayload))
                        graphEl = graphPayload.Clone();
                    _ = Task.Run(() =>
                    {
                        _automationRunnerDeps.HostWindow = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                        var runner = new BndzAutomationRunnerService(_automationRunnerDeps);
                        var result = runner.Run(graphEl);
                        var response = new
                        {
                            type = "AUTOMATION_RUN_RESULT",
                            id = idProp,
                            payload = new { ok = result.Ok, log = result.Log, error = result.Error },
                        };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "SYNC_AUTOMATION_LIVE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    JsonElement graphEl = default;
                    if (root.TryGetProperty("payload", out var graphPayload))
                        graphEl = graphPayload.Clone();
                    _ = Task.Run(() =>
                    {
                        var watchStatus = _automationWatcher.SyncFromGraph(graphEl);
                        var scheduleStatus = _automationScheduler.SyncFromGraph(graphEl);
                        _automationEventTriggers.SyncFromGraph(graphEl);
                        _ = Task.Run(() =>
                        {
                            try { _automationEventTriggers.FireStartup(); }
                            catch { /* best effort */ }
                        });
                        var recentRuns = _automationWatcher.GetRecentRuns(20);
                        var response = new
                        {
                            type = "AUTOMATION_LIVE_STATUS",
                            id = idProp,
                            payload = new
                            {
                                watchers = watchStatus.Watchers,
                                schedules = scheduleStatus.Schedules,
                                recentRuns,
                            },
                        };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "GET_AUTOMATION_LIVE_STATUS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var watchStatus = _automationWatcher.GetStatus();
                    var scheduleStatus = _automationScheduler.GetStatus();
                    var recentRuns = _automationWatcher.GetRecentRuns(20);
                    var response = new
                    {
                        type = "AUTOMATION_LIVE_STATUS",
                        id = idProp,
                        payload = new
                        {
                            watchers = watchStatus.Watchers,
                            schedules = scheduleStatus.Schedules,
                            recentRuns,
                        },
                    };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
                else if (type == "FIRE_AUTOMATION_SPATIAL_PINS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var paths = new List<string>();
                    if (root.TryGetProperty("payload", out var pinPayload))
                    {
                        if (pinPayload.TryGetProperty("paths", out var pathsEl) && pathsEl.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var p in pathsEl.EnumerateArray())
                            {
                                var s = p.GetString();
                                if (!string.IsNullOrWhiteSpace(s)) paths.Add(s);
                            }
                        }
                    }
                    // Ack immediately — RunGraph can take minutes and must not block IPC (timeout).
                    var armedCount = _automationEventTriggers.CountArmedSpatialPins();
                    {
                        var ack = new
                        {
                            type = "AUTOMATION_SPATIAL_PIN_RESULT",
                            id = idProp,
                            payload = new
                            {
                                ok = true,
                                fired = armedCount,
                                queued = true,
                                log = new[] { armedCount == 0
                                    ? "No armed spatialPin pipelines — paths queued for editor seed only."
                                    : $"Queued {armedCount} armed spatialPin pipeline(s)." },
                                error = (string?)null,
                            },
                        };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(ack, jsonOptions)));
                    }
                    if (armedCount > 0 && paths.Count > 0)
                    {
                        _ = Task.Run(() =>
                        {
                            try
                            {
                                _automationRunnerDeps.HostWindow = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                                var results = _automationEventTriggers.FireSpatialPins(paths);
                                var ok = results.Count == 0 || results.All(r => r.Ok);
                                var log = results.SelectMany(r => r.Log ?? Enumerable.Empty<string>()).ToList();
                                var error = results.FirstOrDefault(r => !r.Ok)?.Error;
                                var done = new
                                {
                                    type = "AUTOMATION_SPATIAL_PIN_DONE",
                                    payload = new { ok, fired = results.Count, log, error },
                                };
                                var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                                PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(done, jsonOptions)));
                            }
                            catch (Exception ex)
                            {
                                var done = new
                                {
                                    type = "AUTOMATION_SPATIAL_PIN_DONE",
                                    payload = new { ok = false, fired = 0, log = new[] { ex.Message }, error = ex.Message },
                                };
                                var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                                PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(done, jsonOptions)));
                            }
                        });
                    }
                }
                else if (type == "ANALYZE_MUSIC_FILE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string musicPath = "";
                    if (root.TryGetProperty("payload", out var musicPayload)
                        && musicPayload.TryGetProperty("path", out var mpEl))
                        musicPath = NormalizeFsPath(mpEl.GetString() ?? "");
                    _ = Task.Run(async () =>
                    {
                        var result = await BNDZ.Services.Music.MusicAnalysisService.AnalyzeAsync(musicPath).ConfigureAwait(false);
                        if (result.Ok)
                        {
                            result.SidecarTags = BNDZ.Services.Music.MusicAnalysisService.BuildSidecarTagKeys(result);
                            MediaTagMetadataService.CacheProducerResult(musicPath, result.Bpm, result.Key, result.Mode, result.Camelot);
                            BndzFileIndexService.Instance.StoreProducerMeta(musicPath, result.Bpm, result.Key + (result.Mode == "minor" ? "m" : ""), result.Camelot);
                        }
                        var response = new { type = "ANALYZE_MUSIC_RESULT", id = idProp, payload = result };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "ANALYZE_MUSIC_BATCH")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var musicPaths = new List<string>();
                    var writeTags = false;
                    if (root.TryGetProperty("payload", out var batchPayload))
                    {
                        if (batchPayload.TryGetProperty("paths", out var pathsEl) && pathsEl.ValueKind == JsonValueKind.Array)
                        {
                            foreach (var p in pathsEl.EnumerateArray())
                            {
                                var s = NormalizeFsPath(p.GetString() ?? "");
                                if (!string.IsNullOrWhiteSpace(s)) musicPaths.Add(s);
                            }
                        }
                        if (batchPayload.TryGetProperty("writeTags", out var wt))
                        {
                            writeTags = wt.ValueKind switch
                            {
                                JsonValueKind.True => true,
                                JsonValueKind.False => false,
                                JsonValueKind.String => string.Equals(wt.GetString(), "true", StringComparison.OrdinalIgnoreCase),
                                JsonValueKind.Number => wt.TryGetInt32(out var n) && n != 0,
                                _ => false,
                            };
                        }
                    }
                    _ = Task.Run(async () =>
                    {
                        var results = await BNDZ.Services.Music.MusicAnalysisService.AnalyzeManyAsync(musicPaths, writeTags).ConfigureAwait(false);
                        foreach (var r in results)
                        {
                            if (r.Ok)
                            {
                                r.SidecarTags = BNDZ.Services.Music.MusicAnalysisService.BuildSidecarTagKeys(r);
                                if (!string.IsNullOrWhiteSpace(r.Path))
                                {
                                    MediaTagMetadataService.CacheProducerResult(r.Path, r.Bpm, r.Key, r.Mode, r.Camelot);
                                    BndzFileIndexService.Instance.StoreProducerMeta(r.Path, r.Bpm, r.Key + (r.Mode == "minor" ? "m" : ""), r.Camelot);
                                }
                            }
                        }
                        var response = new
                        {
                            type = "ANALYZE_MUSIC_BATCH_RESULT",
                            id = idProp,
                            payload = new
                            {
                                ok = results.All(r => r.Ok) || results.Any(r => r.Ok),
                                results,
                                analyzed = results.Count(r => r.Ok),
                                failed = results.Count(r => !r.Ok),
                            },
                        };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "REINDEX_BNDZ_DEFAULTS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    try
                    {
                        var started = BndzFileIndexService.Instance.TryStartDefaultReindex(CancellationToken.None);
                        var response = new { type = "REINDEX_BNDZ_DEFAULTS_RESULT", id = idProp, payload = new { ok = started, skipped = !started, error = started ? (string?)null : "Indexing already in progress." } };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    }
                    catch (Exception ex)
                    {
                        var response = new { type = "REINDEX_BNDZ_DEFAULTS_RESULT", id = idProp, payload = new { ok = false, error = ex.Message } };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() => MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    }
                }
                else if (type == "GET_SYSTEM_SHORTCUTS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile).Replace("\\", "/");
                    var pictures = Environment.GetFolderPath(Environment.SpecialFolder.MyPictures).Replace("\\", "/");
                    var galleryPath = pictures;
                    var gallerySub = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyPictures), "Gallery");
                    if (Directory.Exists(gallerySub))
                        galleryPath = gallerySub.Replace("\\", "/");

                    var shortcuts = new List<object>
                    {
                        new { name = "Home",      path = userProfile, icon = "home" },
                        new { name = "Gallery",   path = galleryPath, icon = "gallery" },
                        new { name = "Desktop",   path = Environment.GetFolderPath(Environment.SpecialFolder.Desktop).Replace("\\", "/"),        icon = "desktop"   },
                        new { name = "Documents",  path = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments).Replace("\\", "/"),     icon = "documents" },
                        new { name = "Downloads",  path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads").Replace("\\", "/"), icon = "downloads" },
                        new { name = "Pictures",   path = pictures,      icon = "pictures"  },
                        new { name = "Music",      path = Environment.GetFolderPath(Environment.SpecialFolder.MyMusic).Replace("\\", "/"),         icon = "music"     },
                        new { name = "Videos",     path = Environment.GetFolderPath(Environment.SpecialFolder.MyVideos).Replace("\\", "/"),        icon = "videos"    }
                    };
                    var response = new { type = "SYSTEM_SHORTCUTS_RESULT", id = idProp, payload = shortcuts };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                    });
                }
                else if (type == "EMPTY_RECYCLE_BIN")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = HandleEmptyRecycleBinAsync(idProp);
                }
                else if (type == "RESTORE_RECYCLE_ITEMS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement2) ? idElement2.GetString() : null;
                    var restorePaths = new List<string>();
                    if (root.TryGetProperty("payload", out var restorePayload) && restorePayload.TryGetProperty("paths", out var pathsEl2) && pathsEl2.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var p in pathsEl2.EnumerateArray())
                        {
                            var s = p.GetString();
                            if (!string.IsNullOrWhiteSpace(s)) restorePaths.Add(s);
                        }
                    }
                    _ = HandleRestoreRecycleItemsAsync(idProp, restorePaths);
                }
                else if (type == "PURGE_RECYCLE_ITEMS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement3) ? idElement3.GetString() : null;
                    var purgePaths = new List<string>();
                    if (root.TryGetProperty("payload", out var purgePayload) && purgePayload.TryGetProperty("paths", out var pathsEl3) && pathsEl3.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var p in pathsEl3.EnumerateArray())
                        {
                            var s = p.GetString();
                            if (!string.IsNullOrWhiteSpace(s)) purgePaths.Add(s);
                        }
                    }
                    _ = HandlePurgeRecycleItemsAsync(idProp, purgePaths);
                }
                // ── Recycle Archaeology ──
                else if (type == "RECYCLE_ARCH_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var branches = await RecycleArchaeologyService.Instance.ListBranchesAsync().ConfigureAwait(false);
                            PostMeshIpcResult(idProp, "RECYCLE_ARCH_LIST_RESULT", new { branches });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "RECYCLE_ARCH_LIST_RESULT", new { branches = Array.Empty<object>(), error = ex.Message });
                        }
                    });
                }
                else if (type == "RECYCLE_ARCH_RESTORE_BRANCH")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var parentPath = root.GetProperty("payload").TryGetProperty("parentPath", out var ppEl) ? ppEl.GetString() ?? "" : "";
                    _ = Task.Run(() =>
                    {
                        try
                        {
                            var (restored, failed) = RecycleArchaeologyService.Instance.RestoreBranch(parentPath);
                            PostMeshIpcResult(idProp, "RECYCLE_ARCH_RESTORE_BRANCH_RESULT", new { restored, failed });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "RECYCLE_ARCH_RESTORE_BRANCH_RESULT", new { restored = 0, failed = 0, error = ex.Message });
                        }
                    });
                }
                // ── Hello-Gated Paths ──
                else if (type == "HELLO_GATE_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var gates = HelloGateService.Instance.ListGates().Select(g => new { path = g.Path, addedUtc = g.AddedUtc, hasPassphrase = !string.IsNullOrEmpty(g.PassphraseHash) });
                    PostMeshIpcResult(idProp, "HELLO_GATE_LIST_RESULT", new { gates });
                }
                else if (type == "HELLO_GATE_ADD")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var gatePath = payload.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    var passphrase = payload.TryGetProperty("passphrase", out var passEl) ? passEl.GetString() : null;
                    try
                    {
                        HelloGateService.Instance.AddGate(gatePath, passphrase);
                        PostMeshIpcResult(idProp, "HELLO_GATE_ADD_RESULT", new { ok = true });
                    }
                    catch (Exception ex)
                    {
                        PostMeshIpcResult(idProp, "HELLO_GATE_ADD_RESULT", new { ok = false, error = ex.Message });
                    }
                }
                else if (type == "HELLO_GATE_REMOVE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var gatePath = root.GetProperty("payload").TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    var ok = HelloGateService.Instance.RemoveGate(gatePath);
                    PostMeshIpcResult(idProp, "HELLO_GATE_REMOVE_RESULT", new { ok });
                }
                else if (type == "HELLO_GATE_CHECK")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var checkPath = root.GetProperty("payload").TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    var resolved = ShellPathResolver.ResolveForShell(checkPath);
                    if (string.IsNullOrEmpty(resolved)) resolved = ShellPathResolver.NormalizeIncoming(checkPath);
                    var blocked = HelloGateService.Instance.IsBlocked(resolved);
                    var gatePath = HelloGateService.Instance.GetBlockingGatePath(resolved);
                    PostMeshIpcResult(idProp, "HELLO_GATE_CHECK_RESULT", new { blocked, gatePath });
                }
                else if (type == "HELLO_GATE_UNLOCK")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var unlockPath = payload.TryGetProperty("path", out var pEl) ? pEl.GetString() ?? "" : "";
                    var passphrase = payload.TryGetProperty("passphrase", out var passEl) ? passEl.GetString() : null;
                    var resolved = ShellPathResolver.ResolveForShell(unlockPath);
                    if (string.IsNullOrEmpty(resolved)) resolved = ShellPathResolver.NormalizeIncoming(unlockPath);
                    _ = Task.Run(async () =>
                    {
                        try
                        {
                            var result = await HelloGateService.Instance.UnlockAsync(resolved, passphrase).ConfigureAwait(false);
                            if (!result.ok && result.error?.Contains("Passphrase required", StringComparison.OrdinalIgnoreCase) == true
                                && string.IsNullOrWhiteSpace(passphrase))
                            {
                                string? hostPass = null;
                                await PostToUiAsync(() =>
                                {
                                    var dlg = new BNDZ.Dialogs.HelloGatePasswordDialog(resolved) { Owner = this };
                                    if (dlg.ShowDialog() == true) hostPass = dlg.Passphrase;
                                }).ConfigureAwait(false);
                                if (!string.IsNullOrWhiteSpace(hostPass))
                                    result = await HelloGateService.Instance.UnlockAsync(resolved, hostPass).ConfigureAwait(false);
                            }
                            PostMeshIpcResult(idProp, "HELLO_GATE_UNLOCK_RESULT", new { ok = result.ok, error = result.error, method = result.method });
                        }
                        catch (Exception ex)
                        {
                            PostMeshIpcResult(idProp, "HELLO_GATE_UNLOCK_RESULT", new { ok = false, error = ex.Message, method = "error" });
                        }
                    });
                }
                // ── Live Share Cursor ──
                else if (type == "LIVE_SHARE_START")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var folderPath = root.GetProperty("payload").TryGetProperty("folderPath", out var fpEl) ? fpEl.GetString() ?? "" : "";
                    var resolved = ShellPathResolver.ResolveForShell(folderPath);
                    if (string.IsNullOrEmpty(resolved)) resolved = ShellPathResolver.NormalizeIncoming(folderPath);
                    var session = LiveShareCursorService.Instance.Start(resolved);
                    PostMeshIpcResult(idProp, "LIVE_SHARE_START_RESULT", new { ok = true, peerId = session.PeerId, machineName = session.MachineName });
                }
                else if (type == "LIVE_SHARE_STOP")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var folderPath = root.GetProperty("payload").TryGetProperty("folderPath", out var fpEl) ? fpEl.GetString() ?? "" : "";
                    var resolved = ShellPathResolver.ResolveForShell(folderPath);
                    if (string.IsNullOrEmpty(resolved)) resolved = ShellPathResolver.NormalizeIncoming(folderPath);
                    LiveShareCursorService.Instance.Stop(resolved);
                    PostMeshIpcResult(idProp, "LIVE_SHARE_STOP_RESULT", new { ok = true });
                }
                else if (type == "LIVE_SHARE_UPDATE")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var payload = root.GetProperty("payload");
                    var folderPath = payload.TryGetProperty("folderPath", out var fpEl) ? fpEl.GetString() ?? "" : "";
                    var resolved = ShellPathResolver.ResolveForShell(folderPath);
                    if (string.IsNullOrEmpty(resolved)) resolved = ShellPathResolver.NormalizeIncoming(folderPath);
                    string[] selection = Array.Empty<string>();
                    if (payload.TryGetProperty("selectionPaths", out var selEl) && selEl.ValueKind == JsonValueKind.Array)
                    {
                        selection = selEl.EnumerateArray().Select(e => e.GetString() ?? "").Where(s => !string.IsNullOrWhiteSpace(s)).ToArray();
                    }
                    var cursorPath = payload.TryGetProperty("cursorPath", out var curEl) ? curEl.GetString() : null;
                    LiveShareCursorService.Instance.Update(resolved, selection, cursorPath);
                    PostMeshIpcResult(idProp, "LIVE_SHARE_UPDATE_RESULT", new { ok = true });
                }
                else if (type == "LIVE_SHARE_GET_PEERS")
                {
                    var idProp = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var folderPath = root.GetProperty("payload").TryGetProperty("folderPath", out var fpEl) ? fpEl.GetString() ?? "" : "";
                    var resolved = ShellPathResolver.ResolveForShell(folderPath);
                    if (string.IsNullOrEmpty(resolved)) resolved = ShellPathResolver.NormalizeIncoming(folderPath);
                    var peers = LiveShareCursorService.Instance.GetPeers(resolved);
                    PostMeshIpcResult(idProp, "LIVE_SHARE_GET_PEERS_RESULT", new { peers });
                }
                else if (type == "COMPARE_DIRECTORIES")
                {
                    var payload = root.GetProperty("payload");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var pathA = payload.TryGetProperty("pathA", out var pa) ? pa.GetString() ?? "" : "";
                    var pathB = payload.TryGetProperty("pathB", out var pb) ? pb.GetString() ?? "" : "";
                    var useHashing = payload.TryGetProperty("useHashing", out var uh) && uh.ValueKind == JsonValueKind.True;
                    _ = Task.Run(async () =>
                    {
                        var items = await DirectoryCompareService.CompareAsync(pathA, pathB, useHashing);
                        var response = new { type = "COMPARE_DIRECTORIES_RESULT", id = idProp, payload = items };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        await PostToUiAsync(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)); } catch { }
                        });
                    });
                }
                else if (type == "COMPARE_FILES")
                {
                    var payload = root.GetProperty("payload");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var pathA = payload.TryGetProperty("pathA", out var pa) ? pa.GetString() ?? "" : "";
                    var pathB = payload.TryGetProperty("pathB", out var pb) ? pb.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        var result = await FileCompareService.CompareAsync(pathA, pathB);
                        var response = new { type = "COMPARE_FILES_RESULT", id = idProp, payload = result };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        await PostToUiAsync(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)); } catch { }
                        });
                    });
                }
                else if (type == "OPEN_LEGAL_DOC")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    string docKey = "";
                    if (root.TryGetProperty("payload", out var legalPayload)
                        && legalPayload.TryGetProperty("doc", out var docEl))
                        docKey = docEl.GetString() ?? "";

                    var fileName = docKey switch
                    {
                        "eula" => "EULA.md",
                        "privacy" => "PRIVACY.md",
                        "third-party" => "THIRD_PARTY_LICENSES.md",
                        _ => ""
                    };

                    bool ok = false;
                    string? error = null;
                    if (string.IsNullOrEmpty(fileName))
                    {
                        error = "Unknown legal document.";
                    }
                    else
                    {
                        var legalPath = Path.Combine(AppContext.BaseDirectory, "Assets", "legal", fileName);
                        if (!File.Exists(legalPath))
                            error = $"Document not found: {fileName}";
                        else
                        {
                            try
                            {
                                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(legalPath)
                                {
                                    UseShellExecute = true
                                });
                                ok = true;
                            }
                            catch (Exception ex)
                            {
                                error = ex.Message;
                            }
                        }
                    }

                    var response = new { type = "OPEN_LEGAL_DOC_RESULT", id = idProp, payload = new { ok, error } };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() =>
                        MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
                else if (type == "GET_LICENSE_STATUS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var status = LicenseService.GetStatus();
                    var payload = new
                    {
                        activated = status.Activated,
                        canUseApp = status.CanUseApp,
                        trialExpired = status.TrialExpired,
                        trialDaysTotal = status.TrialDaysTotal,
                        trialDaysRemaining = status.TrialDaysRemaining,
                        trialEndsAt = status.TrialEndsAt,
                        email = status.Email,
                        name = status.Name,
                        serialMasked = status.SerialMasked,
                        onlineBound = status.OnlineBound,
                        licenseMode = status.LicenseMode,
                    };
                    var response = new { type = "LICENSE_STATUS_RESULT", id = idProp, payload };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() =>
                        MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
                else if (type == "ACTIVATE_LICENSE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string serial = payload.TryGetProperty("serial", out var sEl) ? sEl.GetString() ?? "" : "";
                    string email = payload.TryGetProperty("email", out var eEl) ? eEl.GetString() ?? "" : "";
                    string name = payload.TryGetProperty("name", out var nEl) ? nEl.GetString() ?? "" : "";
                    _ = Task.Run(async () =>
                    {
                        var (success, message) = await LicenseService.ActivateAsync(serial, email, name).ConfigureAwait(false);
                        var response = new { type = "ACTIVATE_LICENSE_RESULT", id = idProp, payload = new { success, message } };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() =>
                            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "DEACTIVATE_LICENSE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(async () =>
                    {
                        await LicenseService.DeactivateAsync().ConfigureAwait(false);
                        var response = new { type = "DEACTIVATE_LICENSE_RESULT", id = idProp, payload = new { success = true } };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() =>
                            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                    });
                }
                else if (type == "GET_TAGS_CONFIG")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var tagsConfigPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BNDZ64", "tags-config.json");
                    List<object> tags;
                    try
                    {
                        if (File.Exists(tagsConfigPath))
                        {
                            var saved = JsonSerializer.Deserialize<List<Dictionary<string, string>>>(File.ReadAllText(tagsConfigPath));
                            tags = (saved ?? new List<Dictionary<string, string>>())
                                .Select(t => {
                                    var n = t.TryGetValue("name", out var nv) ? nv : (t.TryGetValue("id", out var iv) ? iv : "");
                                    var l = t.TryGetValue("label", out var lv) ? lv : n;
                                    var c = t.TryGetValue("color", out var cv) ? cv : "#888888";
                                    return (object)new { name = n, id = n, label = l, color = c };
                                }).ToList<object>();
                        }
                        else
                        {
                            tags = new List<object>
                            {
                                new { name = "red",    id = "red",    label = "Important", color = "#ff4444" },
                                new { name = "orange", id = "orange", label = "Work",      color = "#ff9900" },
                                new { name = "yellow", id = "yellow", label = "Personal",  color = "#ffdd00" },
                                new { name = "green",  id = "green",  label = "Approved",  color = "#00cc44" },
                                new { name = "blue",   id = "blue",   label = "To Review", color = "#0088ff" },
                                new { name = "purple", id = "purple", label = "Archive",   color = "#aa00ff" },
                            };
                        }
                    }
                    catch
                    {
                        tags = new List<object>
                        {
                            new { name = "red",    id = "red",    label = "Important", color = "#ff4444" },
                            new { name = "orange", id = "orange", label = "Work",      color = "#ff9900" },
                            new { name = "yellow", id = "yellow", label = "Personal",  color = "#ffdd00" },
                            new { name = "green",  id = "green",  label = "Approved",  color = "#00cc44" },
                            new { name = "blue",   id = "blue",   label = "To Review", color = "#0088ff" },
                            new { name = "purple", id = "purple", label = "Archive",   color = "#aa00ff" },
                        };
                    }
                    var response = new { type = "TAGS_CONFIG_RESULT", id = idProp, payload = tags };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
                    });
                }
                else if (type == "SAVE_TAGS_CONFIG")
                {
                    try
                    {
                        var tagsConfigPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BNDZ64", "tags-config.json");
                        var tagsEl = root.GetProperty("payload").GetProperty("tags");
                        File.WriteAllText(tagsConfigPath, tagsEl.GetRawText());
                    }
                    catch { /* non-critical */ }
                }
                else if (type == "APPLY_TAGS")
                {
                    var payload = root.GetProperty("payload");
                    var paths = JsonSerializer.Deserialize<List<string>>(payload.GetProperty("paths").GetRawText()) ?? new List<string>();
                    var tags = JsonSerializer.Deserialize<List<string>>(payload.GetProperty("tags").GetRawText()) ?? new List<string>();
                    _tagSidecarStore.ApplyTags(paths, tags);
                }
                else if (type == "GET_TAG_SIDECAR")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var path = root.GetProperty("payload").GetProperty("path").GetString() ?? "";
                    var entry = _tagSidecarStore.Get(path);
                    var response = new { type = "TAG_SIDECAR_RESULT", id = idProp, payload = entry };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() =>
                        MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
                else if (type == "SET_TAG_META")
                {
                    var payload = root.GetProperty("payload");
                    var path = payload.GetProperty("path").GetString() ?? "";
                    string? label = payload.TryGetProperty("label", out var lEl) ? lEl.GetString() : null;
                    string? comment = payload.TryGetProperty("comment", out var cEl) ? cEl.GetString() : null;
                    List<string>? tags = null;
                    if (payload.TryGetProperty("tags", out var tEl) && tEl.ValueKind == JsonValueKind.Array)
                        tags = JsonSerializer.Deserialize<List<string>>(tEl.GetRawText());
                    _tagSidecarStore.SetMeta(path, label, comment, tags);
                }
                else if (type == "SET_TAG_META_BATCH")
                {
                    var payload = root.GetProperty("payload");
                    if (!payload.TryGetProperty("items", out var itemsEl) || itemsEl.ValueKind != JsonValueKind.Array)
                        return;
                    var batch = new List<(string path, string? label, string? comment, List<string>? tags)>();
                    foreach (var item in itemsEl.EnumerateArray())
                    {
                        var path = item.GetProperty("path").GetString() ?? "";
                        string? label = item.TryGetProperty("label", out var lEl) ? lEl.GetString() : null;
                        string? comment = item.TryGetProperty("comment", out var cEl) ? cEl.GetString() : null;
                        List<string>? tags = null;
                        if (item.TryGetProperty("tags", out var tEl) && tEl.ValueKind == JsonValueKind.Array)
                            tags = JsonSerializer.Deserialize<List<string>>(tEl.GetRawText());
                        batch.Add((path, label, comment, tags));
                    }
                    if (batch.Count > 0)
                        _tagSidecarStore.SetMetaBatch(batch);
                }
                else if (type == "CATALOG_LIST")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var catalogs = _catalogStore.GetAll();
                    var response = new { type = "CATALOG_LIST_RESULT", id = idProp, payload = catalogs };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() =>
                        MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
                else if (type == "CATALOG_UPSERT")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string? id = payload.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    string name = payload.GetProperty("name").GetString() ?? "";
                    var paths = payload.TryGetProperty("paths", out var pEl)
                        ? JsonSerializer.Deserialize<List<string>>(pEl.GetRawText()) ?? new List<string>()
                        : new List<string>();
                    string? query = payload.TryGetProperty("query", out var qEl) ? qEl.GetString() : null;
                    var entry = _catalogStore.Upsert(id, name, paths, query);
                    var response = new { type = "CATALOG_UPSERT_RESULT", id = idProp, payload = entry };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() =>
                        MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
                else if (type == "CATALOG_DELETE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var catalogId = root.GetProperty("payload").GetProperty("id").GetString() ?? "";
                    var ok = _catalogStore.Delete(catalogId);
                    var response = new { type = "CATALOG_DELETE_RESULT", id = idProp, payload = new { ok } };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() =>
                        MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
                else if (type == "CATALOG_CONTENTS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var catalogPath = root.GetProperty("payload").GetProperty("path").GetString() ?? "";
                    var norm = catalogPath.Replace('\\', '/').TrimEnd('/');
                    List<object> results;
                    if (norm == "/vf" || norm == "vf://" || norm.Equals("vf:", StringComparison.OrdinalIgnoreCase))
                    {
                        results = _catalogStore.ListAsVirtualFolders();
                    }
                    else
                    {
                        var slug = norm.StartsWith("/vf/", StringComparison.OrdinalIgnoreCase)
                            ? norm.Substring(4)
                            : norm.StartsWith("vf://", StringComparison.OrdinalIgnoreCase)
                                ? norm.Substring(5)
                                : norm;
                        var entry = _catalogStore.GetById(slug) ?? _catalogStore.GetBySlug(slug);
                        results = entry != null
                            ? _catalogStore.ResolveContentsWithSearch(entry, _tagSidecarStore, new EverythingSearchService())
                            : new List<object>();
                    }
                    var response = new { type = "CATALOG_CONTENTS_RESULT", id = idProp, payload = results };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() =>
                        MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
                else if (type == "RUN_USER_SCRIPT")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var payload = root.GetProperty("payload");
                    string shell = payload.TryGetProperty("shell", out var sEl) ? sEl.GetString() ?? "powershell" : "powershell";
                    string script = payload.GetProperty("script").GetString() ?? "";
                    string? cwd = payload.TryGetProperty("cwd", out var cwdEl) ? cwdEl.GetString() : null;
                    var (ok, output) = BndzUserScriptRunner.Run(shell, script, cwd);
                    var response = new { type = "RUN_USER_SCRIPT_RESULT", id = idProp, payload = new { ok, output } };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() =>
                        MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions)));
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Error processing WebView message: {ex.Message}");
                try
                {
                    // Always try to unblock the frontend promise when we know the request id.
                    using var errDoc = JsonDocument.Parse(messageStr);
                    var errRoot = errDoc.RootElement;
                    var errId = errRoot.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
                    var errType = errRoot.TryGetProperty("type", out var tEl) ? tEl.GetString() : null;
                    if (!string.IsNullOrEmpty(errId) && !string.IsNullOrEmpty(errType))
                    {
                        var resultType = LicenseService.ResolveIpcResultType(errType);
                        var payload = new { error = ex.Message };
                        var response = new { type = resultType, id = errId, payload };
                        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)); }
                            catch { }
                        });
                    }
                }
                catch { /* best-effort */ }
            }
        }

        /// <summary>
        /// High-priority IPC that must never wait behind DriveInfo / license / catalog work.
        /// Returns true when the request was fully handled (caller should return).
        /// </summary>
        private bool TryHandleFastIpc(string type, string? idProp, JsonElement root)
        {
            if (type == "IPC_PING")
            {
                var response = new { type = "IPC_PING_RESULT", id = idProp, payload = new { ok = true, utc = DateTime.UtcNow.ToString("o") } };
                PostToUi(() =>
                {
                    try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response)); }
                    catch { }
                });
                return true;
            }

            if (type == "REFRESH_WORKSPACE")
            {
                var response = new { type = "REFRESH_WORKSPACE_RESULT", id = idProp, payload = true };
                var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                PostToUi(() =>
                {
                    try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)); }
                    catch { }
                });
                PushDrivesUpdate();
                return true;
            }

            if (type == "GET_FILE_TRANSFER_QUEUE")
            {
                _ = Task.Run(() =>
                {
                    try
                    {
                        var response = new { type = "FILE_TRANSFER_QUEUE_RESULT", id = idProp, payload = _fileTransferQueue.GetQueueState() };
                        PostToUi(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response)); }
                            catch { }
                        });
                    }
                    catch (Exception ex)
                    {
                        var response = new
                        {
                            type = "FILE_TRANSFER_QUEUE_RESULT",
                            id = idProp,
                            payload = new { queuedCount = 0, activeCount = 0, jobs = Array.Empty<object>(), error = ex.Message },
                        };
                        PostToUi(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response)); }
                            catch { }
                        });
                    }
                });
                return true;
            }

            if (type == "RAM_STAGING_LIST_ZONES")
            {
                _ = Task.Run(() =>
                {
                    try
                    {
                        var zones = _ramStagingService.ListZones().Select(z => z.ToDto()).ToList();
                        var status = _ramStagingService.GetStatus();
                        PostMeshIpcResult(idProp, "RAM_STAGING_LIST_ZONES_RESULT", new { zones, status });
                    }
                    catch (Exception ex)
                    {
                        PostMeshIpcResult(idProp, "RAM_STAGING_LIST_ZONES_RESULT", new
                        {
                            zones = Array.Empty<object>(),
                            status = new { error = ex.Message },
                            error = ex.Message,
                        });
                    }
                });
                return true;
            }

            if (type == "GET_DRIVES")
            {
                _ = Task.Run(() =>
                {
                    try
                    {
                        var drives = _cloudStorageService.GetAnnotatedDrives();
                        var response = new { type = "DRIVES_RESULT", id = idProp, payload = drives };
                        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)); }
                            catch { }
                        });
                    }
                    catch (Exception ex)
                    {
                        var response = new { type = "DRIVES_RESULT", id = idProp, payload = Array.Empty<object>(), error = ex.Message };
                        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)); }
                            catch { }
                        });
                    }
                });
                return true;
            }

            if (type == "GET_NETWORK_LOCATIONS")
            {
                // DriveInfo.IsReady / WSL UNC / portable COM must never run on the UI thread —
                // that was freezing the host on startup ("BNDZ is not responding") and blocking
                // DRIVES_RESULT delivery so This PC / Drives showed empty.
                _ = Task.Run(() =>
                {
                    try
                    {
                        var nodes = _networkLocationsService.GetTreeNodes();
                        var response = new { type = "NETWORK_LOCATIONS_RESULT", id = idProp, payload = nodes };
                        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)); }
                            catch { }
                        });
                    }
                    catch (Exception ex)
                    {
                        var response = new { type = "NETWORK_LOCATIONS_RESULT", id = idProp, payload = Array.Empty<object>(), error = ex.Message };
                        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)); }
                            catch { }
                        });
                    }
                });
                return true;
            }

            if (type == "GET_CLOUD_PROVIDERS")
            {
                _ = Task.Run(() =>
                {
                    try
                    {
                        var providers = _cloudStorageService.GetProviders();
                        var response = new { type = "CLOUD_PROVIDERS_RESULT", id = idProp, payload = providers };
                        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)); }
                            catch { }
                        });
                    }
                    catch (Exception ex)
                    {
                        var response = new { type = "CLOUD_PROVIDERS_RESULT", id = idProp, payload = Array.Empty<object>(), error = ex.Message };
                        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        PostToUi(() =>
                        {
                            try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts)); }
                            catch { }
                        });
                    }
                });
                return true;
            }

            return false;
        }
        
        private void CoreWebView2_WebResourceRequested(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebResourceRequestedEventArgs e)
        {
            try
            {
                if (e.Request.Uri.StartsWith("http://bndz.local/assets/3d/", StringComparison.OrdinalIgnoreCase) || 
                    e.Request.Uri.StartsWith("https://bndz.local/assets/3d/", StringComparison.OrdinalIgnoreCase))
                {
                    string iconName = Uri.UnescapeDataString(System.IO.Path.GetFileName(new Uri(e.Request.Uri).LocalPath)).Replace(" ", "_");
                    var mapper = new NativeIconMapper();
                    var stream = mapper.GetIconStream(iconName);
                    if (stream != null)
                    {
                        var env = MainWebView.CoreWebView2.Environment;
                        var response = env.CreateWebResourceResponse(stream, 200, "OK", "Content-Type: image/png");
                        e.Response = response;
                    }
                }
                else if (LocalStreamService.IsStreamRequest(e.Request.Uri))
                {
                    string localPath = LocalStreamService.ParseLocalStreamPath(e.Request.Uri);
                    var env = MainWebView.CoreWebView2.Environment;
                    LocalStreamService.ServeLocalFile(env, e, localPath);
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[WebResourceRequested] Error: {ex.Message}");
            }
        }

        private void PostFileTransferQueueChanged()
        {
            // Queue notifications fire from worker threads; WebView2 must be touched on the UI thread.
            PostToUi(() =>
            {
                if (MainWebView.CoreWebView2 == null) return;
                var evt = new
                {
                    type = "FILE_TRANSFER_QUEUE_CHANGED",
                    payload = _fileTransferQueue.GetQueueState(),
                };
                try
                {
                    MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt));
                }
                catch { /* WebView may be tearing down */ }
            });
        }

        private void ApplyFileOperationPreferences()
        {
            var prefs = FileOperationPreferences.Current;
            _actionLogService.SetMaxEntries(prefs.SingleStepUndo ? 1 : prefs.MaxActionLogEntries);
            _actionLogService.ConfigurePersistence(prefs.RememberActionLogBetweenSessions, prefs.PersistActionLogOnExit);
            if (prefs.RememberActionLogBetweenSessions)
                _actionLogService.LoadPersistedIfEnabled();
            else if (!prefs.PersistActionLogOnExit)
                _actionLogService.ClearPersisted();
            _fileTransferQueue.SetPersistenceEnabled(prefs.PersistTransferQueue);
        }

        private void ApplyGlobalHotkeysFromSettingsJson(string? json)
        {
            try
            {
                using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(json) || json == "null" ? "{}" : json);
                var root = doc.RootElement;
                string? Read(params string[] keys)
                {
                    foreach (var key in keys)
                    {
                        if (root.TryGetProperty(key, out var el) && el.ValueKind == JsonValueKind.String)
                            return el.GetString();
                    }
                    if (root.TryGetProperty("keyboard", out var kb) && kb.ValueKind == JsonValueKind.Object)
                    {
                        foreach (var key in keys)
                        {
                            if (kb.TryGetProperty(key, out var el) && el.ValueKind == JsonValueKind.String)
                                return el.GetString();
                        }
                    }
                    return null;
                }

                // Defaults: Alt+Space show/hide (launcher-style), Ctrl+Shift+P palette, Ctrl+Shift+F search.
                var showHide = Read("globalShowHideHotkey", "showHideHotkey") ?? "Alt+Space";
                var palette = Read("globalCommandPaletteHotkey", "commandPaletteHotkey") ?? "Ctrl+Shift+P";
                var search = Read("globalSearchHotkey", "globalSearchHotkey") ?? "Ctrl+Shift+F";
                _globalHotkeys.ApplyFromSettings(showHide, palette, search);
            }
            catch
            {
                _globalHotkeys.ApplyFromSettings("Alt+Space", "Ctrl+Shift+P", "Ctrl+Shift+F");
            }
        }

        /// <summary>
        /// Gold path: first visit must extract into CAS. Force off settings that blank the list or
        /// flood IPC with hanging folder-shell thumbs on system roots.
        /// </summary>
        private string? SanitizeThumbnailSettingsJson(string? json)
        {
            if (string.IsNullOrWhiteSpace(json) || json == "null") return json;
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                var cachedOnly = root.TryGetProperty("showCachedThumbnailsOnly", out var elCached)
                    && elCached.ValueKind == JsonValueKind.True;
                var folderThumbs = root.TryGetProperty("showFolderThumbnails", out var elFolder)
                    && elFolder.ValueKind == JsonValueKind.True;
                var emptyThumbs = !BndzMediaDiskCache.Instance.HasAnyEntries(BndzMediaDiskCache.Kind.Thumbnail);

                // Always clear cached-only when catalog is empty. One-shot clear folder thumbs
                // (configContext used to default them on and hung GET_THUMBNAIL on C:\Windows etc.).
                var forceFolderOff = false;
                try
                {
                    var marker = Path.Combine(
                        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                        "BNDZ", "Cache", ".v4-folder-thumbs-off");
                    if (!File.Exists(marker))
                    {
                        forceFolderOff = folderThumbs;
                        Directory.CreateDirectory(Path.GetDirectoryName(marker)!);
                        File.WriteAllText(marker, "1");
                    }
                }
                catch { /* ignore */ }

                if ((!cachedOnly || !emptyThumbs) && !forceFolderOff)
                    return json;

                using var stream = new MemoryStream();
                using (var writer = new Utf8JsonWriter(stream))
                {
                    writer.WriteStartObject();
                    var wroteCached = false;
                    var wroteFolder = false;
                    foreach (var prop in root.EnumerateObject())
                    {
                        if (prop.NameEquals("showCachedThumbnailsOnly") && cachedOnly && emptyThumbs)
                        {
                            writer.WriteBoolean("showCachedThumbnailsOnly", false);
                            wroteCached = true;
                            continue;
                        }
                        if (prop.NameEquals("showFolderThumbnails") && forceFolderOff)
                        {
                            writer.WriteBoolean("showFolderThumbnails", false);
                            wroteFolder = true;
                            continue;
                        }
                        prop.WriteTo(writer);
                    }
                    if (cachedOnly && emptyThumbs && !wroteCached)
                        writer.WriteBoolean("showCachedThumbnailsOnly", false);
                    if (forceFolderOff && !wroteFolder)
                        writer.WriteBoolean("showFolderThumbnails", false);
                    writer.WriteEndObject();
                }
                var patched = Encoding.UTF8.GetString(stream.ToArray());
                _settingsManager.SaveSettings(patched);
                return patched;
            }
            catch
            {
                return json;
            }
        }

        private void OnGlobalHotkeyPressed(string id)
        {
            PostToUi(() =>
            {
                try
                {
                    if (string.Equals(id, GlobalHotkeyService.ShowHideId, StringComparison.OrdinalIgnoreCase))
                    {
                        if (IsVisible && WindowState != WindowState.Minimized && IsActive)
                        {
                            WindowState = WindowState.Minimized;
                        }
                        else
                        {
                            ShowAndActivate();
                        }
                    }

                    MainWebView?.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(new
                    {
                        type = "GLOBAL_HOTKEY",
                        payload = new { id },
                    }));
                }
                catch { }
            });
        }

        private static FileTransferPriority ParseTransferPriority(JsonElement payload)
        {
            if (!payload.TryGetProperty("priority", out var prop)) return FileTransferPriority.Normal;
            return prop.GetString()?.ToLowerInvariant() switch
            {
                "high" => FileTransferPriority.High,
                "low" => FileTransferPriority.Low,
                _ => FileTransferPriority.Normal,
            };
        }

        private async Task RunTransferWorkAsync(
        string operationId,
        Func<CancellationToken, Task> work,
        FileTransferPriority priority = FileTransferPriority.Normal,
        bool deleteLane = false)
        {
            var prefs = FileOperationPreferences.Current;
            if (prefs.QueueOperations)
                await _fileTransferQueue.EnqueueAsync(operationId, work, default, priority, deleteLane).ConfigureAwait(false);
            else
                await _fileTransferQueue.RunImmediateAsync(operationId, work).ConfigureAwait(false);
        }

        private static readonly JsonSerializerOptions IpcJsonOptions = new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        };

        private static bool ShouldPostDeferredIpcResult() =>
            !FileOperationPreferences.Current.BackgroundProcessing;

        private static bool ShouldPostFsOperationResult() => ShouldPostDeferredIpcResult();

        private static object BackgroundIpcAck() => new { ok = true, success = true, background = true, queued = true };

        private async Task PostIpcResultAsync(string responseType, string? idProp, object payload)
        {
            if (string.IsNullOrEmpty(idProp)) return;
            var response = new { type = responseType, id = idProp, payload };
            await PostToUiAsync(() =>
            {
                MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions));
            }).ConfigureAwait(false);
        }

        /// <summary>Runs transfer work on the queue or inline. When background processing is enabled,
        /// acknowledges the IPC caller immediately and continues work asynchronously.</summary>
        private async Task ScheduleTransferWorkAsync(
            string operationId,
            Func<CancellationToken, Task> work,
            FileTransferPriority priority = FileTransferPriority.Normal,
            string? ipcIdProp = null,
            string? ipcResultType = null,
            bool deleteLane = false)
        {
            var prefs = FileOperationPreferences.Current;

            async Task RunWorkAsync()
            {
                try
                {
                    await RunTransferWorkAsync(operationId, work, priority, deleteLane).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Transfer] {operationId} failed: {ex.Message}");
                }
            }

            if (prefs.BackgroundProcessing && !string.IsNullOrEmpty(ipcIdProp) && !string.IsNullOrEmpty(ipcResultType))
            {
                await PostIpcResultAsync(ipcResultType, ipcIdProp, BackgroundIpcAck()).ConfigureAwait(false);
                _ = RunWorkAsync();
                return;
            }

            await RunWorkAsync().ConfigureAwait(false);
        }

        private static string BuildFileOpLabel(string action, List<string> sources, string? labelOverride)
        {
            if (!string.IsNullOrWhiteSpace(labelOverride)) return labelOverride;
            if (sources.Count == 1)
            {
                var name = Path.GetFileName(sources[0].TrimEnd('\\', '/'));
                return string.IsNullOrEmpty(name) ? sources[0] : name;
            }
            return $"{sources.Count} items";
        }

        private async Task HandleExecuteFsOperationAsync(
            string operationId,
            string action,
            List<string> sources,
            string target,
            bool bypassRecycleBin,
            string? labelOverride,
            FileTransferPriority priority = FileTransferPriority.Normal,
            bool recreateSourceStructure = false,
            string? idProp = null)
        {
            var prefs = FileOperationPreferences.Current;
            if (!recreateSourceStructure
                && string.Equals(prefs.RecreateSourceFolderStructure, "Always", StringComparison.OrdinalIgnoreCase)
                && FileOperationPathPlanner.ShouldRecreateStructure(sources))
            {
                recreateSourceStructure = true;
            }
            var engine = FileOperationPreferences.ResolveOperationEngine(action, sources, target);
            var label = BuildFileOpLabel(action, sources, labelOverride);

            if (action is "copy" or "move" && !string.IsNullOrWhiteSpace(target))
            {
                try
                {
                    var policyCheck = PolicyPackService.Instance.ValidateTransfer(target, sources, _tagSidecarStore);
                    if (!policyCheck.Allowed)
                    {
                        var policyMsg = policyCheck.Violations.FirstOrDefault()?.Message
                            ?? $"Policy pack '{policyCheck.PackName ?? "pack"}' blocked this transfer.";
                        _fileTransferQueue.RegisterJob(operationId, action, label, engine, Math.Max(sources.Count, 1), "fs", priority, target);
                        _fileTransferQueue.MarkFailed(operationId, policyMsg);
                        if (!string.IsNullOrEmpty(idProp))
                            PostMeshIpcResult(idProp, "EXECUTE_FS_OPERATION_RESULT", new { ok = false, error = policyMsg, policyBlocked = true, violations = policyCheck.Violations });
                        return;
                    }
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"[PolicyPack] transfer check failed: {ex.Message}");
                }
            }

            _fileTransferQueue.RegisterJob(operationId, action, label, engine, Math.Max(sources.Count, 1), "fs", priority, target);

            if (prefs.DefaultRepeatOnCollision && (action == "copy" || action == "move"))
                _conflictBatchResolution[operationId] = "replace";

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                void OnProgress(string opId, int percentage, string currentFile, long bytesTransferred, long totalBytes, double speedBytesPerSecond, int itemsCompleted, int totalItems)
                {
                    _fileTransferQueue.UpdateProgress(opId, percentage, currentFile, itemsCompleted, totalItems, bytesTransferred, totalBytes, speedBytesPerSecond);
                    var evt = new
                    {
                        type = "PROGRESS_UPDATE",
                        payload = new
                        {
                            operationId = opId,
                            percentage,
                            currentFile,
                            bytesTransferred,
                            totalBytes,
                            speedBytesPerSecond,
                            itemsCompleted,
                            totalItems,
                            engine,
                        },
                    };
                    PostToUi(() =>
                    {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt));
                    });
                }

                void OnAccessDenied(string opId, string message)
                {
                    var evt = new
                    {
                        type = "ELEVATION_REQUIRED",
                        payload = new
                        {
                            title = "Administrator approval required",
                            message = $"{message}\n\nSome file operations need elevated permissions. Restart BNDZ as administrator?",
                            context = "fileOperation",
                            operationId = opId,
                        },
                    };
                    PostToUi(() =>
                    {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt));
                    });
                }

                try
                {
                    // Snapshot destinations BEFORE execute — after a move, sources no longer exist
                    // and Plan() would return empty (missing Action History destinations).
                    IReadOnlyList<(string Src, string Dest)>? plannedTargets = null;
                    if (action is "copy" or "move" or "rename")
                    {
                        plannedTargets = FileOperationPathPlanner.Plan(action == "rename" ? "move" : action, sources, target, recreateSourceStructure);
                    }

                    try
                    {
                        var plannedDests = plannedTargets?.Select(p => p.Dest).ToList();
                        ProjectSandboxService.Instance.RecordIntent(
                            operationId,
                            action,
                            sources,
                            string.IsNullOrWhiteSpace(target) ? null : target,
                            null,
                            plannedDests);
                    }
                    catch { }

                    if (engine == "teracopy" && action is "copy" or "move")
                    {
                        var result = _externalCopyHandler.Execute(
                            action,
                            sources,
                            target,
                            action == "move",
                            ct,
                            proc => _fileTransferQueue.AttachProcess(operationId, proc));
                        if (!result.Ok)
                        {
                            if (result.NotInstalled)
                                throw new InvalidOperationException(result.Error ?? "TeraCopy is not installed. Install TeraCopy or change the copy handler in Settings.");
                            throw new IOException(result.Error ?? "TeraCopy operation failed.");
                        }
                        _fileTransferQueue.DetachProcess(operationId);
                        OnProgress(operationId, 99, target, 0, 0, 0, sources.Count, sources.Count);
                        RecordExternalActionLog(action, sources, target, bypassRecycleBin, plannedTargets);
                    }
                    else if (engine == "native")
                    {
                        if (action is "copy" or "move" or "delete")
                        {
                            var valid = sources.Where(s =>
                                !string.IsNullOrWhiteSpace(s)
                                && (File.Exists(s) || Directory.Exists(s)
                                    || PortableDeviceService.IsPortableDevicePath(s)
                                    || ShellPathResolver.IsShellVirtualPath(s))).ToList();
                            if (valid.Count == 0)
                                throw new FileNotFoundException("None of the source items exist. The operation could not run.");
                            sources = valid;
                            if (action is "copy" or "move")
                                plannedTargets = FileOperationPathPlanner.Plan(action, sources, target, recreateSourceStructure);
                        }
                        await _nativeFileOperationService.ExecuteOperationAsync(
                            operationId,
                            action,
                            sources,
                            target,
                            bypassRecycleBin,
                            OnProgress,
                            ct,
                            prefs.ShouldShowNativeProgress(action, sources, target),
                            OnAccessDenied).ConfigureAwait(false);
                        RecordExternalActionLog(action, sources, target, bypassRecycleBin, plannedTargets);
                    }
                    else
                    {
                        await _fileOperationService.ExecuteOperationAsync(
                            operationId,
                            action,
                            sources,
                            target,
                            bypassRecycleBin,
                            onProgress: OnProgress,
                            onConflict: async (opId, fileName, srcPath, destPath) =>
                            {
                                if (_conflictBatchResolution.TryGetValue(opId, out var batchResolution))
                                    return batchResolution;

                                var evt = new { type = "CONFLICT_DETECTED", payload = new { operationId = opId, fileName, sourcePath = srcPath, destPath } };
                                var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
                                string conflictKey = $"{opId}:{fileName}";
                                _conflictResolvers[conflictKey] = tcs;

                                PostToUi(() =>
                                {
                                    MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt));
                                });

                                var completed = await Task.WhenAny(tcs.Task, Task.Delay(TimeSpan.FromSeconds(90))).ConfigureAwait(false);
                                if (completed != tcs.Task)
                                {
                                    _conflictResolvers.TryRemove(conflictKey, out _);
                                    return _conflictBatchResolution.TryGetValue(opId, out var fallback)
                                        ? fallback
                                        : (prefs.DefaultRepeatOnCollision ? "replace" : "keepboth");
                                }
                                return await tcs.Task.ConfigureAwait(false);
                            },
                            recordActionLog: true,
                            onAccessDenied: OnAccessDenied,
                            recreateSourceStructure: recreateSourceStructure,
                            cancellationToken: ct).ConfigureAwait(false);
                    }

                    if ((action is "copy" or "move") && prefs.CopyTagsOnCopyOperations)
                    {
                        var mappings = plannedTargets
                            ?? FileOperationPathPlanner.Plan(action, sources, target, recreateSourceStructure);
                        _tagSidecarStore.CopyMetadata(mappings);
                    }

                    try
                    {
                        if (action is "copy" or "move")
                        {
                            foreach (var s in sources)
                            {
                                var destFile = plannedTargets?.Where(pt => string.Equals(pt.Src, s, StringComparison.OrdinalIgnoreCase))
                                    .Select(pt => pt.Dest).FirstOrDefault();
                                if (string.IsNullOrEmpty(destFile))
                                    destFile = !string.IsNullOrEmpty(target) ? Path.Combine(target, Path.GetFileName(s)) : s;
                                FileLineageService.Instance.RecordEdge(s, destFile, action);
                                _ = FileLineageService.Instance.RecordContentLineageOnCopyAsync(s, destFile, action);
                            }
                        }
                        else if (action == "delete")
                        {
                            foreach (var s in sources)
                                FileLineageService.Instance.RecordEdge(s, s, "delete");
                        }
                    }
                    catch { }

                    _conflictBatchResolution.TryRemove(operationId, out var _unusedBatchResolution);
                    _fileTransferQueue.MarkCompleted(operationId);
                    if (ShouldPostFsOperationResult())
                        await PostFsOperationResultAsync(idProp, true, null).ConfigureAwait(false);

                    foreach (var src in sources)
                    {
                        string dir = Directory.Exists(src) ? src : (Path.GetDirectoryName(src) ?? src);
                        if (!string.IsNullOrEmpty(dir))
                            QueueFsEvent(action == "delete" ? "Deleted" : "Changed", dir, Path.GetFileName(src) ?? "");
                    }
                    if (!string.IsNullOrEmpty(target) && (action == "copy" || action == "move"))
                        QueueFsEvent("Changed", Path.GetDirectoryName(target) ?? target, Path.GetFileName(target) ?? "");
                    FlushFsEvents();
                    try
                    {
                        await PostToUiAsync(PostActionLogChanged).ConfigureAwait(false);
                    }
                    catch (Exception logEx)
                    {
                        Debug.WriteLine($"[FS] PostActionLogChanged failed: {logEx.Message}");
                    }
                }
                catch (OperationCanceledException)
                {
                    _fileTransferQueue.MarkCancelled(operationId);
                    if (ShouldPostFsOperationResult())
                        await PostFsOperationResultAsync(idProp, false, "Cancelled").ConfigureAwait(false);
                    throw;
                }
                catch (Exception ex)
                {
                    _fileTransferQueue.MarkFailed(operationId, ex.Message);
                    var failEvt = new
                    {
                        type = "PROGRESS_UPDATE",
                        payload = new
                        {
                            operationId,
                            percentage = -1,
                            currentFile = "",
                            error = ex.Message,
                            engine,
                        },
                    };
                    PostToUi(() =>
                    {
                        try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(failEvt)); }
                        catch { }
                    });
                    if (ShouldPostFsOperationResult())
                        await PostFsOperationResultAsync(idProp, false, ex.Message).ConfigureAwait(false);
                    throw;
                }
            }

            // Deletes go to the fast-lane so they are never blocked by an in-progress copy/move.
            var isDeleteOp = string.Equals(action, "delete", StringComparison.OrdinalIgnoreCase);
            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, priority, idProp, "FS_OPERATION_RESULT", deleteLane: isDeleteOp).ConfigureAwait(false);
        }

        private Task PostFsOperationResultAsync(string? idProp, bool ok, string? error, bool background = false)
        {
            if (!background && !ShouldPostDeferredIpcResult()) return Task.CompletedTask;
            return PostIpcResultAsync("FS_OPERATION_RESULT", idProp, new { ok, error, background, queued = background });
        }

        private async Task HandleFolderSyncRunAsync(string? idProp, string jobId)
        {
            var syncJob = _folderSyncService.GetJobs().FirstOrDefault(j => j.Id == jobId);
            var operationId = $"folder-sync-{jobId}-{DateTime.UtcNow.Ticks}";
            var label = string.IsNullOrWhiteSpace(syncJob?.Name) ? "Folder sync" : syncJob!.Name;
            _fileTransferQueue.RegisterJob(operationId, "folder-sync", label, "bndz", 1, "folder-sync", FileTransferPriority.Low, syncJob?.DestPath);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                _activeFolderSyncTransferOpId = operationId;
                try
                {
                    _fileTransferQueue.UpdateProgress(operationId, 5, null, 0, 100);
                    var job = await _folderSyncService.RunSyncAsync(jobId, ct).ConfigureAwait(false);
                    _fileTransferQueue.MarkCompleted(operationId);
                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new { type = "FOLDER_SYNC_RUN_RESULT", id = idProp, payload = job };
                        await PostToUiAsync(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response))).ConfigureAwait(false);
                    }
                }
                catch (OperationCanceledException)
                {
                    _fileTransferQueue.MarkCancelled(operationId);
                    throw;
                }
                catch (Exception ex)
                {
                    _fileTransferQueue.MarkFailed(operationId, ex.Message);
                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new { type = "FOLDER_SYNC_RUN_RESULT", id = idProp, payload = new { error = ex.Message } };
                        await PostToUiAsync(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response))).ConfigureAwait(false);
                    }
                    throw;
                }
                finally
                {
                    _activeFolderSyncTransferOpId = null;
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.Low, idProp, "FOLDER_SYNC_RUN_RESULT").ConfigureAwait(false);
        }

        private async Task HandleArchiveAddFilesAsync(string? idProp, string archivePath, List<string> sources, List<string>? entryNames)
        {
            var operationId = $"archive-add-{DateTime.UtcNow.Ticks}";
            var label = $"Add to archive · {Path.GetFileName(archivePath)}";
            _fileTransferQueue.RegisterJob(operationId, "archive-add", label, "bndz", Math.Max(sources.Count, 1), "archive", FileTransferPriority.Low);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                try
                {
                    ct.ThrowIfCancellationRequested();
                    _fileTransferQueue.UpdateProgress(operationId, 10, archivePath, 0, sources.Count);
                    _archiveService.AddFilesToArchive(archivePath, sources, entryNames);
                    _fileTransferQueue.MarkCompleted(operationId);
                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new { type = "ARCHIVE_ADD_FILES_RESULT", id = idProp, payload = new { success = true } };
                        await PostToUiAsync(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions))).ConfigureAwait(false);
                    }
                }
                catch (OperationCanceledException)
                {
                    _fileTransferQueue.MarkCancelled(operationId);
                    throw;
                }
                catch (Exception ex)
                {
                    _fileTransferQueue.MarkFailed(operationId, ex.Message);
                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new { type = "ARCHIVE_ADD_FILES_RESULT", id = idProp, payload = new { success = false, error = ex.Message } };
                        await PostToUiAsync(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions))).ConfigureAwait(false);
                    }
                    throw;
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.Low, idProp, "ARCHIVE_ADD_FILES_RESULT").ConfigureAwait(false);
        }

        private async Task HandleArchiveExtractEntryAsync(string? idProp, string archivePath, string entryPath, string destination)
        {
            var operationId = $"archive-extract-{DateTime.UtcNow.Ticks}";
            var label = $"Extract · {Path.GetFileName(entryPath.TrimEnd('/', '\\'))}";
            _fileTransferQueue.RegisterJob(operationId, "archive-extract", label, "bndz", 1, "archive", FileTransferPriority.Low, destination);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                try
                {
                    ct.ThrowIfCancellationRequested();
                    _fileTransferQueue.UpdateProgress(operationId, 15, entryPath, 0, 1);
                    _archiveService.ExtractEntry(archivePath, entryPath, destination);
                    _fileTransferQueue.MarkCompleted(operationId);
                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new { type = "ARCHIVE_EXTRACT_ENTRY_RESULT", id = idProp, payload = new { success = true } };
                        await PostToUiAsync(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions))).ConfigureAwait(false);
                    }
                }
                catch (OperationCanceledException)
                {
                    _fileTransferQueue.MarkCancelled(operationId);
                    throw;
                }
                catch (Exception ex)
                {
                    _fileTransferQueue.MarkFailed(operationId, ex.Message);
                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new { type = "ARCHIVE_EXTRACT_ENTRY_RESULT", id = idProp, payload = new { success = false, error = ex.Message } };
                        await PostToUiAsync(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions))).ConfigureAwait(false);
                    }
                    throw;
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.Low, idProp, "ARCHIVE_EXTRACT_ENTRY_RESULT").ConfigureAwait(false);
        }

        private async Task HandleCreateArchiveAsync(string operationId, List<string> sources, string target, string format, string? idProp = null)
        {
            var label = $"Create archive · {Path.GetFileName(target)}";
            _fileTransferQueue.RegisterJob(operationId, "archive-create", label, "bndz", Math.Max(sources.Count, 1), "archive", FileTransferPriority.Normal, target);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                try
                {
                    await _archiveService.CreateArchiveAsync(
                        sources,
                        target,
                        format,
                        (pct, file) =>
                        {
                            ct.ThrowIfCancellationRequested();
                            var itemsDone = Math.Max(0, Math.Min(100, pct));
                            _fileTransferQueue.UpdateProgress(operationId, pct, file, itemsDone, 100);
                            var evt = new { type = "PROGRESS_UPDATE", payload = new { operationId, percentage = pct, currentFile = file, bytesTransferred = 0L, totalBytes = 0L, speedBytesPerSecond = 0.0, itemsCompleted = itemsDone, totalItems = 100 } };
                            PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(evt)));
                        },
                        ct,
                        proc => _fileTransferQueue.AttachProcess(operationId, proc)).ConfigureAwait(false);
                    _fileTransferQueue.DetachProcess(operationId);
                    _actionLogService.Record(BndzActionLogService.ForCreateArchive(target, sources));
                    _fileTransferQueue.MarkCompleted(operationId);
                    var done = new { type = "PROGRESS_UPDATE", payload = new { operationId, percentage = 100, currentFile = target, bytesTransferred = 0L, totalBytes = 0L, speedBytesPerSecond = 0.0, itemsCompleted = 100, totalItems = 100 } };
                    PostToUi(() => { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(done)); PostActionLogChanged(); });
                    await PostArchiveResultAsync("CREATE_ARCHIVE_RESULT", idProp, true, null).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    _fileTransferQueue.DetachProcess(operationId);
                    TryDeletePartialArchive(target);
                    _fileTransferQueue.MarkCancelled(operationId);
                    await PostArchiveResultAsync("CREATE_ARCHIVE_RESULT", idProp, false, "Cancelled").ConfigureAwait(false);
                    throw;
                }
                catch (Exception ex)
                {
                    _fileTransferQueue.DetachProcess(operationId);
                    _fileTransferQueue.MarkFailed(operationId, ex.Message);
                    var err = new { type = "PROGRESS_UPDATE", payload = new { operationId, percentage = 0, currentFile = "", error = ex.Message, bytesTransferred = 0L, totalBytes = 0L, speedBytesPerSecond = 0.0, itemsCompleted = 0, totalItems = 1 } };
                    PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(err)));
                    await PostArchiveResultAsync("CREATE_ARCHIVE_RESULT", idProp, false, ex.Message).ConfigureAwait(false);
                    throw;
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.Normal, idProp, "CREATE_ARCHIVE_RESULT").ConfigureAwait(false);
        }

        private static void TryDeletePartialArchive(string target)
        {
            try
            {
                if (!string.IsNullOrWhiteSpace(target) && File.Exists(target))
                    File.Delete(target);
            }
            catch { /* best-effort cleanup */ }
        }

        private async Task HandleExtractArchiveAsync(string operationId, string archivePath, string dest, string? idProp = null)
        {
            var label = $"Extract archive · {Path.GetFileName(archivePath)}";
            _fileTransferQueue.RegisterJob(operationId, "archive-extract", label, "bndz", 1, "archive", FileTransferPriority.Normal, dest);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                try
                {
                    await _archiveService.ExtractArchiveAsync(
                        archivePath,
                        dest,
                        (pct, file) =>
                        {
                            ct.ThrowIfCancellationRequested();
                            var itemsDone = Math.Max(0, Math.Min(100, pct));
                            _fileTransferQueue.UpdateProgress(operationId, pct, file, itemsDone, 100);
                            var evt = new { type = "PROGRESS_UPDATE", payload = new { operationId, percentage = pct, currentFile = file, bytesTransferred = 0L, totalBytes = 0L, speedBytesPerSecond = 0.0, itemsCompleted = itemsDone, totalItems = 100 } };
                            PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(evt)));
                        },
                        ct).ConfigureAwait(false);
                    _actionLogService.Record(BndzActionLogService.ForExtractArchive(archivePath, dest));
                    _fileTransferQueue.MarkCompleted(operationId);
                    var done = new { type = "PROGRESS_UPDATE", payload = new { operationId, percentage = 100, currentFile = dest, bytesTransferred = 0L, totalBytes = 0L, speedBytesPerSecond = 0.0, itemsCompleted = 100, totalItems = 100 } };
                    PostToUi(() => { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(done)); PostActionLogChanged(); });
                    await PostArchiveResultAsync("EXTRACT_ARCHIVE_RESULT", idProp, true, null).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    _fileTransferQueue.MarkCancelled(operationId);
                    await PostArchiveResultAsync("EXTRACT_ARCHIVE_RESULT", idProp, false, "Cancelled").ConfigureAwait(false);
                    throw;
                }
                catch (Exception ex)
                {
                    _fileTransferQueue.MarkFailed(operationId, ex.Message);
                    var err = new { type = "PROGRESS_UPDATE", payload = new { operationId, percentage = 0, currentFile = "", error = ex.Message, bytesTransferred = 0L, totalBytes = 0L, speedBytesPerSecond = 0.0, itemsCompleted = 0, totalItems = 1 } };
                    PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(err)));
                    await PostArchiveResultAsync("EXTRACT_ARCHIVE_RESULT", idProp, false, ex.Message).ConfigureAwait(false);
                    throw;
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.Normal, idProp, "EXTRACT_ARCHIVE_RESULT").ConfigureAwait(false);
        }

        private Task PostArchiveResultAsync(string responseType, string? idProp, bool ok, string? error)
        {
            if (!ShouldPostDeferredIpcResult()) return Task.CompletedTask;
            return PostIpcResultAsync(responseType, idProp, new { ok, error });
        }

        private async Task HandleEmptyRecycleBinAsync(string? idProp)
        {
            var operationId = $"recycle-empty-{DateTime.UtcNow.Ticks}";
            _fileTransferQueue.RegisterJob(operationId, "empty-recycle", "Empty Recycle Bin", "bndz", 1, "recycle", FileTransferPriority.High);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                ct.ThrowIfCancellationRequested();
                var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                var ok = RecycleBinService.Empty(hwnd);
                if (ok) _fileTransferQueue.MarkCompleted(operationId);
                else _fileTransferQueue.MarkFailed(operationId, "Could not empty Recycle Bin");
                if (ShouldPostDeferredIpcResult())
                {
                    await PostIpcResultAsync("EMPTY_RECYCLE_BIN_RESULT", idProp, new { success = ok }).ConfigureAwait(false);
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.High, idProp, "EMPTY_RECYCLE_BIN_RESULT", deleteLane: true).ConfigureAwait(false);
        }

        private async Task HandleRestoreRecycleItemsAsync(string? idProp, List<string> restorePaths)
        {
            var operationId = $"recycle-restore-{DateTime.UtcNow.Ticks}";
            var label = restorePaths.Count == 1 ? "Restore from Recycle Bin" : $"Restore {restorePaths.Count} items";
            _fileTransferQueue.RegisterJob(operationId, "restore", label, "bndz", restorePaths.Count, "recycle", FileTransferPriority.High);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                ct.ThrowIfCancellationRequested();
                var (restored, failed) = RecycleBinService.Restore(restorePaths);
                if (failed > 0 && restored == 0) _fileTransferQueue.MarkFailed(operationId, $"Could not restore {failed} item(s).");
                else _fileTransferQueue.MarkCompleted(operationId);
                if (ShouldPostDeferredIpcResult())
                {
                    var response = new { type = "RESTORE_RECYCLE_ITEMS_RESULT", id = idProp, payload = new { restored, failed } };
                    await PostToUiAsync(() =>
                    {
                        try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions)); } catch { }
                    });
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.High, idProp, "RESTORE_RECYCLE_ITEMS_RESULT").ConfigureAwait(false);
        }

        private async Task HandlePurgeRecycleItemsAsync(string? idProp, List<string> purgePaths)
        {
            var operationId = $"recycle-purge-{DateTime.UtcNow.Ticks}";
            var label = purgePaths.Count == 1 ? "Delete permanently" : $"Delete {purgePaths.Count} items permanently";
            _fileTransferQueue.RegisterJob(operationId, "purge", label, "bndz", purgePaths.Count, "recycle", FileTransferPriority.High);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                ct.ThrowIfCancellationRequested();
                var (purged, failed) = RecycleBinService.Purge(purgePaths);
                if (failed > 0 && purged == 0) _fileTransferQueue.MarkFailed(operationId, $"Could not delete {failed} item(s).");
                else _fileTransferQueue.MarkCompleted(operationId);
                if (ShouldPostDeferredIpcResult())
                {
                    var response = new { type = "PURGE_RECYCLE_ITEMS_RESULT", id = idProp, payload = new { purged, failed } };
                    await PostToUiAsync(() =>
                    {
                        try { MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions)); } catch { }
                    });
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.High, idProp, "PURGE_RECYCLE_ITEMS_RESULT", deleteLane: true).ConfigureAwait(false);
        }

        private async Task HandleUndoRedoAsync(bool undo, string? idProp, string? entryId = null)
        {
            // Ctrl+Z / redo always run against the undo stack. "Show action history" only
            // controls the Action Log panel UI — it must not disable undo.
            var operationId = $"{(undo ? "undo" : "redo")}-{DateTime.UtcNow.Ticks}";
            var label = !string.IsNullOrWhiteSpace(entryId)
                ? (undo ? "Undo to selected action" : "Redo to selected action")
                : (undo ? "Undo last action" : "Redo last action");
            _fileTransferQueue.RegisterJob(operationId, undo ? "undo" : "redo", label, "bndz", 1, "fs", FileTransferPriority.High);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                try
                {
                    ct.ThrowIfCancellationRequested();
                    var result = undo
                        ? (!string.IsNullOrWhiteSpace(entryId)
                            ? await _actionLogService.UndoToAsync(_fileOperationService, entryId!).ConfigureAwait(false)
                            : await _actionLogService.UndoAsync(_fileOperationService).ConfigureAwait(false))
                        : (!string.IsNullOrWhiteSpace(entryId)
                            ? await _actionLogService.RedoToAsync(_fileOperationService, entryId!).ConfigureAwait(false)
                            : await _actionLogService.RedoAsync(_fileOperationService).ConfigureAwait(false));

                    if (result.Ok) _fileTransferQueue.MarkCompleted(operationId);
                    else _fileTransferQueue.MarkFailed(operationId, result.Message);

                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new
                        {
                            type = "UNDO_REDO_RESULT",
                            id = idProp,
                            payload = new { ok = result.Ok, message = result.Message },
                        };
                        var json = JsonSerializer.Serialize(response, IpcJsonOptions);

                        await PostToUiAsync(() =>
                        {
                            MainWebView.CoreWebView2?.PostWebMessageAsJson(json);
                            PostActionLogChanged();
                        });
                    }
                }
                catch (OperationCanceledException)
                {
                    _fileTransferQueue.MarkCancelled(operationId);
                    if (ShouldPostDeferredIpcResult())
                    {
                        var cancelled = new
                        {
                            type = "UNDO_REDO_RESULT",
                            id = idProp,
                            payload = new { ok = false, message = "Cancelled" },
                        };
                        await PostToUiAsync(() =>
                        {
                            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(cancelled, IpcJsonOptions));
                        });
                    }
                    throw;
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.High, idProp, "UNDO_REDO_RESULT").ConfigureAwait(false);
        }

        private void RecordExternalActionLog(
            string action,
            List<string> sources,
            string target,
            bool bypassRecycleBin,
            IReadOnlyList<(string Src, string Dest)>? plannedTargets = null)
        {
            try
            {
                if (!FileOperationPreferences.Current.LogActions) return;
                action = (action ?? "").ToLowerInvariant();
                switch (action)
                {
                    case "copy":
                    {
                        var created = plannedTargets?.Select(p => p.Dest).ToList()
                            ?? FileOperationPathPlanner.Plan("copy", sources, target).Select(p => p.Dest).ToList();
                        if (created.Count == 0 && !string.IsNullOrWhiteSpace(target))
                            created = sources.Select(s => Path.Combine(target, Path.GetFileName(s.TrimEnd('\\', '/')))).ToList();
                        if (created.Count > 0)
                            _actionLogService.Record(BndzActionLogService.ForCopy(sources, created));
                        break;
                    }
                    case "move":
                    case "rename":
                    {
                        var moved = plannedTargets?.Select(p => p.Dest).ToList()
                            ?? FileOperationPathPlanner.Plan(action, sources, target).Select(p => p.Dest).ToList();
                        if (moved.Count == 0 && !string.IsNullOrWhiteSpace(target))
                            moved = sources.Select(s => Path.Combine(target, Path.GetFileName(s.TrimEnd('\\', '/')))).ToList();
                        if (moved.Count > 0)
                            _actionLogService.Record(BndzActionLogService.ForMove(sources, moved));
                        break;
                    }
                    case "delete":
                        if (sources.Count > 0)
                            _actionLogService.Record(BndzActionLogService.ForDelete(sources, !bypassRecycleBin));
                        break;
                    case "create-dir":
                    {
                        var dir = !string.IsNullOrEmpty(target) ? target : sources.FirstOrDefault() ?? "";
                        if (!string.IsNullOrEmpty(dir))
                            _actionLogService.Record(BndzActionLogService.ForCreateDir(dir));
                        break;
                    }
                    case "create-file":
                    {
                        var file = !string.IsNullOrEmpty(target) ? target : sources.FirstOrDefault() ?? "";
                        if (!string.IsNullOrEmpty(file))
                            _actionLogService.Record(BndzActionLogService.ForCreateFile(file));
                        break;
                    }
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ActionLog] Record external failed: {ex.Message}");
            }
        }

        private void PostActionLogChanged()
        {
            if (MainWebView.CoreWebView2 == null) return;
            var evt = new
            {
                type = "ACTION_LOG_CHANGED",
                payload = new
                {
                    canUndo = _actionLogService.CanUndo,
                    canRedo = _actionLogService.CanRedo,
                    lastActionUtc = _actionLogService.GetLastUndoEntryUtc()?.ToString("O"),
                },
            };
            MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(evt, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase }));
        }

        private async Task HandleExecuteBatchRenameAsync(
            string operationId,
            List<(string Source, string Target)> renames,
            string? labelOverride,
            string? idProp)
        {
            var label = labelOverride ?? $"Batch rename ({renames.Count} items)";
            _fileTransferQueue.RegisterJob(operationId, "batch-rename", label, "bndz", Math.Max(renames.Count, 1), "fs", FileTransferPriority.High);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                try
                {
                    var prefs = FileOperationPreferences.Current;
                    void OnProgress(string opId, int percentage, string currentFile, long bytesTransferred, long totalBytes, double speedBytesPerSecond, int itemsCompleted, int totalItems)
                    {
                        _fileTransferQueue.UpdateProgress(opId, percentage, currentFile, itemsCompleted, totalItems, bytesTransferred, totalBytes, speedBytesPerSecond);
                    }

                    var result = await _fileOperationService.ExecuteBatchRenameAsync(
                        operationId,
                        renames,
                        recordActionLog: !FileOperationPreferences.UseNativeEngine,
                        onProgress: OnProgress,
                        cancellationToken: ct).ConfigureAwait(false);

                    _fileTransferQueue.MarkCompleted(operationId);
                    await PostToUiAsync(PostActionLogChanged).ConfigureAwait(false);

                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new
                        {
                            type = "EXECUTE_BATCH_RENAME_RESULT",
                            id = idProp,
                            payload = new { ok = true, renamed = result.Renamed, skipped = result.Skipped, failed = result.Failed },
                        };
                        await PostToUiAsync(() =>
                        {
                            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions));
                        });
                    }
                }
                catch (OperationCanceledException)
                {
                    _fileTransferQueue.MarkCancelled(operationId);
                    throw;
                }
                catch (Exception ex)
                {
                    _fileTransferQueue.MarkFailed(operationId, ex.Message);
                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new
                        {
                            type = "EXECUTE_BATCH_RENAME_RESULT",
                            id = idProp,
                            payload = new { ok = false, error = ex.Message },
                        };
                        await PostToUiAsync(() =>
                        {
                            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions));
                        });
                    }
                    throw;
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.High, idProp, "EXECUTE_BATCH_RENAME_RESULT").ConfigureAwait(false);
        }

        private async Task HandleMagnetApplyDropAsync(
            string operationId,
            string magnetId,
            List<string> sources,
            string action,
            string? idProp)
        {
            var magnet = _dropMagnetService.GetMagnet(magnetId);
            if (magnet == null || !magnet.Enabled)
            {
                await PostIpcResultAsync("MAGNET_APPLY_DROP_RESULT", idProp, new { ok = false, error = "Magnet not found or disabled." }).ConfigureAwait(false);
                return;
            }
            if (sources.Count == 0)
            {
                await PostIpcResultAsync("MAGNET_APPLY_DROP_RESULT", idProp, new { ok = false, error = "No files to apply." }).ConfigureAwait(false);
                return;
            }

            var plan = _dropMagnetService.BuildTransferPlan(sources, magnet);
            if (plan.Entries.Count == 0)
            {
                await PostIpcResultAsync("MAGNET_APPLY_DROP_RESULT", idProp, new { ok = false, error = "No valid source paths." }).ConfigureAwait(false);
                return;
            }

            var move = string.Equals(action, "move", StringComparison.OrdinalIgnoreCase);
            var label = $"Magnet · {magnet.Name}";
            _fileTransferQueue.RegisterJob(operationId, move ? "move" : "copy", label, "bndz", plan.Entries.Count, "magnet", FileTransferPriority.High, magnet.TargetPath);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                var completed = new List<string>();
                try
                {
                    Directory.CreateDirectory(magnet.TargetPath);
                    var total = plan.Entries.Count;
                    var done = 0;
                    foreach (var entry in plan.Entries)
                    {
                        ct.ThrowIfCancellationRequested();
                        var destDir = Path.GetDirectoryName(entry.Destination);
                        if (!string.IsNullOrWhiteSpace(destDir))
                            Directory.CreateDirectory(destDir);

                        if (move)
                        {
                            if (File.Exists(entry.Source))
                                File.Move(entry.Source, entry.Destination, overwrite: true);
                            else if (Directory.Exists(entry.Source))
                                Directory.Move(entry.Source, entry.Destination);
                        }
                        else
                        {
                            if (File.Exists(entry.Source))
                                File.Copy(entry.Source, entry.Destination, overwrite: true);
                            else if (Directory.Exists(entry.Source))
                                CopyDirectoryForMagnet(entry.Source, entry.Destination);
                        }

                        completed.Add(entry.Destination);
                        done++;
                        _fileTransferQueue.UpdateProgress(operationId, (int)(done * 100.0 / total), entry.Destination, done, total);
                    }

                    if (magnet.Tags.Count > 0)
                        _tagSidecarStore.ApplyTags(completed, magnet.Tags);

                    _fileTransferQueue.MarkCompleted(operationId);
                    await PostIpcResultAsync("MAGNET_APPLY_DROP_RESULT", idProp, new
                    {
                        ok = true,
                        magnetId = magnet.Id,
                        magnetName = magnet.Name,
                        transferred = completed.Count,
                        destinations = completed,
                    }).ConfigureAwait(false);
                }
                catch (OperationCanceledException)
                {
                    _fileTransferQueue.MarkCancelled(operationId);
                    throw;
                }
                catch (Exception ex)
                {
                    _fileTransferQueue.MarkFailed(operationId, ex.Message);
                    await PostIpcResultAsync("MAGNET_APPLY_DROP_RESULT", idProp, new { ok = false, error = ex.Message }).ConfigureAwait(false);
                    throw;
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.High, idProp, "MAGNET_APPLY_DROP_RESULT").ConfigureAwait(false);
        }

        private static void CopyDirectoryForMagnet(string sourceDir, string destDir)
        {
            Directory.CreateDirectory(destDir);
            foreach (var file in Directory.GetFiles(sourceDir))
                File.Copy(file, Path.Combine(destDir, Path.GetFileName(file)), overwrite: true);
            foreach (var dir in Directory.GetDirectories(sourceDir))
                CopyDirectoryForMagnet(dir, Path.Combine(destDir, Path.GetFileName(dir)));
        }

        private async Task HandleSyncFoldersAsync(string operationId, string sourceDir, string targetDir, string? idProp, bool mirrorMode = false)
        {
            var label = mirrorMode
                ? $"Mirror sync · {Path.GetFileName(sourceDir.TrimEnd('\\', '/'))}"
                : $"Update sync · {Path.GetFileName(sourceDir.TrimEnd('\\', '/'))}";
            _fileTransferQueue.RegisterJob(operationId, "folder-sync", label, "bndz", 1, "folder-sync", FileTransferPriority.Low, targetDir);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                try
                {
                    var exitCode = await RunRobocopySyncAsync(sourceDir, targetDir, mirrorMode, operationId, ct).ConfigureAwait(false);
                    if (exitCode >= 8)
                        throw new IOException($"Robocopy exited with code {exitCode}");

                    if (FileOperationPreferences.Current.CopyTagsOnBackupAndSync)
                    {
                        var mappings = new List<(string source, string dest)>();
                        foreach (var file in Directory.EnumerateFiles(sourceDir, "*", SearchOption.AllDirectories))
                        {
                            var rel = Path.GetRelativePath(sourceDir, file);
                            mappings.Add((file, Path.Combine(targetDir, rel)));
                        }
                        _tagSidecarStore.CopyMetadata(mappings);
                    }
                    {
                        _actionLogService.Record(BndzActionLogService.ForSyncFolder(sourceDir, targetDir));
                        await PostToUiAsync(PostActionLogChanged).ConfigureAwait(false);
                    }
                    _fileTransferQueue.MarkCompleted(operationId);
                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new { type = "SYNC_FOLDERS_RESULT", id = idProp, payload = new { ok = true } };
                        await PostToUiAsync(() =>
                        {
                            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions));
                        });
                    }
                }
                catch (OperationCanceledException)
                {
                    _fileTransferQueue.MarkCancelled(operationId);
                    throw;
                }
                catch (Exception ex)
                {
                    _fileTransferQueue.MarkFailed(operationId, ex.Message);
                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new { type = "SYNC_FOLDERS_RESULT", id = idProp, payload = new { ok = false, error = ex.Message } };
                        await PostToUiAsync(() =>
                        {
                            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions));
                        });
                    }
                    throw;
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.Low, idProp, "SYNC_FOLDERS_RESULT").ConfigureAwait(false);
        }

        private async Task HandleCreateLinkAsync(string operationId, string linkPath, string targetPath, string linkType, string? idProp)
        {
            var label = $"Create {linkType} · {Path.GetFileName(linkPath)}";
            _fileTransferQueue.RegisterJob(operationId, "create-link", label, "bndz", 1, "fs", FileTransferPriority.Normal);

            async Task ExecuteCoreAsync(CancellationToken ct)
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    _fileTransferQueue.UpdateProgress(operationId, 10, linkPath, 0, 1);
                    var result = _linkService.CreateLink(linkPath, targetPath, linkType);
                    if (!result.Success)
                    {
                        _fileTransferQueue.MarkFailed(operationId, result.Error ?? "Link creation failed");
                    }
                    else
                    {
                        if (!FileOperationPreferences.UseNativeEngine)
                            _actionLogService.Record(BndzActionLogService.ForCreateLink(linkPath, targetPath, result.LinkType ?? linkType));
                        _fileTransferQueue.MarkCompleted(operationId);
                        await PostToUiAsync(PostActionLogChanged).ConfigureAwait(false);
                    }

                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new { type = "CREATE_LINK_RESULT", id = idProp, payload = result };
                        await PostToUiAsync(() =>
                        {
                            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions));
                        });
                    }
                }
                catch (OperationCanceledException)
                {
                    _fileTransferQueue.MarkCancelled(operationId);
                    throw;
                }
                catch (Exception ex)
                {
                    _fileTransferQueue.MarkFailed(operationId, ex.Message);
                    if (ShouldPostDeferredIpcResult())
                    {
                        var response = new { type = "CREATE_LINK_RESULT", id = idProp, payload = new LinkService.LinkResult { Success = false, Error = ex.Message } };
                        await PostToUiAsync(() =>
                        {
                            MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(response, IpcJsonOptions));
                        });
                    }
                    throw;
                }
            }

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.Normal, idProp, "CREATE_LINK_RESULT").ConfigureAwait(false);
        }

        private async Task<int> RunRobocopySyncAsync(string sourceDir, string targetDir, bool mirrorMode, string operationId, CancellationToken ct)
        {
            sourceDir = sourceDir.Replace("/", "\\").TrimEnd('\\');
            targetDir = targetDir.Replace("/", "\\").TrimEnd('\\');
            if (!Directory.Exists(sourceDir))
                throw new DirectoryNotFoundException($"Source not found: {sourceDir}");
            Directory.CreateDirectory(targetDir);

            var args = mirrorMode
                ? $"\"{sourceDir}\" \"{targetDir}\" /MIR /Z /R:2 /W:2 /NP /NDL /NFL /NJH /NJS"
                : $"\"{sourceDir}\" \"{targetDir}\" /E /XO /Z /R:2 /W:2 /NP /NDL /NFL /NJH /NJS";

            var psi = new ProcessStartInfo
            {
                FileName = "robocopy",
                Arguments = args,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
            };

            using var proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            var tcs = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);

            proc.OutputDataReceived += (_, e) =>
            {
                if (!string.IsNullOrWhiteSpace(e.Data))
                    _fileTransferQueue.UpdateProgress(operationId, 50, e.Data.Trim(), 0, 100);
            };
            proc.Exited += (_, _) => tcs.TrySetResult(proc.ExitCode);

            if (!proc.Start())
                throw new InvalidOperationException("Failed to start robocopy");

            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            using var reg = ct.Register(() =>
            {
                try { if (!proc.HasExited) proc.Kill(entireProcessTree: true); } catch { }
                tcs.TrySetCanceled(ct);
            });

            var exitCode = await tcs.Task.ConfigureAwait(false);
            _fileTransferQueue.UpdateProgress(operationId, 100, null, 100, 100);
            return exitCode;
        }

        private async Task SyncDirectoriesTrueAsync(string sourceDir, string targetDir, string operationId, CancellationToken ct)
        {
            sourceDir = sourceDir.Replace("/", "\\");
            targetDir = targetDir.Replace("/", "\\");

            if (!Directory.Exists(sourceDir)) return;
            Directory.CreateDirectory(targetDir);

            var files = Directory.EnumerateFiles(sourceDir, "*.*", SearchOption.AllDirectories).ToList();
            var total = Math.Max(files.Count, 1);
            var completed = 0;

            foreach (var file in files)
            {
                ct.ThrowIfCancellationRequested();
                string refPath = Path.GetRelativePath(sourceDir, file);
                string destPath = Path.Combine(targetDir, refPath);

                string? destDir = Path.GetDirectoryName(destPath);
                if (!string.IsNullOrEmpty(destDir) && !Directory.Exists(destDir))
                    Directory.CreateDirectory(destDir);

                await CopyFileAsync(file, destPath).ConfigureAwait(false);
                completed++;
                var pct = (int)(completed * 100.0 / total);
                _fileTransferQueue.UpdateProgress(operationId, pct, file, completed, total);
            }

            _fileTransferQueue.UpdateProgress(operationId, 100, null, total, total);
        }

        private async Task CopyFileAsync(string sourceFile, string destinationFile)
        {
            const int bufferSize = 4096 * 1024; // 4MB buffer for SSDs
            using var sourceStream = new FileStream(sourceFile, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize, FileOptions.Asynchronous | FileOptions.SequentialScan);
            using var destinationStream = new FileStream(destinationFile, FileMode.Create, FileAccess.Write, FileShare.None, bufferSize, FileOptions.Asynchronous | FileOptions.SequentialScan);
            
            await sourceStream.CopyToAsync(destinationStream);
        }

        private static void EnrichMetadataWithAcl(string path, Dictionary<string, string> meta)
        {
            try
            {
                System.Security.AccessControl.FileSystemSecurity? acl = null;
                if (File.Exists(path))
                {
                    var fi = new FileInfo(path);
                    meta["File Size"] = fi.Length.ToString();
                    meta["Created"] = fi.CreationTimeUtc.ToString("o");
                    meta["Modified"] = fi.LastWriteTimeUtc.ToString("o");
                    meta["Accessed"] = fi.LastAccessTimeUtc.ToString("o");
                    meta["Archive"] = fi.Attributes.HasFlag(FileAttributes.Archive).ToString().ToLower();
                    meta["Hidden"] = fi.Attributes.HasFlag(FileAttributes.Hidden).ToString().ToLower();
                    meta["System"] = fi.Attributes.HasFlag(FileAttributes.System).ToString().ToLower();
                    meta["ReadOnly"] = fi.Attributes.HasFlag(FileAttributes.ReadOnly).ToString().ToLower();
                    acl = fi.GetAccessControl();
                }
                else if (Directory.Exists(path))
                {
                    var di = new DirectoryInfo(path);
                    meta["Created"] = di.CreationTimeUtc.ToString("o");
                    meta["Modified"] = di.LastWriteTimeUtc.ToString("o");
                    meta["Accessed"] = di.LastAccessTimeUtc.ToString("o");
                    meta["Archive"] = di.Attributes.HasFlag(FileAttributes.Archive).ToString().ToLower();
                    meta["Hidden"] = di.Attributes.HasFlag(FileAttributes.Hidden).ToString().ToLower();
                    meta["System"] = di.Attributes.HasFlag(FileAttributes.System).ToString().ToLower();
                    meta["ReadOnly"] = di.Attributes.HasFlag(FileAttributes.ReadOnly).ToString().ToLower();
                    acl = di.GetAccessControl();
                }

                if (acl == null) return;

                meta["Owner"] = acl.GetOwner(typeof(System.Security.Principal.NTAccount))?.Value ?? "Unknown";

                bool canWrite = false;
                bool canExecute = false;
                var rules = new List<string>();
                foreach (System.Security.AccessControl.FileSystemAccessRule rule in acl.GetAccessRules(true, true, typeof(System.Security.Principal.SecurityIdentifier)))
                {
                    var identity = rule.IdentityReference?.Translate(typeof(System.Security.Principal.NTAccount))?.Value
                        ?? rule.IdentityReference?.Value ?? "Unknown";
                    var rights = rule.FileSystemRights.ToString();
                    var kind = rule.AccessControlType == System.Security.AccessControl.AccessControlType.Allow ? "Allow" : "Deny";
                    rules.Add($"{identity}: {rights} ({kind})");

                    if (rule.AccessControlType == System.Security.AccessControl.AccessControlType.Allow)
                    {
                        if ((rule.FileSystemRights & System.Security.AccessControl.FileSystemRights.WriteData) == System.Security.AccessControl.FileSystemRights.WriteData) canWrite = true;
                        if ((rule.FileSystemRights & System.Security.AccessControl.FileSystemRights.ExecuteFile) == System.Security.AccessControl.FileSystemRights.ExecuteFile) canExecute = true;
                    }
                }

                meta["ACL Rule"] = (canWrite ? "W" : "") + (canExecute ? "X" : "");
                meta["ACL Rules"] = string.Join("\n", rules);
            }
            catch { }
        }

        private static object MapContextMenuItemDto(ShellContextMenuService.MenuItemDto item)
        {
            if (item.Separator) return new { separator = true };
            return new
            {
                id = item.Id,
                label = item.Label,
                icon = item.Icon,
                iconBase64 = item.IconBase64,
                verb = item.Verb,
                isPrimary = item.IsPrimary,
                kind = item.Kind,
                commandId = item.CommandId,
                children = item.Children?.Select(MapContextMenuItemDto).ToList(),
            };
        }


    }
}
