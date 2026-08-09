// Copyright (c) BNDZ — FilesMerge hosted React pane (architecture #3).
// Files Community portions remain MIT (see LICENSE-MIT).

using System.Diagnostics;
using System.Text.Json;
using Files.App.Utils.Bndz;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.Web.WebView2.Core;

namespace Files.App.UserControls.Bndz;

/// <summary>
/// Hosts a BNDZ React pane (<c>?pane=…</c>) inside FilesMerge.
/// WebView2 postMessage is bridged to <c>BNDZ.exe --backend-host</c> via named pipe.
/// After first navigation, pane switches soft-route via <c>BNDZ_PANE_SWITCH</c> (no reload).
/// </summary>
public sealed partial class BndzPaneHost : UserControl
{
	public static readonly DependencyProperty PaneProperty =
		DependencyProperty.Register(nameof(Pane), typeof(string), typeof(BndzPaneHost),
			new PropertyMetadata("plugins", OnPaneChanged));

	public static readonly DependencyProperty PluginIdProperty =
		DependencyProperty.Register(nameof(PluginId), typeof(string), typeof(BndzPaneHost),
			new PropertyMetadata(null));

	private bool _initialized;
	private bool _documentReady;
	private bool _initStarted;
	private string? _uiRoot;
	private string? _navigatedPane;
	private CoreWebView2Environment? _webEnv;
	private string? _pendingContextJson;
	private string? _pendingListingJson;
	/// <summary>Last DIR listing JSON — re-posted on BNDZ_UI_READY because early PostWebMessage drops if React has not subscribed yet.</summary>
	private string? _lastListingJson;

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

	public BndzPaneHost()
	{
		InitializeComponent();
	}

	private static void OnPaneChanged(DependencyObject d, DependencyPropertyChangedEventArgs e)
	{
		if (d is BndzPaneHost host && host._initialized)
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
				return;
			}

			_webEnv = await GetSharedPaneEnvironmentAsync().ConfigureAwait(true);
			await PaneWebView.EnsureCoreWebView2Async(_webEnv);
			var core = PaneWebView.CoreWebView2;
			core.Settings.AreDefaultContextMenusEnabled = false;
			core.Settings.IsStatusBarEnabled = false;
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
			ApplyPaneRoute(forceNavigate: true);
		}
		catch (Exception ex)
		{
			PaneStatusHint.Visibility = Visibility.Visible;
			PaneStatusHint.Text = $"Pane host failed: {ex.Message}";
			Debug.WriteLine($"[BndzPaneHost] init failed: {ex}");
			_initStarted = false;
		}
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

			var streamScheme = new CoreWebView2CustomSchemeRegistration(BndzLocalStreamService.CustomScheme);
			// WinRT projection types TreatAsSecure as int (not bool).
			streamScheme.TreatAsSecure = 1;
			streamScheme.HasAuthorityComponent = true;
			streamScheme.AllowedOrigins.Add("http://bndz.local");
			streamScheme.AllowedOrigins.Add("https://bndz.local");

			var options = new CoreWebView2EnvironmentOptions
			{
				AdditionalBrowserArguments =
					"--enable-gpu --enable-gpu-rasterization --enable-gpu-compositing " +
					"--disable-features=CalculateNativeWinOcclusion",
			};
			options.CustomSchemeRegistrations.Add(streamScheme);

			var profileDir = SystemIO.Path.Combine(
				Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
				"BNDZ", "WebView2", "FilesPane");
			SystemIO.Directory.CreateDirectory(profileDir);

			// WinUI projection: CreateWithOptionsAsync (not WPF CreateAsync overload).
			s_sharedPaneEnv = await CoreWebView2Environment.CreateWithOptionsAsync(null, profileDir, options).AsTask().ConfigureAwait(false);
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
			Debug.WriteLine($"[BndzPaneHost] stream: {ex.Message}");
		}
	}

	private void Core_NavigationCompleted(CoreWebView2 sender, CoreWebView2NavigationCompletedEventArgs args)
	{
		// Do not mark ready / flush listings here — React message listeners attach after first paint.
		// BNDZ_UI_READY owns document-ready + flush so DIR listings are not dropped.
		if (args.IsSuccess)
			PaneStatusHint.Visibility = Visibility.Collapsed;
	}

	private void ApplyPaneRoute(bool forceNavigate)
	{
		if (!_initialized || PaneWebView.CoreWebView2 is null)
			return;

		var pane = string.IsNullOrWhiteSpace(Pane) ? "plugins" : Pane.Trim().ToLowerInvariant();

		// Full classic BNDZUI browser (tree + list + preview + plugins) for FilesMerge shell.
		if (pane is "browser" or "files-host" or "fileshost")
		{
			if (!forceNavigate && _documentReady && string.Equals(_navigatedPane, "browser", StringComparison.OrdinalIgnoreCase))
			{
				PaneStatusHint.Visibility = Visibility.Collapsed;
				return;
			}

			_navigatedPane = "browser";
			_documentReady = false;
			PaneStatusHint.Visibility = Visibility.Visible;
			PaneStatusHint.Text = "Loading BNDZ…";
			PaneWebView.CoreWebView2.Navigate("http://bndz.local/index.html?filesHost=1");
			return;
		}

		// Soft-route: keep warm React document, switch shell in-place (instant).
		if (!forceNavigate && _documentReady && !string.IsNullOrEmpty(_navigatedPane)
			&& !string.Equals(_navigatedPane, "browser", StringComparison.OrdinalIgnoreCase))
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

		// First load only — no cache-busting ticks (that forced full rehydrate every open).
		var qs = $"pane={Uri.EscapeDataString(pane)}";
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
		var json = JsonSerializer.Serialize(payload);
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
				_pendingListingJson = json;
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
			Debug.WriteLine($"[BndzPaneHost] PostJson: {ex.Message}");
		}
	}

	private async void Core_WebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
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
			if (type is "BNDZ_PANE_TOOL" or "BNDZ_PANE_NAVIGATE" or "BNDZ_PANE_SWITCH" or "BNDZ_REQUEST_DIR_LISTING")
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
				return;
			}
		}
		catch { /* fall through to backend bridge */ }

		try
		{
			using var response = await BndzBackendClient.InvokeAsyncFromRawJsonAsync(raw).ConfigureAwait(true);
			if (response is null)
			{
				sender.PostWebMessageAsJson(JsonSerializer.Serialize(new
				{
					type = "ERROR",
					id = requestId,
					payload = new { error = "Empty backend host response", requestType },
				}));
				return;
			}
			sender.PostWebMessageAsJson(response.RootElement.GetRawText());
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[BndzPaneHost] IPC bridge: {ex.Message}");
			try
			{
				sender.PostWebMessageAsJson(JsonSerializer.Serialize(new
				{
					type = "ERROR",
					id = requestId,
					payload = new { error = ex.Message, requestType },
				}));
			}
			catch { }
		}
	}

	public event EventHandler<JsonElement>? PaneMessage;

	internal static string? ResolveUiAssetsRoot()
	{
		var baseDir = AppContext.BaseDirectory;
		var candidates = new[]
		{
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "Assets", "ui")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "bndz-host", "Assets", "ui")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "BNDZAssets", "ui")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "BNDZBackend", "Assets", "ui")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(Environment.CurrentDirectory, "BNDZBackend", "Assets", "ui")),
		};
		foreach (var c in candidates)
		{
			if (SystemIO.Directory.Exists(c) && SystemIO.File.Exists(SystemIO.Path.Combine(c, "index.html")))
				return c;
		}
		return null;
	}
}
