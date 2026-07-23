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
        private readonly NetworkLocationsService _networkLocationsService = new();
        private readonly BndzUpdateService _updateService = new();
        private readonly BndzCatalogStore _catalogStore = new();
        private readonly BndzTagSidecarStore _tagSidecarStore = new();
        private readonly BndzActionLogService _actionLogService = new();

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

        private SystemTrayService? _trayService;
        private bool _allowClose;
        private string? _pendingOpenPath;
        private string? _pendingStartupAction;

        public MainWindow(FileManagementService fileService, AiAssistantService aiService, LocalAiService localAi, ShellIntegrationService shellIntegrationService)
        {
            InitializeComponent();
            _fileService = fileService;
            _aiService = aiService;
            _localAi = localAi;
            _shellIntegrationService = shellIntegrationService;
            _iconStudioService = new IconStudioService();
            _fileOperationService = new FileOperationService();
            _fileOperationService.SetActionLog(_actionLogService);
            _settingsManager = new SettingsManager();
            _globalHotkeys = new GlobalHotkeyService();
            _globalHotkeys.HotkeyPressed += OnGlobalHotkeyPressed;
            try
            {
                var bootSettings = _settingsManager.LoadSettings();
                FileOperationPreferences.ApplyFromJson(bootSettings);
                ApplyFileOperationPreferences();
                ApplyGlobalHotkeysFromSettingsJson(bootSettings);
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
            };
            AppIconService.ApplyToWindow(this);
            _trayService = new SystemTrayService(this);
            _trayService.QuitRequested += () => Dispatcher.Invoke(() => RequestCloseFromUI("tray"));
            _trayService.EnsureVisible();
            Closing += OnMainWindowClosing;
            StateChanged += (_, _) => PostWindowStateChanged();
            SourceInitialized += (_, _) => ApplyStartupWindowPlacement();
            
            SetupDebouncedWatcher();
            InitializeWebViewAsync();
        }

        private void ApplyStartupWindowPlacement()
        {
            try
            {
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

        private void PersistWindowPlacementIntoSettings()
        {
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
            if (_allowClose)
            {
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

        private void PostToUi(Action action) => UiThread.Marshal(Dispatcher, action);

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

        private void FlushPendingOpenPath()
        {
            if (!string.IsNullOrWhiteSpace(_pendingStartupAction))
            {
                var action = _pendingStartupAction;
                _pendingStartupAction = null;
                try
                {
                    MainWebView.CoreWebView2?.PostWebMessageAsJson(
                        JsonSerializer.Serialize(new { type = "BNDZ_STARTUP_ACTION", payload = action }));
                }
                catch { }
            }
            if (string.IsNullOrWhiteSpace(_pendingOpenPath)) return;
            var path = _pendingOpenPath;
            _pendingOpenPath = null;
            OpenPathInManager(path);
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

        private void PostExternalFileDrop(string[] paths, double? webViewX = null, double? webViewY = null)
        {
            if (paths == null || paths.Length == 0) return;
            var fingerprint = string.Join('|', paths);
            var now = DateTime.UtcNow;
            if (fingerprint == _lastExternalDropFingerprint && (now - _lastExternalDropUtc).TotalMilliseconds < 400)
                return;
            _lastExternalDropFingerprint = fingerprint;
            _lastExternalDropUtc = now;

            var msg = new
            {
                type = "EXTERNAL_FILES_DROPPED",
                payload = new
                {
                    paths,
                    webViewX,
                    webViewY,
                },
            };
            var json = JsonSerializer.Serialize(msg, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
            PostToUi(() => MainWebView.CoreWebView2?.PostWebMessageAsJson(json));
        }

        private void SetupNativeFileDrop()
        {
            AllowDrop = true;
            MainWebView.AllowDrop = true;
            // Critical: when true (default), Chromium owns OLE drops and WPF Drop never fires —
            // React then sees File objects with no .path in WebView2. Force host-owned drops.
            try { MainWebView.AllowExternalDrop = false; }
            catch (Exception ex) { Debug.WriteLine($"[Drop] AllowExternalDrop: {ex.Message}"); }

            void OnDragOver(object sender, System.Windows.DragEventArgs e)
            {
                var canDrop = e.Data != null && (
                    e.Data.GetDataPresent(System.Windows.DataFormats.FileDrop, true)
                    || e.Data.GetDataPresent("FileGroupDescriptorW", false)
                    || e.Data.GetDataPresent("FileNameW", true)
                    || e.Data.GetDataPresent("FileName", true));
                if (canDrop)
                {
                    e.Effects = System.Windows.DragDropEffects.Copy;
                    e.Handled = true;
                }
            }

            void OnDrop(object sender, System.Windows.DragEventArgs e)
            {
                if (e.Handled) return;
                try
                {
                    var files = ExternalDropHelper.ExtractPaths(e.Data);
                    if (files.Length > 0)
                    {
                        // Coordinates relative to the WebView viewport (matches document.elementFromPoint).
                        var pt = e.GetPosition(MainWebView);
                        PostExternalFileDrop(files, pt.X, pt.Y);
                    }
                    else
                    {
                        Debug.WriteLine("[Drop] No extractable paths in drop payload.");
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Drop] {ex.Message}");
                }
                e.Handled = true;
            }

            // Preview* only — avoids double-fire from both Preview and bubble Drop on Window + WebView.
            PreviewDragOver += OnDragOver;
            PreviewDrop += OnDrop;
            MainWebView.PreviewDragOver += OnDragOver;
            MainWebView.PreviewDrop += OnDrop;
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

        private void PushDrivesUpdate()
        {
            var drives = _cloudStorageService.GetAnnotatedDrives();
            
            var evt = new { type = "DRIVES_CHANGED", payload = drives };
            var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
            string json = JsonSerializer.Serialize(evt, jsonOptions);

            PostToUi(() => {
                try {
                    MainWebView.CoreWebView2?.PostWebMessageAsJson(json);
                } catch { }
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
            // WebView2 uses D3D11 compositing by default; prefer explicit GPU rasterization for smooth panel resize/scroll
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
                additionalBrowserArguments: "--enable-gpu-rasterization --enable-zero-copy --disable-features=CalculateNativeWinOcclusion",
                customSchemeRegistrations: new List<CoreWebView2CustomSchemeRegistration> { streamScheme });

            var webEnv = await CoreWebView2Environment.CreateAsync(null, null, webEnvOptions);
            await MainWebView.EnsureCoreWebView2Async(webEnv);

            if (MainWebView.CoreWebView2 == null)
                throw new InvalidOperationException("WebView2 initialized but CoreWebView2 is still null.");

            // Suppress Edge/WebView2 default context menus — BNDZ uses custom React menus only
            MainWebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            MainWebView.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
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
                    string localPath = new Uri(e.Uri).LocalPath;
                    string ext = Path.GetExtension(localPath).ToLowerInvariant();
                    if (ext is ".png" or ".ico" or ".jpg" or ".jpeg" or ".bmp" or ".webp" or ".gif")
                    {
                        var msg = new { type = "EXTERNAL_FILES_DROPPED", payload = new { paths = new[] { localPath } } };
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(msg));
                    }
                }
                catch { }
            };

            MainWebView.CoreWebView2.NewWindowRequested += (s, e) =>
            {
                e.Handled = true;
                try
                {
                    if (string.IsNullOrEmpty(e.Uri) || !e.Uri.StartsWith("file:", StringComparison.OrdinalIgnoreCase)) return;
                    string localPath = new Uri(e.Uri).LocalPath;
                    string ext = Path.GetExtension(localPath).ToLowerInvariant();
                    if (ext is ".png" or ".ico" or ".jpg" or ".jpeg" or ".bmp" or ".webp" or ".gif")
                    {
                        var msg = new { type = "EXTERNAL_FILES_DROPPED", payload = new { paths = new[] { localPath } } };
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(msg));
                    }
                }
                catch { }
            };

#if DEBUG
            MainWebView.CoreWebView2.OpenDevToolsWindow();
#endif

            // Navigate to the React frontend served from the virtual host, bypassing cache
            MainWebView.CoreWebView2.Navigate($"http://bndz.local/index.html?t={DateTime.Now.Ticks}");
            MainWebView.CoreWebView2.NavigationCompleted += (_, _) => FlushPendingOpenPath();
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
                // Attempt recovery by reloading
                try
                {
                    MainWebView.Reload();
                }
                catch { }
            });
        }

        private async void CoreWebView2_WebMessageReceived(object? sender, Microsoft.Web.WebView2.Core.CoreWebView2WebMessageReceivedEventArgs e)
        {
            try
            {
                string messageStr = e.WebMessageAsJson;
                
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

                // Native license gate: when trial is expired / unlicensed, only allow license + bootstrap IPC.
                if (!LicenseService.GetStatusCached().CanUseApp && !LicenseService.IsIpcAllowedWhenUnlicensed(type))
                {
                    var blockedId = root.TryGetProperty("id", out var blockedIdEl) ? blockedIdEl.GetString() : null;
                    var blockedPayload = new
                    {
                        error = "License required. Activate BNDZ to continue.",
                        licenseRequired = true,
                    };
                    // Frontend waits on names like ICON_LIBRARIES_RESULT, not GET_ICON_LIBRARIES_RESULT.
                    var blockedResultType = LicenseService.ResolveIpcResultType(type);
                    var blockedResponse = new { type = blockedResultType, id = blockedId, payload = blockedPayload };
                    var blockedJson = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() =>
                        MainWebView.CoreWebView2?.PostWebMessageAsJson(JsonSerializer.Serialize(blockedResponse, blockedJson)));
                    return;
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
                    var response = new { type = "FILE_TRANSFER_QUEUE_RESULT", id = idProp, payload = _fileTransferQueue.GetQueueState() };
                    PostToUi(() =>
                    {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response));
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

                    PostToUi(() => {
                        try
                        {
                            var dataObject = new System.Windows.DataObject(System.Windows.DataFormats.FileDrop, pathArray);
                            System.Windows.DragDrop.DoDragDrop(this, dataObject, System.Windows.DragDropEffects.Copy | System.Windows.DragDropEffects.Move | System.Windows.DragDropEffects.Link);
                        }
                        catch { }
                    });
                }
                else if (type == "CLEAR_THUMBNAIL_CACHE")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    _ = Task.Run(() =>
                    {
                        var result = ThumbnailCacheService.ClearAll();
                        BndzHostCaches.ClearAll();
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
                        var results = await _fileService.GetDirContentsAsync(path);
                        var enriched = BndzTagSidecarStore.EnrichDirResults(results, _tagSidecarStore);

                        var response = new { type = "DIR_CONTENTS_RESULT", id = idProp, payload = enriched };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        var responseJson = JsonSerializer.Serialize(response, jsonOptions);

                        PostToUi(() => {
                             IpcDebugLog($"[SEND] {responseJson}");
                             MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                        });
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
                    string path = NormalizeFsPath(payload.GetProperty("path").GetString() ?? "");
                    int x = payload.GetProperty("x").GetInt32();
                    int y = payload.GetProperty("y").GetInt32();

                    Dispatcher.Invoke(() => {
                        var hwnd = new System.Windows.Interop.WindowInteropHelper(this).Handle;
                        _shellContextMenuService.ShowNativeContextMenu(hwnd, path, x, y);
                    });
                }
                else if (type == "GET_CONTEXT_MENU_ITEMS")
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
                            payloadObj = _shellContextMenuService.GetContextMenuItems(path)
                                .Select(i => i.Separator
                                    ? (object)new { separator = true }
                                    : new {
                                        id = i.Id,
                                        label = i.Label,
                                        icon = i.Icon,
                                        iconBase64 = i.IconBase64,
                                        verb = i.Verb,
                                        isPrimary = i.IsPrimary,
                                        kind = i.Kind,
                                        commandId = i.CommandId,
                                    })
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
                else if (type == "GET_DRIVES")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var drives = _cloudStorageService.GetAnnotatedDrives();
                    
                    var response = new { type = "DRIVES_RESULT", id = idProp, payload = drives };
                    var jsonOptsDrives = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    var responseJson = JsonSerializer.Serialize(response, jsonOptsDrives);
                    PostToUi(() =>
                    {
                        IpcDebugLog($"[SEND] {responseJson}");
                        MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                    });
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

                    _ = Task.Run(() => 
                    {
                        var nativeSvc = new NativeShellService();
                        string base64 = nativeSvc.GetNativeThumbnailBase64(path, thumbSize);

                        var response = new { type = "THUMBNAIL_RESULT", id = idProp, payload = string.IsNullOrEmpty(base64) ? null : base64 };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        string responseJson = JsonSerializer.Serialize(response, jsonOptions);

                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                        });
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

                    _ = Task.Run(() => 
                    {
                        var nativeSvc = new NativeShellService();
                        var meta = nativeSvc.GetExtendedMetadata(path);
                        EnrichMetadataWithAcl(path, meta);

                        var response = new { type = "EXTENDED_METADATA_RESULT", id = idProp, payload = meta };
                        var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                        string responseJson = JsonSerializer.Serialize(response, jsonOptions);

                        PostToUi(() => {
                            MainWebView.CoreWebView2.PostWebMessageAsJson(responseJson);
                        });
                    });
                }
                else if (type == "GET_MEDIA_BLOB")
                {
                    var payload = root.GetProperty("payload");
                    string path = NormalizeFsPath(payload.GetProperty("path").GetString() ?? "");
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    long maxBytes = payload.TryGetProperty("maxBytes", out var maxEl) ? maxEl.GetInt64() : 48L * 1024 * 1024;

                    _ = Task.Run(() =>
                    {
                        object resultPayload;
                        try
                        {
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
                    _ = Task.Run(() =>
                    {
                        object resultPayload;
                        try
                        {
                            switch (action)
                            {
                                case "setContextMenu":
                                {
                                    bool enable = payload.GetProperty("enable").GetBoolean();
                                    resultPayload = _shellIntegrationService.SetInContextMenu(enable);
                                    break;
                                }
                                case "setDefault":
                                {
                                    bool enable = payload.GetProperty("enable").GetBoolean();
                                    resultPayload = _shellIntegrationService.SetAsDefaultFileManager(enable);
                                    break;
                                }
                                case "setWin11MoreOptions":
                                {
                                    bool enable = payload.GetProperty("enable").GetBoolean();
                                    resultPayload = _shellIntegrationService.SetWin11MoreOptions(enable);
                                    break;
                                }
                                case "relaunchAdmin":
                                {
                                    string? extraArgs = null;
                                    if (payload.TryGetProperty("extraArgs", out var extraArgsProp)
                                        && extraArgsProp.ValueKind == JsonValueKind.String)
                                        extraArgs = extraArgsProp.GetString();
                                    resultPayload = _shellIntegrationService.RelaunchAsAdministrator(extraArgs);
                                    break;
                                }
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
                    PushDrivesUpdate();
                    var response = new { type = "REFRESH_WORKSPACE_RESULT", id = idProp, payload = true };
                    var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOpts));
                    });
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
                    var providers = _cloudStorageService.GetProviders();

                    var response = new { type = "CLOUD_PROVIDERS_RESULT", id = idProp, payload = providers };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
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

                    _ = Task.Run(() => 
                    {
                        string cacheKey = BndzHostCaches.IconCacheKey(path, isDirectory);

                        if (BndzHostCaches.Icons.TryGet(cacheKey, out var cachedBase64) && !string.IsNullOrEmpty(cachedBase64))
                        {
                            PostIconResult(idProp, cachedBase64);
                            return;
                        }

                        string extractedBase64 = "";
                        try {
                            extractedBase64 = _nativeShellService.GetNativeShellIconBase64(path, isDirectory) ?? "";
                        } catch (Exception ex) {
                            System.Diagnostics.Debug.WriteLine($"Failed to get shell icon for {path}: {ex.Message}");
                        }
                        
                        if (!string.IsNullOrEmpty(extractedBase64)) {
                            BndzHostCaches.Icons.AddOrUpdate(cacheKey, extractedBase64);
                        }

                        PostIconResult(idProp, string.IsNullOrEmpty(extractedBase64) ? null : extractedBase64);
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

                                    bool isVirtualIcon = ShellPathResolver.IsShellVirtualPath(path)
                                        || path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase);
                                    _ = isVirtualIcon;
                                    string cacheKey = BndzHostCaches.IconCacheKey(path, isDir);

                                    if (BndzHostCaches.Icons.TryGet(cacheKey, out var cachedBase64) && !string.IsNullOrEmpty(cachedBase64))
                                    {
                                        results[path] = cachedBase64;
                                        continue;
                                    }

                                    string extracted = "";
                                    try
                                    {
                                        extracted = _nativeShellService.GetNativeShellIconBase64(path, isDir) ?? "";
                                    }
                                    catch { }

                                    if (!string.IsNullOrEmpty(extracted))
                                        BndzHostCaches.Icons.AddOrUpdate(cacheKey, extracted);

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
                    BndzHostCaches.ClearAll();
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
                                RequestCloseFromUI("x");
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
                else if (type == "GET_NETWORK_LOCATIONS")
                {
                    var idProp = root.TryGetProperty("id", out var idElement) ? idElement.GetString() : null;
                    var nodes = _networkLocationsService.GetTreeNodes();
                    var response = new { type = "NETWORK_LOCATIONS_RESULT", id = idProp, payload = nodes };
                    var jsonOptions = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
                    PostToUi(() => {
                        MainWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(response, jsonOptions));
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
                            "large" => svc.GetLargeFiles(limit),
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
                Console.WriteLine($"Error processing WebView message: {ex.Message}");
            }
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
        FileTransferPriority priority = FileTransferPriority.Normal)
        {
            var prefs = FileOperationPreferences.Current;
            if (prefs.QueueOperations)
                await _fileTransferQueue.EnqueueAsync(operationId, work, default, priority).ConfigureAwait(false);
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
            string? ipcResultType = null)
        {
            var prefs = FileOperationPreferences.Current;

            async Task RunWorkAsync()
            {
                try
                {
                    await RunTransferWorkAsync(operationId, work, priority).ConfigureAwait(false);
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
                        RecordExternalActionLog(action, sources, target, bypassRecycleBin);
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
                        RecordExternalActionLog(action, sources, target, bypassRecycleBin);
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

                    if (action is "copy" or "move" && prefs.CopyTagsOnCopyOperations)
                    {
                        var mappings = FileOperationPathPlanner.Plan(action, sources, target, recreateSourceStructure);
                        _tagSidecarStore.CopyMetadata(mappings);
                    }

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

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, priority, idProp, "FS_OPERATION_RESULT").ConfigureAwait(false);
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

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.High, idProp, "EMPTY_RECYCLE_BIN_RESULT").ConfigureAwait(false);
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

            await ScheduleTransferWorkAsync(operationId, ExecuteCoreAsync, FileTransferPriority.High, idProp, "PURGE_RECYCLE_ITEMS_RESULT").ConfigureAwait(false);
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

        private void RecordExternalActionLog(string action, List<string> sources, string target, bool bypassRecycleBin)
        {
            try
            {
                action = (action ?? "").ToLowerInvariant();
                switch (action)
                {
                    case "copy":
                    {
                        var plan = FileOperationPathPlanner.Plan("copy", sources, target);
                        var created = plan.Select(p => p.Dest).ToList();
                        if (created.Count > 0)
                            _actionLogService.Record(BndzActionLogService.ForCopy(sources, created));
                        break;
                    }
                    case "move":
                    case "rename":
                    {
                        var plan = FileOperationPathPlanner.Plan(action, sources, target);
                        var moved = plan.Select(p => p.Dest).ToList();
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


    }
}
