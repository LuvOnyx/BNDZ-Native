// Copyright (c) BNDZ — FilesMerge hosted React pane (architecture #3).
// Files Community portions remain MIT (see LICENSE-MIT).

using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using BNDZ.Services;
using Microsoft.UI;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Web.WebView2.Core;

namespace BNDZShell.Bndz;

/// <summary>
/// Hosts a BNDZ React craft island (<c>?nativeShell=1&amp;pane=…</c>) inside BNDZShell.
/// WebView2 postMessage is bridged in-process via <see cref="BndzInProcessClient"/>.
/// After first navigation, pane switches soft-route via <c>BNDZ_PANE_SWITCH</c> (no reload).
/// </summary>
public sealed partial class CraftPaneHost : UserControl
{
	public static readonly DependencyProperty PaneProperty =
		DependencyProperty.Register(nameof(Pane), typeof(string), typeof(CraftPaneHost),
			new PropertyMetadata("plugins", OnPaneChanged));

	public static readonly DependencyProperty PluginIdProperty =
		DependencyProperty.Register(nameof(PluginId), typeof(string), typeof(CraftPaneHost),
			new PropertyMetadata(null));

	private bool _initialized;
	private bool _documentReady;
	private bool _initStarted;
	private int _readyWatchGeneration;
	private string? _uiRoot;
	private string? _navigatedPane;
	private CoreWebView2Environment? _webEnv;
	private string? _pendingContextJson;
	private string? _pendingListingJson;
	/// <summary>Pre-ready push fan-out queue — earlier messages must not be overwritten.</summary>
	private readonly List<string> _pendingPushQueue = new();
	private string? _pendingCloseRequestJson;
	/// <summary>Last DIR listing JSON — re-posted on BNDZ_UI_READY because early PostWebMessage drops if React has not subscribed yet.</summary>
	private string? _lastListingJson;
	private Action<string>? _pushHandler;
	/// <summary>WinUI main window HWND — required for OLE drop registration.</summary>
	public IntPtr HostWindowHandle { get; set; }

	private bool _oleDropRegistered;
	private Microsoft.UI.Dispatching.DispatcherQueueTimer? _fileDragEscalateTimer;
	private bool _fileDragEscalateArmed;
	private bool _oleGhostMaskVisible;

	private static CoreWebView2Environment? s_sharedPaneEnv;
	private static readonly SemaphoreSlim s_envLock = new(1, 1);

	public string Pane
	{
		get => (string)GetValue(PaneProperty);
		set => SetValue(PaneProperty, value);
	}

	public string? PluginId
	{
		get => (string?)GetValue(PluginIdProperty);
		set => SetValue(PluginIdProperty, value);
	}

	/// <summary>When set, navigates to slim PluginPopoutShell (?pluginWindow=) instead of full BNDZUI.</summary>
	public string? PluginWindowId { get; set; }
	public string? PluginStickyId { get; set; }
	public string? PluginWindowTitle { get; set; }

	public CraftPaneHost()
	{
		InitializeComponent();
		Loaded += (_, _) => SyncRasterizationScale();
		ActualThemeChanged += (_, _) => SyncRasterizationScale();
		Unloaded += (_, _) =>
		{
			if (_pushHandler != null)
			{
				BndzEmbeddedBackendHost.UnregisterPushTarget(_pushHandler);
				_pushHandler = null;
			}
			// Do NOT revoke OLE here — WinUI Unloaded fires on theme/layout reparent and would
			// leave Chromium + BNDZ with no drop target until a full relaunch.
		};
		Loaded += (_, _) =>
		{
			WireHostStaInvokeForOle();
			if (_initialized && !_oleDropRegistered)
				TryRegisterOleDropTarget();
		};
	}

	private static void OnPaneChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
	{
		if (d is CraftPaneHost host && host._initialized)
			host.ApplyPaneRoute(forceNavigate: false);
	}

	/// <summary>Eager-init WebView2 while the host may still be Collapsed (no visible spinner flash).</summary>
	public void Prewarm()
	{
		_ = EnsureInitializedAsync(showHint: false);
	}

	/// <summary>Surface a fatal shell error on the pane status strip (used from MainWindow / App).</summary>
	public void ShowPaneStatus(string message)
	{
		PaneStatusHint.Visibility = Visibility.Visible;
		PaneStatusHint.Text = message;
	}

	private async void PaneWebView_Loaded(object sender, RoutedEventArgs e)
	{
		await EnsureInitializedAsync(showHint: !_documentReady);
	}

	public event EventHandler? WebViewInitialized;

	private async Task EnsureInitializedAsync(bool showHint)
	{
		if (_initialized || _initStarted)
			return;
		_initStarted = true;

		try
		{
			// Always show status until BNDZ_UI_READY — blank dark chrome with no hint looks like a crash.
			PaneStatusHint.Visibility = Visibility.Visible;
			PaneStatusHint.Text = showHint ? "Loading BNDZ…" : "Starting WebView2…";

			_uiRoot = ResolveUiAssetsRoot();
			if (_uiRoot is null)
			{
				PaneStatusHint.Visibility = Visibility.Visible;
				PaneStatusHint.Text = "BNDZ UI assets missing — run npm run build and stage Assets/ui.";
				_initStarted = false;
				return;
			}

			_webEnv = await AwaitWithTimeout(
				GetSharedPaneEnvironmentAsync(),
				TimeSpan.FromSeconds(20),
				"WebView2 profile create timed out (another BNDZShell/WebView may be locking the profile). Close other instances and relaunch.").ConfigureAwait(true);
			PaneStatusHint.Text = "Initializing WebView2…";
			try
			{
				await AwaitWithTimeout(
					PaneWebView.EnsureCoreWebView2Async(_webEnv).AsTask(),
					TimeSpan.FromSeconds(25),
					"WebView2 init timed out. Close other BNDZ windows and relaunch.").ConfigureAwait(true);
			}
			catch (Exception envEx)
			{
				Debug.WriteLine($"[CraftPaneHost] profile env failed ({envEx.Message}), using default runtime");
				PaneStatusHint.Text = "Retrying WebView2 with default profile…";
				await AwaitWithTimeout(
					PaneWebView.EnsureCoreWebView2Async().AsTask(),
					TimeSpan.FromSeconds(25),
					"WebView2 default init timed out.").ConfigureAwait(true);
			}

			var core = PaneWebView.CoreWebView2
				?? throw new InvalidOperationException("WebView2 CoreWebView2 is null after init.");

			// Headless BndzIpcHost (no WPF App.Run / no backend WebView2) — start on this STA thread.
			if (!BndzEmbeddedBackendHost.IsReady)
				BndzEmbeddedBackendHost.EnsureStarted();
			_pushHandler = json =>
			{
				try
				{
					if (DispatcherQueue is not null && !DispatcherQueue.HasThreadAccess)
					{
						DispatcherQueue.TryEnqueue(() => PostHostMessageRaw(json));
						return;
					}
					PostHostMessageRaw(json);
				}
				catch (Exception pushEx)
				{
					Debug.WriteLine($"[CraftPaneHost] push: {pushEx.Message}");
				}
			};
			BndzEmbeddedBackendHost.RegisterPushTarget(_pushHandler);

			core.Settings.AreDefaultContextMenusEnabled = false;
			core.Settings.IsStatusBarEnabled = false;
			core.Settings.AreBrowserAcceleratorKeysEnabled = false;
			core.Settings.IsSwipeNavigationEnabled = false;
			core.Settings.IsZoomControlEnabled = false;
			core.Settings.IsGeneralAutofillEnabled = false;
			core.Settings.IsPasswordAutosaveEnabled = false;
			core.ContextMenuRequested += (_, e) => e.Handled = true;
			SyncRasterizationScale();
			if (XamlRoot is not null)
				XamlRoot.Changed += (_, _) => SyncRasterizationScale();
            // Desktop → BNDZ: AllowExternalDrop=true so WebView2 does not install a blocking
            // DROPEFFECT_NONE target. BNDZ Revoke+Register overlays our IDropTarget on every
            // Chromium/InputSite child under the host.
            try
            {
                var prop = PaneWebView.GetType().GetProperty("AllowExternalDrop");
                prop?.SetValue(PaneWebView, true);
                var controllerProp = PaneWebView.GetType().GetProperty("CoreWebView2Controller")
                    ?? PaneWebView.GetType().GetProperty("Controller");
                var controller = controllerProp?.GetValue(PaneWebView);
                controller?.GetType().GetProperty("AllowExternalDrop")?.SetValue(controller, true);
            }
            catch (Exception dropEx) { Debug.WriteLine($"[CraftPaneHost] AllowExternalDrop: {dropEx.Message}"); }
			// Let WinUI ExtendsContentIntoTitleBar caption buttons receive clicks over WebView2.
			try { core.Settings.IsNonClientRegionSupportEnabled = true; }
			catch (Exception ncEx) { Debug.WriteLine($"[CraftPaneHost] IsNonClientRegionSupportEnabled: {ncEx.Message}"); }
			try
			{
				PaneWebView.DefaultBackgroundColor = Microsoft.UI.Colors.Transparent;
				SetBackdropChrome(BndzShellChromeSettings.MicaBackdrop);
			}
			catch (Exception bgEx) { Debug.WriteLine($"[CraftPaneHost] transparent bg: {bgEx.Message}"); }
			// Opt-in only — Debugger.IsAttached previously enabled DevTools on every pane host.
			core.Settings.AreDevToolsEnabled =
				string.Equals(Environment.GetEnvironmentVariable("BNDZ_DEVTOOLS"), "1", StringComparison.Ordinal);

			core.SetVirtualHostNameToFolderMapping(
				"bndz.local",
				_uiRoot,
				CoreWebView2HostResourceAccessKind.Allow);

			// Local file streaming (WAV/MP4/PDF…) — not under bndz.local folder mapping.
			core.AddWebResourceRequestedFilter(
				$"{BndzLocalStreamService.CustomScheme}:*",
				CoreWebView2WebResourceContext.All);
			core.AddWebResourceRequestedFilter(
				"http://bndz.local/local-stream/*",
				CoreWebView2WebResourceContext.All);
			core.AddWebResourceRequestedFilter(
				$"{BndzMediaScheme.CustomScheme}:*",
				CoreWebView2WebResourceContext.All);
			core.AddWebResourceRequestedFilter(
				"http://bndz.local/assets/native-icon/*",
				CoreWebView2WebResourceContext.All);
			core.WebResourceRequested += Core_WebResourceRequested;

			core.WebMessageReceived += Core_WebMessageReceived;
			core.NavigationStarting += Core_NavigationStarting;
			core.NavigationCompleted += Core_NavigationCompleted;
			core.ProcessFailed += Core_ProcessFailed;
			_initialized = true;
			WebViewInitialized?.Invoke(this, EventArgs.Empty);
			TryRegisterOleDropTarget();
			PaneStatusHint.Text = "Loading BNDZ UI…";
			ApplyPaneRoute(forceNavigate: true);
			ScheduleReadyWatchdog();
		}
		catch (Exception ex)
		{
			PaneStatusHint.Visibility = Visibility.Visible;
			PaneStatusHint.Text = $"Pane host failed: {FormatInitException(ex)}";
			Debug.WriteLine($"[CraftPaneHost] init failed: {ex}");
			_initStarted = false;
		}
	}

	private static async Task<T> AwaitWithTimeout<T>(Task<T> task, TimeSpan timeout, string timeoutMessage)
	{
		var delay = Task.Delay(timeout);
		var completed = await Task.WhenAny(task, delay).ConfigureAwait(true);
		if (completed != task)
			throw new TimeoutException(timeoutMessage);
		return await task.ConfigureAwait(true);
	}

	private static async Task AwaitWithTimeout(Task task, TimeSpan timeout, string timeoutMessage)
	{
		var delay = Task.Delay(timeout);
		var completed = await Task.WhenAny(task, delay).ConfigureAwait(true);
		if (completed != task)
			throw new TimeoutException(timeoutMessage);
		await task.ConfigureAwait(true);
	}

	private static string FormatInitException(Exception ex)
	{
		var parts = new List<string>();
		for (var cur = ex; cur is not null; cur = cur.InnerException)
		{
			var hresult = cur.HResult != 0 ? $" (0x{cur.HResult:X8})" : string.Empty;
			parts.Add($"{cur.Message}{hresult}");
		}
		return string.Join(" -> ", parts);
	}

	private static async Task<CoreWebView2Environment> GetSharedPaneEnvironmentAsync()
	{
		if (s_sharedPaneEnv is not null)
			return s_sharedPaneEnv;

		await s_envLock.WaitAsync().ConfigureAwait(false);
		try
		{
			if (s_sharedPaneEnv is not null)
				return s_sharedPaneEnv;

			var profileDir = System.IO.Path.Combine(
				Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
				"BNDZ", "WebView2", "NativeShell");
			System.IO.Directory.CreateDirectory(profileDir);

			var streamScheme = new CoreWebView2CustomSchemeRegistration(BndzLocalStreamService.CustomScheme);
			streamScheme.TreatAsSecure = 1;
			streamScheme.HasAuthorityComponent = true;
			streamScheme.AllowedOrigins.Add("http://bndz.local");
			streamScheme.AllowedOrigins.Add("https://bndz.local");

			// Native-feel compositor: D3D11 GPU path + zero-copy. Drag regions via
			// IsNonClientRegionSupportEnabled only (not legacy msWebView2EnableDraggableRegions).
			// --disable-frame-rate-limit: compositor follows monitor Hz (not Chromium's 60 cap).
			// --disable-smooth-scrolling: 1:1 wheel like Explorer, not eased browser scroll.
			var options = new CoreWebView2EnvironmentOptions
			{
				AdditionalBrowserArguments =
					"--enable-gpu --enable-gpu-rasterization --enable-gpu-compositing --enable-zero-copy " +
					"--use-angle=d3d11 --enable-features=CanvasOopRasterization " +
					"--disable-features=CalculateNativeWinOcclusion,msExperimentalScrolling " +
					"--disable-frame-rate-limit --disable-smooth-scrolling --ignore-gpu-blocklist " +
					"--unsafely-treat-insecure-origin-as-secure=http://bndz.local,https://bndz.local",
			};
			options.CustomSchemeRegistrations.Add(streamScheme);
			options.CustomSchemeRegistrations.Add(BndzMediaSchemeHost.CreateRegistration());

			s_sharedPaneEnv = await CoreWebView2Environment
				.CreateWithOptionsAsync(null, profileDir, options)
				.AsTask()
				.ConfigureAwait(false);
			return s_sharedPaneEnv;
		}
		finally
		{
			s_envLock.Release();
		}
	}

	private void SyncRasterizationScale()
	{
		try
		{
			var scale = XamlRoot?.RasterizationScale ?? 1.0;
			if (scale > 0.1 && Math.Abs(PaneWebView.RasterizationScale - scale) > 0.001)
				PaneWebView.RasterizationScale = scale;
			if (_initialized)
				TryRegisterOleDropTarget();
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[CraftPaneHost] RasterizationScale: {ex.Message}");
		}
	}

	
	/// <summary>
	/// Modal DoDragDrop must run on the WinUI STA (Explorer model). Blocking is expected during drag.
	/// </summary>
	private void WireHostStaInvokeForOle()
	{
		var dq = DispatcherQueue;
		if (dq is null) return;
		BndzEmbeddedBackendHost.SetHostStaInvoke(action =>
		{
			if (action is null) return;
			if (dq.HasThreadAccess)
			{
				action();
				return;
			}
			using var done = new ManualResetEventSlim(false);
			Exception? err = null;
			if (!dq.TryEnqueue(() =>
			    {
				    try { action(); }
				    catch (Exception ex) { err = ex; }
				    finally { done.Set(); }
			    }))
			{
				throw new InvalidOperationException("WinUI DispatcherQueue rejected OLE STA invoke.");
			}
			if (!done.Wait(TimeSpan.FromMinutes(10)))
				throw new TimeoutException("OLE DoDragDrop STA invoke timed out.");
			if (err != null) throw err;
		});
		BndzEmbeddedBackendHost.SetHostStaInvokeNextTick(action =>
		{
			if (action is null) return;
			if (!dq.TryEnqueue(() =>
			    {
				    try { action(); }
				    catch (Exception ex) { Debug.WriteLine($"[CraftPaneHost] OLE next-tick: {ex.Message}"); }
			    }))
			{
				Debug.WriteLine("[CraftPaneHost] OLE next-tick enqueue rejected — running inline");
				try { action(); } catch (Exception ex) { Debug.WriteLine($"[CraftPaneHost] OLE inline: {ex.Message}"); }
			}
		});
		BndzEmbeddedBackendHost.SetHostStaInvokeDelayed((action, delayMs) =>
		{
			if (action is null) return;
			var ms = Math.Clamp(delayMs, 16, 500);
			var timer = DispatcherQueue.CreateTimer();
			timer.Interval = TimeSpan.FromMilliseconds(ms);
			timer.IsRepeating = false;
			timer.Tick += (_, _) =>
			{
				timer.Stop();
				try { action(); }
				catch (Exception ex) { Debug.WriteLine($"[CraftPaneHost] OLE delayed: {ex.Message}"); }
			};
			timer.Start();
		});
		// Hide every fluid/list ghost node — lead/card/pill survive if we only hide the stack root
		// after React re-commits display (stuck MOVE under WinUI menubar).
		const string GhostDismissScript =
			"try{" +
			"document.documentElement.classList.add('bndz-ole-drag-handoff');" +
			"var veil=document.getElementById('bndz-ole-veil');" +
			"if(!veil){veil=document.createElement('div');veil.id='bndz-ole-veil';" +
			"veil.setAttribute('aria-hidden','true');" +
			"veil.style.cssText='position:fixed;inset:0;z-index:2147483646;pointer-events:none;" +
			"background:transparent;opacity:0;';document.documentElement.appendChild(veil);}" +
			"document.querySelectorAll(" +
			"'.bndz-fluid-drag-stack,.bndz-fluid-drag-lead,.bndz-fluid-drag-card,.bndz-fluid-drag-multi-pill," +
			".bndz-fluid-drag-overflow-badge,.bndz-drag-ghost-root,.bndz-drag-ghost-card'" +
			").forEach(function(el){" +
			"el.style.setProperty('display','none','important');" +
			"el.style.setProperty('visibility','hidden','important');" +
			"el.style.setProperty('opacity','0','important');" +
			"el.style.setProperty('pointer-events','none','important');});" +
			"var f=window.__bndzDismissDragGhost;f?f():window.dispatchEvent(new CustomEvent('bndz-ole-drag-escalated'));" +
			"}catch(e){}";

		BndzEmbeddedBackendHost.SetOleEscalateFeDismiss(() =>
		{
			var core = PaneWebView.CoreWebView2;
			if (core is null) return;
			// Fire-and-forget — must NOT block-wait on UI thread (deadlocks script completion).
			_ = core.ExecuteScriptAsync(GhostDismissScript);
		});
		// Ghost dismiss runs in parallel — DoDragDrop must start while LMB is still down.
		BndzEmbeddedBackendHost.SetRunOleAfterFeHandoff(oleAction =>
		{
			if (oleAction is null) return;
			try
			{
				var core = PaneWebView.CoreWebView2;
				core?.ExecuteScriptAsync(GhostDismissScript);
			}
			catch { /* ignore */ }
			if (!dq.TryEnqueue(() =>
			    {
				    try
				    {
					    File.AppendAllText(
						    Path.Combine(
							    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
							    "BNDZ", "ole-dnd.log"),
						    $"{DateTime.Now:HH:mm:ss.fff} FE ghost dismiss ready why=immediate-next-tick{Environment.NewLine}");
				    }
				    catch { /* ignore */ }
				    try { oleAction(); }
				    catch (Exception ex) { Debug.WriteLine($"[CraftPaneHost] OLE immediate: {ex.Message}"); }
			    }))
			{
				try { oleAction(); }
				catch (Exception ex) { Debug.WriteLine($"[CraftPaneHost] OLE inline: {ex.Message}"); }
			}
		});
		try
		{
			var scale = XamlRoot?.RasterizationScale ?? 1.0;
			// Match MainWindow menubar/caption (~36dip) with headroom for React chrome.
			BndzEmbeddedBackendHost.SetOutboundTopChromePx((int)Math.Round(48 * Math.Max(1.0, scale)));
		}
		catch { /* ignore */ }

		if (!_oleWireStartupLogged)
		{
			_oleWireStartupLogged = true;
			try
			{
				var dir = Path.Combine(
					Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
					"BNDZ");
				Directory.CreateDirectory(dir);
				File.AppendAllText(
					Path.Combine(dir, "ole-dnd.log"),
					$"{DateTime.Now:HH:mm:ss.fff} STARTUP ole-wire topChrome=on awaitHandoff=on topMask=on ownedPayload=hdrop-only acceptGate=fb!=0&&fb!=7 feedbackTrusted=on denyTrayDrop=on pathSanitize=on dropVerify=on forensics=on build={DateTime.Now:yyyyMMdd-HHmm}{Environment.NewLine}");
			}
			catch { /* never break host on logging */ }
		}
	}

	private static bool _oleWireStartupLogged;

	private void StartFileDragEscalatePoll()
	{
		_fileDragEscalateArmed = true;
		if (_fileDragEscalateTimer is null)
		{
			_fileDragEscalateTimer = DispatcherQueue.CreateTimer();
			_fileDragEscalateTimer.Interval = TimeSpan.FromMilliseconds(16);
			_fileDragEscalateTimer.Tick += (_, _) =>
			{
				if (!_fileDragEscalateArmed)
				{
					StopFileDragEscalatePoll();
					return;
				}
				try
				{
					var stopPoll = BndzEmbeddedBackendHost.TryEscalateOutboundOleDrag();
					SyncOleGhostMask(BndzEmbeddedBackendHost.ShouldShowOleTopGhostMask());
					if (stopPoll)
						StopFileDragEscalatePoll();
				}
				catch (Exception ex)
				{
					Debug.WriteLine($"[CraftPaneHost] escalate poll: {ex.Message}");
				}
			};
		}
		if (!_fileDragEscalateTimer.IsRunning)
			_fileDragEscalateTimer.Start();
	}

	private void StopFileDragEscalatePoll()
	{
		_fileDragEscalateArmed = false;
		try { _fileDragEscalateTimer?.Stop(); } catch { /* ignore */ }
		SyncOleGhostMask(false);
	}

	/// <summary>Window close / crash path — stop escalate poll so we do not leave OLE armed after HWND death.</summary>
	public void StopOutboundDragCleanup()
	{
		StopFileDragEscalatePoll();
		try { BndzEmbeddedBackendHost.RevokeHostOleDropTarget(); } catch { /* ignore */ }
		_oleDropRegistered = false;
	}

	/// <summary>
	/// Agent/CI smoke: %LocalAppData%\BNDZ\ole-smoke.json {"paths":["C:\\..."]} arms FILE_DRAG_ACTIVE.
	/// </summary>
	private void TryRunOleSmokeArmDeferred()
	{
		var timer = DispatcherQueue.CreateTimer();
		timer.Interval = TimeSpan.FromMilliseconds(700);
		timer.Tick += (_, _) =>
		{
			timer.Stop();
			TryRunOleSmokeArmCore();
			StartOleSmokePoll();
		};
		timer.Start();
	}

	/// <summary>Poll for late ole-smoke.json (automation writes after UI_READY + mouse down).</summary>
	private void StartOleSmokePoll()
	{
		if (_oleSmokePollTimer is not null) return;
		_oleSmokePollAttempts = 0;
		_oleSmokePollTimer = DispatcherQueue.CreateTimer();
		_oleSmokePollTimer.Interval = TimeSpan.FromMilliseconds(400);
		_oleSmokePollTimer.Tick += (_, _) =>
		{
			_oleSmokePollAttempts++;
			try { TryRunOleSmokeArmCore(); }
			catch (Exception ex) { Debug.WriteLine($"[CraftPaneHost] OleSmokePoll: {ex.Message}"); }
			if (_oleSmokePollAttempts >= 300) // ~2 min
				StopOleSmokePoll();
		};
		_oleSmokePollTimer.Start();
	}

	private void StopOleSmokePoll()
	{
		try { _oleSmokePollTimer?.Stop(); } catch { /* ignore */ }
		_oleSmokePollTimer = null;
	}

	private Microsoft.UI.Dispatching.DispatcherQueueTimer? _oleSmokePollTimer;
	private int _oleSmokePollAttempts;

	private void TryRunOleSmokeArmCore()
	{
		var logDir = Path.Combine(
			Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
			"BNDZ");
		var logFile = Path.Combine(logDir, "ole-dnd.log");
		void SmokeLog(string msg)
		{
			try
			{
				Directory.CreateDirectory(logDir);
				File.AppendAllText(logFile, $"{DateTime.Now:HH:mm:ss.fff} {msg}{Environment.NewLine}");
			}
			catch { /* ignore */ }
		}

		try
		{
			var trigger = Path.Combine(logDir, "ole-smoke.json");
			if (!File.Exists(trigger)) return;
			var json = File.ReadAllText(trigger);
			using var doc = JsonDocument.Parse(json);
			var paths = new List<string>();
			if (doc.RootElement.TryGetProperty("paths", out var arr) && arr.ValueKind == JsonValueKind.Array)
			{
				foreach (var pe in arr.EnumerateArray())
				{
					var s = pe.GetString();
					if (!string.IsNullOrWhiteSpace(s)) paths.Add(s);
				}
			}
			try { File.Delete(trigger); } catch { /* one-shot */ }
			if (paths.Count == 0)
			{
				SmokeLog("OLE smoke skip paths=0");
				return;
			}

			var msg = JsonSerializer.Serialize(new
			{
				type = "FILE_DRAG_ACTIVE",
				payload = new { active = true, paths },
			});
			BndzEmbeddedBackendHost.HandleStartDragSync(msg);
			SmokeLog($"OLE smoke host-direct arm paths={paths.Count} sample={paths[0]}");
			StartFileDragEscalatePoll();
			StopOleSmokePoll();
		}
		catch (Exception ex)
		{
			SmokeLog($"OLE smoke error {ex.Message}");
			Debug.WriteLine($"[CraftPaneHost] OleSmokeArm: {ex.Message}");
		}
	}

	/// <summary>
	/// Opaque WinUI strip over the WebView top — hides a React MOVE card clamped under the menubar
	/// even when ExecuteScript is late. Shell IDataObject owns the cursor outside the HWND.
	/// </summary>
	private void SyncOleGhostMask(bool oleActive)
	{
		_ = oleActive;
		// Mask removed — CSS handoff hides React ghost without painting over the menubar.
	}

/// <summary>Register native OLE IDropTarget on WebView2 child HWND (desktop → BNDZ drops).</summary>
	internal void TryRegisterOleDropTarget()
	{
		if (!_initialized || PaneWebView.CoreWebView2 is null)
			return;
		// Plugin pop-outs must not steal host HWND / OLE STA from the main FM window —
		// that froze the whole app when a tear-off was open.
		if (!string.IsNullOrWhiteSpace(PluginWindowId))
			return;
		// Never revoke/re-register mid outbound DoDragDrop — that produced REGISTER lines
		// during an active drag and helped yield effect=NONE at the desktop.
		if (BndzEmbeddedBackendHost.IsOutboundOleDragActive)
			return;
		var hwnd = HostWindowHandle;
		if (hwnd == IntPtr.Zero)
			return;

		try
		{
			BndzEmbeddedBackendHost.SetHostWindowHandle(hwnd);
			WireHostStaInvokeForOle();

			var clientW = PaneWebView.ActualWidth;
			var clientH = PaneWebView.ActualHeight;
			if (clientW < 1) clientW = 1280;
			if (clientH < 1) clientH = 720;
			var rasterScale = XamlRoot?.RasterizationScale ?? 1.0;

			BndzEmbeddedBackendHost.ConfigureHeadlessDropBridge(
				(screenX, screenY) =>
				{
					if (BndzEmbeddedBackendHost.TryScreenToWebViewClient(screenX, screenY, out var cx, out var cy))
					{
						if (rasterScale > 0.01)
							return (cx / rasterScale, cy / rasterScale);
						return (cx, cy);
					}
					return (screenX, screenY);
				},
				clientW,
				clientH);

			var ok = BndzEmbeddedBackendHost.RegisterHostOleDropTarget();
			_oleDropRegistered = ok;
			if (!_oleDropRegistered)
			{
				Debug.WriteLine("[CraftPaneHost] OLE drop target registration pending — WebView2 HWND not ready.");
				ScheduleOleDropRetry();
			}
			else
			{
				NotifyOleDropReady();
				// Chromium often re-installs its IDropTarget after first paint — reclaim shortly after.
				ScheduleOleDropReassert();
			}
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[CraftPaneHost] TryRegisterOleDropTarget: {ex.Message}");
		}
	}

	private int _oleDropRetryGeneration;
	private int _oleDropReassertGeneration;

	private void ScheduleOleDropRetry()
	{
		var generation = ++_oleDropRetryGeneration;
		_ = Task.Run(async () =>
		{
			// ~20 attempts over ~8s until Chrome_WidgetWin_1 exists.
			for (var attempt = 0; attempt < 20 && generation == _oleDropRetryGeneration; attempt++)
			{
				await Task.Delay(attempt == 0 ? 100 : 400).ConfigureAwait(false);
				try
				{
					DispatcherQueue?.TryEnqueue(() =>
					{
						if (generation != _oleDropRetryGeneration || _oleDropRegistered)
							return;
						TryRegisterOleDropTarget();
					});
				}
				catch { /* ignore */ }
				if (_oleDropRegistered)
					break;
			}
		});
	}

	/// <summary>Re-register after navigation/paint — short reclaim only (no infinite heartbeat).</summary>
	private void ScheduleOleDropReassert()
	{
		var generation = ++_oleDropReassertGeneration;
		_ = Task.Run(async () =>
		{
			foreach (var delayMs in new[] { 300, 800, 1600, 3200 })
			{
				await Task.Delay(delayMs).ConfigureAwait(false);
				if (generation != _oleDropReassertGeneration) return;
				try
				{
                    DispatcherQueue?.TryEnqueue(() =>
					{
						if (generation != _oleDropReassertGeneration) return;
						if (!_initialized || PaneWebView.CoreWebView2 is null) return;
						if (HostWindowHandle == IntPtr.Zero) return;
						if (BndzEmbeddedBackendHost.IsOutboundOleDragActive
						    || BndzEmbeddedBackendHost.IsInboundSuspendedForOutbound)
							return;
						var ok = BndzEmbeddedBackendHost.RegisterHostOleDropTarget();
						_oleDropRegistered = ok;
						if (!ok)
							ScheduleOleDropRetry();
						else
							NotifyOleDropReady();
					});
				}
				catch { /* ignore */ }
			}
		});
	}

	private void NotifyOleDropReady()
	{
		try
		{
			PostHostMessage(new { type = "HOST_OLE_DROP_READY", payload = new { ready = true } });
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[CraftPaneHost] NotifyOleDropReady: {ex.Message}");
		}
	}

	private void Core_NavigationStarting(CoreWebView2 sender, CoreWebView2NavigationStartingEventArgs args)
	{
		if (!args.Uri.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
			return;
		args.Cancel = true;
		try
		{
			var localPath = new Uri(args.Uri).LocalPath;
			if (!string.IsNullOrWhiteSpace(localPath))
				BndzEmbeddedBackendHost.NotifyNavigationFileDrop(localPath);
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[CraftPaneHost] NavigationStarting file drop: {ex.Message}");
		}
	}

	private void Core_WebResourceRequested(CoreWebView2 sender, CoreWebView2WebResourceRequestedEventArgs e)
	{
		try
		{
			if (_webEnv is null)
				return;
			var uri = e.Request.Uri;
			if (BndzMediaScheme.IsMediaRequest(uri))
			{
				BndzMediaSchemeHost.Serve(_webEnv, e);
				return;
			}
			if (!BndzLocalStreamService.IsStreamRequest(uri))
				return;
			var localPath = BndzLocalStreamService.ParseLocalStreamPath(uri);
			BndzLocalStreamService.ServeLocalFile(_webEnv, e, localPath);
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[CraftPaneHost] stream: {ex.Message}");
		}
	}

	private void Core_NavigationCompleted(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
	{
		TryRegisterOleDropTarget();
		// Do not mark ready / hide hint here — React mounts after NavigationCompleted.
		// BNDZ_UI_READY owns document-ready + flush so DIR listings are not dropped.
		if (args.IsSuccess)
		{
			if (!_documentReady)
			{
				PaneStatusHint.Visibility = Visibility.Visible;
				PaneStatusHint.Text = "Painting BNDZ UI…";
				ScheduleReadyWatchdog();
			}
			return;
		}

		PaneStatusHint.Visibility = Visibility.Visible;
		PaneStatusHint.Text = $"WebView navigation failed ({args.WebErrorStatus}). Close other BNDZShell windows and relaunch.";
		Debug.WriteLine($"[CraftPaneHost] NavigationCompleted failed: {args.WebErrorStatus}");
		AppendShellLog($"NavigationCompleted failed: {args.WebErrorStatus}");
	}

	private void Core_ProcessFailed(CoreWebView2 sender, CoreWebView2ProcessFailedEventArgs args)
	{
		StopOutboundDragCleanup();
		_documentReady = false;
		PaneStatusHint.Visibility = Visibility.Visible;
		PaneStatusHint.Text = "UI process crashed — reloading…";
		AppendShellLog($"ProcessFailed kind={args.ProcessFailedKind} exit={args.ExitCode}");
		Debug.WriteLine($"[CraftPaneHost] ProcessFailed: {args.ProcessFailedKind}");
		try
		{
			if (DispatcherQueue is not null && !DispatcherQueue.HasThreadAccess)
			{
				DispatcherQueue.TryEnqueue(() => ApplyPaneRoute(forceNavigate: true));
				return;
			}
			ApplyPaneRoute(forceNavigate: true);
		}
		catch (Exception ex)
		{
			PaneStatusHint.Text = $"UI process crashed: {ex.Message}";
		}
	}

	private void ScheduleReadyWatchdog()
	{
		var generation = ++_readyWatchGeneration;
		_ = Task.Run(async () =>
		{
			await Task.Delay(TimeSpan.FromSeconds(18)).ConfigureAwait(false);
			if (generation != _readyWatchGeneration || _documentReady)
				return;
			try
			{
				if (DispatcherQueue is null)
					return;
				DispatcherQueue.TryEnqueue(() =>
				{
					if (_documentReady || generation != _readyWatchGeneration)
						return;
					PaneStatusHint.Visibility = Visibility.Visible;
					PaneStatusHint.Text = "BNDZ UI is taking too long — relaunch if this stays blank.";
					AppendShellLog("Ready watchdog: BNDZ_UI_READY not received within 18s");
				});
			}
			catch { /* ignore */ }
		});
	}

	private static void AppendShellLog(string line)
	{
		try
		{
			var logDir = System.IO.Path.Combine(
				Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
				"BNDZ");
			System.IO.Directory.CreateDirectory(logDir);
			System.IO.File.AppendAllText(
				System.IO.Path.Combine(logDir, "shell-crash.log"),
				$"{DateTime.UtcNow:o} [CraftPaneHost] {line}\n");
		}
		catch { /* best-effort */ }
	}

	private void ApplyPaneRoute(bool forceNavigate)
	{
		if (!_initialized || PaneWebView.CoreWebView2 is null)
			return;

		// Slim second-process plugin pop-out — never boot the full FM face.
		if (!string.IsNullOrWhiteSpace(PluginWindowId))
		{
			var popQs = $"nativeShell=1&pluginWindow={Uri.EscapeDataString(PluginWindowId)}";
			if (!string.IsNullOrWhiteSpace(PluginStickyId))
				popQs += $"&stickyId={Uri.EscapeDataString(PluginStickyId)}";
			if (!string.IsNullOrWhiteSpace(PluginWindowTitle))
				popQs += $"&title={Uri.EscapeDataString(PluginWindowTitle)}";
			_navigatedPane = "plugin-window";
			_documentReady = false;
			PaneWebView.CoreWebView2.Navigate($"http://bndz.local/index.html?{popQs}");
			PaneStatusHint.Visibility = Visibility.Collapsed;
			return;
		}

		var pane = string.IsNullOrWhiteSpace(Pane) ? "plugins" : Pane.Trim().ToLowerInvariant();

		// Full classic BNDZUI browser face for BNDZShell (native list overlay in workspace slot).
		if (pane is "browser" or "shell" or "face" or "host")
		{
			if (!forceNavigate && _documentReady && string.Equals(_navigatedPane, "browser", StringComparison.OrdinalIgnoreCase))
			{
				PaneStatusHint.Visibility = Visibility.Collapsed;
				return;
			}

			_navigatedPane = "browser";
			_documentReady = false;
			PaneWebView.CoreWebView2.Navigate("http://bndz.local/index.html?nativeShell=1");
			return;
		}

		// Soft-route: keep warm React document, switch shell in-place (instant).
		if (!forceNavigate && _documentReady && !string.IsNullOrEmpty(_navigatedPane))
		{
			PostJson(new
			{
				type = "BNDZ_PANE_SWITCH",
				payload = new { pane, plugin = PluginId, path = (string?)null },
			});
			_navigatedPane = pane;
			PaneStatusHint.Visibility = Visibility.Collapsed;
			return;
		}

		var qs = $"nativeShell=1&pane={Uri.EscapeDataString(pane)}";
		if (!string.IsNullOrWhiteSpace(PluginId))
			qs += $"&plugin={Uri.EscapeDataString(PluginId)}";

		_navigatedPane = pane;
		_documentReady = false;
		PaneWebView.CoreWebView2.Navigate($"http://bndz.local/index.html?{qs}");
	}

	/// <summary>Push Files list selection / cwd into the React pane.</summary>
	public void PostPaneContext(
		string? path,
		IReadOnlyList<string>? selectedPaths = null,
		IReadOnlyList<string>? selectedNames = null,
		IReadOnlyList<string>? selectedTypes = null,
		IReadOnlyList<long>? selectedSizes = null,
		IReadOnlyList<string>? selectedModified = null)
	{
		var envelope = new
		{
			type = "BNDZ_PANE_CONTEXT",
			payload = new
			{
				path,
				selectedPaths,
				selectedNames,
				selectedTypes,
				selectedSizes,
				selectedModified,
			},
		};
		var json = JsonSerializer.Serialize(envelope);
		// Queue until WebView document is ready — early selection push was silently dropped.
		if (!_documentReady || PaneWebView.CoreWebView2 is null)
		{
			_pendingContextJson = json;
			return;
		}
		PostJsonRaw(json);
	}

	private void FlushPendingContext()
	{
		if (PaneWebView.CoreWebView2 is null || !_documentReady)
			return;
		if (!string.IsNullOrEmpty(_pendingCloseRequestJson))
		{
			PostJsonRaw(_pendingCloseRequestJson);
			_pendingCloseRequestJson = null;
		}
		if (!string.IsNullOrEmpty(_pendingContextJson))
		{
			PostJsonRaw(_pendingContextJson);
			_pendingContextJson = null;
		}
		if (_pendingPushQueue.Count > 0)
		{
			foreach (var json in _pendingPushQueue)
				PostJsonRaw(json);
			_pendingPushQueue.Clear();
		}
		// Always re-post last listing on ready — NavigationCompleted can race ahead of React listeners.
		var listing = _pendingListingJson ?? _lastListingJson;
		if (!string.IsNullOrEmpty(listing))
		{
			PostJsonRaw(listing);
			_pendingListingJson = null;
		}
	}

	public void SwitchPane(string pane, string? plugin = null)
	{
		if (plugin is not null)
			PluginId = plugin;

		var target = pane?.Trim().ToLowerInvariant() ?? "plugins";
		if (string.Equals(Pane, target, StringComparison.OrdinalIgnoreCase) && _documentReady)
		{
			// Same DP value won't fire OnPaneChanged — soft-route explicitly.
			if (!string.IsNullOrWhiteSpace(plugin))
			{
				PostJson(new
				{
					type = "BNDZ_PANE_SWITCH",
					payload = new { pane = target, plugin },
				});
			}
			PaneStatusHint.Visibility = Visibility.Collapsed;
			return;
		}

		Pane = target;
		if (_initialized)
			ApplyPaneRoute(forceNavigate: false);
		else
			Prewarm();
	}

	public void PostHostMessage(object payload)
	{
		PostHostMessageRaw(JsonSerializer.Serialize(payload));
	}

	/// <summary>
	/// Toggle host/WebView opacity so Mica can show through chrome without a solid slab.
	/// </summary>
	public void SetBackdropChrome(bool micaEnabled)
	{
		try
		{
			if (PaneRoot is not null)
			{
				PaneRoot.Background = micaEnabled
					? new SolidColorBrush(Colors.Transparent)
					: new SolidColorBrush(ColorHelper.FromArgb(0xFF, 0x0C, 0x0F, 0x14));
			}
			PaneWebView.DefaultBackgroundColor = micaEnabled
				? Colors.Transparent
				: ColorHelper.FromArgb(0xFF, 0x0C, 0x0F, 0x14);
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[CraftPaneHost] SetBackdropChrome: {ex.Message}");
		}
	}

	public void PostHostMessageRaw(string json)
	{
		if (json.Contains("\"BNDZ_DIR_LISTING\"", StringComparison.Ordinal))
		{
			_lastListingJson = json;
			_pendingListingJson = json;
		}
		if (json.Contains("\"CLOSE_REQUEST\"", StringComparison.Ordinal))
		{
			if (!_documentReady || PaneWebView.CoreWebView2 is null)
			{
				_pendingCloseRequestJson = json;
				return;
			}
			PostJsonRaw(json);
			return;
		}
		// Queue until React signals BNDZ_UI_READY — NavigationCompleted alone is too early (listeners not attached).
		if (!_documentReady || PaneWebView.CoreWebView2 is null)
		{
			if (json.Contains("\"BNDZ_PANE_CONTEXT\"", StringComparison.Ordinal))
				_pendingContextJson = json;
			else if (!json.Contains("\"BNDZ_DIR_LISTING\"", StringComparison.Ordinal))
			{
				_pendingPushQueue.Add(json);
				// Prefer keeping transfer + FS watch pushes when capping — dropping them
				// made copy/paste silent and left the list stale until manual refresh.
				while (_pendingPushQueue.Count > 64)
				{
					var dropIdx = _pendingPushQueue.FindIndex(j =>
						!j.Contains("\"FILE_TRANSFER_QUEUE_CHANGED\"", StringComparison.Ordinal)
						&& !j.Contains("\"FS_EVENT_BATCH\"", StringComparison.Ordinal));
					if (dropIdx < 0) dropIdx = 0;
					_pendingPushQueue.RemoveAt(dropIdx);
				}
			}
			return;
		}
		PostJsonRaw(json);
	}

	private void PostJson(object payload)
	{
		PostJsonRaw(JsonSerializer.Serialize(payload));
	}

	private void PostJsonRaw(string json)
	{
		if (PaneWebView.CoreWebView2 is null)
			return;
		try
		{
			PaneWebView.CoreWebView2.PostWebMessageAsJson(json);
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[CraftPaneHost] PostJson: {ex.Message}");
		}
	}

	private void Core_WebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
	{
		string raw;
		try { raw = args.WebMessageAsJson; }
		catch { return; }

		if (string.IsNullOrWhiteSpace(raw))
			return;

		string? requestId = null;
		string? requestType = null;

		// Pane-local control messages stay in Files (no backend round-trip).
		try
		{
			using var doc = JsonDocument.Parse(raw);
			var root = doc.RootElement;
			if (root.TryGetProperty("id", out var idEl))
				requestId = idEl.GetString();
			var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
			requestType = type;
			if (type is "BNDZ_PANE_TOOL" or "BNDZ_PANE_NAVIGATE" or "BNDZ_PANE_SWITCH" or "BNDZ_REQUEST_DIR_LISTING" or "BNDZ_NATIVE_LIST_BOUNDS"
				or "WINDOW_CHROME" or "GET_WINDOW_STATE"
				or "SET_SYSTEM_BACKDROP" or "SHOW_APP_NOTIFICATION"
				or "OPEN_FILE_DIALOG" or "SAVE_FILE_DIALOG" or "OPEN_FOLDER_DIALOG"
				or "PRINT_DOCUMENT" or "PRINT_UI")
			{
				PaneMessage?.Invoke(this, root.Clone());
				return;
			}
			if (type is "START_DRAG")
			{
				try { BndzEmbeddedBackendHost.HandleStartDragSync(raw); }
				catch (Exception dragEx) { Debug.WriteLine($"[CraftPaneHost] START_DRAG sync: {dragEx.Message}"); }
				StopFileDragEscalatePoll();
				return;
			}
			if (type is "OLE_DND_DEBUG")
			{
				try
				{
					var detail = "?";
					if (root.TryGetProperty("payload", out var dbgPayload))
					{
						if (dbgPayload.TryGetProperty("kind", out var kindEl))
							detail = kindEl.GetString() ?? "?";
						if (dbgPayload.TryGetProperty("entityId", out var entEl) && entEl.ValueKind == JsonValueKind.String)
							detail += $" id={entEl.GetString()}";
						if (dbgPayload.TryGetProperty("sample", out var sampleEl) && sampleEl.ValueKind == JsonValueKind.Array
							&& sampleEl.GetArrayLength() > 0
							&& sampleEl[0].ValueKind == JsonValueKind.String)
							detail += $" sample={sampleEl[0].GetString()}";
						if (dbgPayload.TryGetProperty("active", out var actDbg))
							detail += $" active={actDbg.ValueKind == JsonValueKind.True}";
						if (dbgPayload.TryGetProperty("pathCount", out var pcEl) && pcEl.TryGetInt32(out var pc))
							detail += $" paths={pc}";
						if (dbgPayload.TryGetProperty("rejectedCount", out var rcEl) && rcEl.TryGetInt32(out var rc))
							detail += $" rejected={rc}";
						if (dbgPayload.TryGetProperty("localCount", out var lcEl) && lcEl.TryGetInt32(out var lc))
							detail += $" local={lc}";
						if (dbgPayload.TryGetProperty("thumb", out var thEl) && thEl.ValueKind == JsonValueKind.True)
							detail += " block=thumb";
						if (dbgPayload.TryGetProperty("bg", out var bgEl) && bgEl.ValueKind == JsonValueKind.True)
							detail += " block=bg";
						if (dbgPayload.TryGetProperty("disallowList", out var dlEl))
							detail += dlEl.ValueKind == JsonValueKind.True ? " disallowList=1" : " disallowList=0";
						if (dbgPayload.TryGetProperty("thumbDrag", out var tdEl))
							detail += tdEl.ValueKind == JsonValueKind.True ? " thumbDrag=1" : " thumbDrag=0";
						if (dbgPayload.TryGetProperty("bgWindow", out var bwEl))
							detail += bwEl.ValueKind == JsonValueKind.True ? " bgWindow=1" : " bgWindow=0";
						if (dbgPayload.TryGetProperty("fluidDrag", out var fdEl))
							detail += fdEl.ValueKind == JsonValueKind.False ? " fluidDrag=0" : " fluidDrag=1";
						if (dbgPayload.TryGetProperty("bgProcessing", out var bpEl))
							detail += bpEl.ValueKind == JsonValueKind.False ? " bgProc=0" : " bgProc=1";
						if (dbgPayload.TryGetProperty("queueOps", out var qoEl))
							detail += qoEl.ValueKind == JsonValueKind.False ? " queueOps=0" : " queueOps=1";
					}
					File.AppendAllText(
						Path.Combine(
							Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
							"BNDZ", "ole-dnd.log"),
						$"{DateTime.Now:HH:mm:ss.fff} FE_DEBUG {detail}{Environment.NewLine}");
				}
				catch { /* ignore */ }
				return;
			}
			if (type is "FILE_DRAG_ACTIVE")
			{
				try
				{
					BndzEmbeddedBackendHost.HandleStartDragSync(raw);
					var active = false;
					if (root.TryGetProperty("payload", out var dragPayload)
						&& dragPayload.ValueKind == JsonValueKind.Object
						&& dragPayload.TryGetProperty("active", out var actEl))
					{
						active = actEl.ValueKind == JsonValueKind.True;
					}
					if (active) StartFileDragEscalatePoll();
					else if (!BndzEmbeddedBackendHost.IsOutboundOleDragActive)
						StopFileDragEscalatePoll();
					else
						StartFileDragEscalatePoll(); // keep dismiss alive through DoDragDrop handoff
				}
				catch (Exception dragEx) { Debug.WriteLine($"[CraftPaneHost] FILE_DRAG_ACTIVE: {dragEx.Message}"); }
				return;
			}
			if (type is "OLE_ESCALATE_NOW")
			{
				try
				{
					StartFileDragEscalatePoll();
					BndzEmbeddedBackendHost.HandleStartDragSync(raw);
					// Force path may start DoDragDrop inline — keep poll for ghost dismiss.
					StartFileDragEscalatePoll();
				}
				catch (Exception escEx) { Debug.WriteLine($"[CraftPaneHost] OLE_ESCALATE_NOW: {escEx.Message}"); }
				return;
			}
			// React painted — hide any residual host spinner and flush queued selection.
			if (type is "BNDZ_UI_READY")
			{
				try
				{
					var bundle = "?";
					if (root.TryGetProperty("payload", out var uiPayload)
						&& uiPayload.TryGetProperty("bundle", out var bundleEl)
						&& bundleEl.ValueKind == JsonValueKind.String)
						bundle = bundleEl.GetString() ?? "?";
					File.AppendAllText(
						Path.Combine(
							Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
							"BNDZ", "ole-dnd.log"),
						$"{DateTime.Now:HH:mm:ss.fff} UI_READY bundle={bundle}{Environment.NewLine}");
				}
				catch { /* never break host on logging */ }
				PaneStatusHint.Visibility = Visibility.Collapsed;
				_documentReady = true;
				_readyWatchGeneration++;
				FlushPendingContext();
				PaneMessage?.Invoke(this, root.Clone());
				// Forward to headless backend so PushDrivesUpdate / warm paths run (not pane-local only).
				_ = ForwardUiReadyToBackendAsync(raw);
				TryRunOleSmokeArmDeferred();
				return;
			}
			if (type is "BNDZ_UI_CRASH")
			{
				_documentReady = false;
				PaneStatusHint.Visibility = Visibility.Visible;
				var msg = "React render crashed — see shell-crash.log";
				if (root.TryGetProperty("payload", out var crashPayload)
					&& crashPayload.TryGetProperty("message", out var crashMsg)
					&& crashMsg.ValueKind == JsonValueKind.String
					&& !string.IsNullOrWhiteSpace(crashMsg.GetString()))
				{
					msg = $"UI crash: {crashMsg.GetString()}";
				}
				PaneStatusHint.Text = msg;
				AppendShellLog(msg);
				return;
			}
			// SHOW_HOST_CONTEXT_MENU — handle with a native WinUI MenuFlyout so the popup
			// anchors correctly to the WinUI compositor frame (no hidden-WPF-window offset issues).
			if (type is "SHOW_HOST_CONTEXT_MENU")
			{
				HandleShowHostContextMenu(root.Clone(), requestId);
				return;
			}
		}
		catch { /* fall through to backend bridge */ }

		// Never block the WebView message pump on long GET_DIR_CONTENTS / media work — push + fallback post deliver RESULT.
		_ = DispatchBackendIpcAsync(sender, raw, requestId, requestType);
	}

	private async Task DispatchBackendIpcAsync(
		CoreWebView2 sender,
		string raw,
		string? requestId,
		string? requestType)
	{
		try
		{
			using var response = await BndzInProcessClient.InvokeAsyncFromRawJsonAsync(raw).ConfigureAwait(false);
			if (response is null)
			{
				EnqueuePostMessage(sender, JsonSerializer.Serialize(new
				{
					type = "ERROR",
					id = requestId,
					payload = new { error = "Empty backend host response", requestType },
				}));
				return;
			}
			EnqueuePostMessage(sender, response.RootElement.GetRawText());
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[CraftPaneHost] IPC bridge: {ex.Message}");
			try
			{
				EnqueuePostMessage(sender, JsonSerializer.Serialize(new
				{
					type = "ERROR",
					id = requestId,
					payload = new { error = ex.Message, requestType },
				}));
			}
			catch { }
		}
	}

	private void EnqueuePostMessage(CoreWebView2 sender, string json)
	{
		if (DispatcherQueue is not null && !DispatcherQueue.HasThreadAccess)
		{
			DispatcherQueue.TryEnqueue(() => PostWebMessageSafe(sender, json));
			return;
		}
		PostWebMessageSafe(sender, json);
	}

	private static void PostWebMessageSafe(CoreWebView2 sender, string json)
	{
		try { sender.PostWebMessageAsJson(json); }
		catch (Exception ex) { Debug.WriteLine($"[CraftPaneHost] PostWebMessage: {ex.Message}"); }
	}

	/// <summary>
	/// Host-owned context menu via Win32 TrackPopupMenu.
	/// MenuFlyout.ShowAt(WebView2) is unreliable (often invisible / no Closed result) — Win32
	/// popups paint above the compositor and match Explorer tab chrome.
	/// </summary>
	private void HandleShowHostContextMenu(JsonElement root, string? requestId)
	{
		try
		{
			var payload = root.TryGetProperty("payload", out var p) ? p : default;
			var hwnd = HostWindowHandle;
			if (hwnd == IntPtr.Zero)
			{
				PostJsonRaw(HostMenuResultJson(requestId, null));
				return;
			}

			var idByCmd = new Dictionary<int, string>();
			var hMenu = CreatePopupMenu();
			if (hMenu == IntPtr.Zero)
			{
				PostJsonRaw(HostMenuResultJson(requestId, null));
				return;
			}

			try
			{
				var nextCmd = 1000;
				if (payload.ValueKind != JsonValueKind.Undefined
					&& payload.TryGetProperty("items", out var itemsEl)
					&& itemsEl.ValueKind == JsonValueKind.Array)
				{
					foreach (var item in itemsEl.EnumerateArray())
					{
						var isSep = item.TryGetProperty("separator", out var sep) && sep.ValueKind == JsonValueKind.True;
						if (isSep)
						{
							AppendMenu(hMenu, MF_SEPARATOR, 0, string.Empty);
							continue;
						}
						var label = item.TryGetProperty("label", out var lbl) ? lbl.GetString() ?? "" : "";
						if (string.IsNullOrWhiteSpace(label)) continue;
						var itemId = item.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
						var disabled = item.TryGetProperty("disabled", out var dis) && dis.ValueKind == JsonValueKind.True;
						var cmd = nextCmd++;
						if (!string.IsNullOrEmpty(itemId))
							idByCmd[cmd] = itemId!;
						var flags = disabled ? MF_STRING | MF_GRAYED : MF_STRING;
						AppendMenu(hMenu, flags, (nuint)cmd, label);
					}
				}

				if (idByCmd.Count == 0)
				{
					PostJsonRaw(HostMenuResultJson(requestId, null));
					return;
				}

				// Prefer live cursor — right-click just happened; CSS→screen mapping is DPI-fragile.
				if (!GetCursorPos(out var pt))
				{
					var clientX = payload.ValueKind != JsonValueKind.Undefined
						&& payload.TryGetProperty("clientX", out var cx) && cx.ValueKind == JsonValueKind.Number
						? (int)Math.Round(cx.GetDouble()) : 0;
					var clientY = payload.ValueKind != JsonValueKind.Undefined
						&& payload.TryGetProperty("clientY", out var cy) && cy.ValueKind == JsonValueKind.Number
						? (int)Math.Round(cy.GetDouble()) : 0;
					pt = new POINT { X = clientX, Y = clientY };
					ClientToScreen(hwnd, ref pt);
				}

				SetForegroundWindow(hwnd);
				// TPM_RETURNCMD | TPM_RIGHTBUTTON | TPM_LEFTALIGN
				var selected = (int)TrackPopupMenu(
					hMenu,
					TPM_LEFTALIGN | TPM_RIGHTBUTTON | TPM_RETURNCMD,
					pt.X,
					pt.Y,
					0,
					hwnd,
					IntPtr.Zero);
				// Required so the next click is not swallowed after TrackPopupMenu.
				PostMessage(hwnd, WM_NULL, IntPtr.Zero, IntPtr.Zero);

				string? chosen = null;
				if (selected != 0 && idByCmd.TryGetValue(selected, out var mapped))
					chosen = mapped;
				PostJsonRaw(HostMenuResultJson(requestId, chosen));
			}
			finally
			{
				DestroyMenu(hMenu);
			}
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[CraftPaneHost] SHOW_HOST_CONTEXT_MENU: {ex.Message}");
			PostJsonRaw(HostMenuResultJson(requestId, null));
		}
	}

	private static string HostMenuResultJson(string? requestId, string? chosen) =>
		JsonSerializer.Serialize(new { type = "HOST_CONTEXT_MENU_RESULT", id = requestId, payload = chosen });

	private const uint MF_STRING = 0x0000;
	private const uint MF_GRAYED = 0x0001;
	private const uint MF_SEPARATOR = 0x0800;
	private const uint TPM_LEFTALIGN = 0x0000;
	private const uint TPM_RIGHTBUTTON = 0x0002;
	private const uint TPM_RETURNCMD = 0x0100;
	private const uint WM_NULL = 0x0000;

	[StructLayout(LayoutKind.Sequential)]
	private struct POINT { public int X; public int Y; }

	[DllImport("user32.dll")]
	private static extern bool GetCursorPos(out POINT lpPoint);

	[DllImport("user32.dll")]
	private static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

	[DllImport("user32.dll")]
	private static extern bool SetForegroundWindow(IntPtr hWnd);

	[DllImport("user32.dll")]
	private static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);

	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	private static extern IntPtr CreatePopupMenu();

	[DllImport("user32.dll", CharSet = CharSet.Unicode)]
	private static extern bool AppendMenu(IntPtr hMenu, uint uFlags, nuint uIDNewItem, string lpNewItem);

	[DllImport("user32.dll")]
	private static extern bool DestroyMenu(IntPtr hMenu);

	[DllImport("user32.dll")]
	private static extern nint TrackPopupMenu(IntPtr hMenu, uint uFlags, int x, int y, int nReserved, IntPtr hWnd, IntPtr prcRect);

	public event EventHandler<JsonElement>? PaneMessage;

	private static async Task ForwardUiReadyToBackendAsync(string raw)
	{
		try
		{
			using var _ = await BndzInProcessClient.InvokeAsyncFromRawJsonAsync(raw).ConfigureAwait(false);
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[CraftPaneHost] BNDZ_UI_READY forward: {ex.Message}");
		}
	}

	internal static string? ResolveUiAssetsRoot()
	{
		var baseDir = AppContext.BaseDirectory;
		var candidates = new List<string>
		{
			System.IO.Path.GetFullPath(System.IO.Path.Combine(baseDir, "Assets", "ui")),
			System.IO.Path.GetFullPath(System.IO.Path.Combine(baseDir, "bndz-host", "Assets", "ui")),
			System.IO.Path.GetFullPath(System.IO.Path.Combine(baseDir, "BNDZAssets", "ui")),
			System.IO.Path.GetFullPath(System.IO.Path.Combine(Environment.CurrentDirectory, "BNDZBackend", "Assets", "ui")),
			System.IO.Path.GetFullPath(System.IO.Path.Combine(Environment.CurrentDirectory, "Assets", "ui")),
		};

		// Walk up from the exe looking for the repo's live Vite output so a fresh
		// `npm run build` is visible without requiring a locked shell rebuild.
		try
		{
			var dir = new DirectoryInfo(baseDir);
			for (var i = 0; i < 10 && dir is not null; i++, dir = dir.Parent)
			{
				candidates.Add(System.IO.Path.Combine(dir.FullName, "BNDZBackend", "Assets", "ui"));
				candidates.Add(System.IO.Path.Combine(dir.FullName, "Assets", "ui"));
			}
		}
		catch { /* ignore */ }

		string? best = null;
		DateTime bestStamp = DateTime.MinValue;
		foreach (var c in candidates.Distinct(StringComparer.OrdinalIgnoreCase))
		{
			var index = System.IO.Path.Combine(c, "index.html");
			if (!System.IO.File.Exists(index)) continue;
			DateTime stamp;
			try { stamp = System.IO.File.GetLastWriteTimeUtc(index); }
			catch { continue; }
			if (best is null || stamp > bestStamp)
			{
				best = c;
				bestStamp = stamp;
			}
		}
		return best;
	}
}

