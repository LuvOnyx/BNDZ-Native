using System.Diagnostics;
using System.Text.Json;
using System.Threading;
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
            return WebView2DropTargetService.RegisteredWebViewHwnd != IntPtr.Zero;
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
}
