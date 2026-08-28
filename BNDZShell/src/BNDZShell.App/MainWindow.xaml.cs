using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using BNDZ.Services;
using BNDZShell.Bndz;
using Microsoft.UI;
using Microsoft.UI.Input;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.Graphics;
using WinRT.Interop;

namespace BNDZShell;

public sealed partial class MainWindow : Window
{
    private const int MinWindowWidth = 1100;
    private const int MinWindowHeight = 720;
    // Comfortable default — not 2560×1440 (oversized on many displays; tiny chrome on 4K).
    private const int DefaultWindowWidth = 1600;
    private const int DefaultWindowHeight = 1000;

    private AppWindow? _appWindow;
    private IntPtr _hwnd;
    private bool _bootstrapped;
    private bool _closeConfirmed;
    private bool _closing;
    private BndzTrayIcon? _trayIcon;
    private SubclassProc? _subclassProc;
    private readonly PluginLaunch _launch;

    private delegate IntPtr SubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, nuint uIdSubclass, nuint dwRefData);

    [DllImport("comctl32.dll", ExactSpelling = true)]
    private static extern bool SetWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, nuint uIdSubclass, nuint dwRefData);

    [DllImport("comctl32.dll", ExactSpelling = true)]
    private static extern bool RemoveWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, nuint uIdSubclass);

    [DllImport("comctl32.dll", ExactSpelling = true)]
    private static extern IntPtr DefSubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

    private const nuint DeviceChangeSubclassId = 0xB002;
    private const uint WM_DEVICECHANGE = 0x0219;

    public MainWindow() : this(null)
    {
    }

    internal MainWindow(PluginLaunch? launch)
    {
        _launch = launch ?? PluginLaunch.FromBoot();
        InitializeComponent();
        Title = _launch.IsPlugin
            ? (string.IsNullOrWhiteSpace(_launch.Title) ? "BNDZ Plugin" : _launch.Title!)
            : "BNDZ";
        if (_launch.IsPlugin)
        {
            ChromeHost.PluginWindowId = _launch.PluginId;
            ChromeHost.PluginStickyId = _launch.StickyId;
            ChromeHost.PluginWindowTitle = _launch.Title;
            try { NativeList.Visibility = Visibility.Collapsed; } catch { /* ignore */ }
        }
        ConfigureAppWindow();
        TrySetWindowIcon();
        InstallWindowSubclass();
        WireHostLifecycle();

        ChromeHost.PaneMessage += ChromeHost_PaneMessage;
        NativeList.ContextChanged += (_, _) => { };
        ChromeHost.WebViewInitialized += (_, _) =>
        {
            WireHostLifecycle();
            ChromeHost.HostWindowHandle = _hwnd;
            ChromeHost.TryRegisterOleDropTarget();
            _ = BootstrapAsync();
        };

        Closed += (_, _) =>
        {
            RemoveWindowSubclass();
            DisposeTray();
            if (_launch.IsPlugin) return;
            try { BndzEmbeddedBackendHost.SetHostCloseAction(() => { }); } catch { /* ignore */ }
        };

        ChromeHost.Prewarm();
        Activate();
    }

    private void WireHostLifecycle()
    {
        if (_launch.IsPlugin) return;
        if (_hwnd != IntPtr.Zero)
            BndzEmbeddedBackendHost.SetHostWindowHandle(_hwnd);
        BndzEmbeddedBackendHost.SetHostCloseAction(RequestHostClose);
        BndzEmbeddedBackendHost.SetHostTrayActions(HideToTray, RestoreFromTray);
        BndzEmbeddedBackendHost.SetOpenPluginWindowAction(PluginWindowRegistry.Open);
    }

    private void RequestHostClose()
    {
        if (_closing) return;
        _closing = true;
        _closeConfirmed = true;
        try
        {
            if (DispatcherQueue is not null && !DispatcherQueue.HasThreadAccess)
            {
                DispatcherQueue.TryEnqueue(() =>
                {
                    try { Close(); } catch { /* ignore */ }
                });
                return;
            }
            Close();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] host close: {ex.Message}");
        }
    }

    private async Task BootstrapAsync()
    {
        if (_bootstrapped) return;
        _bootstrapped = true;
        try
        {
            NativeList.ApplyListBounds(0, 0, 0, 0, visible: false);
            await Task.CompletedTask.ConfigureAwait(true);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] bootstrap failed: {ex}");
        }
    }

    private void ConfigureAppWindow()
    {
        try
        {
            _hwnd = WindowNative.GetWindowHandle(this);
            ChromeHost.HostWindowHandle = _hwnd;
            var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(_hwnd);
            _appWindow = AppWindow.GetFromWindowId(windowId);

            var (w, h) = _launch.IsSticky
                ? (340, 390)
                : _launch.IsPlugin
                    ? (980, 720)
                    : ResolveDefaultWindowSize(windowId);
            _appWindow.Resize(new Windows.Graphics.SizeInt32(w, h));
            if (_appWindow.Presenter is OverlappedPresenter overlapped)
            {
                overlapped.PreferredMinimumWidth = _launch.IsSticky ? 220 : _launch.IsPlugin ? 480 : MinWindowWidth;
                overlapped.PreferredMinimumHeight = _launch.IsSticky ? 180 : _launch.IsPlugin ? 360 : MinWindowHeight;
                if (_launch.IsSticky)
                {
                    try { overlapped.SetBorderAndTitleBar(false, false); } catch { /* older WASDK */ }
                    overlapped.IsMaximizable = false;
                    overlapped.IsMinimizable = false;
                    overlapped.IsAlwaysOnTop = true;
                    overlapped.IsResizable = true;
                }
            }

            // WinUIEx: persist placement across launches (falls back silently if unavailable).
            // Plugin pop-outs use a separate PersistenceId so they do not inherit the main FM size.
            try
            {
                var mgr = WinUIEx.WindowManager.Get(this);
                mgr.MinWidth = _launch.IsSticky ? 220 : _launch.IsPlugin ? 480 : MinWindowWidth;
                mgr.MinHeight = _launch.IsSticky ? 180 : _launch.IsPlugin ? 360 : MinWindowHeight;
                mgr.PersistenceId = _launch.IsSticky
                    ? "BNDZShell.StickyWidget.v1"
                    : _launch.IsPlugin
                        ? "BNDZShell.PluginPopout.v1"
                        : "BNDZShell.MainWindow.v54";
            }
            catch (Exception winUiEx)
            {
                System.Diagnostics.Debug.WriteLine($"[BNDZShell] WinUIEx WindowManager: {winUiEx.Message}");
            }

            // After persistence restore, clamp into the work area (never larger than the display).
            DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, ClampWindowToWorkArea);

            ExtendsContentIntoTitleBar = !_launch.IsSticky;
            ApplySystemBackdropFromSettings();
            var tb = _appWindow.TitleBar;
            tb.ButtonBackgroundColor = Colors.Transparent;
            tb.ButtonInactiveBackgroundColor = Colors.Transparent;
            tb.ButtonPressedBackgroundColor = Colors.Transparent;
            tb.ButtonHoverBackgroundColor = ColorHelper.FromArgb(0x33, 0xFF, 0xFF, 0xFF);
            tb.ButtonForegroundColor = Colors.White;
            tb.ButtonInactiveForegroundColor = ColorHelper.FromArgb(0x99, 0xFF, 0xFF, 0xFF);
            tb.BackgroundColor = Colors.Transparent;
            tb.InactiveBackgroundColor = Colors.Transparent;
            // File/Edit band must Passthrough so WebView2 gets first click (caption otherwise eats it).
            ApplyMenubarInputRegions();
            if (Content is FrameworkElement root)
            {
                root.SizeChanged -= OnRootSizeChangedForMenubar;
                root.SizeChanged += OnRootSizeChangedForMenubar;
            }
            if (_launch.IsSticky)
            {
                try
                {
                    tb.ExtendsContentIntoTitleBar = true;
                    tb.IconShowOptions = IconShowOptions.HideIconAndSystemMenu;
                    tb.PreferredHeightOption = TitleBarHeightOption.Collapsed;
                }
                catch { /* older WASDK */ }
                try
                {
                    if (RootGrid is not null)
                        RootGrid.Background = new SolidColorBrush(Colors.Transparent);
                    SystemBackdrop = null;
                }
                catch { /* ignore */ }
            }

            // Caption X / Alt+F4 / taskbar close → same Ask/Tray/Quit flow as File→Exit.
            // Plugin pop-outs are slim tear-offs — close immediately (no FM quit dialog).
            _appWindow.Closing += (_, args) =>
            {
                if (_closeConfirmed || _launch.IsPlugin)
                {
                    if (_launch.IsPlugin)
                        _closeConfirmed = true;
                    return;
                }
                args.Cancel = true;
                try
                {
                    ChromeHost.PostHostMessage(new
                    {
                        type = "CLOSE_REQUEST",
                        payload = new { source = "x" },
                    });
                }
                catch (Exception ex)
                {
                    System.Diagnostics.Debug.WriteLine($"[BNDZShell] CLOSE_REQUEST: {ex.Message}");
                }
            };

            _appWindow.Changed += (_, args) =>
            {
                if (args.DidPresenterChange || args.DidSizeChange)
                    BroadcastWindowState();
            };
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] titlebar: {ex.Message}");
        }
    }

    private void OnRootSizeChangedForMenubar(object sender, SizeChangedEventArgs e)
        => ApplyMenubarInputRegions();

    /// <summary>
    /// WinUI caption covers the top band by default. Mark File/Edit (left ~520px of ~36px)
    /// as Passthrough so WebView2 receives clicks; keep Caption on the trailing drag strip.
    /// </summary>
    private void ApplyMenubarInputRegions()
    {
        if (_launch.IsSticky || _appWindow is null) return;
        try
        {
            var source = InputNonClientPointerSource.GetForWindowId(_appWindow.Id);
            var scale = Content?.XamlRoot?.RasterizationScale ?? 1.0;
            if (scale < 0.5) scale = 1.0;
            var menuH = (int)Math.Round(36 * scale);
            var menuW = (int)Math.Round(520 * scale);
            var winW = _appWindow.Size.Width;
            if (winW <= 0 || menuH <= 0) return;

            source.ClearRegionRects(NonClientRegionKind.Passthrough);
            source.ClearRegionRects(NonClientRegionKind.Caption);

            var passW = Math.Min(menuW, winW);
            if (passW > 0)
            {
                source.SetRegionRects(
                    NonClientRegionKind.Passthrough,
                    [new RectInt32(0, 0, passW, menuH)]);
            }

            var capX = passW;
            var capW = winW - capX;
            if (capW > 0)
            {
                source.SetRegionRects(
                    NonClientRegionKind.Caption,
                    [new RectInt32(capX, 0, capW, menuH)]);
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] menubar input regions: {ex.Message}");
        }
    }

    private static (int Width, int Height) ResolveDefaultWindowSize(WindowId windowId)
    {
        try
        {
            var area = DisplayArea.GetFromWindowId(windowId, DisplayAreaFallback.Primary);
            var work = area.WorkArea;
            // ~72% of work area, capped at 1920×1080 — readable on 1080p and 4K alike.
            var w = Math.Clamp((int)(work.Width * 0.72), MinWindowWidth, Math.Min(1920, Math.Max(MinWindowWidth, work.Width - 48)));
            var h = Math.Clamp((int)(work.Height * 0.78), MinWindowHeight, Math.Min(1080, Math.Max(MinWindowHeight, work.Height - 48)));
            return (w, h);
        }
        catch
        {
            return (DefaultWindowWidth, DefaultWindowHeight);
        }
    }

    private void ClampWindowToWorkArea()
    {
        try
        {
            if (_appWindow is null) return;
            if (_launch.IsPlugin) return;
            if (_launch.IsSticky) return;
            var area = DisplayArea.GetFromWindowId(_appWindow.Id, DisplayAreaFallback.Nearest);
            var work = area.WorkArea;
            var size = _appWindow.Size;
            var pos = _appWindow.Position;
            var minW = _launch.IsPlugin ? 480 : MinWindowWidth;
            var minH = _launch.IsPlugin ? 360 : MinWindowHeight;
            var w = Math.Min(size.Width, Math.Max(minW, work.Width - 16));
            var h = Math.Min(size.Height, Math.Max(minH, work.Height - 16));
            if (w != size.Width || h != size.Height)
                _appWindow.Resize(new Windows.Graphics.SizeInt32(w, h));

            var x = Math.Min(Math.Max(pos.X, work.X), work.X + work.Width - w);
            var y = Math.Min(Math.Max(pos.Y, work.Y), work.Y + work.Height - h);
            if (x != pos.X || y != pos.Y)
                _appWindow.Move(new Windows.Graphics.PointInt32(x, y));
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] ClampWindowToWorkArea: {ex.Message}");
        }
    }

    private void InstallWindowSubclass()
    {
        if (_hwnd == IntPtr.Zero) return;
        try
        {
            _subclassProc = WindowSubclass;
            SetWindowSubclass(_hwnd, _subclassProc, DeviceChangeSubclassId, 0);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] subclass: {ex.Message}");
        }
    }

    private void RemoveWindowSubclass()
    {
        if (_hwnd == IntPtr.Zero || _subclassProc is null) return;
        try { RemoveWindowSubclass(_hwnd, _subclassProc, DeviceChangeSubclassId); }
        catch { /* ignore */ }
        _subclassProc = null;
    }

    private IntPtr WindowSubclass(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, nuint uIdSubclass, nuint dwRefData)
    {
        if (uMsg == WM_DEVICECHANGE)
        {
            try { BndzEmbeddedBackendHost.NotifyDeviceChange(); }
            catch { /* ignore */ }
        }
        else if (_trayIcon is not null && _trayIcon.HandleWindowMessage(uMsg, wParam, lParam))
        {
            return IntPtr.Zero;
        }
        return DefSubclassProc(hWnd, uMsg, wParam, lParam);
    }

    private void EnsureTrayIcon()
    {
        if (_trayIcon is not null || _hwnd == IntPtr.Zero) return;
        try
        {
            var icoPath = Path.Combine(AppContext.BaseDirectory, "Assets", "BNDZ.ico");
            _trayIcon = new BndzTrayIcon(
                _hwnd,
                "BNDZ",
                File.Exists(icoPath) ? icoPath : null,
                onOpen: RestoreFromTray,
                onExit: () =>
                {
                    try
                    {
                        ChromeHost.PostHostMessage(new
                        {
                            type = "CLOSE_REQUEST",
                            payload = new { source = "tray" },
                        });
                    }
                    catch
                    {
                        RequestHostClose();
                    }
                });
            _trayIcon.Show();
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] tray: {ex.Message}");
        }
    }

    private void HideToTray()
    {
        void Run()
        {
            try
            {
                EnsureTrayIcon();
                _appWindow?.Hide();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[BNDZShell] HideToTray: {ex.Message}");
            }
        }

        if (DispatcherQueue is not null && !DispatcherQueue.HasThreadAccess)
            DispatcherQueue.TryEnqueue(Run);
        else
            Run();
    }

    private void RestoreFromTray()
    {
        void Run()
        {
            try
            {
                _appWindow?.Show();
                Activate();
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"[BNDZShell] RestoreFromTray: {ex.Message}");
            }
        }

        if (DispatcherQueue is not null && !DispatcherQueue.HasThreadAccess)
            DispatcherQueue.TryEnqueue(Run);
        else
            Run();
    }

    private void DisposeTray()
    {
        try
        {
            _trayIcon?.Dispose();
            _trayIcon = null;
        }
        catch { /* ignore */ }
    }

    private bool IsMaximized()
    {
        try
        {
            return _appWindow?.Presenter is OverlappedPresenter p
                && p.State == OverlappedPresenterState.Maximized;
        }
        catch
        {
            return false;
        }
    }

    private void BroadcastWindowState()
    {
        try
        {
            ChromeHost.PostHostMessage(new
            {
                type = "WINDOW_STATE_CHANGED",
                payload = new { maximized = IsMaximized() },
            });
        }
        catch { /* ignore */ }
    }

    private void TrySetWindowIcon()
    {
        try
        {
            if (_appWindow is null) return;
            foreach (var iconPath in ResolveAppIconPaths())
            {
                if (string.IsNullOrWhiteSpace(iconPath) || !File.Exists(iconPath)) continue;
                _appWindow.SetIcon(iconPath);
                return;
            }
        }
        catch { /* best effort */ }
    }

    private static IEnumerable<string> ResolveAppIconPaths()
    {
        var baseDir = AppContext.BaseDirectory;
        yield return Path.Combine(baseDir, "Assets", "BNDZ.ico");
        var exe = Environment.ProcessPath;
        if (!string.IsNullOrWhiteSpace(exe))
        {
            var exeDir = Path.GetDirectoryName(exe);
            if (!string.IsNullOrWhiteSpace(exeDir))
                yield return Path.Combine(exeDir, "Assets", "BNDZ.ico");
        }
    }

    private void ApplySystemBackdropFromSettings()
    {
        BndzSystemBackdrop.Apply(this, BndzShellChromeSettings.MicaBackdrop, BndzShellChromeSettings.BackdropKind);
        try
        {
            // When backdrop is off, keep an opaque root so WebView doesn't flash through.
            if (RootGrid is not null)
            {
                RootGrid.Background = BndzShellChromeSettings.MicaBackdrop
                    ? new SolidColorBrush(Colors.Transparent)
                    : new SolidColorBrush(ColorHelper.FromArgb(0xFF, 0x0C, 0x0F, 0x14));
            }
        }
        catch { /* ignore */ }
    }

    private void ChromeHost_PaneMessage(object? sender, JsonElement root)
    {
        if (!root.TryGetProperty("type", out var typeEl)) return;
        var type = typeEl.GetString();

        if (type is "GET_WINDOW_STATE")
        {
            var id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
            ChromeHost.PostHostMessage(new
            {
                type = "WINDOW_STATE_RESULT",
                id,
                payload = new { maximized = IsMaximized() },
            });
            return;
        }

        if (type is "WINDOW_CHROME")
        {
            HandleWindowChrome(root);
            return;
        }

        if (type is "SET_SYSTEM_BACKDROP")
        {
            HandleSetSystemBackdrop(root);
            return;
        }

        if (type is "SHOW_APP_NOTIFICATION")
        {
            HandleShowAppNotification(root);
            return;
        }

        if (type is "OPEN_FILE_DIALOG" or "SAVE_FILE_DIALOG" or "OPEN_FOLDER_DIALOG")
        {
            _ = HandleWinRtDialogAsync(root, type);
            return;
        }

        if (type is "PRINT_DOCUMENT" or "PRINT_UI")
        {
            _ = HandlePrintAsync(root, type);
            return;
        }

        if (type is "BNDZ_NATIVE_LIST_BOUNDS" or "BNDZ_PANE_NAVIGATE" or "BNDZ_REQUEST_DIR_LISTING")
            return;
    }

    private void HandleSetSystemBackdrop(JsonElement root)
    {
        try
        {
            if (!root.TryGetProperty("payload", out var payload)) return;
            var enabled = !payload.TryGetProperty("enabled", out var en) || en.ValueKind != JsonValueKind.False;
            var kind = payload.TryGetProperty("kind", out var k) ? k.GetString() : null;
            var nativeToasts = payload.TryGetProperty("nativeActionCenterToasts", out var nt)
                ? nt.ValueKind != JsonValueKind.False
                : (bool?)null;
            BndzShellChromeSettings.Save(enabled, kind, nativeToasts);
            ApplySystemBackdropFromSettings();
            ChromeHost.SetBackdropChrome(enabled);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] SET_SYSTEM_BACKDROP: {ex.Message}");
        }
    }

    private void HandleShowAppNotification(JsonElement root)
    {
        try
        {
            if (!root.TryGetProperty("payload", out var payload)) return;
            var title = payload.TryGetProperty("title", out var t) ? t.GetString() : "BNDZ";
            var message = payload.TryGetProperty("message", out var m) ? m.GetString() : null;
            var tag = payload.TryGetProperty("tag", out var g) ? g.GetString() : null;
            BndzAppNotifications.TryShow(title ?? "BNDZ", message ?? "", tag);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] SHOW_APP_NOTIFICATION: {ex.Message}");
        }
    }

    private async Task HandleWinRtDialogAsync(JsonElement root, string? type)
    {
        var id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
        JsonElement payload = default;
        _ = root.TryGetProperty("payload", out payload);

        try
        {
            if (type == "OPEN_FILE_DIALOG")
            {
                var filter = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("filter", out var f)
                    ? f.GetString()
                    : null;
                var files = await BndzWinRtDialogs.PickOpenFilesAsync(_hwnd, filter, multiselect: true).ConfigureAwait(true);
                ChromeHost.PostHostMessage(new { type = "OPEN_FILE_DIALOG_RESULT", id, payload = files });
                return;
            }

            if (type == "SAVE_FILE_DIALOG")
            {
                var filter = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("filter", out var f)
                    ? f.GetString()
                    : null;
                var defaultPath = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("defaultPath", out var d)
                    ? d.GetString()
                    : null;
                var selected = await BndzWinRtDialogs.PickSaveFileAsync(_hwnd, defaultPath, filter).ConfigureAwait(true);
                ChromeHost.PostHostMessage(new { type = "SAVE_FILE_DIALOG_RESULT", id, payload = selected });
                return;
            }

            if (type == "OPEN_FOLDER_DIALOG")
            {
                var description = payload.ValueKind == JsonValueKind.Object && payload.TryGetProperty("description", out var desc)
                    ? desc.GetString()
                    : null;
                var folder = await BndzWinRtDialogs.PickFolderAsync(_hwnd, description).ConfigureAwait(true);
                ChromeHost.PostHostMessage(new
                {
                    type = "OPEN_FOLDER_DIALOG_RESULT",
                    id,
                    payload = string.IsNullOrWhiteSpace(folder) ? "" : folder,
                });
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] WinRT dialog: {ex.Message}");
            if (type == "OPEN_FILE_DIALOG")
                ChromeHost.PostHostMessage(new { type = "OPEN_FILE_DIALOG_RESULT", id, payload = Array.Empty<string>() });
            else if (type == "SAVE_FILE_DIALOG")
                ChromeHost.PostHostMessage(new { type = "SAVE_FILE_DIALOG_RESULT", id, payload = (string?)null });
            else
                ChromeHost.PostHostMessage(new { type = "OPEN_FOLDER_DIALOG_RESULT", id, payload = "" });
        }
    }

    private async Task HandlePrintAsync(JsonElement root, string? type)
    {
        var id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
        try
        {
            bool ok;
            if (type == "PRINT_DOCUMENT"
                && root.TryGetProperty("payload", out var payload)
                && payload.TryGetProperty("path", out var pathEl))
            {
                ok = await BndzWinRtPrint.PrintPathAsync(_hwnd, pathEl.GetString()).ConfigureAwait(true);
            }
            else
            {
                ok = await BndzWinRtPrint.ShowPrintUiAsync(_hwnd).ConfigureAwait(true);
            }

            ChromeHost.PostHostMessage(new
            {
                type = "PRINT_RESULT",
                id,
                payload = new { ok },
            });
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] print: {ex.Message}");
            ChromeHost.PostHostMessage(new
            {
                type = "PRINT_RESULT",
                id,
                payload = new { ok = false, error = ex.Message },
            });
        }
    }

    private void HandleWindowChrome(JsonElement root)
    {
        try
        {
            if (!root.TryGetProperty("payload", out var payload)) return;
            var action = payload.TryGetProperty("action", out var a) ? a.GetString() ?? "" : "";
            switch (action.ToLowerInvariant())
            {
                case "minimize":
                    if (_appWindow?.Presenter is OverlappedPresenter minP)
                        minP.Minimize();
                    break;
                case "maximize":
                    if (_appWindow?.Presenter is OverlappedPresenter maxP)
                    {
                        if (maxP.State == OverlappedPresenterState.Maximized)
                            maxP.Restore();
                        else
                            maxP.Maximize();
                    }
                    BroadcastWindowState();
                    break;
                case "close":
                    if (_launch.IsPlugin)
                    {
                        _closeConfirmed = true;
                        Close();
                        break;
                    }
                    try
                    {
                        ChromeHost.PostHostMessage(new
                        {
                            type = "CLOSE_REQUEST",
                            payload = new { source = "x" },
                        });
                    }
                    catch
                    {
                        Close();
                    }
                    break;
                case "alwaysontop":
                    if (_appWindow?.Presenter is OverlappedPresenter topP)
                    {
                        var enabled = payload.TryGetProperty("enabled", out var en) && en.ValueKind == JsonValueKind.True;
                        topP.IsAlwaysOnTop = enabled;
                    }
                    break;
                case "drag":
                    BeginDrag();
                    break;
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[BNDZShell] WINDOW_CHROME: {ex.Message}");
        }
    }

    [DllImport("user32.dll")]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern IntPtr SendMessage(IntPtr hWnd, int msg, IntPtr wParam, IntPtr lParam);

    private const int WM_NCLBUTTONDOWN = 0xA1;
    private const int HTCAPTION = 0x2;

    private void BeginDrag()
    {
        if (_hwnd == IntPtr.Zero) return;
        ReleaseCapture();
        SendMessage(_hwnd, WM_NCLBUTTONDOWN, (IntPtr)HTCAPTION, IntPtr.Zero);
    }

    internal void ShowFatalError(string message)
    {
        try
        {
            ChromeHost.PaneStatusHint.Visibility = Microsoft.UI.Xaml.Visibility.Visible;
            ChromeHost.PaneStatusHint.Text = $"BNDZ shell error — see shell-crash.log\n{message}";
        }
        catch { /* ignore */ }
        try
        {
            var dialog = new Microsoft.UI.Xaml.Controls.ContentDialog
            {
                Title = "BNDZ shell error",
                Content = message + "\n\nDetails were written to %LocalAppData%\\BNDZ\\shell-crash.log",
                CloseButtonText = "Close",
                XamlRoot = Content?.XamlRoot,
            };
            _ = dialog.ShowAsync();
        }
        catch { /* ignore */ }
    }
}
