// Copyright (c) BNDZ — WebView2 DragStarting COM bridge (official outbound OLE path).
// Default outbound drag path. WinUI WebView2 XAML wrapper does not expose DragStarting on the control.

using System.Reflection;
using System.Runtime.InteropServices;
using BNDZ.Services;

namespace BNDZShell.Bndz;

/// <summary>
/// Subscribes to <c>ICoreWebView2CompositionControllerInterop3.DragStarting</c> and runs host
/// <see cref="BndzEmbeddedBackendHost.HandleWebView2DragStarting"/> with WebView2's IDataObject.
/// </summary>
internal static class WebView2DragStartingBridge
{
    private static readonly Guid IID_CompositionControllerInterop3 =
        new("b211edcf-7ef3-44ad-8aed-4d3ef0af1813");

    private static WebView2DragStartingHandler? s_handler;
    private static EventRegistrationToken s_token;
    private static object? s_interopKeepAlive;

    /// <summary>Always on — primary list drag-out path (avoids boundary handoff).</summary>
    public static bool IsEnabled => true;

    public static bool IsInstalled { get; private set; }

    public static bool TryInstall(object webViewControl, object? coreWebView2 = null)
    {
        if (IsInstalled || webViewControl is null)
            return false;

        var controller = TryGetCoreWebView2Controller(webViewControl, coreWebView2);
        if (controller is null)
        {
            Log("DragStarting install skip — no composition/controller COM object (WinUI WebView2 uses standard hosting)");
            return false;
        }

        var unk = Marshal.GetIUnknownForObject(controller);
        try
        {
            if (TrySubscribeViaInterop3(unk, out var interop3))
            {
                s_interopKeepAlive = interop3;
                IsInstalled = true;
                Log("DragStarting bridge installed (Interop3)");
                return true;
            }

            Log("DragStarting install failed — QI ICoreWebView2CompositionControllerInterop3");
            return false;
        }
        finally
        {
            Marshal.Release(unk);
        }
    }

    private static bool TrySubscribeViaInterop3(IntPtr controllerUnk, out ICoreWebView2CompositionControllerInterop3? interop3)
    {
        interop3 = null;
        var hr = Marshal.QueryInterface(controllerUnk, in IID_CompositionControllerInterop3, out var ptr);
        if (hr != 0 || ptr == IntPtr.Zero)
            return false;

        try
        {
            interop3 = (ICoreWebView2CompositionControllerInterop3)Marshal.GetObjectForIUnknown(ptr)!;
            s_handler ??= new WebView2DragStartingHandler();
            var addHr = interop3.add_DragStarting(s_handler, out s_token);
            if (addHr != 0)
            {
                Log($"DragStarting add_DragStarting Interop3 hr=0x{addHr:X8}");
                interop3 = null;
                return false;
            }
            return true;
        }
        finally
        {
            Marshal.Release(ptr);
        }
    }

    private static object? TryGetCoreWebView2Controller(object webViewControl, object? coreWebView2)
    {
        var t = webViewControl.GetType();
        foreach (var name in new[] { "CoreWebView2Controller", "Controller", "_controller", "controller" })
        {
            var prop = t.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            var val = prop?.GetValue(webViewControl);
            if (val != null)
                return val;
            var field = t.GetField(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
            val = field?.GetValue(webViewControl);
            if (val != null)
                return val;
        }
        foreach (var field in t.GetFields(BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public))
        {
            var val = field.GetValue(webViewControl);
            if (val is null) continue;
            var ft = val.GetType().FullName ?? val.GetType().Name;
            if (ft.Contains("CoreWebView2Controller", StringComparison.Ordinal)
                || ft.Contains("CoreWebView2CompositionController", StringComparison.Ordinal))
                return val;
        }
        if (coreWebView2 is not null)
        {
            var ct = coreWebView2.GetType();
            foreach (var name in new[] { "Controller", "CoreWebView2Controller" })
            {
                var prop = ct.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
                var val = prop?.GetValue(coreWebView2);
                if (val != null) return val;
            }
        }
        return null;
    }

    private static void Log(string message)
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
        System.Diagnostics.Debug.WriteLine($"[WebView2DragStarting] {message}");
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct EventRegistrationToken
    {
        public long Value;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [ComImport]
    [Guid("8e9922ce-9c80-42e6-bad7-fcebf291a495")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ICoreWebView2CompositionControllerInterop
    {
        [PreserveSig] int get_AutomationProvider(out IntPtr provider);
        [PreserveSig] int get_RootVisualTarget(out IntPtr target);
        [PreserveSig] int put_RootVisualTarget(IntPtr target);
    }

    [ComImport]
    [Guid("6b47bbe1-2480-4ff8-a5ba-69c2f0b868b3")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ICoreWebView2CompositionControllerInterop2 : ICoreWebView2CompositionControllerInterop
    {
        [PreserveSig] int DragEnter(IntPtr dataObject, uint keyState, POINT point, out uint effect);
        [PreserveSig] int DragLeave();
        [PreserveSig] int DragOver(uint keyState, POINT point, out uint effect);
        [PreserveSig] int Drop(IntPtr dataObject, uint keyState, POINT point, out uint effect);
    }

    [ComImport]
    [Guid("b211edcf-7ef3-44ad-8aed-4d3ef0af1813")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ICoreWebView2CompositionControllerInterop3 : ICoreWebView2CompositionControllerInterop2
    {
        [PreserveSig] int add_DragStarting(ICoreWebView2DragStartingEventHandler eventHandler, out EventRegistrationToken token);
        [PreserveSig] int remove_DragStarting(EventRegistrationToken token);
    }

    [ComImport]
    [Guid("3b149321-83c3-5d1f-b03f-a42899bc1c15")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ICoreWebView2DragStartingEventHandler
    {
        [PreserveSig]
        int Invoke(IntPtr sender, IntPtr args);
    }

    [ComImport]
    [Guid("8b8d9c7e-2f1a-4e6b-9d5a-3c8f7b9e1a2d")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface ICoreWebView2DragStartingEventArgs
    {
        [PreserveSig] int get_AllowedDropEffects(out uint value);
        [PreserveSig] int get_Data(out IntPtr dataObject);
        [PreserveSig] int get_Handled(out int value);
        [PreserveSig] int put_Handled(int value);
        [PreserveSig] int get_Position(out POINT value);
        [PreserveSig] int GetDeferral(out IntPtr deferral);
    }

    [ComVisible(true)]
    [ClassInterface(ClassInterfaceType.None)]
    private sealed class WebView2DragStartingHandler : ICoreWebView2DragStartingEventHandler
    {
        public int Invoke(IntPtr sender, IntPtr argsRaw)
        {
            _ = sender;
            if (argsRaw == IntPtr.Zero)
                return unchecked((int)0x80004003); // E_POINTER

            var args = (ICoreWebView2DragStartingEventArgs)Marshal.GetObjectForIUnknown(argsRaw)!;
            try
            {
                var dataHr = args.get_Data(out var dataPtr);
                if (dataHr != 0 || dataPtr == IntPtr.Zero)
                {
                    Log($"DragStarting skip — get_Data hr=0x{dataHr:X8}");
                    return dataHr != 0 ? dataHr : unchecked((int)0x80004005);
                }

                // Tell WebView2 we own the drag — must set before DoDragDrop (official sample).
                args.put_Handled(1);

                var dataObject = Marshal.GetObjectForIUnknown(dataPtr)!;
                Marshal.Release(dataPtr);
                BndzEmbeddedBackendHost.HandleWebView2DragStarting(dataObject);
                return 0;
            }
            catch (Exception ex)
            {
                Log($"DragStarting handler error {ex.Message}");
                return ex.HResult != 0 ? ex.HResult : unchecked((int)0x80004005);
            }
        }
    }
}
