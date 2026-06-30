using System;
using System.Drawing;
using System.IO;
using Microsoft.Win32;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Threading;
using BNDZ.Services;
using Microsoft.Web.WebView2.Core;

namespace BNDZ;

public partial class LauncherShellWindow : Window
{
    private bool _ready;
    private LauncherShellBridge? _bridge;
    private DateTime _shownAtUtc = DateTime.MinValue;
    private string _layoutMode = "compact";

    private const double CompactWidth = 680;
    private const double CompactHeight = 56;
    private const double ExpandedWidth = 920;
    private const double ExpandedHeight = 620;

    public LauncherShellWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Deactivated += OnDeactivated;
        PreviewKeyDown += OnPreviewKeyDown;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            await LauncherWebView.EnsureCoreWebView2Async(null);
            LauncherWebView.DefaultBackgroundColor = Color.Transparent;
            var core = LauncherWebView.CoreWebView2;
            core.Settings.AreDefaultContextMenusEnabled = false;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true;
            core.ContextMenuRequested += (_, args) => args.Handled = true;

            var uiPath = Path.Combine(AppContext.BaseDirectory, "Assets", "launcher-ui");
            Directory.CreateDirectory(uiPath);
            core.SetVirtualHostNameToFolderMapping(
                "bndz.launcher.local",
                uiPath,
                CoreWebView2HostResourceAccessKind.Allow);

            core.AddWebResourceRequestedFilter("https://bndz.launcher.local/icon*", CoreWebView2WebResourceContext.Image);
            core.AddWebResourceRequestedFilter("https://bndz.launcher.local/stream*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += OnLauncherResourceRequested;

            core.WebMessageReceived += OnWebMessageReceived;
            core.NavigationCompleted += (_, _) =>
            {
                _ready = true;
                FocusLauncherInput();
            };

            _bridge = new LauncherShellBridge(json => core.PostWebMessageAsJson(json));

            core.Navigate("https://bndz.launcher.local/index.html");
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[LauncherShell] init failed: {ex.Message}");
        }
    }

    private void OnLauncherResourceRequested(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        try
        {
            var uri = e.Request.Uri;
            if (!uri.Contains("bndz.launcher.local/", StringComparison.OrdinalIgnoreCase)) return;

            string? localPath = null;
            if (uri.Contains("/icon", StringComparison.OrdinalIgnoreCase))
                localPath = ParseQueryPath(uri);
            else if (uri.Contains("/stream", StringComparison.OrdinalIgnoreCase))
                localPath = ParseQueryPath(uri);

            if (string.IsNullOrWhiteSpace(localPath)) return;
            if (!File.Exists(localPath) && !Directory.Exists(localPath)) return;

            var env = LauncherWebView.CoreWebView2?.Environment;
            if (env == null) return;
            if (Directory.Exists(localPath))
            {
                var empty = new MemoryStream();
                e.Response = env.CreateWebResourceResponse(empty, 404, "Not Found", "Content-Type: text/plain");
                return;
            }
            LocalStreamService.ServeLocalFile(env, e, localPath);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[LauncherShell] resource serve failed: {ex.Message}");
        }
    }

    private static string? ParseQueryPath(string uri)
    {
        var pathIdx = uri.IndexOf("path=", StringComparison.OrdinalIgnoreCase);
        if (pathIdx < 0) return null;
        var raw = uri[(pathIdx + 5)..];
        var amp = raw.IndexOf('&');
        if (amp >= 0) raw = raw[..amp];
        return Uri.UnescapeDataString(raw);
    }

    private void OnWebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
            switch (type)
            {
                case "LAUNCHER_READY":
                    _ready = true;
                    FocusLauncherInput();
                    break;
                case "QUERY":
                    HandleQuery(root);
                    break;
                case "EXECUTE":
                    {
                        var execRequestId = root.TryGetProperty("requestId", out var erid) ? erid.GetString() : "";
                        if (root.TryGetProperty("commandId", out var cid))
                        {
                            var id = cid.GetString() ?? "";
                            var execQuery = root.TryGetProperty("query", out var qEl) ? qEl.GetString() : null;
                            if (!id.StartsWith("view-", StringComparison.Ordinal))
                            {
                                _ = Task.Run(() =>
                                {
                                    var ok = LauncherCommandService.Execute(id, execQuery);
                                    Dispatcher.BeginInvoke(() =>
                                    {
                                        PostExecuteResult(execRequestId, ok);
                                        if (ok && ShouldHideAfterExecute(id)) Hide();
                                    });
                                });
                            }
                        }
                        break;
                    }
                case "HIDE":
                    Hide();
                    break;
                case "OPEN_LAUNCHER_SETTINGS":
                    Hide();
                    BndzLauncherPendingActions.RequestOpenSettings();
                    break;
                case "OPEN_BNDZ_FILE_MANAGER":
                    Hide();
                    BndzHostCoordinator.Instance.ShowFileManager();
                    break;
                case "OPEN_BNDZ_PATH":
                    {
                        var openPath = root.TryGetProperty("path", out var op) ? op.GetString() : null;
                        Hide();
                        if (!string.IsNullOrWhiteSpace(openPath))
                            BndzHostCoordinator.Instance.OpenPathInFileManager(openPath);
                        else
                            BndzHostCoordinator.Instance.ShowFileManager();
                        break;
                    }
                case "SET_LAUNCHER_LAYOUT":
                    {
                        var mode = root.TryGetProperty("mode", out var modeEl) ? modeEl.GetString() : "compact";
                        ApplyLayoutMode(mode ?? "compact");
                        break;
                    }
                case "GET_FILE_PREVIEW_META":
                    {
                        var metaRequestId = root.TryGetProperty("requestId", out var mrid) ? mrid.GetString() : "";
                        var metaPath = root.TryGetProperty("path", out var mp) ? mp.GetString() : null;
                        _ = Task.Run(() =>
                        {
                            var meta = FilePreviewMetaService.Build(metaPath);
                            Dispatcher.BeginInvoke(() => PostPreviewMeta(metaRequestId, meta));
                        });
                        break;
                    }
                default:
                    _bridge?.Handle(root);
                    break;
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[LauncherShell] message error: {ex.Message}");
        }
    }

    private void HandleQuery(JsonElement root)
    {
        if (!_ready || LauncherWebView.CoreWebView2 == null) return;
        var requestId = root.TryGetProperty("requestId", out var rid) ? rid.GetString() : "";
        var query = root.TryGetProperty("query", out var q) ? q.GetString() : "";
        var local = Services.LauncherCommandService.SearchLocal(query);
        PostQueryResult(requestId, local, partial: true);

        var capturedId = requestId;
        var capturedQuery = query;
        var capturedLocal = local;
        _ = Task.Run(() =>
        {
            try
            {
                BndzShellQueryClient.WarmupFlowPlugins();
                var priority = BndzShellQueryClient.QueryFlowPlugins(capturedQuery, "priority");
                var mergedPriority = LauncherCommandService.MergeFlowResults(capturedLocal, priority);
                Dispatcher.BeginInvoke(() =>
                {
                    if (!_ready || LauncherWebView.CoreWebView2 == null) return;
                    PostQueryResult(capturedId, mergedPriority, partial: true);
                });

                var extensions = BndzShellQueryClient.QueryFlowPlugins(capturedQuery, "extensions");
                var mergedAll = LauncherCommandService.MergeFlowResults(mergedPriority, extensions);
                Dispatcher.BeginInvoke(() =>
                {
                    if (!_ready || LauncherWebView.CoreWebView2 == null) return;
                    PostQueryResult(capturedId, mergedAll, partial: false);
                });
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[LauncherShell] flow query error: {ex.Message}");
                Dispatcher.BeginInvoke(() =>
                {
                    if (!_ready || LauncherWebView.CoreWebView2 == null) return;
                    PostQueryResult(capturedId, capturedLocal, partial: false);
                });
            }
        });
    }

    private void PostPreviewMeta(string? requestId, FilePreviewMetaService.PreviewMetaDto meta)
    {
        if (LauncherWebView.CoreWebView2 == null) return;
        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        var payload = JsonSerializer.Serialize(new { type = "GET_FILE_PREVIEW_META_RESULT", requestId, payload = meta }, jsonOpts);
        LauncherWebView.CoreWebView2.PostWebMessageAsJson(payload);
    }

    private void ApplyLayoutMode(string mode)
    {
        _layoutMode = mode.Equals("expanded", StringComparison.OrdinalIgnoreCase) ? "expanded" : "compact";
        var area = SystemParameters.WorkArea;
        if (_layoutMode == "expanded")
        {
            Width = ExpandedWidth;
            Height = ExpandedHeight;
        }
        else
        {
            Width = CompactWidth;
            Height = CompactHeight;
        }
        Left = area.Left + (area.Width - Width) / 2;
        Top = area.Top + (area.Height - Height) / 3;
    }

    private void PostLauncherVisible()
    {
        if (LauncherWebView.CoreWebView2 == null) return;
        LauncherWebView.CoreWebView2.PostWebMessageAsJson("{\"type\":\"LAUNCHER_VISIBLE\"}");
        var wallpaperPath = GetDesktopWallpaperPath();
        var wallpaperUrl = !string.IsNullOrWhiteSpace(wallpaperPath)
            ? $"https://bndz.launcher.local/stream?path={Uri.EscapeDataString(wallpaperPath)}"
            : null;
        var themeJson = JsonSerializer.Serialize(new
        {
            type = "THEME_SYNC",
            dark = true,
            accent = "#2f6bff",
            wallpaperUrl,
            launcherShowBackground = true,
            launcherBackgroundOpacity = 46,
            launcherBackgroundBlur = 35,
        });
        LauncherWebView.CoreWebView2.PostWebMessageAsJson(themeJson);
    }

    private static string? GetDesktopWallpaperPath()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Control Panel\Desktop");
            var path = key?.GetValue("WallPaper") as string;
            if (!string.IsNullOrWhiteSpace(path) && File.Exists(path))
                return path;
        }
        catch { }
        return null;
    }
    private static bool ShouldHideAfterExecute(string commandId)
    {
        if (commandId.StartsWith("system-search-", StringComparison.Ordinal)) return false;
        if (commandId is "system-clipboard-manager" or "system-open-extensions" or "system-window-management" or "system-file-search" or "system-search-files") return false;
        return true;
    }

    private void PostExecuteResult(string? requestId, bool ok)
    {
        if (LauncherWebView.CoreWebView2 == null) return;
        var payload = JsonSerializer.Serialize(new { type = "EXECUTE_RESULT", requestId, ok });
        LauncherWebView.CoreWebView2.PostWebMessageAsJson(payload);
    }

    private void PostQueryResult(string? requestId, Services.LauncherCommandService.QueryResponse result, bool partial)
    {
        if (LauncherWebView.CoreWebView2 == null) return;
        var jsonOpts = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        var payload = JsonSerializer.Serialize(new
        {
            type = "QUERY_RESULT",
            requestId,
            partial,
            result = new
            {
                query = result.query,
                commands = result.commands,
                sections = result.sections,
            },
        }, jsonOpts);
        LauncherWebView.CoreWebView2.PostWebMessageAsJson(payload);
    }

    private void OnPreviewKeyDown(object sender, System.Windows.Input.KeyEventArgs e)
    {
        if (e.Key == Key.Escape)
        {
            Hide();
            e.Handled = true;
        }
    }

    public void ShowCentered()
    {
        BndzInstalledAppsIndex.Shared.EnsureIndexed();
        _ = Task.Run(BndzShellQueryClient.WarmupFlowPlugins);

        ApplyLayoutMode("compact");
        _shownAtUtc = DateTime.UtcNow;
        if (!IsVisible)
        {
            Topmost = true;
            Show();
            Topmost = false;
        }
        else
        {
            Show();
        }
        Activate();
        FocusLauncherInput();
        PostLauncherVisible();
    }

    private void FocusLauncherInput()
    {
        try
        {
            LauncherWebView?.Focus();
            _ = LauncherWebView?.CoreWebView2?.ExecuteScriptAsync(
                "setTimeout(() => document.querySelector('input')?.focus(), 0);");
        }
        catch { }
    }

    private void OnDeactivated(object? sender, EventArgs e)
    {
        Dispatcher.BeginInvoke(() =>
        {
            if (!IsVisible) return;
            if ((DateTime.UtcNow - _shownAtUtc).TotalMilliseconds < 700) return;
            if (IsCursorInsideWindow()) return;
            Hide();
        }, DispatcherPriority.Input);
    }

    private bool IsCursorInsideWindow()
    {
        try
        {
            if (!GetCursorPos(out var pt)) return true;
            var helper = new WindowInteropHelper(this);
            if (helper.Handle == IntPtr.Zero) return true;
            if (!GetWindowRect(helper.Handle, out var rect)) return true;
            return pt.X >= rect.Left && pt.X < rect.Right && pt.Y >= rect.Top && pt.Y < rect.Bottom;
        }
        catch { return true; }
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left; public int Top; public int Right; public int Bottom; }

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
}
