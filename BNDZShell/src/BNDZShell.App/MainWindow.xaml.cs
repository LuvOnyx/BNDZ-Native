using System.Runtime.InteropServices;
using System.Text.Json;
using BNDZ.Services;
using BNDZShell.Bndz;
using Microsoft.UI;
using Microsoft.UI.Windowing;
using Microsoft.UI.Xaml;
using WinRT.Interop;

namespace BNDZShell;

public sealed partial class MainWindow : Window
{
    private const int MinWindowWidth = 416;
    private const int MinWindowHeight = 316;

    private AppWindow? _appWindow;
    private IntPtr _hwnd;
    private bool _bootstrapped;
    private bool _closeConfirmed;
    private bool _closing;
    private BndzTrayIcon? _trayIcon;
    private SubclassProc? _subclassProc;

    private delegate IntPtr SubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam, nuint uIdSubclass, nuint dwRefData);

    [DllImport("comctl32.dll", ExactSpelling = true)]
    private static extern bool SetWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, nuint uIdSubclass, nuint dwRefData);

    [DllImport("comctl32.dll", ExactSpelling = true)]
    private static extern bool RemoveWindowSubclass(IntPtr hWnd, SubclassProc pfnSubclass, nuint uIdSubclass);

    [DllImport("comctl32.dll", ExactSpelling = true)]
    private static extern IntPtr DefSubclassProc(IntPtr hWnd, uint uMsg, IntPtr wParam, IntPtr lParam);

    private const nuint DeviceChangeSubclassId = 0xB002;
    private const uint WM_DEVICECHANGE = 0x0219;

    public MainWindow()
    {
        InitializeComponent();
        Title = "BNDZ";
        ConfigureAppWindow();
        TrySetWindowIcon();
        InstallWindowSubclass();
        WireHostLifecycle();

        ChromeHost.PaneMessage += ChromeHost_PaneMessage;
        NativeList.ContextChanged += (_, _) => { };
        ChromeHost.WebViewInitialized += (_, _) =>
        {
            WireHostLifecycle();
            _ = BootstrapAsync();
        };

        Closed += (_, _) =>
        {
            RemoveWindowSubclass();
            DisposeTray();
            try { BndzEmbeddedBackendHost.SetHostCloseAction(() => { }); } catch { /* ignore */ }
        };

        ChromeHost.Prewarm();
        Activate();
    }

    private void WireHostLifecycle()
    {
        if (_hwnd != IntPtr.Zero)
            BndzEmbeddedBackendHost.SetHostWindowHandle(_hwnd);
        BndzEmbeddedBackendHost.SetHostCloseAction(RequestHostClose);
        BndzEmbeddedBackendHost.SetHostTrayActions(HideToTray, RestoreFromTray);
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
            var windowId = Microsoft.UI.Win32Interop.GetWindowIdFromWindow(_hwnd);
            _appWindow = AppWindow.GetFromWindowId(windowId);
            _appWindow.Resize(new Windows.Graphics.SizeInt32(1520, 960));
            if (_appWindow.Presenter is OverlappedPresenter overlapped)
            {
                overlapped.PreferredMinimumWidth = MinWindowWidth;
                overlapped.PreferredMinimumHeight = MinWindowHeight;
            }

            ExtendsContentIntoTitleBar = true;
            var tb = _appWindow.TitleBar;
            tb.ButtonBackgroundColor = Colors.Transparent;
            tb.ButtonInactiveBackgroundColor = Colors.Transparent;
            tb.ButtonPressedBackgroundColor = Colors.Transparent;
            tb.ButtonHoverBackgroundColor = ColorHelper.FromArgb(0x33, 0xFF, 0xFF, 0xFF);
            tb.ButtonForegroundColor = Colors.White;
            tb.ButtonInactiveForegroundColor = ColorHelper.FromArgb(0x99, 0xFF, 0xFF, 0xFF);
            tb.BackgroundColor = Colors.Transparent;
            tb.InactiveBackgroundColor = Colors.Transparent;

            // Caption X / Alt+F4 / taskbar close → same Ask/Tray/Quit flow as File→Exit.
            _appWindow.Closing += (_, args) =>
            {
                if (_closeConfirmed) return;
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
            var iconPath = Path.Combine(AppContext.BaseDirectory, "Assets", "BNDZ.ico");
            if (!File.Exists(iconPath) || _appWindow is null) return;
            _appWindow.SetIcon(iconPath);
        }
        catch { /* best effort */ }
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

        if (type is "BNDZ_NATIVE_LIST_BOUNDS" or "BNDZ_PANE_NAVIGATE" or "BNDZ_REQUEST_DIR_LISTING")
            return;
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
}
