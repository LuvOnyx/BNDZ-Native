using System;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>Brings BNDZ above WebView2 before showing a native modal dialog.</summary>
public static class NativeDialogHelper
{
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    public static void FocusOwner(IntPtr hwnd)
    {
        if (hwnd != IntPtr.Zero)
            SetForegroundWindow(hwnd);
    }
}
