using System.Runtime.InteropServices;

namespace BNDZShell;

/// <summary>Minimal Win32 tray icon — avoids UseWindowsForms (breaks WinUI XAML compile).</summary>
internal sealed class BndzTrayIcon : IDisposable
{
    private readonly IntPtr _ownerHwnd;
    private readonly Action _onOpen;
    private readonly Action _onExit;
    private NOTIFYICONDATA _data;
    private bool _added;
    private bool _disposed;
    private IntPtr _iconHandle;

    private const uint NIM_ADD = 0x00000000;
    private const uint NIM_DELETE = 0x00000002;
    private const uint NIF_MESSAGE = 0x00000001;
    private const uint NIF_ICON = 0x00000002;
    private const uint NIF_TIP = 0x00000004;
    private const uint WM_APP = 0x8000;
    public const uint TrayCallbackMessage = WM_APP + 0x42;
    private const uint WM_LBUTTONDBLCLK = 0x0203;
    private const uint WM_RBUTTONUP = 0x0205;
    private const uint WM_COMMAND = 0x0111;
    private const int IdOpen = 1;
    private const int IdExit = 2;

    public BndzTrayIcon(IntPtr ownerHwnd, string tip, string? icoPath, Action onOpen, Action onExit)
    {
        _ownerHwnd = ownerHwnd;
        _onOpen = onOpen;
        _onExit = onExit;
        _iconHandle = LoadIconHandle(icoPath);

        _data = new NOTIFYICONDATA
        {
            cbSize = (uint)Marshal.SizeOf<NOTIFYICONDATA>(),
            hWnd = ownerHwnd,
            uID = 1,
            uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP,
            uCallbackMessage = TrayCallbackMessage,
            hIcon = _iconHandle,
            szTip = string.IsNullOrWhiteSpace(tip) ? "BNDZ" : tip,
        };
    }

    public void Show()
    {
        if (_added || _disposed) return;
        if (Shell_NotifyIcon(NIM_ADD, ref _data))
            _added = true;
    }

    public bool HandleWindowMessage(uint msg, IntPtr wParam, IntPtr lParam)
    {
        if (_disposed) return false;
        if (msg == TrayCallbackMessage)
        {
            var mouseMsg = (uint)lParam.ToInt64() & 0xFFFF;
            if (mouseMsg == WM_LBUTTONDBLCLK)
            {
                _onOpen();
                return true;
            }
            if (mouseMsg == WM_RBUTTONUP)
            {
                ShowContextMenu();
                return true;
            }
        }
        else if (msg == WM_COMMAND)
        {
            var id = (int)(wParam.ToInt64() & 0xFFFF);
            if (id == IdOpen) { _onOpen(); return true; }
            if (id == IdExit) { _onExit(); return true; }
        }
        return false;
    }

    private void ShowContextMenu()
    {
        var menu = CreatePopupMenu();
        if (menu == IntPtr.Zero) return;
        AppendMenu(menu, 0, (nuint)IdOpen, "Open BNDZ");
        AppendMenu(menu, 0x800, 0, string.Empty); // MF_SEPARATOR
        AppendMenu(menu, 0, (nuint)IdExit, "Exit BNDZ");

        GetCursorPos(out var pt);
        SetForegroundWindow(_ownerHwnd);
        TrackPopupMenu(menu, 0x0100 /*TPM_RIGHTBUTTON*/, pt.X, pt.Y, 0, _ownerHwnd, IntPtr.Zero);
        DestroyMenu(menu);
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        if (_added)
        {
            Shell_NotifyIcon(NIM_DELETE, ref _data);
            _added = false;
        }
        if (_iconHandle != IntPtr.Zero)
        {
            DestroyIcon(_iconHandle);
            _iconHandle = IntPtr.Zero;
        }
    }

    private static IntPtr LoadIconHandle(string? icoPath)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(icoPath) && File.Exists(icoPath))
            {
                var h = LoadImage(IntPtr.Zero, icoPath, 1 /*IMAGE_ICON*/, 0, 0, 0x00000010 /*LR_LOADFROMFILE*/);
                if (h != IntPtr.Zero) return h;
            }
        }
        catch { /* fall through */ }
        return LoadIcon(IntPtr.Zero, (IntPtr)32512 /*IDI_APPLICATION*/);
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATA
    {
        public uint cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIcon(uint dwMessage, ref NOTIFYICONDATA lpData);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImage(IntPtr hInst, string name, uint type, int cx, int cy, uint fuLoad);

    [DllImport("user32.dll")]
    private static extern IntPtr LoadIcon(IntPtr hInstance, IntPtr lpIconName);

    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr hIcon);

    [DllImport("user32.dll")]
    private static extern IntPtr CreatePopupMenu();

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool AppendMenu(IntPtr hMenu, uint uFlags, nuint uIDNewItem, string lpNewItem);

    [DllImport("user32.dll")]
    private static extern bool DestroyMenu(IntPtr hMenu);

    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool TrackPopupMenu(IntPtr hMenu, uint uFlags, int x, int y, int nReserved, IntPtr hWnd, IntPtr prcRect);
}
