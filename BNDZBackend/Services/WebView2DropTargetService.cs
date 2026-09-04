using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Threading;
using ComIDataObject = System.Runtime.InteropServices.ComTypes.IDataObject;

namespace BNDZ.Services;

/// <summary>
/// Registers a host-owned native OLE <c>IDropTarget</c> on the WebView2 child HWND.
///
/// Root-cause of the external-drop bug:
///   WPF's <c>PreviewDrop</c> works through WPF's own <c>IDropTarget</c> registered on the
///   top-level HWND.  WebView2 creates a child HWND and registers its OWN <c>IDropTarget</c>
///   on it.  OLE delivers drag messages to the topmost HWND under the cursor — which is the
///   WebView2 child — so WPF's routed events never fire for drops over the WebView2 area.
///   Setting <c>AllowExternalDrop=false</c> makes WebView2 install a *blocking* target that
///   returns <c>DROPEFFECT_NONE</c>; it does NOT unregister, so OLE still never walks up to
///   the WPF target.
///
/// Fix:
///   1. Find the WebView2 child HWND (class "Chrome_WidgetWin_1").
///   2. <c>RevokeDragDrop</c> – removes WebView2's own OLE target.
///   3. <c>RegisterDragDrop</c> our <see cref="BndzDropTarget"/> on that HWND.
///   4. <see cref="BndzDropTarget"/> extracts CF_HDROP, resolves DROPEFFECT, and calls back
///      into <c>MainWindow</c> via <c>onDrop</c> / <c>onHover</c> (existing JS post path).
///
/// The WPF <c>PreviewDrop</c> handlers remain as a fallback for drops over non-WebView2 areas
/// (sidebar, toolbar, tabs) where the WebView2 HWND is not the topmost target.
/// </summary>
internal static class WebView2DropTargetService
{
    // ── Win32 / COM P-Invoke ────────────────────────────────────────────────────

    [DllImport("ole32.dll", PreserveSig = true)]
    private static extern int RegisterDragDrop(IntPtr hwnd,
        [MarshalAs(UnmanagedType.Interface)] IRawDropTarget pDropTarget);

    [DllImport("ole32.dll", PreserveSig = true)]
    private static extern int RevokeDragDrop(IntPtr hwnd);

    [DllImport("ole32.dll", PreserveSig = true)]
    private static extern int OleInitialize(IntPtr reserved);

    // shell32 DragQueryFile – extracts paths from an HDROP handle (= CF_HDROP HGLOBAL)
    [DllImport("shell32.dll", EntryPoint = "DragQueryFileW", CharSet = CharSet.Unicode)]
    private static extern uint DragQueryFile(IntPtr hDrop, uint iFile, StringBuilder? lpszFile, uint cch);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumChildWindows(IntPtr hwndParent,
        [MarshalAs(UnmanagedType.FunctionPtr)] EnumChildProc lpEnumFunc,
        IntPtr lParam);

    [DllImport("user32.dll", EntryPoint = "GetClassNameW", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hwnd, StringBuilder lpClassName, int nMaxCount);

    // Must return SHORT — Bool marshal collapses 0x8000 (down) to 0/1 and breaks QueryContinueDrag.
    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int vKey);

    [DllImport("user32.dll")]
    private static extern bool ScreenToClient(IntPtr hWnd, ref NativePoint lpPoint);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr hWnd, out NativeRect lpRect);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr WindowFromPoint(NativePoint pt);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string? lpClassName, string? lpWindowName);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowEx(IntPtr hwndParent, IntPtr hwndChildAfter, string? lpszClass, string? lpszWindow);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnumWindows(
        [MarshalAs(UnmanagedType.FunctionPtr)] EnumChildProc lpEnumFunc,
        IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IntersectRect(out NativeRect lprcDst, ref NativeRect lprcSrc1, ref NativeRect lprcSrc2);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsChild(IntPtr hWndParent, IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReleaseCapture();

    [DllImport("user32.dll")]
    private static extern IntPtr GetCapture();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ClipCursor(IntPtr lpRect);

    [DllImport("user32.dll")]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr LoadCursor(IntPtr hInstance, int lpCursorName);

    [DllImport("user32.dll")]
    private static extern IntPtr SetCursor(IntPtr hCursor);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHFileOperation(ref SHFILEOPSTRUCT fileOp);

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InvalidateRect(IntPtr hWnd, IntPtr lpRect, [MarshalAs(UnmanagedType.Bool)] bool bErase);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool EnableWindow(IntPtr hWnd, [MarshalAs(UnmanagedType.Bool)] bool bEnable);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowEnabled(IntPtr hWnd);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelMouseProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);

    private delegate IntPtr LowLevelMouseProc(int nCode, IntPtr wParam, IntPtr lParam);

    private const int WH_MOUSE_LL = 14;

    /// <summary>Host HWND temporarily disabled so WindowFromPoint reaches Desktop under us.</summary>
    private static int _hostDisabledForDesktopOleDrop;

    /// <summary>
    /// Physical mouse-up (WH_MOUSE_LL). Ignore ups until OLE has seen button-down AND desktop
    /// GiveFeedback (early ~900ms WM_LBUTTONUP is synthetic noise). On accept: Escape so
    /// DoDragDrop's nested loop runs QueryContinueDrag immediately — WM_MOUSEMOVE alone does not
    /// wake QCD while the cursor stays on wallpaper.
    /// </summary>
    private static int _outboundPhysicalButtonUp;
    private static int _outboundSawButtonDown;
    private static long _outboundSawButtonDownAtMs;
    private static int _outboundSawDesktopFeedback;
    private static long _outboundDragStartedMs;
    private static IntPtr _llMouseHook = IntPtr.Zero;
    private static LowLevelMouseProc? _llMouseProcKeepAlive;
    private static int _olePointerStateReleased;
    /// <summary>DragStarting path — skip LL hook and synthetic pointer ups.</summary>
    private static int _outboundDragFromDragStarting;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEOPSTRUCT
    {
        public IntPtr hwnd;
        public uint wFunc;
        public string pFrom;
        public string pTo;
        public ushort fFlags;
        [MarshalAs(UnmanagedType.Bool)] public bool fAnyOperationsAborted;
        public IntPtr hNameMappings;
        public string? lpszProgressTitle;
    }

    private const uint FO_MOVE = 0x0001;
    private const uint FO_COPY = 0x0002;
    private const ushort FOF_SILENT = 0x0004;
    private const ushort FOF_RENAMEONCOLLISION = 0x0008;
    private const ushort FOF_NOCONFIRMATION = 0x0010;
    private const ushort FOF_ALLOWUNDO = 0x0040;
    private const ushort FOF_NOCONFIRMMKDIR = 0x0200;
    private const ushort FOF_NOERRORUI = 0x0400;
    private const uint SHCNE_CREATE = 0x00000002;
    private const uint SHCNE_DELETE = 0x00000004;
    private const uint SHCNE_UPDATEITEM = 0x00002000;
    private const uint SHCNE_UPDATEDIR = 0x00001000;
    private const uint SHCNF_PATHW = 0x0005;
    private const uint SHCNF_FLUSH = 0x1000;
    private const uint SHCNF_FLUSHNOWAIT = 0x2000;

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT
    {
        public int dx;
        public int dy;
        public uint mouseData;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public MOUSEINPUT mi;
    }

    private const uint INPUT_MOUSE = 0;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint WM_LBUTTONUP = 0x0202;
    private const uint WM_RBUTTONUP = 0x0205;
    private const uint WM_MOUSEMOVE = 0x0200;
    private const int IDC_ARROW = 32512;
    private const byte VK_ESCAPE = 0x1B;
    private const uint KEYEVENTF_KEYUP = 0x0002;

    [DllImport("user32.dll")]
    private static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out NativePoint lpPoint);

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left, Top, Right, Bottom;
        public int Width => Right - Left;
        public int Height => Bottom - Top;
        public int Area => Math.Max(0, Width) * Math.Max(0, Height);
    }

    [DllImport("ole32.dll")]
    private static extern void ReleaseStgMedium(ref STGMEDIUM pmedium);

    private delegate bool EnumChildProc(IntPtr hwnd, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativePoint { public int x, y; }

    // OLE DROPEFFECT constants
    private const uint DROPEFFECT_NONE = 0;
    private const uint DROPEFFECT_COPY = 1;
    private const uint DROPEFFECT_MOVE = 2;

    // grfKeyState bitmask
    private const uint MK_SHIFT = 0x0004;
    private const uint MK_CONTROL = 0x0008;

    private const short CF_HDROP = 15;
    private static readonly short CF_FILEGROUPDESCRIPTORW = (short)RegisterClipboardFormat("FileGroupDescriptorW");
    private static readonly short CF_FILECONTENTS = (short)RegisterClipboardFormat("FileContents");
    private static readonly short CF_SHELLIDLIST = (short)RegisterClipboardFormat("Shell IDList Array");

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterClipboardFormat(string lpszFormat);

    // HRESULT S_OK / S_FALSE
    private const int S_OK = 0;
    private const int S_FALSE = 1;

    // ── COM IDropTarget (GUID 00000122-…) ──────────────────────────────────────

    [ComImport]
    [Guid("00000122-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IRawDropTarget
    {
        [PreserveSig]
        int DragEnter(
            [MarshalAs(UnmanagedType.Interface)] ComIDataObject pDataObj,
            uint grfKeyState,
            NativePoint pt,
            ref uint pdwEffect);

        [PreserveSig]
        int DragOver(uint grfKeyState, NativePoint pt, ref uint pdwEffect);

        [PreserveSig]
        int DragLeave();

        [PreserveSig]
        int Drop(
            [MarshalAs(UnmanagedType.Interface)] ComIDataObject pDataObj,
            uint grfKeyState,
            NativePoint pt,
            ref uint pdwEffect);
    }

    // ── Registration state ─────────────────────────────────────────────────────

    private static BndzDropTarget? _activeTarget;
    private static IntPtr _registeredHwnd = IntPtr.Zero;
    private static IntPtr _hostWindowHwnd = IntPtr.Zero;
    private static readonly List<IntPtr> _extraRegisteredHwnds = new();
    /// <summary>Top caption/menubar band (physical px) — escalate outbound OLE across full strip.</summary>
    private static int _outboundTopChromePx = 48;
    private static bool _registeredOnChromeChild;
    private static int _lastRegisterHr;

    private const int DRAGDROP_E_ALREADYREGISTERED = unchecked((int)0x80040101);

    /// <summary>
    /// Find the WebView2 child HWND under <paramref name="windowHwnd"/> and register
    /// BNDZ's <see cref="BndzDropTarget"/> on it.
    ///
    /// <para>Callbacks run on the UI (STA) thread — direct WPF access is safe.</para>
    /// <para>
    ///   <paramref name="onDrop"/>: (paths, screenX, screenY, grfKeyState, fromBndzOle).<br/>
    ///   <paramref name="onHover"/>: (screenX, screenY) — caller throttles.
    /// </para>
    /// Call after <c>EnsureCoreWebView2Async</c> completes and every time WebView2 restarts.
    /// Never treats the top-level host HWND as success — OLE hits the Chromium child.
    /// </summary>
    public static bool Register(
        IntPtr windowHwnd,
        Action<string[], double, double, uint, bool> onDrop,
        Action<double, double> onHover,
        Func<bool>? isBndzOleDragActive)
    {
        if (windowHwnd == IntPtr.Zero)
        {
            _lastRegisterHr = unchecked((int)0x80070057); // E_INVALIDARG
            return false;
        }

        var oleDragActive = isBndzOleDragActive ?? (() => false);

        // Never revoke/re-register while outbound DoDragDrop owns the mouse — breaks desktop drop.
        try
        {
            if (_inboundDropTargetSuspendedForOutbound || oleDragActive())
            {
                AppendOleDndLog("REGISTER skipped — outbound OLE drag active");
                return true;
            }
        }
        catch { /* treat as not active */ }

        _hostWindowHwnd = windowHwnd;

        // Ensure OLE is initialized on this thread (S_FALSE = already initialized, fine).
        int oleHr = OleInitialize(IntPtr.Zero);
        if (oleHr < 0)
            Debug.WriteLine($"[OleDrop] OleInitialize hr=0x{oleHr:X8}");

        // OLE hits WindowFromPoint — prefer that HWND, not "largest Chrome_WidgetWin_1".
        var wv2Hwnd = ResolveOleHitHwnd(windowHwnd);
        if (wv2Hwnd == IntPtr.Zero)
            wv2Hwnd = FindWebView2Hwnd(windowHwnd);
        if (wv2Hwnd == IntPtr.Zero)
        {
            _lastRegisterHr = unchecked((int)0x80004005); // E_FAIL — Chrome child not ready
            Debug.WriteLine($"[OleDrop] WebView2 Chrome HWND missing under 0x{windowHwnd:X} — not latching top-level");
            return false;
        }

        RevokeAllRegistered();

        var target = new BndzDropTarget(wv2Hwnd, onDrop, onHover, oleDragActive);
        // Revoke every Chromium/InputSite leaf under the host, then register BNDZ on each —
        // OLE delivers to the live cursor HWND, not only the center-probe primary.
        var claimHwnds = CollectAndRevokeChromiumTargetsUnder(windowHwnd, wv2Hwnd);

        int primaryHr = unchecked((int)0x80004005);
        var registered = new List<IntPtr>();
        foreach (var hwnd in claimHwnds)
        {
            int regHr = RegisterDragDrop(hwnd, target);
            if (regHr == DRAGDROP_E_ALREADYREGISTERED)
            {
                try { RevokeDragDrop(hwnd); } catch { /* ignore */ }
                regHr = RegisterDragDrop(hwnd, target);
            }
            if (hwnd == wv2Hwnd)
                primaryHr = regHr;
            if (regHr == S_OK)
                registered.Add(hwnd);
            else
                Debug.WriteLine($"[OleDrop] RegisterDragDrop failed hr=0x{regHr:X8} on 0x{hwnd:X}");
        }

        _lastRegisterHr = primaryHr;
        if (registered.Count == 0)
        {
            Debug.WriteLine($"[OleDrop] RegisterDragDrop failed on all claim HWNDs (primary hr=0x{primaryHr:X8})");
            return false;
        }

        _activeTarget = target;
        _registeredHwnd = registered.Contains(wv2Hwnd) ? wv2Hwnd : registered[0];
        _registeredOnChromeChild = true;
        foreach (var hwnd in registered)
        {
            if (hwnd != _registeredHwnd)
                _extraRegisteredHwnds.Add(hwnd);
        }

        Debug.WriteLine($"[OleDrop] Registered IDropTarget on {_registeredHwnd:X} (+{_extraRegisteredHwnds.Count} siblings) total={registered.Count}");
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BNDZ");
            Directory.CreateDirectory(dir);
            File.AppendAllText(
                Path.Combine(dir, "ole-dnd.log"),
                $"{DateTime.Now:HH:mm:ss.fff} REGISTER ok primary=0x{_registeredHwnd:X} extras={_extraRegisteredHwnds.Count} hr=0x{primaryHr:X8}{Environment.NewLine}");
        }
        catch { /* ignore */ }
        return true;
    }

    private static void RevokeAllRegistered()
    {
        if (_registeredHwnd != IntPtr.Zero)
        {
            try { RevokeDragDrop(_registeredHwnd); } catch { /* ignore */ }
            _registeredHwnd = IntPtr.Zero;
        }
        foreach (var h in _extraRegisteredHwnds)
        {
            try { RevokeDragDrop(h); } catch { /* ignore */ }
        }
        _extraRegisteredHwnds.Clear();
        _activeTarget = null;
        _registeredOnChromeChild = false;
    }

    private static bool IsWebViewOleClass(IntPtr hwnd)
    {
        var sb = new StringBuilder(256);
        GetClassName(hwnd, sb, sb.Capacity);
        var cls = sb.ToString();
        return cls.StartsWith("Chrome_WidgetWin", StringComparison.Ordinal)
            || cls.IndexOf("Chrome_RenderWidget", StringComparison.OrdinalIgnoreCase) >= 0
            || cls.IndexOf("IntermediateD3D", StringComparison.OrdinalIgnoreCase) >= 0
            || cls.IndexOf("InputSite", StringComparison.OrdinalIgnoreCase) >= 0
            || cls.IndexOf("DesktopChildSiteBridge", StringComparison.OrdinalIgnoreCase) >= 0
            || cls.IndexOf("WebView", StringComparison.OrdinalIgnoreCase) >= 0;
    }

    private static IntPtr ResolveOleHitHwnd(IntPtr parentHwnd)
    {
        if (!GetWindowRect(parentHwnd, out var hostRect))
            return IntPtr.Zero;
        GetWindowThreadProcessId(parentHwnd, out var hostPid);
        var cx = (hostRect.Left + hostRect.Right) / 2;
        var cy = (hostRect.Top + hostRect.Bottom) / 2;
        var hit = WindowFromPoint(new NativePoint { x = cx, y = cy });
        if (hit == IntPtr.Zero) return IntPtr.Zero;

        var cur = hit;
        for (var i = 0; i < 16 && cur != IntPtr.Zero; i++)
        {
            GetWindowThreadProcessId(cur, out var pid);
            if (pid != hostPid) break;
            if (cur != parentHwnd && IsWebViewOleClass(cur))
            {
                Debug.WriteLine($"[OleDrop] ResolveOleHitHwnd → 0x{cur:X} (from center hit 0x{hit:X})");
                return cur;
            }
            if (cur == parentHwnd) break;
            cur = GetParent(cur);
        }
        return IntPtr.Zero;
    }

    private static bool IsChromiumDropClaimClass(string cls) =>
        cls.StartsWith("Chrome_WidgetWin", StringComparison.Ordinal)
        || cls.IndexOf("Chrome_RenderWidget", StringComparison.OrdinalIgnoreCase) >= 0
        || cls.IndexOf("IntermediateD3D", StringComparison.OrdinalIgnoreCase) >= 0
        || cls.IndexOf("InputSite", StringComparison.OrdinalIgnoreCase) >= 0
        || cls.IndexOf("DesktopChildSiteBridge", StringComparison.OrdinalIgnoreCase) >= 0
        || cls.IndexOf("WebView", StringComparison.OrdinalIgnoreCase) >= 0;

    /// <summary>
    /// Revoke Chromium/InputSite drop targets under the host and return every hwnd that
    /// should receive BNDZ's <see cref="BndzDropTarget"/> (primary first).
    /// </summary>
    private static List<IntPtr> CollectAndRevokeChromiumTargetsUnder(IntPtr parentHwnd, IntPtr primary)
    {
        var claimed = new List<IntPtr>();
        var seen = new HashSet<long>();

        void TryClaim(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return;
            var key = hwnd.ToInt64();
            if (!seen.Add(key)) return;
            try { RevokeDragDrop(hwnd); } catch { /* ignore */ }
            claimed.Add(hwnd);
        }

        TryClaim(primary);
        var sb = new StringBuilder(256);
        void Walk(IntPtr node)
        {
            EnumChildWindows(node, (hwnd, _) =>
            {
                sb.Clear();
                GetClassName(hwnd, sb, sb.Capacity);
                if (IsChromiumDropClaimClass(sb.ToString()))
                    TryClaim(hwnd);
                Walk(hwnd);
                return true;
            }, IntPtr.Zero);
        }
        Walk(parentHwnd);

        // Prefer primary first so latch / diagnostics stay stable.
        if (primary != IntPtr.Zero && claimed.Count > 1 && claimed[0] != primary)
        {
            claimed.Remove(primary);
            claimed.Insert(0, primary);
        }
        return claimed;
    }

    /// <summary>Revoke the currently registered drop target (e.g., on window close).</summary>
    public static void Revoke()
    {
        RevokeAllRegistered();
        Debug.WriteLine("[OleDrop] Drop target revoked.");
    }

    private static Action? _outboundDragResumeRegistration;
    private static bool _inboundDropTargetSuspendedForOutbound;

    /// <summary>True while inbound IDropTarget is revoked for an outbound DoDragDrop.</summary>
    public static bool IsInboundSuspendedForOutbound => _inboundDropTargetSuspendedForOutbound;

    /// <summary>Wire re-register after outbound DoDragDrop (BNDZShell RegisterHostOleDropTarget).</summary>
    public static void SetOutboundDragResumeRegistration(Action? resume) =>
        _outboundDragResumeRegistration = resume;

    /// <summary>Revoke inbound IDropTarget so SELF-REFUSE cannot poison Explorer mid-exit.</summary>
    public static void SuspendInboundDropTargetForOutboundDrag()
    {
        if (_inboundDropTargetSuspendedForOutbound) return;
        _inboundDropTargetSuspendedForOutbound = true;
        RevokeAllRegistered();
        AppendOleDndLog("REGISTER suspended outbound");
    }

    /// <summary>Restore inbound desktop→BNDZ drop target after outbound DoDragDrop ends.</summary>
    public static void ResumeInboundDropTargetAfterOutboundDrag()
    {
        if (!_inboundDropTargetSuspendedForOutbound) return;
        _inboundDropTargetSuspendedForOutbound = false;
        try { _outboundDragResumeRegistration?.Invoke(); }
        catch (Exception ex) { AppendOleDndLog($"REGISTER resume error {ex.Message}"); }
        AppendOleDndLog("REGISTER resumed outbound");
    }

    /// <summary>WebView2 child HWND that currently owns the BNDZ OLE drop target.</summary>
    public static IntPtr RegisteredWebViewHwnd => _registeredHwnd;

    /// <summary>True when registration succeeded on a Chromium/InputSite child (not top-level).</summary>
    public static bool IsRegisteredOnChromeChild => _registeredOnChromeChild && _registeredHwnd != IntPtr.Zero;

    /// <summary>Last <c>RegisterDragDrop</c> HRESULT for diagnostics.</summary>
    public static int LastRegisterHr => _lastRegisterHr;

    /// <summary>True when screen point is fully outside the registered WebView rect.</summary>
    public static bool IsScreenPointOutsideRegisteredWebView(int screenX, int screenY)
    {
        if (_registeredHwnd == IntPtr.Zero) return true;
        if (!GetWindowRect(_registeredHwnd, out var rect)) return true;
        return screenX < rect.Left || screenX >= rect.Right
            || screenY < rect.Top || screenY >= rect.Bottom;
    }

    public static void SetOutboundTopChromePx(int physicalPx)
    {
        _outboundTopChromePx = Math.Clamp(physicalPx, 36, 120);
    }

    /// <summary>
    /// True when native OLE <c>DoDragDrop</c> should take over from the in-app WebView drag.
    /// Escalate only when the cursor has actually left BNDZ (host rect or foreign HWND), or
    /// outer host rim (any side). React menubar inside the WebView is never an escalate zone.
    /// </summary>
    public static bool ShouldHostEscalateOutboundDrag(int screenX, int screenY, int edgeBandPx = 48)
    {
        var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
        var web = _registeredHwnd != IntPtr.Zero ? _registeredHwnd : host;
        if (host == IntPtr.Zero && web == IntPtr.Zero)
            return false;

        if (host != IntPtr.Zero && GetWindowRect(host, out var hostRect))
        {
            if (!PointInRect(hostRect, screenX, screenY))
                return true;

            // Match top menubar band on every side (~48px). Tiny rims (8–16px) meant left/right
            // exits never escalated before WebView2 pointercancel disarmed the gesture.
            var rim = Math.Max(Math.Max(16, edgeBandPx), _outboundTopChromePx);

            // WinUI strip above the WebView (extends-into-title-bar gap) — escalate to desktop.
            // Do NOT treat the in-WebView React menubar band as an escalate zone; dragging over
            // File→Help must stay in-app until the cursor actually leaves the host window.
            if (web != IntPtr.Zero && GetWindowRect(web, out var webRect))
            {
                if (screenY >= hostRect.Top && screenY < webRect.Top)
                    return true;
            }
            else if (screenY >= hostRect.Top && screenY < hostRect.Top + rim)
            {
                return true;
            }

            // Physical window rim — sides + bottom only. Top exit uses outside-host / foreign HWND
            // so OLE never starts while the cursor is still over the React menubar band.
            if (IsCursorInsideWebViewMenubarBand(screenX, screenY))
                return false;

            if (screenX < hostRect.Left + rim || screenX >= hostRect.Right - rim
                || screenY >= hostRect.Bottom - rim)
                return true;

            // Foreign HWND under cursor (Desktop / other app) even if still near our frame.
            var foreignHit = WindowFromPoint(new NativePoint { x = screenX, y = screenY });
            if (foreignHit != IntPtr.Zero && foreignHit != host && !IsChild(host, foreignHit))
            {
                var underHost = false;
                for (var cur = foreignHit; cur != IntPtr.Zero; cur = GetParent(cur))
                {
                    if (cur == host) { underHost = true; break; }
                }
                if (!underHost)
                    return true;
            }

            return false;
        }

        var bound = host != IntPtr.Zero ? host : web;
        var hit = WindowFromPoint(new NativePoint { x = screenX, y = screenY });
        if (hit == IntPtr.Zero) return true;

        if (hit == bound || IsChild(bound, hit))
            return false;

        for (var cur = hit; cur != IntPtr.Zero; cur = GetParent(cur))
        {
            if (cur == bound)
                return false;
        }

        return true;
    }

    /// <summary>React menubar band inside the WebView — never start OLE while still here.</summary>
    public static bool IsCursorInsideWebViewMenubarBand(int screenX, int screenY)
    {
        var web = _registeredHwnd != IntPtr.Zero ? _registeredHwnd : _hostWindowHwnd;
        if (web == IntPtr.Zero || !GetWindowRect(web, out var webRect))
            return false;
        if (!PointInRect(webRect, screenX, screenY))
            return false;
        var band = Math.Clamp(_outboundTopChromePx, 36, 120);
        return screenY >= webRect.Top && screenY < webRect.Top + band;
    }

    /// <summary>
    /// True when the cursor left the WebView into WinUI caption or fully exited the host.
    /// Used only for diagnostics — not for preemptive ghost kill inside the list/menubar.
    /// </summary>
    public static bool IsCursorInOutboundChromeBand(int screenX, int screenY, int edgeBandPx = 16)
    {
        _ = edgeBandPx;
        var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
        var web = _registeredHwnd != IntPtr.Zero ? _registeredHwnd : host;
        if (host == IntPtr.Zero) return false;
        if (!GetWindowRect(host, out var hostRect)) return false;
        if (!PointInRect(hostRect, screenX, screenY)) return true;
        if (web != IntPtr.Zero && GetWindowRect(web, out var webRect)
            && !PointInRect(webRect, screenX, screenY))
            return true;
        return false;
    }

    /// <summary>
    /// True when a button-up should commit the OLE drop (cursor left BNDZ / over foreign HWND).
    /// Unlike escalate, this does <b>not</b> treat the inner edge-band as "outside" —
    /// releasing while still over BNDZ cancels instead of dropping onto ourselves.
    /// </summary>
    public static bool IsCursorOutsideHostForOleDrop(int screenX, int screenY)
    {
        var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
        if (host == IntPtr.Zero)
            return true;
        if (!GetWindowRect(host, out var hostRect))
            return true;
        if (!PointInRect(hostRect, screenX, screenY))
            return true;

        var hit = WindowFromPoint(new NativePoint { x = screenX, y = screenY });
        if (hit == IntPtr.Zero) return true;
        if (hit == host || IsChild(host, hit))
            return false;
        for (var cur = hit; cur != IntPtr.Zero; cur = GetParent(cur))
        {
            if (cur == host)
                return false;
        }
        return true;
    }

    /// <summary>Deep inside the host — safe to treat button-up as an intentional cancel.
    /// Excludes the top caption/menubar band so outbound exits never look "deep inside".</summary>
    public static bool IsCursorDeepInsideHost(int screenX, int screenY, int insetPx = 40)
    {
        var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
        if (host == IntPtr.Zero || !GetWindowRect(host, out var rect))
            return false;
        var inset = Math.Max(16, insetPx);
        var topInset = Math.Max(inset, _outboundTopChromePx);
        return screenX >= rect.Left + inset && screenX < rect.Right - inset
            && screenY >= rect.Top + topInset && screenY < rect.Bottom - inset;
    }

    private static bool PointInRect(NativeRect rect, int x, int y)
        => x >= rect.Left && x < rect.Right && y >= rect.Top && y < rect.Bottom;

    private static bool NearRectRim(NativeRect rect, int x, int y, int bandPx)
        => PointInRect(rect, x, y)
           && (x < rect.Left + bandPx || x >= rect.Right - bandPx
               || y < rect.Top + bandPx || y >= rect.Bottom - bandPx);

    /// <summary>Diagnostics for ole-dnd.log — why the host poll chose to escalate.</summary>
    public static string DescribeOutboundEscalateReason(int screenX, int screenY, int edgeBandPx = 48)
    {
        var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
        var web = _registeredHwnd != IntPtr.Zero ? _registeredHwnd : host;
        if (host != IntPtr.Zero && GetWindowRect(host, out var hostRect))
        {
            if (!PointInRect(hostRect, screenX, screenY)) return "outside-host";
            var rim = Math.Max(Math.Max(16, edgeBandPx), _outboundTopChromePx);
            if (screenX < hostRect.Left + rim) return "host-rim-left";
            if (screenX >= hostRect.Right - rim) return "host-rim-right";
            if (screenY >= hostRect.Bottom - rim) return "host-rim-bottom";
            if (web != IntPtr.Zero && GetWindowRect(web, out var webRect))
            {
                if (screenY >= hostRect.Top && screenY < webRect.Top)
                    return "outside-webview-caption";
                if (screenY >= webRect.Top && screenY < webRect.Top + rim)
                    return "webview-top-chrome";
            }
            var hit = WindowFromPoint(new NativePoint { x = screenX, y = screenY });
            if (hit != IntPtr.Zero && hit != host && !IsChild(host, hit))
                return "foreign-hwnd";
        }
        return "foreign-hwnd";
    }

    /// <summary>Map screen coordinates to WebView2 client space on the registered HWND.</summary>
    public static bool TryScreenToWebViewClient(double screenX, double screenY, out double clientX, out double clientY)
    {
        clientX = screenX;
        clientY = screenY;
        if (_registeredHwnd == IntPtr.Zero)
            return false;
        var pt = new NativePoint
        {
            x = (int)Math.Round(screenX),
            y = (int)Math.Round(screenY),
        };
        if (!ScreenToClient(_registeredHwnd, ref pt))
            return false;
        clientX = pt.x;
        clientY = pt.y;
        return true;
    }

    // ── HWND discovery ────────────────────────────────────────────────────────

    /// <summary>
    /// Enumerate child windows of <paramref name="parentHwnd"/> and return the HWND
    /// that WebView2 registered its OLE drop target on (largest visible Chrome_WidgetWin_1).
    /// WinUI islands sometimes host Chrome outside the EnumChild tree — also scan same-process windows.
    /// </summary>
    private static IntPtr FindWebView2Hwnd(IntPtr parentHwnd)
    {
        var underParent = FindBestChromeUnder(parentHwnd, hostClip: null);
        if (underParent != IntPtr.Zero)
            return underParent;

        // Composition / island: Chrome_WidgetWin_1 may not be a descendant of the WinUI HWND.
        if (!GetWindowRect(parentHwnd, out var hostRect))
            return IntPtr.Zero;
        GetWindowThreadProcessId(parentHwnd, out var hostPid);
        if (hostPid == 0) return IntPtr.Zero;

        IntPtr best = IntPtr.Zero;
        var bestArea = -1;
        var sb = new StringBuilder(256);
        EnumWindows((hwnd, _) =>
        {
            GetWindowThreadProcessId(hwnd, out var pid);
            if (pid != hostPid) return true;
            sb.Clear();
            GetClassName(hwnd, sb, sb.Capacity);
            var cls = sb.ToString();
            if (!cls.StartsWith("Chrome_WidgetWin", StringComparison.Ordinal)
                && cls.IndexOf("InputSite", StringComparison.OrdinalIgnoreCase) < 0)
                return true;
            if (!IsWindowVisible(hwnd)) return true;
            if (!GetWindowRect(hwnd, out var wr)) return true;
            if (!IntersectRect(out var overlap, ref hostRect, ref wr)) return true;
            var area = overlap.Area;
            if (area > bestArea)
            {
                best = hwnd;
                bestArea = area;
            }
            // Also walk children of this top-level chrome host.
            var nested = FindBestChromeUnder(hwnd, hostClip: hostRect);
            if (nested != IntPtr.Zero)
            {
                if (GetWindowRect(nested, out var nr) && IntersectRect(out var no, ref hostRect, ref nr))
                {
                    if (no.Area > bestArea)
                    {
                        best = nested;
                        bestArea = no.Area;
                    }
                }
            }
            return true;
        }, IntPtr.Zero);

        if (best != IntPtr.Zero)
            Debug.WriteLine($"[OleDrop] FindWebView2Hwnd (process scan) → 0x{best:X} area={bestArea}");
        else
            Debug.WriteLine($"[OleDrop] FindWebView2Hwnd failed under parent 0x{parentHwnd:X}");
        return best;
    }

    private static IntPtr FindBestChromeUnder(IntPtr parentHwnd, NativeRect? hostClip)
    {
        IntPtr bestChrome1 = IntPtr.Zero;
        var bestChrome1Area = -1;
        IntPtr bestChrome = IntPtr.Zero;
        var bestChromeArea = -1;
        IntPtr bestInputSite = IntPtr.Zero;
        var bestInputSiteArea = -1;
        IntPtr bestWebView = IntPtr.Zero;
        var bestWebViewArea = -1;
        var sb = new StringBuilder(256);

        int AreaOf(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero || !IsWindowVisible(hwnd)) return -1;
            if (!GetWindowRect(hwnd, out var r)) return -1;
            if (hostClip is NativeRect clip)
            {
                var c = clip;
                if (!IntersectRect(out var o, ref c, ref r)) return -1;
                return o.Area;
            }
            return r.Area;
        }

        void Consider(ref IntPtr best, ref int bestArea, IntPtr hwnd)
        {
            var area = AreaOf(hwnd);
            if (area < 0) return;
            if (area > bestArea)
            {
                best = hwnd;
                bestArea = area;
            }
        }

        void Walk(IntPtr node)
        {
            EnumChildWindows(node, (hwnd, _) =>
            {
                sb.Clear();
                GetClassName(hwnd, sb, sb.Capacity);
                var cls = sb.ToString();

                if (cls.StartsWith("Chrome_WidgetWin_1", StringComparison.Ordinal))
                    Consider(ref bestChrome1, ref bestChrome1Area, hwnd);
                else if (cls.StartsWith("Chrome_WidgetWin", StringComparison.Ordinal))
                    Consider(ref bestChrome, ref bestChromeArea, hwnd);
                else if (cls.IndexOf("InputSite", StringComparison.OrdinalIgnoreCase) >= 0
                    || cls.IndexOf("DesktopChildSiteBridge", StringComparison.OrdinalIgnoreCase) >= 0)
                    Consider(ref bestInputSite, ref bestInputSiteArea, hwnd);
                else if (cls.IndexOf("WebView", StringComparison.OrdinalIgnoreCase) >= 0)
                    Consider(ref bestWebView, ref bestWebViewArea, hwnd);

                Walk(hwnd);
                return true;
            }, IntPtr.Zero);
        }

        Walk(parentHwnd);
        var best = bestChrome1 != IntPtr.Zero ? bestChrome1
            : bestChrome != IntPtr.Zero ? bestChrome
            : bestInputSite != IntPtr.Zero ? bestInputSite
            : bestWebView;
        if (best != IntPtr.Zero)
            Debug.WriteLine($"[OleDrop] FindBestChromeUnder(0x{parentHwnd:X}) → 0x{best:X}");
        return best;
    }

    // ── CF_HDROP path extraction (COM ComIDataObject, no WPF wrapper needed) ──────

    /// <summary>
    /// Extract filesystem paths from a COM <see cref="ComIDataObject"/> —
    /// CF_HDROP first, then Shell IDList, then FileGroupDescriptorW + FileContents (virtual files).
    /// </summary>
    internal static string[] ExtractPathsFromComDataObject(ComIDataObject comData)
    {
        if (comData == null) return Array.Empty<string>();

        var hdrop = ExtractHdropPaths(comData);
        if (hdrop.Length > 0) return hdrop;

        var idList = ExtractShellIdListPaths(comData);
        if (idList.Length > 0) return idList;

        var virtualFiles = ExtractFileGroupDescriptorPaths(comData);
        return virtualFiles;
    }

    private static string[] ExtractHdropPaths(ComIDataObject comData)
    {
        var paths = new List<string>();
        try
        {
            var fmt = new FORMATETC
            {
                cfFormat = CF_HDROP,
                ptd = IntPtr.Zero,
                dwAspect = DVASPECT.DVASPECT_CONTENT,
                lindex = -1,
                tymed = TYMED.TYMED_HGLOBAL,
            };

            comData.QueryGetData(ref fmt);
            comData.GetData(ref fmt, out var stg);

            try
            {
                if (stg.tymed == TYMED.TYMED_HGLOBAL && stg.unionmember != IntPtr.Zero)
                {
                    var hDrop = stg.unionmember;
                    uint count = DragQueryFile(hDrop, 0xFFFFFFFF, null, 0);

                    var buf = new StringBuilder(8192);
                    for (uint i = 0; i < count && i < 2048; i++)
                    {
                        buf.Clear();
                        if (DragQueryFile(hDrop, i, buf, (uint)buf.Capacity) > 0)
                        {
                            var p = buf.ToString().Trim().Trim('"');
                            if (p.Length > 2)
                                paths.Add(p);
                        }
                    }
                }
            }
            finally
            {
                ReleaseStgMedium(ref stg);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[OleDrop] ExtractPaths CF_HDROP: {ex.Message}");
        }

        return paths
            .Where(p => p.Length > 2)
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static string[] ExtractShellIdListPaths(ComIDataObject comData)
    {
        if (CF_SHELLIDLIST == 0) return Array.Empty<string>();
        try
        {
            // Prefer Vanara ShellDataObject when present — falls back silently.
            var wpf = new System.Windows.DataObject(comData);
            if (wpf.GetDataPresent("Shell IDList Array", false))
            {
                // Shell IDList often coexists with HDROP; when HDROP was empty, try file-drop list.
                if (wpf.GetDataPresent(System.Windows.DataFormats.FileDrop, false))
                {
                    var files = wpf.GetData(System.Windows.DataFormats.FileDrop) as string[];
                    if (files is { Length: > 0 })
                        return files.Where(p => !string.IsNullOrWhiteSpace(p) && p.Length > 2)
                            .Distinct(StringComparer.OrdinalIgnoreCase)
                            .ToArray();
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[OleDrop] ShellIDList: {ex.Message}");
        }
        return Array.Empty<string>();
    }

    private static string[] ExtractFileGroupDescriptorPaths(ComIDataObject comData)
    {
        if (CF_FILEGROUPDESCRIPTORW == 0 || CF_FILECONTENTS == 0)
            return Array.Empty<string>();

        var staged = new List<string>();
        try
        {
            var wpf = new System.Windows.DataObject(comData);
            if (!wpf.GetDataPresent("FileGroupDescriptorW"))
                return Array.Empty<string>();

            // Virtual file drops (Outlook, zip internals): stage into temp then treat as paths.
            if (wpf.GetDataPresent(System.Windows.DataFormats.FileDrop, false))
            {
                var files = wpf.GetData(System.Windows.DataFormats.FileDrop) as string[];
                if (files is { Length: > 0 })
                    return files.Where(p => !string.IsNullOrWhiteSpace(p)).ToArray();
            }

            var stagingRoot = Path.Combine(
                Path.GetTempPath(),
                "BNDZ",
                "OleDrop",
                DateTime.UtcNow.ToString("yyyyMMdd_HHmmss_fff"));
            Directory.CreateDirectory(stagingRoot);

            // FILECONTENTS streams — index-based extraction via WPF when available.
            for (var i = 0; i < 64; i++)
            {
                try
                {
                    var streamObj = wpf.GetData("FileContents", false);
                    if (streamObj is not Stream stream) break;
                    var dest = Path.Combine(stagingRoot, $"drop_{i}.bin");
                    using (var fs = File.Create(dest))
                        stream.CopyTo(fs);
                    staged.Add(dest);
                }
                catch
                {
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[OleDrop] FileGroupDescriptor: {ex.Message}");
        }

        return staged.ToArray();
    }

    private static bool HasFileDrop(ComIDataObject comData)
    {
        if (comData == null) return false;
        if (HasFormat(comData, CF_HDROP)) return true;
        if (CF_SHELLIDLIST != 0 && HasFormat(comData, CF_SHELLIDLIST)) return true;
        if (CF_FILEGROUPDESCRIPTORW != 0 && HasFormat(comData, CF_FILEGROUPDESCRIPTORW)) return true;
        return false;
    }

    private static bool HasFormat(ComIDataObject comData, short cf)
    {
        try
        {
            var fmt = new FORMATETC
            {
                cfFormat = cf,
                ptd = IntPtr.Zero,
                dwAspect = DVASPECT.DVASPECT_CONTENT,
                lindex = -1,
                // Match ExtractHdropPaths / GetData — QueryGetData with a combined tymed mask
                // can succeed while TYMED_HGLOBAL extract later fails.
                tymed = TYMED.TYMED_HGLOBAL,
            };
            // Must honour HRESULT — ignoring it made CF_HDROP always look present.
            return comData.QueryGetData(ref fmt) == 0;
        }
        catch { return false; }
    }

    /// <summary>
    /// Explorer returns 7 when echoing source okEffects (not a real target accept). Commit only 1/2/4.
    /// </summary>
    private static uint ResolveSingleDropEffect(uint bits7)
    {
        bits7 &= 0x7u;
        if (bits7 is 1 or 2 or 4) return bits7;
        if (bits7 == 3)
        {
            const int VK_SHIFT = 0x10;
            var shift = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
            return shift ? 2u : 1u;
        }
        return 0;
    }

    /// <summary>
    /// Default when shell echoes okEffects (7). Prefer MOVE (Explorer same-volume default);
    /// Ctrl forces COPY. Cross-volume COPY still arrives as resolved effect=1 from GiveFeedback.
    /// </summary>
    private static uint ResolveDefaultForeignDropEffect()
    {
        const int VK_CONTROL = 0x11;
        if ((GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0) return 1u; // COPY
        return 2u; // MOVE
    }

    /// <summary>
    /// Desktop shell-recover: same-volume → MOVE unless Ctrl (Explorer model).
    /// Never keep a poisoned COPY latch from the initial effect=7 echo.
    /// </summary>
    private static bool PreferMoveForDesktopShellRecover(string[] sourcePaths, uint effectBits)
    {
        const int VK_CONTROL = 0x11;
        const int VK_SHIFT = 0x10;
        if ((GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0) return false;
        if ((GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0) return true;
        if (effectBits == 2) return true;
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var deskRoot = Path.GetPathRoot(desktop);
            if (string.IsNullOrEmpty(deskRoot)) return effectBits != 1;
            foreach (var src in sourcePaths)
            {
                if (string.IsNullOrWhiteSpace(src)) continue;
                var srcRoot = Path.GetPathRoot(src);
                if (!string.Equals(srcRoot, deskRoot, StringComparison.OrdinalIgnoreCase))
                    return false;
            }
            return true;
        }
        catch { return effectBits == 2; }
    }

    private static bool SourcesShareVolumeWith(IEnumerable<string> sources, string destinationFolder)
    {
        try
        {
            var destRoot = Path.GetPathRoot(destinationFolder);
            if (string.IsNullOrEmpty(destRoot)) return false;
            foreach (var src in sources)
            {
                if (string.IsNullOrWhiteSpace(src)) continue;
                var srcRoot = Path.GetPathRoot(src);
                if (!string.Equals(srcRoot, destRoot, StringComparison.OrdinalIgnoreCase))
                    return false;
            }
            return true;
        }
        catch { return false; }
    }

    private static uint ResolveCommitDropEffect(uint rawFeedback7, bool overForeignFolder)
    {
        var resolved = ResolveSingleDropEffect(rawFeedback7);
        if (resolved != 0) return resolved;
        if (overForeignFolder && (rawFeedback7 & 0x7u) == 7u)
            return ResolveDefaultForeignDropEffect();
        return 0;
    }

    private static bool IsTargetAcceptedEffect(uint bits7) => ResolveSingleDropEffect(bits7) != 0;

    /// <summary>
    /// Taskbar / Start / tray are not Desktop or Explorer folder drops.
    /// Committing DROP there produced hr=DROP effect=MOVE with no Desktop file.
    /// </summary>
    private static bool IsDeniedOleDropCommitTarget(int screenX, int screenY)
    {
        try
        {
            var hit = WindowFromPoint(new NativePoint { x = screenX, y = screenY });
            if (hit == IntPtr.Zero) return false;
            for (var cur = hit; cur != IntPtr.Zero; cur = GetParent(cur))
            {
                var cls = GetHwndClassName(cur);
                // Tray / taskbar only — do NOT deny Windows.UI.Core.CoreWindow (WinUI apps).
                if (cls is "Shell_TrayWnd" or "Shell_SecondaryTrayWnd" or "MSTaskSwWClass"
                    or "MSTaskListWClass" or "TrayNotifyWnd" or "NotifyIconOverflowWindow"
                    or "ForegroundStaging")
                    return true;
            }
            return false;
        }
        catch { return false; }
    }

    /// <summary>
    /// True when WindowFromPoint (or an ancestor) belongs to our outbound-drag host.
    /// Desktop SysListView32 spans the whole screen behind us — geometric containment alone
    /// must never override this, or QCD DROPs onto our chrome → effect=NONE.
    /// </summary>
    private static bool IsPointUnderOurHost(int screenX, int screenY)
    {
        try
        {
            var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
            if (host == IntPtr.Zero) return false;
            if (!GetWindowRect(host, out var hostRect) || !PointInRect(hostRect, screenX, screenY))
                return false;
            var hit = WindowFromPoint(new NativePoint { x = screenX, y = screenY });
            if (hit == IntPtr.Zero) return false;
            if (hit == host || IsChild(host, hit)) return true;
            for (var cur = hit; cur != IntPtr.Zero; cur = GetParent(cur))
            {
                if (cur == host) return true;
            }
            return false;
        }
        catch { return false; }
    }

    /// <summary>
    /// Cursor over the shell Desktop (Progman/WorkerW + SysListView32) — authorize DROP at
    /// commit time only when the topmost HWND is actually desktop, not BNDZ chrome on top.
    /// </summary>
    private static bool IsDesktopDropTargetAtPoint(int screenX, int screenY)
    {
        try
        {
            // Never treat points owned by our host as desktop — wallpaper HWND is full-screen
            // behind the window; geometric listview checks would otherwise always win.
            if (IsPointUnderOurHost(screenX, screenY))
                return false;

            var hit = WindowFromPoint(new NativePoint { x = screenX, y = screenY });
            if (hit != IntPtr.Zero)
            {
                // Geometric DefView is full-screen behind every window — never treat Cursor /
                // Chrome / other apps sitting above wallpaper as a desktop drop target.
                if (IsForeignWindowAboveDesktop(hit))
                    return false;

                var leafCls = GetHwndClassName(hit);
                var sawExplorerCabinet = false;
                for (var cur = hit; cur != IntPtr.Zero; cur = GetParent(cur))
                {
                    var cls = GetHwndClassName(cur);
                    if (cls is "CabinetWClass" or "ExploreWClass")
                    {
                        sawExplorerCabinet = true;
                        break;
                    }
                    if (cls is "Progman" or "WorkerW" or "SHELLDLL_DefView") return true;
                }
                if (sawExplorerCabinet) return false;
                if (leafCls == "SysListView32")
                {
                    for (var cur = GetParent(hit); cur != IntPtr.Zero; cur = GetParent(cur))
                    {
                        var cls = GetHwndClassName(cur);
                        if (cls is "Progman" or "WorkerW" or "SHELLDLL_DefView") return true;
                    }
                }
            }

            // Win11 sometimes returns odd non-SysListView32 leaves over bare wallpaper.
            // Geometric fallback only when topmost is not a foreign app window.
            if (hit == IntPtr.Zero || !IsForeignWindowAboveDesktop(hit))
                return IsCursorOverShellDesktopListView(screenX, screenY);

            return false;
        }
        catch { return false; }
    }

    /// <summary>Topmost HWND is clearly another app (not shell desktop / our host).</summary>
    private static bool IsForeignWindowAboveDesktop(IntPtr hit)
    {
        if (hit == IntPtr.Zero) return false;
        for (var cur = hit; cur != IntPtr.Zero; cur = GetParent(cur))
        {
            var cls = GetHwndClassName(cur);
            if (cls is "Progman" or "WorkerW" or "SHELLDLL_DefView" or "SysListView32")
                return false;
            if (cls.StartsWith("Chrome_", StringComparison.Ordinal)
                || cls.StartsWith("Mozilla", StringComparison.Ordinal)
                || cls is "ApplicationFrameWindow" or "XamlExplorerHostIslandWindow"
                || cls.Contains("RenderWidget", StringComparison.Ordinal))
                return true;
        }
        return false;
    }

    /// <summary>True when screen point falls on the shell desktop SysListView32 wallpaper area.</summary>
    private static bool IsCursorOverShellDesktopListView(int screenX, int screenY)
    {
        try
        {
            static bool ListViewContainsPoint(IntPtr listView, int x, int y)
            {
                if (listView == IntPtr.Zero) return false;
                return GetWindowRect(listView, out var r) && PointInRect(r, x, y);
            }

            var progman = FindWindow("Progman", null);
            if (progman != IntPtr.Zero)
            {
                var defView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
                var listView = FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
                if (ListViewContainsPoint(listView, screenX, screenY)) return true;
            }

            var found = false;
            EnumWindows((hwnd, _) =>
            {
                if (GetHwndClassName(hwnd) != "WorkerW") return true;
                var defView = FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (defView == IntPtr.Zero) return true;
                var listView = FindWindowEx(defView, IntPtr.Zero, "SysListView32", null);
                if (!ListViewContainsPoint(listView, screenX, screenY)) return true;
                found = true;
                return false;
            }, IntPtr.Zero);
            return found;
        }
        catch { return false; }
    }

    /// <summary>Cursor over an Explorer folder view — same commit-time trust as Desktop.</summary>
    private static bool IsExplorerFolderDropTargetAtPoint(int screenX, int screenY)
    {
        try
        {
            var hit = WindowFromPoint(new NativePoint { x = screenX, y = screenY });
            if (hit == IntPtr.Zero) return false;
            for (var cur = hit; cur != IntPtr.Zero; cur = GetParent(cur))
            {
                var cls = GetHwndClassName(cur);
                if (cls is "CabinetWClass" or "ExploreWClass") return true;
            }
            return false;
        }
        catch { return false; }
    }

    // ── IDropTarget implementation ────────────────────────────────────────────

    // ── Outbound OLE drag (BNDZShell headless / WinUI shell path) ────────────

    [ComImport]
    [Guid("00000121-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IDropSource
    {
        [PreserveSig] int QueryContinueDrag([MarshalAs(UnmanagedType.Bool)] bool fEscapePressed, uint grfKeyState);
        [PreserveSig] int GiveFeedback(uint dwEffect);
    }

    [DllImport("ole32.dll", EntryPoint = "DoDragDrop", PreserveSig = true)]
    private static extern int NativeDoDragDrop(
        [MarshalAs(UnmanagedType.Interface)] ComIDataObject pDataObj,
        [MarshalAs(UnmanagedType.Interface)] IDropSource pDropSource,
        uint dwOKEffect,
        out uint pdwEffect);

    private const int DRAGDROP_S_DROP   = unchecked((int)0x00040100);
    private const int DRAGDROP_S_CANCEL = unchecked((int)0x00040101);
    private const int DRAGDROP_S_USEDEFAULTCURSORS = unchecked((int)0x00040102);

    private sealed class BndzNativeDropSource : IDropSource
    {
        private const uint MK_LBUTTON = 0x0001;
        private const uint MK_RBUTTON = 0x0002;
        private const int FreshTrustedFeedbackMs = 1200;
        private readonly Action<string>? _log;
        private bool _sawButtonDown;
        private long _buttonUpInsideSinceMs;
        private long _buttonUpOutsideNoneSinceMs;
        private uint _lastFeedbackEffect = uint.MaxValue;
        /// <summary>Latched COPY|MOVE|LINK from the last foreign target — survives BNDZ re-entry.</summary>
        private uint _latchedAcceptEffect;
        /// <summary>True after GiveFeedback saw desktop/Explorer while shell offered an effect.</summary>
        private bool _sawFolderAccept;
        private long _folderPointerDownSinceMs;
        /// <summary>Last trusted GiveFeedback while over Desktop/Explorer.</summary>
        private long _lastTrustedForeignFolderFeedbackMs;
        /// <summary>Last trusted latch was shell Desktop (not Explorer cabinet).</summary>
        private bool _lastTrustedWasDesktop;
        private bool _lastFeedbackTrusted;
        private bool _loggedFeedbackOnce;
        private int _buttonUpStreak;
        /// <summary>OLE grfKeyState reported button up — sticky GetAsyncKeyState must not override.</summary>
        private bool _oleReportedButtonUp;
        private bool _loggedStickyAsyncOnce;
        /// <summary>Set when button-up landed on our chrome after a fresh desktop latch — OLE cannot DROP there.</summary>
        private bool _requestDesktopShellRecover;

        internal BndzNativeDropSource(Action<string>? log = null) => _log = log;

        /// <summary>
        /// WinUI often owns WindowFromPoint at release after a real Desktop hover.
        /// OLE then cannot deliver; caller should SH move/copy onto DesktopDirectory.
        /// </summary>
        internal bool TryGetDesktopShellRecoverEffect(out uint effect)
        {
            effect = 0;
            if (!_requestDesktopShellRecover) return false;
            if (_latchedAcceptEffect is not (1 or 2 or 4)) return false;
            if (!_lastTrustedWasDesktop) return false;
            effect = _latchedAcceptEffect;
            return true;
        }

        private uint RawFeedbackBits()
            => _lastFeedbackEffect == uint.MaxValue ? 0u : (_lastFeedbackEffect & 0x7u);

        private long FreshFeedbackAgeMs()
            => _lastTrustedForeignFolderFeedbackMs == 0
                ? long.MaxValue
                : Environment.TickCount64 - _lastTrustedForeignFolderFeedbackMs;

        private bool HasFreshTrustedFolderFeedback()
            => _lastTrustedForeignFolderFeedbackMs != 0
                && FreshFeedbackAgeMs() <= FreshTrustedFeedbackMs;

        private static bool IsBadLatchedCommitHit(string hit)
        {
            if (string.IsNullOrEmpty(hit)) return false;
            return hit.Contains("InputNonClientPointerSource", StringComparison.Ordinal)
                || hit.Contains("DesktopChildSiteBridge", StringComparison.Ordinal)
                || hit.Contains("WinUIDesktopWin32WindowClass", StringComparison.Ordinal)
                || hit.Contains("underHost=True", StringComparison.Ordinal);
        }

        private void MarkTrustedFolderFeedback(uint resolved, bool overDesktop)
        {
            if (resolved is not (1 or 2 or 4)) return;
            _latchedAcceptEffect = resolved;
            _sawFolderAccept = true;
            _lastTrustedForeignFolderFeedbackMs = Environment.TickCount64;
            _lastTrustedWasDesktop = overDesktop;
        }

        /// <summary>Resolve commit effect using cursor position + latched feedback (Explorer model).</summary>
        private uint ResolveAcceptEffectAtCursor(int x, int y, bool allowFolderDefault)
        {
            var overFolder = IsDesktopDropTargetAtPoint(x, y)
                || IsExplorerFolderDropTargetAtPoint(x, y);

            // Never infer accept from stale echo-7 — Explorer must latch COPY|MOVE via GiveFeedback.
            if (_latchedAcceptEffect is 1 or 2 or 4)
            {
                if (overFolder || _lastFeedbackTrusted)
                    return _latchedAcceptEffect;
            }

            var raw = RawFeedbackBits();
            if (raw is 1 or 2 or 4 && _lastFeedbackTrusted && (overFolder || _sawFolderAccept))
                return ResolveSingleDropEffect(raw);

            if (overFolder && raw == 7 && _lastFeedbackTrusted && _sawFolderAccept)
            {
                var echo = ResolveCommitDropEffect(7u, overForeignFolder: true);
                if (echo != 0) return echo;
            }

            if (overFolder && allowFolderDefault && _sawFolderAccept && _latchedAcceptEffect != 0)
                return ResolveDefaultForeignDropEffect();

            return 0;
        }

        private void LatchDesktopShellRecoverFromPhysicalUp()
        {
            if (_latchedAcceptEffect is not (1 or 2 or 4))
                _latchedAcceptEffect = ResolveDefaultForeignDropEffect();
            if (_latchedAcceptEffect is 1 or 2 or 4)
            {
                _lastTrustedWasDesktop = true;
                _requestDesktopShellRecover = true;
            }
        }

        private void LogDecision(string reason)
        {
            try { _log?.Invoke($"QueryContinueDrag {reason}"); }
            catch { /* ignore */ }
        }

        public int QueryContinueDrag(bool fEscapePressed, uint grfKeyState)
        {
            if (fEscapePressed)
            {
                // Hook forces Escape after a trusted wallpaper mouse-up so OLE exits without
                // waiting for the cursor to re-enter BNDZ (nested loop otherwise goes quiet).
                if (Volatile.Read(ref _outboundPhysicalButtonUp) != 0)
                {
                    LatchDesktopShellRecoverFromPhysicalUp();
                    LogDecision($"cancel escape-after-physical-up {DescribeCursorHit()}");
                    return DRAGDROP_S_CANCEL;
                }
                LogDecision($"cancel escape {DescribeCursorHit()}");
                return DRAGDROP_S_CANCEL;
            }
            const int VK_LBUTTON = 0x01;
            const int VK_RBUTTON = 0x02;
            // Early in the drag (still over BNDZ/Chromium), OLE grfKeyState can look "up" while
            // the user holds — OR async in. After Desktop/Explorer accept, wallpaper release often
            // leaves BOTH OLE and GetAsyncKeyState DOWN until the cursor re-enters our HWND.
            // Boundary fallback: WH_MOUSE_LL with edge-band filter sets physicalUp on desktop release.
            bool oleDown = (grfKeyState & (MK_LBUTTON | MK_RBUTTON)) != 0;
            bool asyncDown =
                (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0
                || (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0;
            bool physicalUp = Volatile.Read(ref _outboundPhysicalButtonUp) != 0;
            if (oleDown)
                _oleReportedButtonUp = false;
            else if (_sawButtonDown)
                _oleReportedButtonUp = true;

            var haveCursorEarly = GetCursorPos(out var earlyCursorPt);
            var underHostEarly = haveCursorEarly && IsPointUnderOurHost(earlyCursorPt.x, earlyCursorPt.y);
            var geoDesktopEarly = haveCursorEarly
                && !underHostEarly
                && IsCursorOverShellDesktopListView(earlyCursorPt.x, earlyCursorPt.y);

            bool buttonDown;
            // Fake handoff ups used to set physicalUp before OLE saw a hold → QCD returned S_OK forever.
            if (physicalUp && !_sawButtonDown)
            {
                buttonDown = oleDown || asyncDown;
            }
            else if (physicalUp)
            {
                buttonDown = false;
                if (!_loggedStickyAsyncOnce && (oleDown || asyncDown))
                {
                    _loggedStickyAsyncOnce = true;
                    LogDecision("physical-button-up — ignoring sticky OLE/async down (wallpaper release)");
                }
            }
            // WinUI/WebView2 often keeps oleDown=true after the real wallpaper mouse-up.
            // GetAsyncKeyState is authoritative over SysListView32 once we've seen the desktop.
            else if (geoDesktopEarly && !asyncDown && (_sawButtonDown || _sawFolderAccept || _lastTrustedWasDesktop))
            {
                buttonDown = false;
                if (oleDown && !_loggedStickyAsyncOnce)
                {
                    _loggedStickyAsyncOnce = true;
                    LogDecision("desktop-async-up — release over SysListView32 (sticky oleDown ignored)");
                }
            }
            // Release inside BNDZ to abort — don't require leaving the window first.
            else if (underHostEarly && !asyncDown && _sawButtonDown)
            {
                buttonDown = false;
                if (oleDown && !_loggedStickyAsyncOnce)
                {
                    _loggedStickyAsyncOnce = true;
                    LogDecision("host-async-up — release inside app (cancel allowed)");
                }
            }
            else if (_oleReportedButtonUp || _sawFolderAccept || _lastTrustedWasDesktop)
            {
                buttonDown = oleDown;
                if (!oleDown && asyncDown && !_loggedStickyAsyncOnce)
                {
                    _loggedStickyAsyncOnce = true;
                    LogDecision("sticky-async-down ignored — OLE button up (wallpaper release)");
                }
            }
            else
            {
                buttonDown = oleDown || asyncDown;
            }

            if (buttonDown)
            {
                _sawButtonDown = true;
                if (Interlocked.Exchange(ref _outboundSawButtonDown, 1) == 0)
                    _outboundSawButtonDownAtMs = Environment.TickCount64;
                _buttonUpStreak = 0;
                _buttonUpInsideSinceMs = 0;
                _buttonUpOutsideNoneSinceMs = 0;
                try { BndzOutboundDragGhostOverlay.FollowCursor(); } catch { /* ignore */ }
                if (GetCursorPos(out var downPt)
                    && (IsDesktopDropTargetAtPoint(downPt.x, downPt.y)
                        || IsExplorerFolderDropTargetAtPoint(downPt.x, downPt.y)))
                {
                    if (_folderPointerDownSinceMs == 0)
                        _folderPointerDownSinceMs = Environment.TickCount64;
                }
                else
                {
                    _folderPointerDownSinceMs = 0;
                }
                return S_OK;
            }

            // Physical wallpaper up: commit on this sample — do not wait for streak / re-entry.
            if (physicalUp && _sawButtonDown)
            {
                _buttonUpStreak = 99;
            }
            else
            {
                // Chromium/WebView2 often flickers button-up while the user is still holding.
                _buttonUpStreak++;
                var outsideHostRectEarly = false;
                if (GetCursorPos(out var earlyPt))
                {
                    var hostEarly = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
                    outsideHostRectEarly = hostEarly == IntPtr.Zero
                        || !GetWindowRect(hostEarly, out var earlyRect)
                        || !PointInRect(earlyRect, earlyPt.x, earlyPt.y);
                }
                var fastDesktopRelease = outsideHostRectEarly && geoDesktopEarly && _sawButtonDown;
                if (_buttonUpStreak < (fastDesktopRelease ? 1 : outsideHostRectEarly ? 2 : 4))
                    return S_OK;
            }

            // --- Button up (debounced): DROP only on folder+latched, else CANCEL ---
            bool haveCursor = GetCursorPos(out var pt);
            var hit = haveCursor ? DescribeCursorHit(pt.x, pt.y) : "no-cursor";
            var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
            var insideHostRect = haveCursor && host != IntPtr.Zero
                && GetWindowRect(host, out var hostRectQcd)
                && PointInRect(hostRectQcd, pt.x, pt.y);
            var outsideHostRect = haveCursor && !insideHostRect;
            var underOurHost = haveCursor && IsPointUnderOurHost(pt.x, pt.y);
            var overSelf = hit.Contains("ourDropTarget=True", StringComparison.Ordinal)
                || underOurHost
                || (insideHostRect && hit.Contains("underHost=True", StringComparison.Ordinal));
            var overDeniedChrome = haveCursor && IsDeniedOleDropCommitTarget(pt.x, pt.y);
            // Require topmost HWND outside our host — never DROP onto ourselves (effect=NONE).
            var outsideHostForDrop = haveCursor && IsCursorOutsideHostForOleDrop(pt.x, pt.y);
            var overDesktop = haveCursor && !underOurHost && IsDesktopDropTargetAtPoint(pt.x, pt.y);
            var geoDesktop = haveCursor && !underOurHost && IsCursorOverShellDesktopListView(pt.x, pt.y);
            var overForeignFolder = haveCursor && outsideHostForDrop
                && (overDesktop || IsExplorerFolderDropTargetAtPoint(pt.x, pt.y));
            var rawFb = RawFeedbackBits();

            if (!_sawButtonDown)
                return S_OK;

            if (overDeniedChrome)
            {
                LogDecision($"cancel button-up denied-chrome cursor=({pt.x},{pt.y}) latched={_latchedAcceptEffect} {hit}");
                return DRAGDROP_S_CANCEL;
            }

            var fbAgeMs = FreshFeedbackAgeMs();
            var freshFb = HasFreshTrustedFolderFeedback();

            // PRIMARY: button-up outside BNDZ over desktop wallpaper — commit via shell recover.
            // Prefer shell recover over OLE DROP: DROP onto SysListView32 has been flaky, and
            // geo-desktop previously false-committed onto Chrome_RenderWidgetHostHWND.
            if (!underOurHost && (outsideHostRect || overDesktop || geoDesktop))
            {
                var effectReady = _latchedAcceptEffect is 1 or 2 or 4;
                if (!effectReady && geoDesktop && _sawButtonDown)
                {
                    _latchedAcceptEffect = ResolveDefaultForeignDropEffect();
                    _lastTrustedWasDesktop = true;
                    effectReady = _latchedAcceptEffect is 1 or 2 or 4;
                    if (effectReady)
                        LogDecision($"desktop-default-latch cursor=({pt.x},{pt.y}) effect={_latchedAcceptEffect} {hit}");
                }

                if (effectReady
                    && (_lastTrustedWasDesktop || overDesktop || geoDesktop)
                    && (freshFb || overDesktop || geoDesktop || _sawFolderAccept))
                {
                    _requestDesktopShellRecover = true;
                    LogDecision($"cancel-for-desktop-outside-commit cursor=({pt.x},{pt.y}) effect={_latchedAcceptEffect} fbAgeMs={fbAgeMs} geo={geoDesktop} physicalUp={physicalUp} asyncDown={asyncDown} oleDown={oleDown} {hit}");
                    return DRAGDROP_S_CANCEL;
                }
            }

            // Soft edge / back inside BNDZ: abort. Never force desktop shell-recover here —
            // that made cancel feel impossible (had to finish the drop after visiting wallpaper).
            if (underOurHost || !outsideHostForDrop || IsBadLatchedCommitHit(hit))
            {
                _requestDesktopShellRecover = false;
                LogDecision($"cancel button-up under-host (abort) cursor=({pt.x},{pt.y}) lastFb={rawFb} fbAgeMs={fbAgeMs} latched={_latchedAcceptEffect} {hit}");
                return DRAGDROP_S_CANCEL;
            }

            if (overForeignFolder && _latchedAcceptEffect is 1 or 2 or 4 && freshFb)
            {
                LogDecision($"drop folder cursor=({pt.x},{pt.y}) effect={_latchedAcceptEffect} latched={_latchedAcceptEffect} oleDown={oleDown} asyncDown={asyncDown} fbAgeMs={fbAgeMs} {hit}");
                return DRAGDROP_S_DROP;
            }

            // Desktop release recovery — only when topmost hit is truly desktop wallpaper.
            if (overDesktop && _folderPointerDownSinceMs != 0)
            {
                var effect = _latchedAcceptEffect is 1 or 2 or 4
                    ? _latchedAcceptEffect
                    : ResolveDefaultForeignDropEffect();
                if (effect is 1 or 2 or 4)
                {
                    _latchedAcceptEffect = effect;
                    LogDecision($"drop desktop-recover cursor=({pt.x},{pt.y}) effect={effect} fbAgeMs={fbAgeMs} {hit}");
                    return DRAGDROP_S_DROP;
                }
            }

            // Latched commit only when cursor is truly over foreign folder with fresh feedback —
            // never over BNDZ chrome (effect=NONE failures).
            if (_latchedAcceptEffect is 1 or 2 or 4 && _sawFolderAccept && freshFb
                && overForeignFolder && !IsBadLatchedCommitHit(hit))
            {
                LogDecision($"drop latched-commit cursor=({pt.x},{pt.y}) effect={_latchedAcceptEffect} fbAgeMs={fbAgeMs} {hit}");
                return DRAGDROP_S_DROP;
            }

            if (insideHostRect && !overDesktop)
            {
                if (haveCursor && (!IsCursorDeepInsideHost(pt.x, pt.y) || IsCursorInOutboundChromeBand(pt.x, pt.y)))
                    return S_OK;
                if (_buttonUpInsideSinceMs == 0)
                    _buttonUpInsideSinceMs = Environment.TickCount64;
                else if (Environment.TickCount64 - _buttonUpInsideSinceMs >= 2500)
                {
                    LogDecision($"cancel button-up inside host cursor=({pt.x},{pt.y}) lastFb={rawFb} {hit}");
                    return DRAGDROP_S_CANCEL;
                }
                return S_OK;
            }

            if (_buttonUpOutsideNoneSinceMs == 0)
                _buttonUpOutsideNoneSinceMs = Environment.TickCount64;
            var waitedOutside = Environment.TickCount64 - _buttonUpOutsideNoneSinceMs;
            if (waitedOutside >= 5000)
            {
                LogDecision($"cancel button-up no-latch cursor=({pt.x},{pt.y}) lastFb={rawFb} fbAgeMs={fbAgeMs} {hit}");
                return DRAGDROP_S_CANCEL;
            }
            if (waitedOutside < 40)
                LogDecision($"defer-drop wait latch cursor=({pt.x},{pt.y}) lastFb={rawFb} fbAgeMs={fbAgeMs} {hit}");
            return S_OK;
        }

        public int GiveFeedback(uint dwEffect)
        {
            var bits = dwEffect & 0x7u;
            var haveCursor = GetCursorPos(out var pt);
            var overForeignFolder = haveCursor
                && (IsDesktopDropTargetAtPoint(pt.x, pt.y)
                    || IsExplorerFolderDropTargetAtPoint(pt.x, pt.y));
            var resolved = ResolveCommitDropEffect(bits, overForeignFolder);
            var prev = _lastFeedbackEffect == uint.MaxValue ? uint.MaxValue : (_lastFeedbackEffect & 0x7u);
            var hit = haveCursor ? DescribeCursorHit(pt.x, pt.y) : "no-cursor";
            var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
            var insideHostRect = haveCursor && host != IntPtr.Zero
                && GetWindowRect(host, out var hostRect)
                && PointInRect(hostRect, pt.x, pt.y);
            var overSelf = hit.Contains("ourDropTarget=True", StringComparison.Ordinal)
                || (insideHostRect && hit.Contains("underHost=True", StringComparison.Ordinal));
            var overDenied = haveCursor && IsDeniedOleDropCommitTarget(pt.x, pt.y);
            var trusted = haveCursor
                && !overSelf
                && !overDenied
                && resolved != 0
                && (overForeignFolder || !hit.Contains("MSTaskSwWClass", StringComparison.Ordinal));

            // Crossing back over BNDZ mid-exit — never wipe latched foreign accept.
            if (overSelf && resolved == 0)
            {
                if (!_loggedFeedbackOnce)
                {
                    _loggedFeedbackOnce = true;
                    try { _log?.Invoke($"GiveFeedback skip-self-zero latched={_latchedAcceptEffect} {hit}"); }
                    catch { /* ignore */ }
                }
                return DRAGDROP_S_USEDEFAULTCURSORS;
            }

            if (!_loggedFeedbackOnce || resolved != prev || trusted != _lastFeedbackTrusted)
            {
                _loggedFeedbackOnce = true;
                try
                {
                    _log?.Invoke(
                        $"GiveFeedback effect={bits} resolved={resolved} trusted={trusted} raw=0x{dwEffect:X8} {hit}");
                }
                catch { /* ignore */ }
            }

            var overDesktop = haveCursor && IsDesktopDropTargetAtPoint(pt.x, pt.y);
            if (overDesktop || (overForeignFolder && haveCursor && IsCursorOverShellDesktopListView(pt.x, pt.y)))
                Interlocked.Exchange(ref _outboundSawDesktopFeedback, 1);
            if (!overDenied && resolved != 0 && overForeignFolder)
            {
                _latchedAcceptEffect = resolved;
                // Desktop SysListView32 must always latch — mis-hits (DesktopChildSiteBridge) skip trusted.
                if (overDesktop || trusted)
                    MarkTrustedFolderFeedback(resolved, overDesktop);
            }
            if (overForeignFolder)
                _sawFolderAccept = true;
            if (overForeignFolder && bits == 7)
                _lastFeedbackEffect = ResolveCommitDropEffect(7u, overForeignFolder: true);
            else if (resolved != 0)
                _lastFeedbackEffect = resolved;
            else if (!overSelf)
                _lastFeedbackEffect = 0;
            _lastFeedbackTrusted = trusted;
            try
            {
                // Badge tracks Ctrl (copy) vs move while OLE runs.
                BndzOutboundDragGhostOverlay.SetCopyMode(resolved == 1 || bits == 1);
                BndzOutboundDragGhostOverlay.FollowCursor();
            }
            catch { /* ignore */ }
            return DRAGDROP_S_USEDEFAULTCURSORS;
        }
    }

    private static void ForceOleDragEndViaEscape()
    {
        try
        {
            keybd_event(VK_ESCAPE, 0, 0, UIntPtr.Zero);
            keybd_event(VK_ESCAPE, 0, KEYEVENTF_KEYUP, UIntPtr.Zero);
            AppendOleDndLog("OLE wake Escape after wallpaper physical-up");
        }
        catch { /* ignore */ }
        WakeOleNestedLoop();
    }

    private static void WakeOleNestedLoop()
    {
        try
        {
            var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
            if (host == IntPtr.Zero) return;
            PostMessage(host, WM_MOUSEMOVE, IntPtr.Zero, IntPtr.Zero);
        }
        catch { /* ignore */ }
    }

    private static IntPtr OutboundLlMouseHook(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var msg = unchecked((uint)(wParam.ToInt64() & 0xFFFFFFFF));
            if (msg is WM_LBUTTONUP or WM_RBUTTONUP)
            {
                if (!GetCursorPos(out var pt))
                    return CallNextHookEx(_llMouseHook, nCode, wParam, lParam);
                if (IsPointUnderOurHost(pt.x, pt.y))
                    return CallNextHookEx(_llMouseHook, nCode, wParam, lParam);
                // Need a real OLE hold first — ignore synthetic ups in the first 400ms after that.
                if (Volatile.Read(ref _outboundSawButtonDown) == 0
                    || _outboundSawButtonDownAtMs == 0
                    || Environment.TickCount64 - _outboundSawButtonDownAtMs < 400)
                    return CallNextHookEx(_llMouseHook, nCode, wParam, lParam);
                // Live desktop hit-test — do NOT wait for GiveFeedback (that missed releases).
                if (!IsDesktopDropTargetAtPoint(pt.x, pt.y)
                    && !IsCursorOverShellDesktopListView(pt.x, pt.y))
                    return CallNextHookEx(_llMouseHook, nCode, wParam, lParam);
                if (Interlocked.Exchange(ref _outboundPhysicalButtonUp, 1) == 0)
                {
                    AppendOleDndLog($"physical-button-up (LL hook, outside-host) {DescribeCursorHit(pt.x, pt.y)}");
                    ForceOleDragEndViaEscape();
                }
            }
        }
        return CallNextHookEx(_llMouseHook, nCode, wParam, lParam);
    }

    private static bool TryInstallOutboundMouseHook()
    {
        if (_llMouseHook != IntPtr.Zero) return true;
        Interlocked.Exchange(ref _outboundPhysicalButtonUp, 0);
        // Arm hold at OLE start so wallpaper LBUTTONUP is accepted without waiting for QCD.
        Interlocked.Exchange(ref _outboundSawButtonDown, 1);
        _outboundSawButtonDownAtMs = Environment.TickCount64;
        Interlocked.Exchange(ref _outboundSawDesktopFeedback, 0);
        _outboundDragStartedMs = Environment.TickCount64;
        _llMouseProcKeepAlive = OutboundLlMouseHook;
        var hMod = GetModuleHandle(null);
        _llMouseHook = SetWindowsHookEx(WH_MOUSE_LL, _llMouseProcKeepAlive, hMod, 0);
        if (_llMouseHook == IntPtr.Zero)
            _llMouseHook = SetWindowsHookEx(WH_MOUSE_LL, _llMouseProcKeepAlive, IntPtr.Zero, 0);
        if (_llMouseHook == IntPtr.Zero)
        {
            AppendOleDndLog($"LL mouse hook failed err={Marshal.GetLastWin32Error()}");
            _llMouseProcKeepAlive = null;
            return false;
        }
        AppendOleDndLog("LL mouse hook installed (outside-host up)");
        return true;
    }

    private static void UninstallOutboundMouseHook()
    {
        var hook = _llMouseHook;
        _llMouseHook = IntPtr.Zero;
        if (hook != IntPtr.Zero)
        {
            try { UnhookWindowsHookEx(hook); }
            catch { /* ignore */ }
            AppendOleDndLog("LL mouse hook removed");
        }
        _llMouseProcKeepAlive = null;
        Interlocked.Exchange(ref _outboundPhysicalButtonUp, 0);
        Interlocked.Exchange(ref _outboundSawButtonDown, 0);
        _outboundSawButtonDownAtMs = 0;
        Interlocked.Exchange(ref _outboundSawDesktopFeedback, 0);
        _outboundDragStartedMs = 0;
    }

    private static string DescribeCursorHit()
    {
        if (!GetCursorPos(out var pt)) return "hit=no-cursor";
        return DescribeCursorHit(pt.x, pt.y);
    }

    private static string DescribeCursorHit(int screenX, int screenY)
    {
        try
        {
            var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
            var hit = WindowFromPoint(new NativePoint { x = screenX, y = screenY });
            var cls = hit == IntPtr.Zero ? "?" : GetHwndClassName(hit);
            var underHost = false;
            if (host != IntPtr.Zero && hit != IntPtr.Zero)
            {
                underHost = hit == host || IsChild(host, hit);
                if (!underHost)
                {
                    for (var cur = hit; cur != IntPtr.Zero; cur = GetParent(cur))
                    {
                        if (cur == host) { underHost = true; break; }
                    }
                }
            }
            var ours = hit != IntPtr.Zero
                && (hit == _registeredHwnd || _extraRegisteredHwnds.Contains(hit));
            return $"hit=0x{hit.ToInt64():X} class={cls} underHost={underHost} ourDropTarget={ours}";
        }
        catch
        {
            return "hit=error";
        }
    }

    private static string GetHwndClassName(IntPtr hwnd)
    {
        try
        {
            var sb = new StringBuilder(256);
            GetClassName(hwnd, sb, sb.Capacity);
            return sb.ToString();
        }
        catch { return "?"; }
    }

    /// <summary>Set during outbound DoDragDrop when our IDropTarget::Drop runs (should stay false after self-refuse).</summary>
    private static int _outboundSelfDropCount;

    private static void AppendOleDndLog(string message)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BNDZ");
            Directory.CreateDirectory(dir);
            File.AppendAllText(
                Path.Combine(dir, "ole-dnd.log"),
                $"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}");
        }
        catch { /* ignore */ }
        Debug.WriteLine($"[OleDnd] {message}");
    }

    /// <summary>Forensic log from payload builders outside this type (path sanitize rejects).</summary>
    internal static void AppendOleDndLogPublic(string message) => AppendOleDndLog(message);

    /// <summary>Result of modal ole32 DoDragDrop for outbound file drags.</summary>
    internal readonly struct NativeDragDropResult
    {
        internal NativeDragDropResult(int resultHr, uint effectBits)
        {
            ResultHr = resultHr;
            EffectBits = effectBits;
        }

        internal int ResultHr { get; }
        internal uint EffectBits { get; }
        internal bool Dropped => ResultHr == DRAGDROP_S_DROP;
    }

    /// <summary>
    /// Perform native OLE drag from the BNDZShell headless path.
    /// ole32 <c>DoDragDrop</c> only — SHDoDragDrop with a custom IDropSource already
    /// produced hr=DROP effect=NONE after premature QueryContinueDrag DROP.
    /// </summary>
    public static NativeDragDropResult RunNativeDragDrop(
        IntPtr hwnd,
        object dataObject,
        string? pathSummary = null,
        string[]? sourcePaths = null,
        bool fromDragStarting = false)
    {
        _ = hwnd; // retained for call-site compatibility / future drag-image HWND
        if (dataObject == null) return new NativeDragDropResult(DRAGDROP_S_CANCEL, 0);

        int oleHr = OleInitialize(IntPtr.Zero);
        if (oleHr < 0)
            Debug.WriteLine($"[OleDrag] OleInitialize hr=0x{oleHr:X8}");

        Interlocked.Exchange(ref _olePointerStateReleased, 0);
        Interlocked.Exchange(ref _outboundDragFromDragStarting, fromDragStarting ? 1 : 0);
        var resultHr = DRAGDROP_S_CANCEL;
        var resultEffect = 0u;
        try
        {
            ComIDataObject comData;
            IntPtr oleUnk = IntPtr.Zero;
            var releaseUnk = false;
            if (dataObject is ComIDataObject direct)
            {
                comData = direct;
            }
            else
            {
                oleUnk = Marshal.GetIUnknownForObject(dataObject);
                releaseUnk = true;
                comData = (ComIDataObject)Marshal.GetObjectForIUnknown(oleUnk)!;
            }

            try
            {
                Interlocked.Exchange(ref _outboundSelfDropCount, 0);
                var src = new BndzNativeDropSource(AppendOleDndLog);
                const uint DROPEFFECT_COPY = 1u;
                const uint DROPEFFECT_MOVE = 2u;
                const uint DROPEFFECT_LINK = 4u;
                var okEffects = DROPEFFECT_COPY | DROPEFFECT_MOVE | DROPEFFECT_LINK;

                var hasHdrop = HasFormat(comData, CF_HDROP);
                var hasShellIdList = CF_SHELLIDLIST != 0 && HasFormat(comData, CF_SHELLIDLIST);
                var summary = string.IsNullOrWhiteSpace(pathSummary) ? "" : $" paths={pathSummary}";
                AppendOleDndLog($"DoDragDrop begin CF_HDROP={hasHdrop} ShellIDList={hasShellIdList} dragStarting={fromDragStarting}{summary}");

                // Host layered ghost — WebView2 cannot paint outside the HWND; IDragSourceHelper
                // fails on this machine. Click-through overlay so wallpaper release still works.
                try
                {
                    const int VK_CONTROL = 0x11;
                    var copyHeld = (GetAsyncKeyState(VK_CONTROL) & 0x8000) != 0;
                    BndzOutboundDragGhostOverlay.Show(sourcePaths, copyMode: copyHeld);
                }
                catch (Exception ghostEx)
                {
                    AppendOleDndLog($"outbound-ghost show error {ghostEx.Message}");
                }

                if (!fromDragStarting)
                    TryInstallOutboundMouseHook();
                int hr;
                uint finalEffect;
                try
                {
                    hr = NativeDoDragDrop(comData, src, okEffects, out finalEffect);
                }
                finally
                {
                    try { BndzOutboundDragGhostOverlay.Hide(); }
                    catch { /* ignore */ }
                    if (!fromDragStarting)
                        UninstallOutboundMouseHook();
                }
                AppendOleDndLog("drag API=DoDragDrop");

                var effectBits = ResolveSingleDropEffect(finalEffect & 0x7u);
                if (effectBits == 0 && hr == DRAGDROP_S_DROP)
                    effectBits = finalEffect & 0x7u; // log raw when drop returned echo 7
                var effectName = effectBits switch
                {
                    1u => "COPY",
                    2u => "MOVE",
                    4u => "LINK",
                    3u => "COPY|MOVE",
                    0u => "NONE",
                    _ => $"0x{finalEffect:X}",
                };
                var hrName = hr switch
                {
                    DRAGDROP_S_DROP => "DROP",
                    DRAGDROP_S_CANCEL => "CANCEL",
                    S_OK => "OK",
                    _ => $"0x{hr:X8}",
                };
                var selfDrops = Volatile.Read(ref _outboundSelfDropCount);
                AppendOleDndLog($"DoDragDrop end hr={hrName} effect={effectName}({effectBits}) selfDrop={selfDrops} CF_HDROP={hasHdrop} ShellIDList={hasShellIdList}{summary}");

                resultHr = hr;
                resultEffect = effectBits;

                // WinUI chrome often owns the release HWND after a real Desktop hover → OLE
                // returns CANCEL or DROP+NONE. Commit onto DesktopDirectory ourselves.
                if (sourcePaths is { Length: > 0 }
                    && (hr == DRAGDROP_S_CANCEL || (hr == DRAGDROP_S_DROP && effectBits == 0))
                    && src.TryGetDesktopShellRecoverEffect(out var recoverEffect)
                    && TryShellCommitToDesktop(sourcePaths, recoverEffect, out var committedEffect))
                {
                    resultHr = DRAGDROP_S_DROP;
                    resultEffect = committedEffect;
                    AppendOleDndLog($"desktop-shell-recover ok effect={committedEffect}{summary}");
                    LogPostDropVerify(sourcePaths, committedEffect);
                }
                else if (hr == DRAGDROP_S_DROP && sourcePaths is { Length: > 0 }
                    && effectBits is 1 or 2 or 4)
                    LogPostDropVerify(sourcePaths, effectBits);
                else if (hr == DRAGDROP_S_CANCEL && sourcePaths is { Length: > 0 })
                    AppendOleDndLog($"drop-cancelled effect={effectBits}{summary}");
            }
            finally
            {
                if (releaseUnk && oleUnk != IntPtr.Zero)
                    Marshal.Release(oleUnk);
            }
        }
        catch (Exception ex)
        {
            AppendOleDndLog($"DoDragDrop error {ex.Message}");
            Debug.WriteLine($"[OleDrag] RunNativeDragDrop: {ex.Message}");
        }
        finally
        {
            RestoreHostAfterDesktopOleHitBypass();
            ReleaseOleDragPointerState();
            Interlocked.Exchange(ref _outboundDragFromDragStarting, 0);
        }

        return new NativeDragDropResult(resultHr, resultEffect);
    }

    /// <summary>
    /// WindowFromPoint skips disabled windows — disable our host so OLE can DROP onto the
    /// Desktop SysListView32 that sits under WinUI InputNonClientPointerSource at release.
    /// </summary>
    private static bool TryDisableHostForDesktopOleHit()
    {
        try
        {
            var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
            if (host == IntPtr.Zero) return false;
            if (!IsWindowEnabled(host))
            {
                Interlocked.Exchange(ref _hostDisabledForDesktopOleDrop, 1);
                return true;
            }
            if (!EnableWindow(host, false)) return false;
            Interlocked.Exchange(ref _hostDisabledForDesktopOleDrop, 1);
            AppendOleDndLog($"host disabled for desktop OLE hit hwnd=0x{host.ToInt64():X}");
            return true;
        }
        catch (Exception ex)
        {
            AppendOleDndLog($"host disable for desktop OLE failed {ex.Message}");
            return false;
        }
    }

    private static void RestoreHostAfterDesktopOleHitBypass()
    {
        if (Interlocked.Exchange(ref _hostDisabledForDesktopOleDrop, 0) == 0) return;
        try
        {
            var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
            if (host == IntPtr.Zero) return;
            EnableWindow(host, true);
            AppendOleDndLog($"host re-enabled after desktop OLE hwnd=0x{host.ToInt64():X}");
        }
        catch (Exception ex)
        {
            AppendOleDndLog($"host re-enable failed {ex.Message}");
        }
    }

    /// <summary>
    /// Drop leftover mouse capture / clip / depressed button after OLE ends so wallpaper
    /// does not need an extra click to "release" the drag.
    /// After cancel-for-desktop-shell-recover the physical button is often already up, but
    /// WinUI InputNonClientPointerSource still awaits PointerReleased — always synthesize up.
    /// </summary>
    internal static void ReleaseOleDragPointerState()
    {
        if (Interlocked.Exchange(ref _olePointerStateReleased, 1) != 0)
            return;

        var fromDragStarting = Volatile.Read(ref _outboundDragFromDragStarting) != 0;
        IntPtr capturer = IntPtr.Zero;
        try { capturer = GetCapture(); } catch { /* ignore */ }
        try { ReleaseCapture(); } catch { /* ignore */ }
        try { ClipCursor(IntPtr.Zero); } catch { /* ignore */ }

        if (!fromDragStarting)
        {
            // Left-up only — injecting RBUTTONUP was opening the desktop context menu.
            try
            {
                var inputs = new[]
                {
                    new INPUT
                    {
                        type = INPUT_MOUSE,
                        mi = new MOUSEINPUT { dwFlags = MOUSEEVENTF_LEFTUP },
                    },
                };
                SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<INPUT>());
            }
            catch { /* ignore */ }

            // Wake WinUI / WebView pointer state — never post synthetic ups to Desktop SysListView32.
            try
            {
                if (!GetCursorPos(out var pt)) pt = default;
                var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
                PostButtonUpToHwnd(host, pt);
                if (_registeredHwnd != IntPtr.Zero && _registeredHwnd != host)
                    PostButtonUpToHwnd(_registeredHwnd, pt);
                var hit = WindowFromPoint(pt);
                if (hit != IntPtr.Zero && hit != host && hit != _registeredHwnd && !IsDesktopShellHwnd(hit))
                    PostButtonUpToHwnd(hit, pt);
                if (capturer != IntPtr.Zero && capturer != host && capturer != hit && !IsDesktopShellHwnd(capturer))
                    PostButtonUpToHwnd(capturer, pt);
            }
            catch { /* ignore */ }
        }

        try
        {
            var arrow = LoadCursor(IntPtr.Zero, IDC_ARROW);
            if (arrow != IntPtr.Zero) SetCursor(arrow);
        }
        catch { /* ignore */ }
        AppendOleDndLog($"ole pointer state released capture=0x{capturer.ToInt64():X}");
    }

    private static bool IsDesktopShellHwnd(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        for (var cur = hwnd; cur != IntPtr.Zero; cur = GetParent(cur))
        {
            var cls = GetHwndClassName(cur);
            if (cls is "Progman" or "WorkerW" or "SHELLDLL_DefView" or "SysListView32")
                return true;
        }
        return false;
    }

    private static void PostButtonUpToHwnd(IntPtr hwnd, NativePoint screenPt)
    {
        if (hwnd == IntPtr.Zero || IsDesktopShellHwnd(hwnd)) return;
        var client = screenPt;
        try { ScreenToClient(hwnd, ref client); } catch { /* keep screen */ }
        var lp = (IntPtr)(((client.y & 0xFFFF) << 16) | (client.x & 0xFFFF));
        try { PostMessage(hwnd, WM_MOUSEMOVE, IntPtr.Zero, lp); } catch { /* ignore */ }
        try { PostMessage(hwnd, WM_LBUTTONUP, IntPtr.Zero, lp); } catch { /* ignore */ }
    }

    /// <summary>
    /// When WinUI steals the release HWND after a trusted Desktop hover, move/copy onto
    /// the user Desktop folder so the drop still lands (OLE would have returned effect=NONE).
    /// Uses SHFileOperation so Explorer DefView refreshes immediately (File.Move left icons
    /// invisible until the user clicked the wallpaper).
    /// </summary>
    private static bool TryShellCommitToDesktop(string[] sourcePaths, uint effectBits, out uint committedEffect)
    {
        committedEffect = 0;
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            if (string.IsNullOrWhiteSpace(desktop) || !Directory.Exists(desktop))
            {
                AppendOleDndLog("desktop-shell-recover fail — DesktopDirectory missing");
                return false;
            }

            var move = PreferMoveForDesktopShellRecover(sourcePaths, effectBits);
            committedEffect = move ? 2u : 1u;

            var sources = new List<string>();
            var sourceDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var src in sourcePaths)
            {
                if (string.IsNullOrWhiteSpace(src)) continue;
                var path = src.Trim();
                if (!File.Exists(path) && !Directory.Exists(path))
                {
                    AppendOleDndLog($"desktop-shell-recover skip missing src={path}");
                    continue;
                }
                sources.Add(path);
                var parent = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(parent)) sourceDirs.Add(parent);
            }
            if (sources.Count == 0) return false;

            // Same-volume File.Move is instant — SHFileOperation was taking ~3s and felt like
            // "drop only after I move back into BNDZ".
            if (move && SourcesShareVolumeWith(sources, desktop)
                && TryManagedCommitToDesktop(sources, desktop, move: true, out committedEffect))
            {
                AppendOleDndLog($"desktop-shell-recover fast-MOVE count={sources.Count} -> {desktop}");
                return true;
            }

            // Double-null-terminated multi-source list → desktop folder (Explorer model).
            var from = string.Join("\0", sources) + "\0\0";
            var to = desktop.TrimEnd('\\') + "\0\0";
            var flags = (ushort)(FOF_ALLOWUNDO | FOF_SILENT | FOF_NOERRORUI | FOF_NOCONFIRMMKDIR
                | FOF_NOCONFIRMATION | FOF_RENAMEONCOLLISION);
            var fileOp = new SHFILEOPSTRUCT
            {
                hwnd = IntPtr.Zero, // owning to host HWND blocked the UI for seconds
                wFunc = move ? FO_MOVE : FO_COPY,
                pFrom = from,
                pTo = to,
                fFlags = flags,
            };
            var hr = SHFileOperation(ref fileOp);
            if (hr != 0 || fileOp.fAnyOperationsAborted)
            {
                AppendOleDndLog($"desktop-shell-recover SHFileOperation failed hr={hr} aborted={fileOp.fAnyOperationsAborted}");
                // Fallback: managed move so the file still lands.
                return TryManagedCommitToDesktop(sources, desktop, move, out committedEffect);
            }

            AppendOleDndLog($"desktop-shell-recover SHFileOperation {(move ? "MOVE" : "COPY")} count={sources.Count} -> {desktop}");
            NotifyDesktopShellRefresh(desktop, sources, sourceDirs, move);
            return true;
        }
        catch (Exception ex)
        {
            AppendOleDndLog($"desktop-shell-recover error {ex.Message}");
            return false;
        }
    }

    private static bool TryManagedCommitToDesktop(List<string> sources, string desktop, bool move, out uint committedEffect)
    {
        committedEffect = move ? 2u : 1u;
        var ok = 0;
        var sourceDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in sources)
        {
            var leaf = Path.GetFileName(path.TrimEnd('\\', '/'));
            if (string.IsNullOrEmpty(leaf)) continue;
            var dest = AllocateUniqueDesktopPath(desktop, leaf);
            try
            {
                if (Directory.Exists(path))
                {
                    if (move) Directory.Move(path, dest);
                    else CopyDirectoryRecursive(path, dest);
                }
                else
                {
                    if (move) File.Move(path, dest);
                    else File.Copy(path, dest, overwrite: false);
                }
                ok++;
                var parent = Path.GetDirectoryName(path);
                if (!string.IsNullOrEmpty(parent)) sourceDirs.Add(parent);
                AppendOleDndLog($"desktop-shell-recover managed-{(move ? "MOVE" : "COPY")} {path} -> {dest}");
            }
            catch (Exception itemEx)
            {
                AppendOleDndLog($"desktop-shell-recover managed-fail {path}: {itemEx.Message}");
            }
        }
        if (ok > 0) NotifyDesktopShellRefresh(desktop, sources, sourceDirs, move);
        return ok > 0;
    }

    /// <summary>Force Desktop DefView to show the new icon without requiring a wallpaper click.</summary>
    private static void NotifyDesktopShellRefresh(
        string desktop,
        List<string> sources,
        HashSet<string> sourceDirs,
        bool moved)
    {
        try
        {
            foreach (var src in sources)
            {
                var leaf = Path.GetFileName(src.TrimEnd('\\', '/'));
                if (string.IsNullOrEmpty(leaf)) continue;
                var dest = Path.Combine(desktop, leaf);
                var destPtr = Marshal.StringToHGlobalUni(dest);
                var srcPtr = Marshal.StringToHGlobalUni(src);
                try
                {
                    SHChangeNotify(SHCNE_CREATE | SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, destPtr, IntPtr.Zero);
                    if (moved)
                        SHChangeNotify(SHCNE_DELETE | SHCNE_UPDATEITEM, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, srcPtr, IntPtr.Zero);
                }
                finally
                {
                    Marshal.FreeHGlobal(destPtr);
                    Marshal.FreeHGlobal(srcPtr);
                }
            }

            var deskPtr = Marshal.StringToHGlobalUni(desktop);
            try
            {
                SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, deskPtr, IntPtr.Zero);
            }
            finally { Marshal.FreeHGlobal(deskPtr); }

            foreach (var dir in sourceDirs)
            {
                var dirPtr = Marshal.StringToHGlobalUni(dir);
                try { SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, dirPtr, IntPtr.Zero); }
                finally { Marshal.FreeHGlobal(dirPtr); }
            }

            // Never SHCNF_FLUSH — it waits for Explorer and blocked ~3s after every wallpaper drop.
            SHChangeNotify(0, SHCNF_FLUSHNOWAIT, IntPtr.Zero, IntPtr.Zero);
            InvalidateDesktopListView();
            AppendOleDndLog("desktop-shell-recover DefView notified");
        }
        catch (Exception ex)
        {
            AppendOleDndLog($"desktop-shell-recover notify error {ex.Message}");
        }
    }

    private static void InvalidateDesktopListView()
    {
        try
        {
            void InvalidateList(IntPtr listView)
            {
                if (listView == IntPtr.Zero) return;
                InvalidateRect(listView, IntPtr.Zero, true);
                // Do not UpdateWindow — sync paint waited on DefView and added multi-second lag.
            }

            var progman = FindWindow("Progman", null);
            if (progman != IntPtr.Zero)
            {
                var defView = FindWindowEx(progman, IntPtr.Zero, "SHELLDLL_DefView", null);
                InvalidateList(FindWindowEx(defView, IntPtr.Zero, "SysListView32", null));
            }

            EnumWindows((hwnd, _) =>
            {
                if (GetHwndClassName(hwnd) != "WorkerW") return true;
                var defView = FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null);
                if (defView == IntPtr.Zero) return true;
                InvalidateList(FindWindowEx(defView, IntPtr.Zero, "SysListView32", null));
                return true;
            }, IntPtr.Zero);
        }
        catch { /* ignore */ }
    }

    private static string AllocateUniqueDesktopPath(string desktop, string leaf)
    {
        var dest = Path.Combine(desktop, leaf);
        if (!File.Exists(dest) && !Directory.Exists(dest)) return dest;
        var name = Path.GetFileNameWithoutExtension(leaf);
        var ext = Path.GetExtension(leaf);
        for (var i = 2; i < 1000; i++)
        {
            dest = Path.Combine(desktop, $"{name} ({i}){ext}");
            if (!File.Exists(dest) && !Directory.Exists(dest)) return dest;
        }
        return Path.Combine(desktop, $"{name}-{Environment.TickCount64}{ext}");
    }

    private static void CopyDirectoryRecursive(string sourceDir, string destDir)
    {
        Directory.CreateDirectory(destDir);
        foreach (var file in Directory.GetFiles(sourceDir))
            File.Copy(file, Path.Combine(destDir, Path.GetFileName(file)), overwrite: false);
        foreach (var dir in Directory.GetDirectories(sourceDir))
            CopyDirectoryRecursive(dir, Path.Combine(destDir, Path.GetFileName(dir)));
    }

    private static void LogPostDropVerify(string[] sourcePaths, uint effectBits)
    {
        try
        {
            var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            var cursorNote = "";
            if (GetCursorPos(out var pt))
                cursorNote = $" cursor=({pt.x},{pt.y})";
            foreach (var src in sourcePaths)
            {
                if (string.IsNullOrWhiteSpace(src)) continue;
                var leaf = Path.GetFileName(src.TrimEnd('\\', '/'));
                var srcExists = File.Exists(src) || Directory.Exists(src);
                var deskPath = string.IsNullOrEmpty(leaf) || string.IsNullOrEmpty(desktop)
                    ? ""
                    : Path.Combine(desktop, leaf);
                var onDesktop = !string.IsNullOrEmpty(deskPath)
                    && (File.Exists(deskPath) || Directory.Exists(deskPath));
                AppendOleDndLog(
                    $"drop-verify effect={effectBits} srcExists={srcExists} onDesktop={onDesktop} leaf={leaf}{cursorNote} desk={deskPath} src={src}");
            }
        }
        catch (Exception ex)
        {
            AppendOleDndLog($"drop-verify error {ex.Message}");
        }
    }

    // ── IDropTarget implementation ────────────────────────────────────────

    private sealed class BndzDropTarget : IRawDropTarget
    {
        private readonly IntPtr _wv2Hwnd;
        private readonly Action<string[], double, double, uint, bool> _onDrop;
        private readonly Action<double, double> _onHover;
        private readonly Func<bool> _isBndzOleDragActive;
        private bool _hasFiles;
        private bool _loggedSelfRefuseEnter;

        internal BndzDropTarget(
            IntPtr wv2Hwnd,
            Action<string[], double, double, uint, bool> onDrop,
            Action<double, double> onHover,
            Func<bool> isBndzOleDragActive)
        {
            _wv2Hwnd = wv2Hwnd;
            _onDrop = onDrop;
            _onHover = onHover;
            _isBndzOleDragActive = isBndzOleDragActive;
        }

        private uint ResolveEffect(uint grfKeyState, uint proposedEffect)
        {
            if ((grfKeyState & MK_CONTROL) != 0) return DROPEFFECT_COPY;
            if ((grfKeyState & MK_SHIFT) != 0 && (proposedEffect & DROPEFFECT_MOVE) != 0)
                return DROPEFFECT_MOVE;
            // BNDZ internal OLE drag re-entering the window — honour move intent.
            if (_isBndzOleDragActive() && (proposedEffect & DROPEFFECT_MOVE) != 0)
                return DROPEFFECT_MOVE;
            return DROPEFFECT_COPY;
        }

        public int DragEnter(ComIDataObject pDataObj, uint grfKeyState, NativePoint pt, ref uint pdwEffect)
        {
            // Outbound OLE must never accept itself — false MOVE in GiveFeedback then
            // QueryContinueDrag DROP yielded hr=DROP effect=NONE.
            if (_isBndzOleDragActive())
            {
                var proposed = pdwEffect;
                pdwEffect = DROPEFFECT_NONE;
                // Log once per enter — spam was drowning real DROP evidence.
                if (!_loggedSelfRefuseEnter)
                {
                    _loggedSelfRefuseEnter = true;
                    AppendOleDndLog($"DropTarget DragEnter SELF-REFUSE proposed=0x{proposed:X} {DescribeCursorHit(pt.x, pt.y)}");
                }
                _hasFiles = false;
                return S_OK;
            }
            _loggedSelfRefuseEnter = false;
            _hasFiles = HasFileDrop(pDataObj);
            if (!_hasFiles) { pdwEffect = DROPEFFECT_NONE; return S_OK; }
            pdwEffect = ResolveEffect(grfKeyState, pdwEffect);
            AppendOleDndLog($"DropTarget DragEnter effect={pdwEffect} {DescribeCursorHit(pt.x, pt.y)}");
            _onHover(pt.x, pt.y);
            return S_OK;
        }

        public int DragOver(uint grfKeyState, NativePoint pt, ref uint pdwEffect)
        {
            if (_isBndzOleDragActive())
            {
                pdwEffect = DROPEFFECT_NONE;
                return S_OK;
            }
            if (!_hasFiles) { pdwEffect = DROPEFFECT_NONE; return S_OK; }
            pdwEffect = ResolveEffect(grfKeyState, pdwEffect);
            _onHover(pt.x, pt.y);
            return S_OK;
        }

        public int DragLeave()
        {
            _loggedSelfRefuseEnter = false;
            if (_isBndzOleDragActive())
                AppendOleDndLog("DropTarget DragLeave (outbound)");
            _hasFiles = false;
            return S_OK;
        }

        public int Drop(ComIDataObject pDataObj, uint grfKeyState, NativePoint pt, ref uint pdwEffect)
        {
            _hasFiles = false;
            if (_isBndzOleDragActive())
            {
                Interlocked.Increment(ref _outboundSelfDropCount);
                pdwEffect = DROPEFFECT_NONE;
                AppendOleDndLog($"DropTarget Drop SELF-REFUSE {DescribeCursorHit(pt.x, pt.y)}");
                return S_OK;
            }
            if (pDataObj == null) { pdwEffect = DROPEFFECT_NONE; return S_OK; }

            var paths = ExtractPathsFromComDataObject(pDataObj);
            var effect = paths.Length == 0 ? DROPEFFECT_NONE : ResolveEffect(grfKeyState, pdwEffect);
            pdwEffect = effect;
            AppendOleDndLog($"DropTarget Drop paths={paths.Length} effect={effect} {DescribeCursorHit(pt.x, pt.y)}");
            // Always notify host — empty paths surface EXTERNAL_FILES_DROP_FAILED (no silent X).
            _onDrop(paths, pt.x, pt.y, effect, _isBndzOleDragActive());
            return S_OK;
        }
    }
}
