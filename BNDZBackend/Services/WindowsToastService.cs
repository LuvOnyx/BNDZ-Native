using System;
using System.IO;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>
/// Native Windows shell notifications (tray balloon → notification center on Win10+).
/// </summary>
public static class WindowsToastService
{
    private const int WM_USER = 0x0400;
    private const int NIM_ADD = 0x00000000;
    private const int NIM_MODIFY = 0x00000001;
    private const int NIM_DELETE = 0x00000002;
    private const int NIF_MESSAGE = 0x00000001;
    private const int NIF_ICON = 0x00000002;
    private const int NIF_TIP = 0x00000004;
    private const int NIF_INFO = 0x00000010;
    private const int NIIF_INFO = 0x00000001;

    private static readonly object Gate = new();
    private static bool _added;
    private static IntPtr _iconHandle = IntPtr.Zero;
    private static readonly uint CallbackMessage = WM_USER + 0x5A1;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)]
        public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
        public string szInfo;
        public uint uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
        public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern bool Shell_NotifyIcon(int dwMessage, ref NOTIFYICONDATA lpData);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr LoadImage(IntPtr hInst, string name, uint type, int cx, int cy, uint fuLoad);

    private const uint IMAGE_ICON = 1;
    private const uint LR_LOADFROMFILE = 0x00000010;
    private const uint LR_DEFAULTSIZE = 0x00000040;

    public static void EnsureRegistered()
    {
        lock (Gate)
        {
            if (_added) return;
            try
            {
                var icoPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Assets", "BNDZ.ico");
                if (File.Exists(icoPath))
                {
                    _iconHandle = LoadImage(IntPtr.Zero, icoPath, IMAGE_ICON, 0, 0, LR_LOADFROMFILE | LR_DEFAULTSIZE);
                }

                var data = CreateData();
                data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
                data.szTip = "BNDZ File Manager";
                if (_iconHandle != IntPtr.Zero)
                {
                    Shell_NotifyIcon(NIM_ADD, ref data);
                    _added = true;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"WindowsToastService.EnsureRegistered: {ex.Message}");
            }
        }
    }

    public static void Show(string title, string body, string? tag = null)
    {
        if (string.IsNullOrWhiteSpace(title) && string.IsNullOrWhiteSpace(body)) return;

        System.Windows.Application.Current?.Dispatcher.BeginInvoke(() =>
        {
            try
            {
                EnsureRegistered();
                if (!_added) return;

                var data = CreateData();
                data.uFlags = NIF_INFO | NIF_ICON | NIF_TIP;
                data.szInfoTitle = Truncate(string.IsNullOrWhiteSpace(title) ? "BNDZ" : title, 63);
                data.szInfo = Truncate(body ?? "", 255);
                data.dwInfoFlags = NIIF_INFO;
                data.szTip = "BNDZ File Manager";
                Shell_NotifyIcon(NIM_MODIFY, ref data);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"WindowsToastService.Show: {ex.Message}");
            }
        });
    }

    private static NOTIFYICONDATA CreateData()
    {
        return new NOTIFYICONDATA
        {
            cbSize = Marshal.SizeOf<NOTIFYICONDATA>(),
            hWnd = IntPtr.Zero,
            uID = 1,
            uCallbackMessage = CallbackMessage,
            hIcon = _iconHandle,
            uVersion = 3,
        };
    }

    private static string Truncate(string value, int max) =>
        value.Length <= max ? value : value[..max];
}
