using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
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

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ScreenToClient(IntPtr hWnd, ref NativePoint lpPoint);

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
    /// </summary>
    public static bool Register(
        IntPtr windowHwnd,
        Action<string[], double, double, uint, bool> onDrop,
        Action<double, double> onHover,
        Func<bool> isBndzOleDragActive)
    {
        if (windowHwnd == IntPtr.Zero) return false;

        // Ensure OLE is initialized on this thread (S_FALSE = already initialized, fine).
        int oleHr = OleInitialize(IntPtr.Zero);
        if (oleHr < 0)
            Debug.WriteLine($"[OleDrop] OleInitialize hr=0x{oleHr:X8}");

        var wv2Hwnd = FindWebView2Hwnd(windowHwnd);
        if (wv2Hwnd == IntPtr.Zero)
        {
            Debug.WriteLine("[OleDrop] WebView2 HWND not found; WPF-only drop fallback active.");
            return false;
        }

        // Revoke any existing target (WebView2's own or a previous BNDZ registration).
        int revokeHr = RevokeDragDrop(wv2Hwnd);
        Debug.WriteLine($"[OleDrop] RevokeDragDrop(0x{wv2Hwnd:X}) → hr=0x{revokeHr:X8}");

        var target = new BndzDropTarget(wv2Hwnd, onDrop, onHover, isBndzOleDragActive);
        int regHr = RegisterDragDrop(wv2Hwnd, target);
        if (regHr == S_OK)
        {
            _activeTarget = target;
            _registeredHwnd = wv2Hwnd;
            Debug.WriteLine($"[OleDrop] ✓ Registered IDropTarget on WebView2 HWND 0x{wv2Hwnd:X}");
            return true;
        }

        Debug.WriteLine($"[OleDrop] RegisterDragDrop failed hr=0x{regHr:X8}");
        _activeTarget = null;
        _registeredHwnd = IntPtr.Zero;
        return false;
    }

    /// <summary>Revoke the currently registered drop target (e.g., on window close).</summary>
    public static void Revoke()
    {
        if (_registeredHwnd == IntPtr.Zero) return;
        RevokeDragDrop(_registeredHwnd);
        _registeredHwnd = IntPtr.Zero;
        _activeTarget = null;
        Debug.WriteLine("[OleDrop] Drop target revoked.");
    }

    /// <summary>WebView2 child HWND that currently owns the BNDZ OLE drop target.</summary>
    public static IntPtr RegisteredWebViewHwnd => _registeredHwnd;

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
    /// that WebView2 registered its OLE drop target on.
    /// </summary>
    private static IntPtr FindWebView2Hwnd(IntPtr parentHwnd)
    {
        IntPtr best = IntPtr.Zero;
        var sb = new StringBuilder(256);

        EnumChildWindows(parentHwnd, (hwnd, _) =>
        {
            sb.Clear();
            GetClassName(hwnd, sb, sb.Capacity);
            var cls = sb.ToString();

            // "Chrome_WidgetWin_1" = the interactive Chromium HWND that receives OLE drops.
            if (cls.StartsWith("Chrome_WidgetWin_1", StringComparison.Ordinal))
            {
                best = hwnd;
                return false; // stop – highest priority hit
            }

            // "Chrome_WidgetWin_0" or any other Chrome variant as fallback.
            if (cls.StartsWith("Chrome_WidgetWin", StringComparison.Ordinal) && best == IntPtr.Zero)
            {
                best = hwnd;
                // keep enumerating — a _1 might still appear
            }

            // Generic "WebView" class name used by some WebView2 builds.
            if (cls.IndexOf("WebView", StringComparison.OrdinalIgnoreCase) >= 0 && best == IntPtr.Zero)
            {
                best = hwnd;
                Debug.WriteLine($"[OleDrop]  candidate WebView HWND 0x{hwnd:X} class='{cls}'");
            }

            return true; // continue enumeration
        }, IntPtr.Zero);

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
                tymed = TYMED.TYMED_HGLOBAL | TYMED.TYMED_ISTREAM | TYMED.TYMED_ISTORAGE,
            };
            comData.QueryGetData(ref fmt);
            return true;
        }
        catch { return false; }
    }

    // ── IDropTarget implementation ────────────────────────────────────────────

    private sealed class BndzDropTarget : IRawDropTarget
    {
        private readonly IntPtr _wv2Hwnd;
        private readonly Action<string[], double, double, uint, bool> _onDrop;
        private readonly Action<double, double> _onHover;
        private readonly Func<bool> _isBndzOleDragActive;
        private bool _hasFiles;

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
            _hasFiles = HasFileDrop(pDataObj);
            if (!_hasFiles) { pdwEffect = DROPEFFECT_NONE; return S_OK; }
            pdwEffect = ResolveEffect(grfKeyState, pdwEffect);
            _onHover(pt.x, pt.y);
            return S_OK;
        }

        public int DragOver(uint grfKeyState, NativePoint pt, ref uint pdwEffect)
        {
            if (!_hasFiles) { pdwEffect = DROPEFFECT_NONE; return S_OK; }
            pdwEffect = ResolveEffect(grfKeyState, pdwEffect);
            _onHover(pt.x, pt.y);
            return S_OK;
        }

        public int DragLeave()
        {
            _hasFiles = false;
            return S_OK;
        }

        public int Drop(ComIDataObject pDataObj, uint grfKeyState, NativePoint pt, ref uint pdwEffect)
        {
            _hasFiles = false;
            if (pDataObj == null) { pdwEffect = DROPEFFECT_NONE; return S_OK; }

            var paths = ExtractPathsFromComDataObject(pDataObj);
            if (paths.Length == 0) { pdwEffect = DROPEFFECT_NONE; return S_OK; }

            var effect = ResolveEffect(grfKeyState, pdwEffect);
            pdwEffect = effect;
            _onDrop(paths, pt.x, pt.y, effect, _isBndzOleDragActive());
            return S_OK;
        }
    }
}
