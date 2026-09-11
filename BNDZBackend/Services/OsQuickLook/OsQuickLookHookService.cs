using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Threading;

namespace BNDZ.Services.OsQuickLook;

/// <summary>
/// OS-wide Spacebar Quick Look (Explorer / Desktop), adapted from QL-Win/QuickLook's
/// low-level keyboard hook model — not RegisterHotKey (bare Space cannot be registered safely).
/// </summary>
public sealed class OsQuickLookHookService : IDisposable
{
    private const int WhKeyboardLl = 13;
    private const int WmKeyDown = 0x0100;
    private const int WmSysKeyDown = 0x0104;
    private const int WmKeyUp = 0x0101;
    private const int WmSysKeyUp = 0x0105;
    private const int VkSpace = 0x20;
    private const int VkEscape = 0x1B;
    private const long ValidKeyPressDelayTicks = TimeSpan.TicksPerSecond;
    private const long HoldToPreviewTicks = TimeSpan.TicksPerMillisecond * 750;

    private readonly Dispatcher _dispatcher;
    private readonly object _gate = new();
    private IntPtr _hook = IntPtr.Zero;
    private LowLevelKeyboardProc? _proc;
    private Thread? _hookThread;
    private volatile bool _enabled = true;
    private volatile bool _disposed;
    private long _lastInvalidKeyTicks;
    private bool _spaceDown;
    private long _spaceHoldTicks;
    private bool _previewContext;

    public event Action? ToggleRequested;
    public event Action? CloseRequested;

    public OsQuickLookHookService(Dispatcher dispatcher)
    {
        _dispatcher = dispatcher ?? throw new ArgumentNullException(nameof(dispatcher));
    }

    public bool Enabled
    {
        get => _enabled;
        set => _enabled = value;
    }

    public void Start()
    {
        lock (_gate)
        {
            if (_disposed || _hookThread != null) return;
            _hookThread = new Thread(HookThreadMain)
            {
                IsBackground = true,
                Name = "BNDZ-OsQuickLook-Hook",
            };
            _hookThread.SetApartmentState(ApartmentState.STA);
            _hookThread.Start();
        }
    }

    public void Stop()
    {
        lock (_gate)
        {
            if (_hook != IntPtr.Zero)
            {
                try { UnhookWindowsHookEx(_hook); } catch { /* ignore */ }
                _hook = IntPtr.Zero;
            }
            _proc = null;
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _enabled = false;
        Stop();
        try { _hookThread?.Join(500); } catch { /* ignore */ }
        _hookThread = null;
    }

    private void HookThreadMain()
    {
        try
        {
            _proc = HookProc;
            var hMod = LoadLibrary("user32.dll");
            _hook = SetWindowsHookEx(WhKeyboardLl, _proc, hMod, 0);
            if (_hook == IntPtr.Zero)
            {
                Debug.WriteLine($"[OsQuickLook] SetWindowsHookEx failed: {Marshal.GetLastWin32Error()}");
                return;
            }

            // Message pump required for WH_KEYBOARD_LL on this thread.
            while (!_disposed)
            {
                var ret = GetMessage(out var msg, IntPtr.Zero, 0, 0);
                if (ret <= 0) break;
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[OsQuickLook] hook thread: {ex.Message}");
        }
        finally
        {
            Stop();
        }
    }

    private IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode < 0 || !_enabled || _disposed)
            return CallNextHookEx(_hook, nCode, wParam, lParam);

        try
        {
            var info = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
            var vk = (int)info.vkCode;
            var wp = wParam.ToInt32();
            var isDown = wp is WmKeyDown or WmSysKeyDown;
            var isUp = wp is WmKeyUp or WmSysKeyUp;

            if (vk is not (VkSpace or VkEscape)
                && vk is not (0x25 or 0x26 or 0x27 or 0x28) /* arrows — reserved */)
            {
                if (isDown) _lastInvalidKeyTicks = DateTime.UtcNow.Ticks;
                return CallNextHookEx(_hook, nCode, wParam, lParam);
            }

            // Modifiers: ignore Ctrl/Alt/Shift+Space (leave to OS / other apps).
            if (isDown && (IsKeyDown(0x10) || IsKeyDown(0x11) || IsKeyDown(0x12) || IsKeyDown(0x5B) || IsKeyDown(0x5C)))
                return CallNextHookEx(_hook, nCode, wParam, lParam);

            if (DateTime.UtcNow.Ticks - _lastInvalidKeyTicks < ValidKeyPressDelayTicks
                && vk == VkSpace)
            {
                // Too soon after typing — avoid accidental popups while navigating with letters.
                return CallNextHookEx(_hook, nCode, wParam, lParam);
            }

            if (vk == VkEscape && isDown)
            {
                if (!ForegroundShellSelectionService.IsShellPreviewTarget()
                    && !IsOwnForeground())
                {
                    return CallNextHookEx(_hook, nCode, wParam, lParam);
                }
                Post(() => CloseRequested?.Invoke());
                return CallNextHookEx(_hook, nCode, wParam, lParam);
            }

            if (vk != VkSpace)
                return CallNextHookEx(_hook, nCode, wParam, lParam);

            // In-app BNDZ Spacebar Quick Look owns focus when our window is foreground.
            if (IsOwnForeground())
                return CallNextHookEx(_hook, nCode, wParam, lParam);

            if (isDown)
            {
                if (_spaceDown) return CallNextHookEx(_hook, nCode, wParam, lParam);
                _spaceHoldTicks = DateTime.UtcNow.Ticks;
                _previewContext = ForegroundShellSelectionService.IsShellPreviewTarget();
                if (!_previewContext)
                    return CallNextHookEx(_hook, nCode, wParam, lParam);

                _spaceDown = true;
                // Fire on key-down for instant Quick Look (macOS-like). Hold-release still toggles close.
                Post(() => ToggleRequested?.Invoke());
                // Swallow Space in Explorer/Desktop so the shell doesn't also activate/scroll.
                return (IntPtr)1;
            }

            if (isUp)
            {
                var heldLong = DateTime.UtcNow.Ticks - _spaceHoldTicks >= HoldToPreviewTicks;
                var wasPreview = _previewContext;
                _spaceDown = false;
                _previewContext = false;
                // Optional hold-to-close (QuickLook AutoCloseHolding): close after long hold release.
                if (wasPreview && heldLong)
                {
                    Post(() => CloseRequested?.Invoke());
                    return (IntPtr)1;
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[OsQuickLook] HookProc: {ex.Message}");
        }

        return CallNextHookEx(_hook, nCode, wParam, lParam);
    }

    private void Post(Action action)
    {
        try
        {
            _dispatcher.BeginInvoke(action, DispatcherPriority.Normal);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[OsQuickLook] dispatch: {ex.Message}");
        }
    }

    private static bool IsOwnForeground()
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return false;
        GetWindowThreadProcessId(hwnd, out var pid);
        return pid == (uint)Environment.ProcessId;
    }

    private static bool IsKeyDown(int vk) => (GetAsyncKeyState(vk) & 0x8000) != 0;

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadLibrary(string lpFileName);

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll")]
    private static extern bool TranslateMessage([In] ref MSG lpMsg);

    [DllImport("user32.dll")]
    private static extern IntPtr DispatchMessage([In] ref MSG lpMsg);
}
