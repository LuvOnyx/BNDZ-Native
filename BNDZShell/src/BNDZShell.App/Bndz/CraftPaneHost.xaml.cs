// Copyright (c) BNDZ — FilesMerge hosted React pane (architecture #3).
// Files Community portions remain MIT (see LICENSE-MIT).

using System.Diagnostics;
using System.Text.Json;
using BNDZ.Services;
using BNDZShell.Bndz;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
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
	private string? _uiRoot;
	private string? _navigatedPane;
	private CoreWebView2Environment? _webEnv;
	private string? _pendingContextJson;
	private string? _pendingListingJson;
	/// <summary>Pre-ready push fan-out queue — earlier messages must not be overwritten.</summary>
	private readonly List<string> _pendingPushQueue = new();
	/// <summary>Last DIR listing JSON — re-posted on BNDZ_UI_READY because early PostWebMessage drops if React has not subscribed yet.</summary>
	private string? _lastListingJson;
	private Action<string>? _pushHandler;

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

	public CraftPaneHost()
	{
		InitializeComponent();
		Unloaded += (_, _) =>
		{
			if (_pushHandler != null)
			{
				BndzEmbeddedBackendHost.UnregisterPushTarget(_pushHandler);
				_pushHandler = null;
			}
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
			if (showHint)
			{
				PaneStatusHint.Visibility = Visibility.Visible;
				PaneStatusHint.Text = "Loading BNDZ pane…";
			}

			_uiRoot = ResolveUiAssetsRoot();
			if (_uiRoot is null)
			{
				PaneStatusHint.Visibility = Visibility.Visible;
				PaneStatusHint.Text = "BNDZ UI assets missing — run npm run build and stage Assets/ui.";
				_initStarted = false;
				return;
			}

			_webEnv = await GetSharedPaneEnvironmentAsync().ConfigureAwait(true);
			try
			{
				await PaneWebView.EnsureCoreWebView2Async(_webEnv);
			}
			catch (Exception envEx)
			{
				Debug.WriteLine($"[CraftPaneHost] profile env failed ({envEx.Message}), using default runtime");
				await PaneWebView.EnsureCoreWebView2Async();
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
			// Let WinUI ExtendsContentIntoTitleBar caption buttons receive clicks over WebView2.
			try { core.Settings.IsNonClientRegionSupportEnabled = true; }
			catch (Exception ncEx) { Debug.WriteLine($"[CraftPaneHost] IsNonClientRegionSupportEnabled: {ncEx.Message}"); }
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
			core.WebResourceRequested += Core_WebResourceRequested;

			core.WebMessageReceived += Core_WebMessageReceived;
			core.NavigationCompleted += Core_NavigationCompleted;
			_initialized = true;
			WebViewInitialized?.Invoke(this, EventArgs.Empty);
			ApplyPaneRoute(forceNavigate: true);
		}
		catch (Exception ex)
		{
			PaneStatusHint.Visibility = Visibility.Visible;
			PaneStatusHint.Text = $"Pane host failed: {FormatInitException(ex)}";
			Debug.WriteLine($"[CraftPaneHost] init failed: {ex}");
			_initStarted = false;
		}
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

			var options = new CoreWebView2EnvironmentOptions
			{
				AdditionalBrowserArguments =
					"--enable-gpu --enable-gpu-rasterization --enable-gpu-compositing --enable-zero-copy " +
					"--enable-features=CanvasOopRasterization " +
					"--disable-features=CalculateNativeWinOcclusion " +
					"--disable-frame-rate-limit --disable-smooth-scrolling --ignore-gpu-blocklist",
			};
			options.CustomSchemeRegistrations.Add(streamScheme);

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

	private void Core_WebResourceRequested(CoreWebView2 sender, CoreWebView2WebResourceRequestedEventArgs e)
	{
		try
		{
			var uri = e.Request.Uri;
			if (!BndzLocalStreamService.IsStreamRequest(uri))
				return;
			if (_webEnv is null)
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
		// Do not mark ready / flush listings here — React message listeners attach after first paint.
		// BNDZ_UI_READY owns document-ready + flush so DIR listings are not dropped.
		if (args.IsSuccess)
		{
			PaneStatusHint.Visibility = Visibility.Collapsed;
			return;
		}

		PaneStatusHint.Visibility = Visibility.Visible;
		PaneStatusHint.Text = $"WebView navigation failed ({args.WebErrorStatus}). Close other BNDZShell windows and relaunch.";
		Debug.WriteLine($"[CraftPaneHost] NavigationCompleted failed: {args.WebErrorStatus}");
	}

	private void ApplyPaneRoute(bool forceNavigate)
	{
		if (!_initialized || PaneWebView.CoreWebView2 is null)
			return;

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

	public void PostHostMessageRaw(string json)
	{
		if (json.Contains("\"BNDZ_DIR_LISTING\"", StringComparison.Ordinal))
		{
			_lastListingJson = json;
			_pendingListingJson = json;
		}
		// Queue until React signals BNDZ_UI_READY — NavigationCompleted alone is too early (listeners not attached).
		if (!_documentReady || PaneWebView.CoreWebView2 is null)
		{
			if (json.Contains("\"BNDZ_PANE_CONTEXT\"", StringComparison.Ordinal))
				_pendingContextJson = json;
			else if (!json.Contains("\"BNDZ_DIR_LISTING\"", StringComparison.Ordinal))
			{
				_pendingPushQueue.Add(json);
				// Cap so a stuck WebView cannot grow unbounded.
				while (_pendingPushQueue.Count > 32)
					_pendingPushQueue.RemoveAt(0);
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
			if (type is "BNDZ_PANE_TOOL" or "BNDZ_PANE_NAVIGATE" or "BNDZ_PANE_SWITCH" or "BNDZ_REQUEST_DIR_LISTING" or "BNDZ_NATIVE_LIST_BOUNDS" or "WINDOW_CHROME" or "GET_WINDOW_STATE")
			{
				PaneMessage?.Invoke(this, root.Clone());
				return;
			}
			// React painted — hide any residual host spinner and flush queued selection.
			if (type is "BNDZ_UI_READY")
			{
				PaneStatusHint.Visibility = Visibility.Collapsed;
				_documentReady = true;
				FlushPendingContext();
				PaneMessage?.Invoke(this, root.Clone());
				// Forward to headless backend so PushDrivesUpdate / warm paths run (not pane-local only).
				_ = ForwardUiReadyToBackendAsync(raw);
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
		var candidates = new[]
		{
			System.IO.Path.GetFullPath(System.IO.Path.Combine(baseDir, "Assets", "ui")),
			System.IO.Path.GetFullPath(System.IO.Path.Combine(baseDir, "bndz-host", "Assets", "ui")),
			System.IO.Path.GetFullPath(System.IO.Path.Combine(baseDir, "BNDZAssets", "ui")),
			System.IO.Path.GetFullPath(System.IO.Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "BNDZBackend", "Assets", "ui")),
			System.IO.Path.GetFullPath(System.IO.Path.Combine(Environment.CurrentDirectory, "BNDZBackend", "Assets", "ui")),
		};
		foreach (var c in candidates)
		{
			if (System.IO.Directory.Exists(c) && System.IO.File.Exists(System.IO.Path.Combine(c, "index.html")))
				return c;
		}
		return null;
	}
}

