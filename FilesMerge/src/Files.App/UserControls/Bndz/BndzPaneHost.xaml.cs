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
	private string? _uiRoot;

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
			_ = host.NavigatePaneAsync();
	}

	private async void PaneWebView_Loaded(object sender, RoutedEventArgs e)
	{
		if (_initialized)
			return;

		try
		{
			PaneStatusHint.Visibility = Visibility.Visible;
			PaneStatusHint.Text = "Loading BNDZ pane…";

			_uiRoot = ResolveUiAssetsRoot();
			if (_uiRoot is null)
			{
				PaneStatusHint.Text = "BNDZ UI assets missing — run npm run build and stage Assets/ui.";
				return;
			}

			await PaneWebView.EnsureCoreWebView2Async();
			var core = PaneWebView.CoreWebView2;
			core.Settings.AreDefaultContextMenusEnabled = false;
			core.Settings.IsStatusBarEnabled = false;
			core.Settings.AreDevToolsEnabled = Debugger.IsAttached;

			core.SetVirtualHostNameToFolderMapping(
				"bndz.local",
				_uiRoot,
				CoreWebView2HostResourceAccessKind.Allow);

			core.WebMessageReceived += Core_WebMessageReceived;
			_initialized = true;
			await NavigatePaneAsync();
			PaneStatusHint.Visibility = Visibility.Collapsed;
		}
		catch (Exception ex)
		{
			PaneStatusHint.Visibility = Visibility.Visible;
			PaneStatusHint.Text = $"Pane host failed: {ex.Message}";
			Debug.WriteLine($"[BndzPaneHost] init failed: {ex}");
		}
	}

	private async Task NavigatePaneAsync()
	{
		if (!_initialized || PaneWebView.CoreWebView2 is null)
			return;

		var pane = string.IsNullOrWhiteSpace(Pane) ? "plugins" : Pane.Trim().ToLowerInvariant();
		var qs = $"pane={Uri.EscapeDataString(pane)}&t={DateTime.UtcNow.Ticks}";
		if (!string.IsNullOrWhiteSpace(PluginId))
			qs += $"&plugin={Uri.EscapeDataString(PluginId)}";

		PaneWebView.CoreWebView2.Navigate($"http://bndz.local/index.html?{qs}");
		await Task.CompletedTask;
	}

	/// <summary>Push Files list selection / cwd into the React pane.</summary>
	public void PostPaneContext(string? path, IReadOnlyList<string>? selectedPaths = null, IReadOnlyList<string>? selectedNames = null, IReadOnlyList<string>? selectedTypes = null)
	{
		if (PaneWebView.CoreWebView2 is null)
			return;

		var payload = new
		{
			type = "BNDZ_PANE_CONTEXT",
			payload = new
			{
				path,
				selectedPaths,
				selectedNames,
				selectedTypes,
			},
		};
		try
		{
			PaneWebView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(payload));
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[BndzPaneHost] PostPaneContext: {ex.Message}");
		}
	}

	public void SwitchPane(string pane, string? plugin = null)
	{
		Pane = pane;
		if (plugin is not null)
			PluginId = plugin;
		_ = NavigatePaneAsync();
	}

	private async void Core_WebMessageReceived(CoreWebView2 sender, CoreWebView2WebMessageReceivedEventArgs args)
	{
		string raw;
		try { raw = args.WebMessageAsJson; }
		catch { return; }

		if (string.IsNullOrWhiteSpace(raw))
			return;

		// Pane-local control messages stay in Files (no backend round-trip).
		try
		{
			using var doc = JsonDocument.Parse(raw);
			var root = doc.RootElement;
			var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
			if (type is "BNDZ_PANE_TOOL" or "BNDZ_PANE_NAVIGATE" or "BNDZ_PANE_SWITCH")
			{
				PaneMessage?.Invoke(this, root);
				return;
			}
		}
		catch { /* fall through to backend bridge */ }

		try
		{
			// Bridge WebView envelope → backend host pipe → PostWebMessage response
			using var response = await BndzBackendClient.InvokeAsyncFromRawJsonAsync(raw).ConfigureAwait(true);
			if (response is null)
				return;
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
					payload = new { error = ex.Message },
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
			Path.GetFullPath(Path.Combine(baseDir, "Assets", "ui")),
			Path.GetFullPath(Path.Combine(baseDir, "BNDZAssets", "ui")),
			Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "BNDZBackend", "Assets", "ui")),
			Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "BNDZBackend", "Assets", "ui")),
		};
		foreach (var c in candidates)
		{
			if (Directory.Exists(c) && File.Exists(Path.Combine(c, "index.html")))
				return c;
		}
		return null;
	}
}
