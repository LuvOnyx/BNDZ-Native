using System;
using System.Runtime.InteropServices;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.Shell;
using Windows.Win32.UI.WindowsAndMessaging;

namespace BNDZ.Services;

/// <summary>
/// Thin CsWin32-backed helpers for shell icon lifetime (complements Vanara paths).
/// </summary>
internal static class ShellWin32
{
    public static void SafeDestroyIcon(IntPtr hIcon)
    {
        if (hIcon == IntPtr.Zero) return;
        try
        {
            PInvoke.DestroyIcon(new HICON(hIcon));
        }
        catch
        {
            try { DestroyIconFallback(hIcon); } catch { }
        }
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool DestroyIconFallback(IntPtr hIcon);
}
