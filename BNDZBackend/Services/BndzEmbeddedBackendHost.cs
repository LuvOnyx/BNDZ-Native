using System.Diagnostics;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Extensions.DependencyInjection;

namespace BNDZ.Services;

/// <summary>
/// In-process headless BNDZ backend for BNDZShell — no App.xaml, no MainWindow.xaml, no WebView2, no WPF Application.
/// </summary>
public static class BndzEmbeddedBackendHost
{
    private static readonly object Sync = new();
#if BNDZ_HEADLESS_CORE
    private static BndzIpcHost? _host;
    private static ServiceProvider? _services;
#endif
    private static readonly object PushSync = new();
    private static readonly List<Action<string>> PushTargets = new();

    /// <summary>WinUI CraftPaneHost registers receivers so backend push events fan out to every island.</summary>
    public static Action<string>? PushToUi
    {
        get
        {
            lock (PushSync)
            {
                if (PushTargets.Count == 0) return null;
                var snapshot = PushTargets.ToArray();
                return json =>
                {
                    foreach (var t in snapshot)
                    {
                        try { t(json); }
                        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] push target: {ex.Message}"); }
                    }
                };
            }
        }
        set
        {
            // Backward-compat: assigning replaces with a single target (legacy single-host boot).
            lock (PushSync)
            {
                PushTargets.Clear();
                if (value != null) PushTargets.Add(value);
            }
        }
    }

    public static void RegisterPushTarget(Action<string> target)
    {
        if (target is null) return;
        lock (PushSync)
        {
            if (!PushTargets.Contains(target))
                PushTargets.Add(target);
        }
    }

    public static void UnregisterPushTarget(Action<string> target)
    {
        if (target is null) return;
        lock (PushSync)
        {
            PushTargets.Remove(target);
        }
    }

    /// <summary>
    /// Classic WPF embed path (legacy): mark host ready once MainWindow exists.
    /// Headless BNDZShell uses <see cref="EnsureStarted"/> instead.
    /// </summary>
    public static void NotifyReady(object? mainWindow, object? dispatcher)
    {
        _ = mainWindow;
        _ = dispatcher;
        try { EnsureStarted(); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] NotifyReady: {ex.Message}"); }
    }

    private static readonly TaskCompletionSource<bool> ReadyTcs = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public static bool IsReady => ReadyTcs.Task.IsCompletedSuccessfully;

    public static void EnsureStarted(IntPtr hostWindowHandle = default)
    {
#if !BNDZ_HEADLESS_CORE
        throw new InvalidOperationException(
            "BndzEmbeddedBackendHost requires the BNDZShell headless core build.");
#else
        if (IsReady)
        {
            if (hostWindowHandle != IntPtr.Zero)
            {
                try { _host?.SetHostWindowHandle(hostWindowHandle); }
                catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetHostWindowHandle: {ex.Message}"); }
            }
            return;
        }
        lock (Sync)
        {
            if (IsReady)
            {
                if (hostWindowHandle != IntPtr.Zero)
                {
                    try { _host?.SetHostWindowHandle(hostWindowHandle); }
                    catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetHostWindowHandle: {ex.Message}"); }
                }
                return;
            }
            try
            {
                // Headless shell has no App.xaml — bootstrap STA for clipboard / native menus.
                try { BndzUiDispatcher.EnsureStarted(); }
                catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] UI dispatcher: {ex.Message}"); }

                try { ExternalDropHelper.SweepStaleDropTemps(); }
                catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] drop temp sweep: {ex.Message}"); }

                var collection = new ServiceCollection();
                collection.AddSingleton<FileManagementService>();
                collection.AddSingleton<LocalAiService>();
                collection.AddSingleton<AiAssistantService>();
                collection.AddSingleton<ShellIntegrationService>();
                collection.AddSingleton<NativeShellService>();
                collection.AddSingleton<IconStudioService>();
                collection.AddSingleton<EverythingSearchService>();
                collection.AddSingleton<WindowsSearchService>();
                collection.AddSingleton<GlobalHotkeyService>();
                _services = collection.BuildServiceProvider();

                _host = new BndzIpcHost(
                    _services.GetRequiredService<FileManagementService>(),
                    _services.GetRequiredService<AiAssistantService>(),
                    _services.GetRequiredService<LocalAiService>(),
                    _services.GetRequiredService<ShellIntegrationService>(),
                    pushWebMessage: json =>
                    {
                        try { PushToUi?.Invoke(json); }
                        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] push: {ex.Message}"); }
                    },
                    hostWindowHandle: hostWindowHandle);

                ReadyTcs.TrySetResult(true);
                BndzOleDragStaThread.WarmUp();
                BndzShellStaThread.WarmUp();
                Debug.WriteLine("[BndzEmbeddedBackendHost] headless BndzIpcHost ready");
            }
            catch (Exception ex)
            {
                ReadyTcs.TrySetException(ex);
                Debug.WriteLine($"[BndzEmbeddedBackendHost] start failed: {ex}");
                throw;
            }
        }
#endif
    }

    public static void SetHostWindowHandle(IntPtr hwnd)
    {
#if BNDZ_HEADLESS_CORE
        if (hwnd == IntPtr.Zero) return;
        if (!IsReady)
        {
            EnsureStarted(hwnd);
            return;
        }
        try { _host?.SetHostWindowHandle(hwnd); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetHostWindowHandle: {ex.Message}"); }
#endif
    }

    /// <summary>WinUI STA synchronous invoke for OLE DoDragDrop (mouse-owning thread).</summary>
    public static void SetHostStaInvoke(Action<Action>? invoke)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { _host?.SetHostStaInvoke(invoke); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetHostStaInvoke: {ex.Message}"); }
#endif
    }

    /// <summary>Dedicated OLE STA thread for modal DoDragDrop (WinUI must not block).</summary>
    public static void RunOnOleDragSta(Action action, bool block = true)
    {
#if BNDZ_HEADLESS_CORE
        BndzOleDragStaThread.Run(action, block);
#else
        _ = block;
        action();
#endif
    }

    /// <summary>Enqueue OLE work on the next WinUI dispatcher turn (never inline).</summary>
    public static void SetHostStaInvokeNextTick(Action<Action>? invokeNextTick)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { _host?.SetHostStaInvokeNextTick(invokeNextTick); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetHostStaInvokeNextTick: {ex.Message}"); }
#endif
    }

    /// <summary>Run OLE work on WinUI dispatcher after delayMs (ghost handoff before DoDragDrop).</summary>
    public static void SetHostStaInvokeDelayed(Action<Action, int>? invokeDelayed)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { _host?.SetHostStaInvokeDelayed(invokeDelayed); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetHostStaInvokeDelayed: {ex.Message}"); }
#endif
    }

    /// <summary>Fire-and-forget FE ghost dismiss before DoDragDrop blocks STA.</summary>
    public static void SetOleEscalateFeDismiss(Action? dismiss)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { _host?.SetOleEscalateFeDismiss(dismiss); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetOleEscalateFeDismiss: {ex.Message}"); }
#endif
    }

    /// <summary>
    /// WinUI: run OLE only after WebView2 ghost-dismiss script completes (or times out).
    /// </summary>
    public static void SetRunOleAfterFeHandoff(Action<Action>? runAfterHandoff)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { _host?.SetRunOleAfterFeHandoff(runAfterHandoff); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetRunOleAfterFeHandoff: {ex.Message}"); }
#endif
    }

    /// <summary>Physical px height of caption/menubar for outbound OLE top-chrome escalate.</summary>
    public static void SetOutboundTopChromePx(int physicalPx)
    {
        try { WebView2DropTargetService.SetOutboundTopChromePx(physicalPx); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetOutboundTopChromePx: {ex.Message}"); }
    }

    /// <summary>WinUI CraftPaneHost: map OLE screen coords to WebView2 CSS client space.</summary>
    public static void ConfigureHeadlessDropBridge(
        Func<double, double, (double X, double Y)>? screenToClientMapper,
        double webViewClientWidth,
        double webViewClientHeight)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try
        {
            _host?.ConfigureHeadlessDropBridge(
                screenToClientMapper == null
                    ? null
                    : (x, y) =>
                    {
                        var p = screenToClientMapper(x, y);
                        return new System.Windows.Point(p.X, p.Y);
                    },
                webViewClientWidth,
                webViewClientHeight);
        }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] ConfigureHeadlessDropBridge: {ex.Message}"); }
#endif
    }

    /// <summary>Register BNDZ OLE IDropTarget on WebView2 child HWND under the WinUI shell window.</summary>
    public static bool RegisterHostOleDropTarget()
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try
        {
            _host?.RegisterHostOleDropTarget();
            WebView2DropTargetService.SetOutboundDragResumeRegistration(() =>
            {
                try { _host?.RegisterHostOleDropTarget(); }
                catch (Exception resumeEx) { Debug.WriteLine($"[BndzEmbeddedBackendHost] resume OLE: {resumeEx.Message}"); }
            });
            // Only latch success on a Chromium/InputSite child — top-level registration is never used.
            return WebView2DropTargetService.IsRegisteredOnChromeChild;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzEmbeddedBackendHost] RegisterHostOleDropTarget: {ex.Message}");
            return false;
        }
#else
        return false;
#endif
    }

    public static bool IsOleRegisteredOnChromeChild
    {
        get
        {
#if BNDZ_HEADLESS_CORE
            return WebView2DropTargetService.IsRegisteredOnChromeChild;
#else
            return false;
#endif
        }
    }

    public static IntPtr RegisteredOleWebViewHwnd
    {
        get
        {
#if BNDZ_HEADLESS_CORE
            return WebView2DropTargetService.RegisteredWebViewHwnd;
#else
            return IntPtr.Zero;
#endif
        }
    }

    public static bool IsScreenPointOutsideOleWebView(int screenX, int screenY)
    {
#if BNDZ_HEADLESS_CORE
        return WebView2DropTargetService.IsScreenPointOutsideRegisteredWebView(screenX, screenY);
#else
        return true;
#endif
    }

    /// <summary>Revoke OLE drop target (pane unload / WebView recovery).</summary>
    public static void RevokeHostOleDropTarget()
    {
#if BNDZ_HEADLESS_CORE
        try { _host?.RevokeHostOleDropTarget(); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] RevokeHostOleDropTarget: {ex.Message}"); }
#endif
    }

    /// <summary>Path A fallback when Chromium navigates to file: from an external drop.</summary>
    public static void NotifyNavigationFileDrop(string localPath)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { _host?.NotifyNavigationFileDrop(localPath); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] NotifyNavigationFileDrop: {ex.Message}"); }
#endif
    }

    /// <summary>Map screen coordinates to WebView2 client space after OLE registration.</summary>
    public static bool TryScreenToWebViewClient(double screenX, double screenY, out double clientX, out double clientY)
    {
#if BNDZ_HEADLESS_CORE
        return WebView2DropTargetService.TryScreenToWebViewClient(screenX, screenY, out clientX, out clientY);
#else
        clientX = screenX;
        clientY = screenY;
        return false;
#endif
    }

    public static void SetHostCloseAction(Action closeAction)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { _host?.SetHostCloseAction(closeAction); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetHostCloseAction: {ex.Message}"); }
#endif
    }

    public static void SetHostTrayActions(Action hideToTray, Action restoreFromTray)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { _host?.SetHostTrayActions(hideToTray, restoreFromTray); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetHostTrayActions: {ex.Message}"); }
#endif
    }

    public static void SetOpenPluginWindowAction(Func<string, string?, string?, bool> openAction)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { _host?.SetOpenPluginWindowAction(openAction); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetOpenPluginWindowAction: {ex.Message}"); }
#endif
    }

    public static void SetHostActivateMainAction(Action activateMain)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { _host?.SetHostActivateMainAction(activateMain); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] SetHostActivateMainAction: {ex.Message}"); }
#endif
    }

    public static void NotifyDeviceChange()
    {
#if BNDZ_HEADLESS_CORE
        if (!IsReady) return;
        try { _host?.NotifyDeviceChange(); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] NotifyDeviceChange: {ex.Message}"); }
#endif
    }

    public static async Task<JsonDocument?> InvokeAsync(string requestJson, CancellationToken ct = default)
    {
        EnsureStarted();
#if !BNDZ_HEADLESS_CORE
        await Task.CompletedTask.ConfigureAwait(false);
        return null;
#else
        if (_host is null)
            throw new InvalidOperationException("Headless backend not initialized.");

        ct.ThrowIfCancellationRequested();
        var responseJson = await _host.HandleIpcAsync(requestJson).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(responseJson))
            return null;
        return JsonDocument.Parse(responseJson);
#endif
    }

    public static void HandleStartDragSync(string requestJson)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        if (_host is null) return;
        _host.HandleDragNotifySync(requestJson);
#endif
    }

    /// <summary>WinUI timer poll — escalate FILE_DRAG_ACTIVE when cursor leaves WebView HWND.</summary>
    public static bool TryEscalateOutboundOleDrag()
    {
#if BNDZ_HEADLESS_CORE
        if (!IsReady || _host is null) return false;
        try { return _host.TryEscalateOutboundOleDrag(); }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzEmbeddedBackendHost] TryEscalateOutboundOleDrag: {ex.Message}");
            return false;
        }
#else
        return false;
#endif
    }

    /// <summary>True while native ole32 DoDragDrop is on the stack — skip HWND re-register.</summary>
    public static bool IsOutboundOleDragActive
    {
        get
        {
#if BNDZ_HEADLESS_CORE
            try { return _host?.IsOutboundOleDragActive == true; }
            catch { return false; }
#else
            return false;
#endif
        }
    }

    /// <summary>True while inbound IDropTarget is revoked for outbound DoDragDrop.</summary>
    public static bool IsInboundSuspendedForOutbound
    {
        get
        {
            try { return WebView2DropTargetService.IsInboundSuspendedForOutbound; }
            catch { return false; }
        }
    }

    /// <summary>WinUI top strip over WebView during outbound OLE / top-chrome handoff.</summary>
    public static bool ShouldShowOleTopGhostMask()
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { return _host?.ShouldShowOleTopGhostMask() == true; }
        catch { return false; }
#else
        return false;
#endif
    }

    public static async Task<JsonDocument?> InvokeAsync(string type, object? payload = null, CancellationToken ct = default)
    {
        var id = Guid.NewGuid().ToString("N");
        var request = JsonSerializer.Serialize(new { type, id, payload = payload ?? new { } });
        return await InvokeAsync(request, ct).ConfigureAwait(false);
    }

    public static void Shutdown()
    {
#if BNDZ_HEADLESS_CORE
        lock (Sync)
        {
            try { _services?.Dispose(); } catch { /* ignore */ }
            _services = null;
            _host = null;
        }
#endif
        lock (PushSync) { PushTargets.Clear(); }
    }

    /// <summary>Position embedded OS console for Remote Mesh local terminal.</summary>
    public static void LayoutMeshTerminal(string sessionId, IntPtr parentHwnd, int x, int y, int width, int height, bool visible)
    {
#if BNDZ_HEADLESS_CORE
        EnsureStarted();
        try { _host?.LayoutEmbeddedMeshTerminal(sessionId, parentHwnd, x, y, width, height, visible); }
        catch (Exception ex) { Debug.WriteLine($"[BndzEmbeddedBackendHost] LayoutMeshTerminal: {ex.Message}"); }
#endif
    }
}
