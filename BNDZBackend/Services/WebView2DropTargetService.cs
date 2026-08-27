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
        Func<bool> isBndzOleDragActive)
    {
        if (windowHwnd == IntPtr.Zero)
        {
            _lastRegisterHr = unchecked((int)0x80070057); // E_INVALIDARG
            return false;
        }

        // Never revoke/re-register while outbound DoDragDrop owns the mouse — breaks desktop drop.
        try
        {
            if (_inboundDropTargetSuspendedForOutbound || isBndzOleDragActive?.Invoke() == true)
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

        var target = new BndzDropTarget(wv2Hwnd, onDrop, onHover, isBndzOleDragActive);
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

            // React menubar / WinUI caption — user drags past top chrome to reach Desktop.
            if (web != IntPtr.Zero && GetWindowRect(web, out var webRect))
            {
                if (screenY >= hostRect.Top && screenY < webRect.Top)
                    return true;
                if (screenY >= webRect.Top && screenY < webRect.Top + rim)
                    return true;
            }
            else if (screenY >= hostRect.Top && screenY < hostRect.Top + rim)
            {
                return true;
            }

            // Physical window rim (all sides) — same width as top so side exits feel identical.
            // Not layout-% bands (those covered the whole sidebar and poisoned mid-drag).
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

    /// <summary>Default COPY/MOVE when shell echoes okEffects (7) over Desktop/Explorer.</summary>
    private static uint ResolveDefaultForeignDropEffect()
    {
        const int VK_SHIFT = 0x10;
        var shift = (GetAsyncKeyState(VK_SHIFT) & 0x8000) != 0;
        return shift ? 2u : 1u;
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
    /// Cursor over the shell Desktop (Progman/WorkerW + SysListView32) — authorize DROP at
    /// commit time even when GiveFeedback is stale from a prior taskbar hover.
    /// </summary>
    private static bool IsDesktopDropTargetAtPoint(int screenX, int screenY)
    {
        try
        {
            var hit = WindowFromPoint(new NativePoint { x = screenX, y = screenY });
            if (hit == IntPtr.Zero) return false;
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
            if (GetHwndClassName(hit) == "SysListView32")
            {
                for (var cur = GetParent(hit); cur != IntPtr.Zero; cur = GetParent(cur))
                {
                    var cls = GetHwndClassName(cur);
                    if (cls is "Progman" or "WorkerW" or "SHELLDLL_DefView") return true;
                }
            }
            return false;
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
        private bool _lastFeedbackTrusted;
        private bool _loggedFeedbackOnce;
        private int _buttonUpStreak;

        internal BndzNativeDropSource(Action<string>? log = null) => _log = log;

        private uint RawFeedbackBits()
            => _lastFeedbackEffect == uint.MaxValue ? 0u : (_lastFeedbackEffect & 0x7u);

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

        private void LogDecision(string reason)
        {
            try { _log?.Invoke($"QueryContinueDrag {reason}"); }
            catch { /* ignore */ }
        }

        public int QueryContinueDrag(bool fEscapePressed, uint grfKeyState)
        {
            if (fEscapePressed)
            {
                LogDecision($"cancel escape {DescribeCursorHit()}");
                return DRAGDROP_S_CANCEL;
            }
            const int VK_LBUTTON = 0x01;
            const int VK_RBUTTON = 0x02;
            // Prefer process-wide async key state — OLE grfKeyState is queue-local to the
            // DoDragDrop STA and looks "up" when the button-down lived in Chromium.
            bool oleDown = (grfKeyState & (MK_LBUTTON | MK_RBUTTON)) != 0;
            bool asyncDown =
                (GetAsyncKeyState(VK_LBUTTON) & 0x8000) != 0
                || (GetAsyncKeyState(VK_RBUTTON) & 0x8000) != 0;
            bool buttonDown = oleDown || asyncDown;
            if (buttonDown)
            {
                _sawButtonDown = true;
                _buttonUpStreak = 0;
                _buttonUpInsideSinceMs = 0;
                _buttonUpOutsideNoneSinceMs = 0;
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

            // Chromium/WebView2 often flickers button-up while the user is still holding.
            _buttonUpStreak++;
            if (_buttonUpStreak < 4)
                return S_OK;

            // --- Button up (debounced): DROP only on folder+latched, else CANCEL ---
            bool haveCursor = GetCursorPos(out var pt);
            var hit = haveCursor ? DescribeCursorHit(pt.x, pt.y) : "no-cursor";
            var host = _hostWindowHwnd != IntPtr.Zero ? _hostWindowHwnd : _registeredHwnd;
            var insideHostRect = haveCursor && host != IntPtr.Zero
                && GetWindowRect(host, out var hostRectQcd)
                && PointInRect(hostRectQcd, pt.x, pt.y);
            var overSelf = hit.Contains("ourDropTarget=True", StringComparison.Ordinal)
                || (insideHostRect && hit.Contains("underHost=True", StringComparison.Ordinal));
            var overDeniedChrome = haveCursor && IsDeniedOleDropCommitTarget(pt.x, pt.y);
            var overForeignFolder = haveCursor
                && (IsDesktopDropTargetAtPoint(pt.x, pt.y)
                    || IsExplorerFolderDropTargetAtPoint(pt.x, pt.y));
            var rawFb = RawFeedbackBits();

            if (!_sawButtonDown)
                return S_OK;

            if (overDeniedChrome)
            {
                LogDecision($"cancel button-up denied-chrome cursor=({pt.x},{pt.y}) latched={_latchedAcceptEffect} {hit}");
                return DRAGDROP_S_CANCEL;
            }

            if (overForeignFolder && _latchedAcceptEffect is 1 or 2 or 4)
            {
                LogDecision($"drop folder cursor=({pt.x},{pt.y}) effect={_latchedAcceptEffect} latched={_latchedAcceptEffect} oleDown={oleDown} asyncDown={asyncDown} {hit}");
                return DRAGDROP_S_DROP;
            }

            // Explorer latched COPY|MOVE on Desktop — commit even if the cursor drifted back over BNDZ chrome.
            if (_latchedAcceptEffect is 1 or 2 or 4 && _sawFolderAccept)
            {
                LogDecision($"drop latched-commit cursor=({pt.x},{pt.y}) effect={_latchedAcceptEffect} {hit}");
                return DRAGDROP_S_DROP;
            }

            if (insideHostRect && !overSelf)
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
                LogDecision($"cancel button-up no-latch cursor=({pt.x},{pt.y}) lastFb={rawFb} {hit}");
                return DRAGDROP_S_CANCEL;
            }
            if (waitedOutside < 40)
                LogDecision($"defer-drop wait latch cursor=({pt.x},{pt.y}) lastFb={rawFb} {hit}");
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

            if (!overDenied && resolved != 0 && overForeignFolder)
                _latchedAcceptEffect = resolved;
            if (overForeignFolder)
                _sawFolderAccept = true;
            if (overForeignFolder && bits == 7)
                _lastFeedbackEffect = ResolveCommitDropEffect(7u, overForeignFolder: true);
            else if (resolved != 0)
                _lastFeedbackEffect = resolved;
            else if (!overSelf)
                _lastFeedbackEffect = 0;
            _lastFeedbackTrusted = trusted;
            return DRAGDROP_S_USEDEFAULTCURSORS;
        }
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

    /// <summary>
    /// Perform native OLE drag from the BNDZShell headless path.
    /// ole32 <c>DoDragDrop</c> only — SHDoDragDrop with a custom IDropSource already
    /// produced hr=DROP effect=NONE after premature QueryContinueDrag DROP.
    /// </summary>
    public static void RunNativeDragDrop(IntPtr hwnd, object dataObject, string? pathSummary = null, string[]? sourcePaths = null)
    {
        _ = hwnd; // retained for call-site compatibility / future drag-image HWND
        if (dataObject == null) return;

        int oleHr = OleInitialize(IntPtr.Zero);
        if (oleHr < 0)
            Debug.WriteLine($"[OleDrag] OleInitialize hr=0x{oleHr:X8}");

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
                AppendOleDndLog($"DoDragDrop begin CF_HDROP={hasHdrop} ShellIDList={hasShellIdList}{summary}");

                var hr = NativeDoDragDrop(comData, src, okEffects, out var finalEffect);
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

                if (hr == DRAGDROP_S_DROP && sourcePaths is { Length: > 0 }
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
