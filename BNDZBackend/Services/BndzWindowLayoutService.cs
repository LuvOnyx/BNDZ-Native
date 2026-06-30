using System;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>SuperCmd window-management port — tiles the foreground window on the active monitor.</summary>
public static class BndzWindowLayoutService
{
    public static bool Apply(string commandId)
    {
        var hwnd = GetForegroundWindow();
        if (hwnd == IntPtr.Zero) return false;
        if (!GetWindowRect(hwnd, out var win)) return false;

        var monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if (monitor == IntPtr.Zero) return false;
        var mi = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        if (!GetMonitorInfo(monitor, ref mi)) return false;

        var work = mi.rcWork;
        var sw = work.Right - work.Left;
        var sh = work.Bottom - work.Top;
        var winW = win.Right - win.Left;
        var winH = win.Bottom - win.Top;

        if (!ResolveLayout(commandId, work.Left, work.Top, sw, sh, win.Left, win.Top, winW, winH, out var x, out var y, out var w, out var h))
            return false;

        return SetWindowPos(hwnd, HWND_TOP, x, y, w, h, SWP_SHOWWINDOW);
    }

    private static bool ResolveLayout(
        string id, int ox, int oy, int sw, int sh,
        int winX, int winY, int winW, int winH,
        out int x, out int y, out int w, out int h)
    {
        x = winX; y = winY; w = winW; h = winH;
        switch (id)
        {
            case "system-window-management-left":
                x = ox; y = oy; w = sw / 2; h = sh; return true;
            case "system-window-management-right":
                x = ox + sw / 2; y = oy; w = sw - sw / 2; h = sh; return true;
            case "system-window-management-top":
                x = ox; y = oy; w = sw; h = sh / 2; return true;
            case "system-window-management-bottom":
                x = ox; y = oy + sh / 2; w = sw; h = sh - sh / 2; return true;
            case "system-window-management-top-left":
                x = ox; y = oy; w = sw / 2; h = sh / 2; return true;
            case "system-window-management-top-right":
                x = ox + sw / 2; y = oy; w = sw - sw / 2; h = sh / 2; return true;
            case "system-window-management-bottom-left":
                x = ox; y = oy + sh / 2; w = sw / 2; h = sh - sh / 2; return true;
            case "system-window-management-bottom-right":
                x = ox + sw / 2; y = oy + sh / 2; w = sw - sw / 2; h = sh - sh / 2; return true;
            case "system-window-management-first-third":
                x = ox; y = oy; w = sw / 3; h = sh; return true;
            case "system-window-management-center-third":
                x = ox + sw / 3; y = oy; w = sw / 3; h = sh; return true;
            case "system-window-management-last-third":
                x = ox + (2 * sw / 3); y = oy; w = sw - (2 * sw / 3); h = sh; return true;
            case "system-window-management-center":
                w = (3 * sw) / 4; h = (3 * sh) / 4; x = ox + (sw - w) / 2; y = oy + (sh - h) / 2; return true;
            case "system-window-management-center-80":
                w = (4 * sw) / 5; h = (4 * sh) / 5; x = ox + (sw - w) / 2; y = oy + (sh - h) / 2; return true;
            case "system-window-management-fill":
                x = ox; y = oy; w = sw; h = sh; return true;
            case "system-window-management-maximize-width":
                x = ox; y = winY; w = sw; h = winH; return true;
            case "system-window-management-maximize-height":
                x = winX; y = oy; w = winW; h = sh; return true;
            case "system-window-management-increase-size-10":
                w = winW + Math.Max(20, winW / 10); h = winH + Math.Max(20, winH / 10);
                x = winX - (w - winW) / 2; y = winY - (h - winH) / 2; return true;
            case "system-window-management-decrease-size-10":
                w = Math.Max(200, winW - Math.Max(20, winW / 10)); h = Math.Max(160, winH - Math.Max(20, winH / 10));
                x = winX + (winW - w) / 2; y = winY + (winH - h) / 2; return true;
            case "system-window-management":
                w = (3 * sw) / 4; h = (3 * sh) / 4; x = ox + (sw - w) / 2; y = oy + (sh - h) / 2; return true;
            default:
                return id.StartsWith("system-window-management", StringComparison.Ordinal)
                    && ResolveLayout("system-window-management-center", ox, oy, sw, sh, winX, winY, winW, winH, out x, out y, out w, out h);
        }
    }

    private const uint SWP_SHOWWINDOW = 0x0040;
    private static readonly IntPtr HWND_TOP = IntPtr.Zero;
    private const uint MONITOR_DEFAULTTONEAREST = 2;

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int x, int y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFO lpmi);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int Left, Top, Right, Bottom; }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MONITORINFO
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
    }
}
