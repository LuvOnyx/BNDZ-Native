using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

namespace BNDZ.Services.OsQuickLook;

/// <summary>
/// Resolves selected paths from the foreground Explorer / Desktop shell view.
/// Inspired by QL-Win/QuickLook selection flow; implemented via Shell.Application COM
/// (no QuickLook.Native DLL dependency).
/// </summary>
public static class ForegroundShellSelectionService
{
    private const int MaxPath = 32767;

    public static IReadOnlyList<string> GetSelectedPaths()
    {
        var paths = new List<string>(8);
        try
        {
            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return paths;
            if (IsOwnProcess(hwnd)) return paths;
            if (IsEditableFocus()) return paths;

            CollectFromShellApplication(hwnd, IsDesktopWindow(hwnd), paths);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[OsQuickLook] selection: {ex.Message}");
        }

        return DedupResolve(paths);
    }

    public static bool IsShellPreviewTarget()
    {
        try
        {
            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero || IsOwnProcess(hwnd) || IsEditableFocus()) return false;
            if (IsDesktopWindow(hwnd) || IsExplorerWindow(hwnd)) return true;

            // Other file managers that host an Explorer view may still appear in Shell.Windows.
            var probe = new List<string>();
            CollectFromShellApplication(hwnd, desktopFallback: false, probe);
            return probe.Count > 0 || MatchesAnyShellWindow(hwnd);
        }
        catch
        {
            return false;
        }
    }

    private static void CollectFromShellApplication(IntPtr foreground, bool desktopFallback, List<string> paths)
    {
        var shellType = Type.GetTypeFromProgID("Shell.Application");
        if (shellType == null) return;
        dynamic shell = Activator.CreateInstance(shellType)!;

        foreach (dynamic window in shell.Windows())
        {
            try
            {
                long wh = Convert.ToInt64(window.HWND);
                var isFg = wh == foreground.ToInt64();
                var isDesktopLoc = false;
                try
                {
                    string? loc = window.LocationName as string;
                    isDesktopLoc = string.Equals(loc, "Desktop", StringComparison.OrdinalIgnoreCase);
                }
                catch { /* ignore */ }

                if (!isFg && !(desktopFallback && isDesktopLoc)) continue;

                dynamic items = window.Document.SelectedItems();
                foreach (dynamic item in items)
                {
                    try
                    {
                        string? p = item.Path as string;
                        if (!string.IsNullOrWhiteSpace(p)) paths.Add(p);
                    }
                    catch { /* skip */ }
                }

                if (paths.Count > 0) return;
            }
            catch
            {
                // Not a folder view (browser leftover, etc.)
            }
        }
    }

    private static bool MatchesAnyShellWindow(IntPtr foreground)
    {
        try
        {
            var shellType = Type.GetTypeFromProgID("Shell.Application");
            if (shellType == null) return false;
            dynamic shell = Activator.CreateInstance(shellType)!;
            foreach (dynamic window in shell.Windows())
            {
                try
                {
                    if (Convert.ToInt64(window.HWND) == foreground.ToInt64()) return true;
                }
                catch { /* ignore */ }
            }
        }
        catch { /* ignore */ }
        return false;
    }

    private static IReadOnlyList<string> DedupResolve(List<string> paths)
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var outList = new List<string>(paths.Count);
        foreach (var raw in paths)
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            var path = ResolveShortcut(raw.Trim().Trim('"'));
            if (string.IsNullOrWhiteSpace(path)) continue;
            if (!File.Exists(path) && !Directory.Exists(path)) continue;
            if (!seen.Add(path)) continue;
            outList.Add(path);
        }
        return outList;
    }

    private static string ResolveShortcut(string path)
    {
        if (string.IsNullOrEmpty(path)) return path;
        if (!string.Equals(Path.GetExtension(path), ".lnk", StringComparison.OrdinalIgnoreCase))
            return path;
        try
        {
            var link = (IShellLinkW)new ShellLinkCoClass();
            ((IPersistFile)link).Load(path, 0);
            var sb = new StringBuilder(MaxPath);
            link.GetPath(sb, sb.Capacity, IntPtr.Zero, 0);
            return sb.Length == 0 ? path : sb.ToString();
        }
        catch
        {
            return path;
        }
    }

    private static bool IsOwnProcess(IntPtr hwnd)
    {
        GetWindowThreadProcessId(hwnd, out var pid);
        return pid == (uint)Environment.ProcessId;
    }

    private static bool IsDesktopWindow(IntPtr hwnd)
    {
        var cls = GetClassName(hwnd);
        if (cls is "Progman" or "WorkerW" or "SHELLDLL_DefView" or "SysListView32")
        {
            if (cls is "Progman" or "WorkerW") return true;
            var root = GetAncestor(hwnd, 2);
            var rootCls = GetClassName(root);
            return rootCls is "Progman" or "WorkerW";
        }
        var root2 = GetAncestor(hwnd, 2);
        return GetClassName(root2) is "Progman" or "WorkerW";
    }

    private static bool IsExplorerWindow(IntPtr hwnd)
    {
        var root = GetAncestor(hwnd, 2);
        var cls = GetClassName(root != IntPtr.Zero ? root : hwnd);
        return cls is "CabinetWClass" or "ExploreWClass";
    }

    private static bool IsEditableFocus()
    {
        var guithi = new GUITHREADINFO { cbSize = Marshal.SizeOf<GUITHREADINFO>() };
        if (!GetGUIThreadInfo(0, ref guithi)) return false;
        var focus = guithi.hwndFocus;
        if (focus == IntPtr.Zero) return false;
        var cls = GetClassName(focus);
        return cls is "Edit" or "RichEdit20W" or "RichEdit50W" or "AutoFillPopup";
    }

    private static string GetClassName(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return string.Empty;
        var sb = new StringBuilder(256);
        _ = GetClassNameW(hwnd, sb, sb.Capacity);
        return sb.ToString();
    }

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint = "GetClassNameW")]
    private static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    private static extern IntPtr GetAncestor(IntPtr hwnd, uint gaFlags);

    [DllImport("user32.dll")]
    private static extern bool GetGUIThreadInfo(uint idThread, ref GUITHREADINFO pgui);

    [StructLayout(LayoutKind.Sequential)]
    private struct GUITHREADINFO
    {
        public int cbSize;
        public uint flags;
        public IntPtr hwndActive;
        public IntPtr hwndFocus;
        public IntPtr hwndCapture;
        public IntPtr hwndMenuOwner;
        public IntPtr hwndMoveSize;
        public IntPtr hwndCaret;
        public RECT rcCaret;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT { public int left, top, right, bottom; }

    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLinkCoClass { }

    [ComImport, Guid("000214F9-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszFile, int cchMaxPath, IntPtr pfd, int fFlags);
        void GetIDList(out IntPtr ppidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszName, int cchMaxName);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string pszName);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszDir, int cchMaxPath);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string pszDir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszArgs, int cchMaxPath);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string pszArgs);
        void GetHotkey(out short pwHotkey);
        void SetHotkey(short wHotkey);
        void GetShowCmd(out int piShowCmd);
        void SetShowCmd(int iShowCmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder pszIconPath, int cchIconPath, out int piIcon);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string pszIconPath, int iIcon);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string pszPathRel, int dwReserved);
        void Resolve(IntPtr hwnd, int fFlags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string pszFile);
    }
}
