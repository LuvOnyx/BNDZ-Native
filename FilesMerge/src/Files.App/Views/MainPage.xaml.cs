// Copyright (c) Files Community
// Licensed under the MIT License.

using CommunityToolkit.WinUI;
using Files.App.Controls;
using Files.App.Services.PreviewPopupProviders;
using Files.App.UserControls.Bndz;
using Files.App.Utils.Bndz;
using Microsoft.Extensions.Logging;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Navigation;
using System.Runtime.InteropServices;
using Windows.Foundation.Metadata;
using Windows.Graphics;
using Windows.UI.Input;
using WinUIEx;
using GridSplitter = Files.App.Controls.GridSplitter;
using VirtualKey = Windows.System.VirtualKey;

namespace Files.App.Views
{
	public sealed partial class MainPage : Page
	{
		private IGeneralSettingsService generalSettingsService { get; } = Ioc.Default.GetRequiredService<IGeneralSettingsService>();
		private readonly IContentPageContext ContentPageContext = Ioc.Default.GetRequiredService<IContentPageContext>();
		public IUserSettingsService UserSettingsService { get; }
		private readonly IWindowContext WindowContext = Ioc.Default.GetRequiredService<IWindowContext>();
		private readonly ICommandManager Commands = Ioc.Default.GetRequiredService<ICommandManager>();
		public SidebarViewModel SidebarAdaptiveViewModel { get; }
		public MainPageViewModel ViewModel { get; }

		private bool keyReleased = true;

		private DispatcherQueueTimer _updateDateDisplayTimer;

		private readonly Dictionary<TabBarItem, double> _sidebarScrollByTab = new();
		private TabBarItem? _previousSidebarTab;

		public MainPage()
		{
			InitializeComponent();

			// Dependency Injection
			UserSettingsService = Ioc.Default.GetRequiredService<IUserSettingsService>();
			SidebarAdaptiveViewModel = Ioc.Default.GetRequiredService<SidebarViewModel>();
			SidebarAdaptiveViewModel.PaneFlyout = (MenuFlyout)Resources["SidebarContextMenu"];
			ViewModel = Ioc.Default.GetRequiredService<MainPageViewModel>();

			if (AppLanguageHelper.IsPreferredLanguageRtl)
			{
				MainWindow.Instance.SetExtendedWindowStyle(ExtendedWindowStyle.LayoutRtl);
				FlowDirection = FlowDirection.RightToLeft;
			}

			ViewModel.PropertyChanged += ViewModel_PropertyChanged;
			UserSettingsService.OnSettingChangedEvent += UserSettingsService_OnSettingChangedEvent;
			ContentPageContext.PropertyChanged += ContentPageContext_PropertyChanged;

			_updateDateDisplayTimer = DispatcherQueue.CreateTimer();
			_updateDateDisplayTimer.Interval = TimeSpan.FromSeconds(1);
			_updateDateDisplayTimer.Tick += UpdateDateDisplayTimer_Tick;

			ApplySidebarWidthState();

			BndzBackendHostService.Instance.StatusChanged += BndzBackendHostService_StatusChanged;
			ApplyBndzBackendStatus(BndzBackendHostService.Instance.Status);
			BndzPreviewPopupProvider.PreviewRequested += BndzPreviewPopupProvider_PreviewRequested;
		}

		private void BndzPreviewPopupProvider_PreviewRequested(string path, bool open)
		{
			DispatcherQueue.TryEnqueue(() =>
			{
				try
				{
					if (open && !_bndzPreviewOpen)
						SetBndzPreviewOpen(true);
					var preview = EnsurePreviewPaneHost();
					preview?.PostHostMessage(new
					{
						type = "BNDZ_QUICK_PREVIEW",
						payload = new { path, open },
					});
					PushSelectionToBndzPanes();
				}
				catch (Exception ex)
				{
					App.Logger.LogDebug(ex, "BNDZ quick preview post failed");
				}
			});
		}

		private void BndzBackendHostService_StatusChanged(object? sender, BndzBackendStatus status)
		{
			DispatcherQueue.TryEnqueue(() => ApplyBndzBackendStatus(status));
		}

		private void ApplyBndzBackendStatus(BndzBackendStatus status)
		{
			var label = status.State switch
			{
				BndzBackendConnectionState.Connected => status.IndexedFileCount is long n && n > 0
					? $"BNDZ · {n:N0}"
					: "BNDZ · live",
				BndzBackendConnectionState.Starting => "BNDZ · starting",
				BndzBackendConnectionState.Degraded => "BNDZ · degraded",
				_ => "BNDZ · offline",
			};
			var tip = status.Label;
			if (!string.IsNullOrEmpty(status.Detail))
				tip = $"{tip} — {status.Detail}";
			if (status.ProcessId is int pid)
				tip = $"{tip} · PID {pid}";

			if (BndzBackendStatusText is not null)
			{
				BndzBackendStatusText.Text = label;
				ToolTipService.SetToolTip(BndzBackendStatusText, tip);
			}
			if (BndzBackendStatusChip is not null)
				ToolTipService.SetToolTip(BndzBackendStatusChip, tip);
			if (BndzBackendStatusTextOverlay is not null)
				BndzBackendStatusTextOverlay.Text = label;
			if (BndzBackendStatusChipOverlay is not null)
				ToolTipService.SetToolTip(BndzBackendStatusChipOverlay, tip);
		}

		private bool _bndzPluginsDockOpen = false;
		private bool _bndzPreviewOpen = false;
		private string? _bndzWorkspacePane;
		private double _bndzDockHeight = 280;
		private bool _bndzNavigatingFromReact;
		private string? _lastPushedBrowserPath;
		private DispatcherQueueTimer? _bndzContextDebounceTimer;
		private int _bndzNavigateGeneration;

		private void EnsureBndzPaneEventsWired()
		{
			// Idempotent: hosts may materialize later via x:Load / FindName.
			if (BndzBrowserHost is not null)
			{
				BndzBrowserHost.PaneMessage -= BndzPaneHost_PaneMessage;
				BndzBrowserHost.PaneMessage += BndzPaneHost_PaneMessage;
			}
			if (BndzPluginsDockHost is not null)
			{
				BndzPluginsDockHost.PaneMessage -= BndzPaneHost_PaneMessage;
				BndzPluginsDockHost.PaneMessage += BndzPaneHost_PaneMessage;
			}
			if (BndzWorkspacePaneHost is not null)
			{
				BndzWorkspacePaneHost.PaneMessage -= BndzPaneHost_PaneMessage;
				BndzWorkspacePaneHost.PaneMessage += BndzPaneHost_PaneMessage;
			}
			if (BndzPreviewPaneHost is not null)
			{
				BndzPreviewPaneHost.PaneMessage -= BndzPaneHost_PaneMessage;
				BndzPreviewPaneHost.PaneMessage += BndzPaneHost_PaneMessage;
			}
		}

		private BndzPaneHost? EnsureBrowserHost()
		{
			if (BndzBrowserHost is null)
				FindName(nameof(BndzBrowserHost));
			EnsureBndzPaneEventsWired();
			return BndzBrowserHost;
		}

		private BndzPaneHost? EnsurePluginsDockHost()
		{
			if (BndzPluginsDockHost is null)
				FindName(nameof(BndzPluginsDockHost));
			EnsureBndzPaneEventsWired();
			return BndzPluginsDockHost;
		}

		private BndzPaneHost? EnsurePreviewPaneHost()
		{
			if (BndzPreviewPaneHost is null)
				FindName(nameof(BndzPreviewPaneHost));
			EnsureBndzPaneEventsWired();
			return BndzPreviewPaneHost;
		}

		private BndzPaneHost? EnsureWorkspacePaneHost()
		{
			if (BndzWorkspacePaneHost is null)
				FindName(nameof(BndzWorkspacePaneHost));
			EnsureBndzPaneEventsWired();
			return BndzWorkspacePaneHost;
		}

		private void BndzMenu_TogglePlugins_Click(object sender, RoutedEventArgs e) => TogglePluginsDock();
		private void BndzMenu_TogglePreview_Click(object sender, RoutedEventArgs e)
		{
			SetBndzPreviewOpen(!_bndzPreviewOpen);
			UpdatePositioning();
			PushSelectionToBndzPanes();
		}
		private void BndzMenu_OpenHub_Click(object sender, RoutedEventArgs e) => ToggleWorkspacePane("marketplace");
		private void BndzMenu_OpenConfig_Click(object sender, RoutedEventArgs e) => ToggleWorkspacePane("settings");
		private void BndzMenu_SmartTools_Click(object sender, RoutedEventArgs e) => ToggleWorkspacePane("smart-tools");
		private void BndzMenu_Automation_Click(object sender, RoutedEventArgs e) => ToggleWorkspacePane("automation");
		private void BndzMenu_Spatial_Click(object sender, RoutedEventArgs e) => ToggleWorkspacePane("canvas");

		private void ApplyBndzSurfaceDefaults()
		{
			// Planned blend: Files engines enumerate; BNDZUI paints the product face.
			BndzShellOwnership.BrowserOwnsFileViewport = false;
			BndzShellOwnership.BndzUiFaceActive = true;
			_bndzDockHeight = GetPluginsDockHeight();
			// Plugins / preview live inside BNDZUI — no second WinUI dock + duplicate chips.
			_bndzPluginsDockOpen = false;
			_bndzPreviewOpen = false;
			ApplyPluginsDockHeight(false);

			try
			{
				UserSettingsService.InfoPaneSettingsService.IsInfoPaneEnabled = false;
				ViewModel.ShouldPreviewPaneBeDisplayed = false;
				ViewModel.ShouldPreviewPaneBeActive = false;
				UserSettingsService.ApplicationSettingsService.HasClickedReviewPrompt = true;
				UserSettingsService.ApplicationSettingsService.HasClickedSponsorPrompt = true;
			}
			catch { /* best-effort */ }

			try
			{
				if (BndzMenuBar is not null)
					BndzMenuBar.Visibility = Visibility.Collapsed;
				if (BndzAddressChromeRow is not null)
					BndzAddressChromeRow.Visibility = Visibility.Collapsed;
				if (SidebarControl is not null)
					SidebarControl.Visibility = Visibility.Collapsed;
				if (InfoPane is not null)
					InfoPane.Visibility = Visibility.Collapsed;
				if (TabControl is not null)
					TabControl.Visibility = Visibility.Collapsed;
				if (InnerNavigationToolbar is not null)
					InnerNavigationToolbar.Visibility = Visibility.Collapsed;
				if (NavToolbar is not null)
					NavToolbar.Visibility = Visibility.Collapsed;
				if (BndzPluginsDockHost is not null)
					BndzPluginsDockHost.Visibility = Visibility.Collapsed;
				if (BndzPreviewPaneHost is not null)
					BndzPreviewPaneHost.Visibility = Visibility.Collapsed;
				// Kill the duplicate floating "BNDZ bars" — status lives in BNDZUI.
				if (BndzBackendStatusChipOverlay is not null)
					BndzBackendStatusChipOverlay.Visibility = Visibility.Collapsed;
				if (BndzBackendStatusChip is not null)
					BndzBackendStatusChip.Visibility = Visibility.Collapsed;
			}
			catch { /* best-effort */ }

			UpdatePositioning();

			DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Normal, async () =>
			{
				try
				{
					try
					{
						await BndzBackendHostService.Instance.EnsureStartedAsync().ConfigureAwait(true);
					}
					catch (Exception ex)
					{
						App.Logger.LogWarning(ex, "BNDZ backend not ready before browser prewarm");
					}

					var browser = EnsureBrowserHost();
					if (browser is not null)
					{
						browser.Visibility = Visibility.Visible;
						browser.SwitchPane("browser");
						browser.Prewarm();
					}
					WireShellListingPush();
					UpdatePositioning();
					PushSelectionToBndzPanes();
					PushDirListingToBndzUi();
					MainWindow.Instance.RaiseSetTitleBarDragRegion(SetTitleBarDragRegion);
				}
				catch (Exception ex)
				{
					App.Logger.LogWarning(ex, "Deferred BNDZ blend face failed");
				}
			});
		}

		private void SyncBndzToggleChrome()
		{
			// Omnibar strip removed — pane access is via status-chip flyout / dock.
		}

		private void BndzBackendStatusChip_Tapped(object sender, TappedRoutedEventArgs e)
		{
			var flyout = new MenuFlyout();
			AddBndzFlyoutItem(flyout, _bndzPluginsDockOpen ? "Hide plugins panel" : "Show plugins panel", TogglePluginsDock);
			AddBndzFlyoutItem(flyout, _bndzPreviewOpen ? "Hide BNDZ preview" : "Show BNDZ preview", () =>
			{
				SetBndzPreviewOpen(!_bndzPreviewOpen);
				PushSelectionToBndzPanes();
			});
			flyout.Items.Add(new MenuFlyoutSeparator());
			AddBndzFlyoutItem(flyout, "Smart Tools", () => ToggleWorkspacePane("smart-tools"));
			AddBndzFlyoutItem(flyout, "Automation", () => ToggleWorkspacePane("automation"));
			AddBndzFlyoutItem(flyout, "Spatial Canvas", () => ToggleWorkspacePane("canvas"));
			AddBndzFlyoutItem(flyout, "Extension Hub", () => ToggleWorkspacePane("marketplace"));
			AddBndzFlyoutItem(flyout, "BNDZ Configuration…", () => ToggleWorkspacePane("settings"));
			flyout.ShowAt(BndzBackendStatusChip);
		}

		private static void AddBndzFlyoutItem(MenuFlyout flyout, string text, Action action)
		{
			var item = new MenuFlyoutItem { Text = text };
			item.Click += (_, _) => action();
			flyout.Items.Add(item);
		}

		private void TogglePluginsDock()
		{
			_bndzPluginsDockOpen = !_bndzPluginsDockOpen;
			var plugins = EnsurePluginsDockHost();
			if (plugins is not null)
				plugins.Visibility = _bndzPluginsDockOpen ? Visibility.Visible : Visibility.Collapsed;
			ApplyPluginsDockHeight(_bndzPluginsDockOpen);
			if (_bndzPluginsDockOpen)
				plugins?.Prewarm();
			PushSelectionToBndzPanes();
		}

		private void BndzPaneHost_PaneMessage(object? sender, System.Text.Json.JsonElement root)
		{
			try
			{
				var type = root.TryGetProperty("type", out var t) ? t.GetString() : null;
				if (type is null)
					return;

				System.Text.Json.JsonElement payload = default;
				var hasPayload = root.TryGetProperty("payload", out payload);

				switch (type)
				{
					case "BNDZ_PANE_NAVIGATE":
					{
						var path = hasPayload && payload.TryGetProperty("path", out var p) ? p.GetString() : null;
						_ = HandleBndzNavigateAsync(path);
						break;
					}
					case "BNDZ_PANE_SWITCH":
					{
						var pane = hasPayload && payload.TryGetProperty("pane", out var pn) ? pn.GetString() : null;
						var plugin = hasPayload && payload.TryGetProperty("plugin", out var pl) ? pl.GetString() : null;
						HandleBndzPaneSwitch(pane, plugin);
						break;
					}
					case "BNDZ_PANE_TOOL":
					{
						var tool = hasPayload && payload.TryGetProperty("tool", out var tl) ? tl.GetString() : null;
						_ = HandleBndzPaneToolAsync(tool, payload);
						break;
					}
				}
			}
			catch (Exception ex)
			{
				App.Logger.LogDebug(ex, "BNDZ pane message handling failed");
			}
		}

		private async Task HandleBndzNavigateAsync(string? path)
		{
			if (string.IsNullOrWhiteSpace(path))
				return;

			await DispatcherQueue.EnqueueAsync(async () =>
			{
				try
				{
					var target = path!;
					if (System.IO.File.Exists(target))
					{
						var dir = System.IO.Path.GetDirectoryName(target);
						if (!string.IsNullOrWhiteSpace(dir))
							target = dir!;
					}

					var normalized = NormalizeFsPathKey(target);
					if (string.Equals(normalized, NormalizeFsPathKey(_lastPushedBrowserPath), StringComparison.OrdinalIgnoreCase))
						return;

					var shell = ContentPageContext.ShellPage
						?? SidebarAdaptiveViewModel.PaneHolder?.ActivePaneOrColumn;
					if (shell is null)
						return;

					var gen = ++_bndzNavigateGeneration;
					_bndzNavigatingFromReact = true;
					_lastPushedBrowserPath = target;
					try
					{
						shell.NavigateToPath(target);
						// Hold echo-suppression briefly so Folder PropertyChanged doesn't re-push.
						await Task.Delay(120);
					}
					finally
					{
						if (gen == _bndzNavigateGeneration)
							_bndzNavigatingFromReact = false;
					}
				}
				catch (Exception ex)
				{
					_bndzNavigatingFromReact = false;
					App.Logger.LogDebug(ex, "BNDZ navigate failed for {Path}", path);
				}
			});
		}

		private static string NormalizeFsPathKey(string? path)
		{
			if (string.IsNullOrWhiteSpace(path))
				return string.Empty;
			return path.Trim().Replace('/', '\\').TrimEnd('\\').ToLowerInvariant();
		}

		private void HandleBndzPaneSwitch(string? pane, string? plugin)
		{
			if (string.IsNullOrWhiteSpace(pane))
				return;

			DispatcherQueue.TryEnqueue(() =>
			{
				switch (pane!.Trim().ToLowerInvariant())
				{
					case "plugins":
						_bndzPluginsDockOpen = true;
						{
							var plugins = EnsurePluginsDockHost();
							if (plugins is not null)
							{
								plugins.Visibility = Visibility.Visible;
								plugins.SwitchPane("plugins", plugin);
							}
						}
						if (BndzPluginsDockRow is not null)
							ApplyPluginsDockHeight(true);
						break;
					case "preview":
						SetBndzPreviewOpen(true);
						break;
					case "automation":
					case "canvas":
					case "smart-tools":
					case "marketplace":
					case "settings":
						ShowWorkspacePane(pane);
						break;
				}
				SyncBndzToggleChrome();
				PushSelectionToBndzPanes();
			});
		}

		private async Task HandleBndzPaneToolAsync(string? tool, System.Text.Json.JsonElement payload)
		{
			if (string.IsNullOrWhiteSpace(tool))
				return;

			await DispatcherQueue.EnqueueAsync(async () =>
			{
				try
				{
					switch (tool!.Trim().ToLowerInvariant())
					{
						case "properties":
						{
							var shell = ContentPageContext.ShellPage
								?? SidebarAdaptiveViewModel.PaneHolder?.ActivePaneOrColumn;
							if (shell is not null)
								FilePropertiesHelpers.OpenPropertiesWindow(shell);
							else
								HandleBndzPaneSwitch("plugins", "properties");
							break;
						}
						case "quick-look":
						case "loupe":
						case "histogram":
						case "waveform":
						case "media-tab":
							SetBndzPreviewOpen(true);
							break;
						case "continuum-compose":
							ShowWorkspacePane("canvas");
							break;
						default:
							// Plugin-mapped tools routed in React; ensure hybrid dock is open.
							if (!_bndzPluginsDockOpen)
							{
								_bndzPluginsDockOpen = true;
								var plugins = EnsurePluginsDockHost();
								if (plugins is not null)
									plugins.Visibility = Visibility.Visible;
								if (BndzPluginsDockRow is not null)
									ApplyPluginsDockHeight(true);
							}
							var pluginId = BndzPluginCatalog.PluginIdForDeckTool(tool!);
							if (!string.IsNullOrWhiteSpace(pluginId))
								EnsurePluginsDockHost()?.SwitchPane("plugins", pluginId);
							break;
					}
					SyncBndzToggleChrome();
				}
				catch (Exception ex)
				{
					App.Logger.LogDebug(ex, "BNDZ tool {Tool} failed", tool);
				}
				await Task.CompletedTask;
			});
		}

		private void SetBndzPreviewOpen(bool open)
		{
			_bndzPreviewOpen = open;
			if (!open)
			{
				if (BndzPreviewPaneHost is not null)
					BndzPreviewPaneHost.Visibility = Visibility.Collapsed;
				UpdatePositioning();
				return;
			}

			var preview = EnsurePreviewPaneHost();
			if (preview is not null)
			{
				preview.Visibility = Visibility.Visible;
				preview.ClearValue(FrameworkElement.WidthProperty);
				preview.MinWidth = 220;
				preview.Prewarm();
			}
			try
			{
				if (InfoPane is not null)
					InfoPane.Visibility = Visibility.Collapsed;
			}
			catch { /* best-effort */ }
			UpdatePositioning();
		}

		private void ToggleWorkspacePane(string pane)
		{
			if (_bndzWorkspacePane == pane && BndzWorkspaceOverlay?.Visibility == Visibility.Visible)
			{
				_bndzWorkspacePane = null;
				if (BndzWorkspaceOverlay is not null)
					BndzWorkspaceOverlay.Visibility = Visibility.Collapsed;
				if (PageContent is not null)
					PageContent.Visibility = Visibility.Visible;
				SyncBndzToggleChrome();
				return;
			}

			ShowWorkspacePane(pane);
		}

		private void ShowWorkspacePane(string pane)
		{
			_bndzWorkspacePane = pane;
			if (BndzWorkspaceOverlay is not null)
				BndzWorkspaceOverlay.Visibility = Visibility.Visible;
			// Content-mode: swap out the list frame while heavy workspace tools own the row.
			if (PageContent is not null)
				PageContent.Visibility = Visibility.Collapsed;
			var workspace = EnsureWorkspacePaneHost();
			if (workspace is not null)
			{
				// Soft-switch in-place when already warm; Prewarm only first open.
				workspace.SwitchPane(pane);
			}
			SyncBndzToggleChrome();
			PushSelectionToBndzPanes();
		}

		private void PushSelectionToBndzPanes()
		{
			try
			{
				if (_bndzNavigatingFromReact)
					return;

				var path = ContentPageContext.Folder?.ItemPath
					?? SidebarAdaptiveViewModel?.PaneHolder?.ActivePaneOrColumn?.ShellViewModel?.WorkingDirectory;
				var pathKey = NormalizeFsPathKey(path);

				// Blend face: BNDZUI is the product — push cwd (+ listing via PushDirListing).
				if (BndzShellOwnership.BndzUiFaceActive || BndzShellOwnership.BrowserOwnsFileViewport)
				{
					if (!string.IsNullOrEmpty(pathKey)
						&& string.Equals(pathKey, NormalizeFsPathKey(_lastPushedBrowserPath), StringComparison.OrdinalIgnoreCase))
					{
						PushDirListingToBndzUi();
						return;
					}
					_lastPushedBrowserPath = path;
					_lastPushedListingSignature = null;
					EnsureBrowserHost()?.PostPaneContext(path, null, null, null, null, null);
					PushDirListingToBndzUi();
					return;
				}

				var items = ContentPageContext.SelectedItems;
				List<string>? paths = null;
				List<string>? names = null;
				List<string>? types = null;
				List<long>? sizes = null;
				List<string>? modified = null;
				if (items is { Count: > 0 })
				{
					paths = items.Select(i => i.ItemPath).Where(p => !string.IsNullOrWhiteSpace(p)).ToList()!;
					names = items.Select(i => i.Name).ToList();
					types = items.Select(i => i.IsFolder ? "directory" : "file").ToList();
					sizes = items.Select(i => i.FileSizeBytes).ToList();
					modified = items.Select(i =>
					{
						try { return i.ItemDateModifiedReal.UtcDateTime.ToString("o"); }
						catch { return string.Empty; }
					}).ToList();
				}
				if (BndzPluginsDockHost is not null)
					BndzPluginsDockHost.PostPaneContext(path, paths, names, types, sizes, modified);
				if (BndzWorkspacePaneHost is not null)
					BndzWorkspacePaneHost.PostPaneContext(path, paths, names, types, sizes, modified);
				if (BndzPreviewPaneHost is not null)
					BndzPreviewPaneHost.PostPaneContext(path, paths, names, types, sizes, modified);
			}
			catch
			{
				/* selection push is best-effort */
			}
		}

		private ShellViewModel? _wiredListingShell;
		private string? _lastPushedListingSignature;

		private void WireShellListingPush()
		{
			try
			{
				var shell = SidebarAdaptiveViewModel?.PaneHolder?.ActivePaneOrColumn?.ShellViewModel
					?? ContentPageContext.ShellPage?.ShellViewModel;
				if (shell is null || ReferenceEquals(shell, _wiredListingShell))
					return;

				if (_wiredListingShell is not null)
					_wiredListingShell.ItemLoadStatusChanged -= ShellViewModel_ItemLoadStatusChanged;

				_wiredListingShell = shell;
				_wiredListingShell.ItemLoadStatusChanged += ShellViewModel_ItemLoadStatusChanged;
			}
			catch
			{
				/* best-effort */
			}
		}

		private void ShellViewModel_ItemLoadStatusChanged(object sender, ItemLoadStatusChangedEventArgs e)
		{
			if (e.Status is ItemLoadStatusChangedEventArgs.ItemLoadStatus.Starting)
			{
				DispatcherQueue.TryEnqueue(() =>
				{
					_lastPushedListingSignature = null;
				});
				return;
			}
			if (e.Status != ItemLoadStatusChangedEventArgs.ItemLoadStatus.Complete)
				return;
			DispatcherQueue.TryEnqueue(() =>
			{
				WireShellListingPush();
				PushDirListingToBndzUi();
			});
		}

		private void PushDirListingToBndzUi()
		{
			if (!BndzShellOwnership.BndzUiFaceActive)
				return;

			try
			{
				var shell = SidebarAdaptiveViewModel?.PaneHolder?.ActivePaneOrColumn?.ShellViewModel
					?? ContentPageContext.ShellPage?.ShellViewModel;
				if (shell is null)
					return;

				var path = shell.WorkingDirectory;
				if (string.IsNullOrWhiteSpace(path))
					return;

				var rows = new List<object>(shell.FilesAndFolders.Count);
				foreach (var item in shell.FilesAndFolders)
				{
					if (item is null || string.IsNullOrWhiteSpace(item.ItemPath))
						continue;
					var isDir = item.IsFolder;
					string modified;
					try { modified = item.ItemDateModifiedReal.UtcDateTime.ToString("o"); }
					catch { modified = string.Empty; }
					var ext = !isDir && item.Name.Contains('.', StringComparison.Ordinal)
						? item.Name[(item.Name.LastIndexOf('.') + 1)..]
						: string.Empty;
					rows.Add(new
					{
						id = item.ItemPath,
						name = item.Name,
						path = item.ItemPath,
						type = isDir ? "directory" : "file",
						size = item.FileSizeBytes,
						modified,
						extension = ext,
						isDirectory = isDir,
					});
				}

				var signature = $"{NormalizeFsPathKey(path)}|{rows.Count}|{shell.FilesAndFolders.FirstOrDefault()?.ItemPath}";
				if (string.Equals(signature, _lastPushedListingSignature, StringComparison.Ordinal))
					return;
				_lastPushedListingSignature = signature;

				EnsureBrowserHost()?.PostHostMessage(new
				{
					type = "BNDZ_DIR_LISTING",
					payload = new
					{
						path,
						complete = true,
						items = rows,
					},
				});
			}
			catch (Exception ex)
			{
				App.Logger.LogDebug(ex, "PushDirListingToBndzUi failed");
			}
		}

		private void SchedulePushSelectionToBndzPanes()
		{
			_bndzContextDebounceTimer ??= DispatcherQueue.CreateTimer();
			_bndzContextDebounceTimer.Stop();
			_bndzContextDebounceTimer.Interval = TimeSpan.FromMilliseconds(40);
			_bndzContextDebounceTimer.Tick -= BndzContextDebounce_Tick;
			_bndzContextDebounceTimer.Tick += BndzContextDebounce_Tick;
			_bndzContextDebounceTimer.Start();
		}

		private void BndzContextDebounce_Tick(DispatcherQueueTimer sender, object args)
		{
			sender.Stop();
			PushSelectionToBndzPanes();
		}

		private double GetPluginsDockHeight()
		{
			try
			{
				if (Windows.Storage.ApplicationData.Current.LocalSettings.Values.TryGetValue("BndzPluginsDockHeight", out var stored)
					&& stored is double d
					&& d >= 160
					&& d <= 720)
				{
					return d;
				}
			}
			catch { /* ignore */ }
			return _bndzDockHeight > 0 ? _bndzDockHeight : 180;
		}

		private void ApplyPluginsDockHeight(bool open)
		{
			if (BndzPluginsDockRow is null)
				return;
			if (BndzPluginsDockSizer is not null)
				BndzPluginsDockSizer.Visibility = open ? Visibility.Visible : Visibility.Collapsed;
			if (BndzPluginsDockSizerRow is not null)
				BndzPluginsDockSizerRow.Height = open ? GridLength.Auto : new GridLength(0);
			if (!open)
			{
				BndzPluginsDockRow.Height = new GridLength(0);
				BndzPluginsDockRow.MinHeight = 0;
				return;
			}
			var h = GetPluginsDockHeight();
			_bndzDockHeight = h;
			BndzPluginsDockRow.Height = new GridLength(h);
			BndzPluginsDockRow.MinHeight = 140;
		}

		private void PersistPluginsDockHeight()
		{
			try
			{
				if (BndzPluginsDockRow?.Height.IsAbsolute == true && BndzPluginsDockRow.Height.Value >= 160)
				{
					_bndzDockHeight = BndzPluginsDockRow.Height.Value;
					Windows.Storage.ApplicationData.Current.LocalSettings.Values["BndzPluginsDockHeight"] = _bndzDockHeight;
				}
			}
			catch { /* ignore */ }
		}

		private void BndzPluginsDockSizer_ManipulationCompleted(object sender, Microsoft.UI.Xaml.Input.ManipulationCompletedRoutedEventArgs e)
		{
			PersistPluginsDockHeight();
		}

		private async Task AppRunningAsAdminPromptAsync()
		{
			var runningAsAdminPrompt = new ContentDialog
			{
				Title = Strings.FilesRunningAsAdmin.ToLocalized(),
				Content = Strings.FilesRunningAsAdminContent.ToLocalized(),
				PrimaryButtonText = "Ok".ToLocalized(),
				SecondaryButtonText = Strings.DontShowAgain.ToLocalized()
			};

			var result = await SetContentDialogRoot(runningAsAdminPrompt).TryShowAsync();

			if (result == ContentDialogResult.Secondary)
				UserSettingsService.ApplicationSettingsService.ShowRunningAsAdminPrompt = false;
		}

		// WINUI3
		private ContentDialog SetContentDialogRoot(ContentDialog contentDialog)
		{
			if (ApiInformation.IsApiContractPresent("Windows.Foundation.UniversalApiContract", 8))
				contentDialog.XamlRoot = MainWindow.Instance.Content.XamlRoot;

			return contentDialog;
		}

		private void UserSettingsService_OnSettingChangedEvent(object? sender, SettingChangedEventArgs e)
		{
			switch (e.SettingName)
			{
				case nameof(IInfoPaneSettingsService.IsInfoPaneEnabled):
					LoadPaneChanged();
					break;
				case nameof(IAppearanceSettingsService.SidebarWidth):
					ApplySidebarWidthState();
					break;
			}
		}

		private void HorizontalMultitaskingControl_Loaded(object sender, RoutedEventArgs e)
		{
			if (BndzShellOwnership.BrowserOwnsFileViewport || TabControl is null)
				return;

			try
			{
				if (TabControl.DragArea is not null)
					TabControl.DragArea.SizeChanged += (_, _) => MainWindow.Instance.RaiseSetTitleBarDragRegion(SetTitleBarDragRegion);
				TabControl.SizeChanged += (_, _) => MainWindow.Instance.RaiseSetTitleBarDragRegion(SetTitleBarDragRegion);
				if (ViewModel.MultitaskingControl is not TabBar)
				{
					ViewModel.MultitaskingControl = TabControl;
					ViewModel.MultitaskingControls.Add(TabControl);
					ViewModel.MultitaskingControl.CurrentInstanceChanged += MultitaskingControl_CurrentInstanceChanged;
				}
			}
			catch (Exception ex)
			{
				App.Logger.LogDebug(ex, "TabControl load skipped for filesHost");
			}
		}

		private int SetTitleBarDragRegion(InputNonClientPointerSource source, SizeInt32 size, double scaleFactor, Func<UIElement, RectInt32?, RectInt32> getScaledRect)
		{
			// Blend face: BNDZUI fills the window — reserve a real caption band so the window moves.
			if (BndzShellOwnership.BndzUiFaceActive)
				return 44;

			// Caption height must be > 0 so DragZoneHelper installs a real move region.
			try
			{
				var tabVisible = TabControl is not null && TabControl.Visibility == Visibility.Visible;
				var height = tabVisible && TabControl!.ActualHeight > 1
					? (int)TabControl.ActualHeight
					: 40;

				if (tabVisible && TabControl!.DragArea is not null && TabControl.ActualWidth > 0)
				{
					var passW = (int)Math.Max(0, TabControl.ActualWidth + TabControl.Margin.Left - TabControl.DragArea.ActualWidth);
					if (passW > 0)
					{
						source.SetRegionRects(
							NonClientRegionKind.Passthrough,
							[getScaledRect(this, new RectInt32(0, 0, passW, height))]);
					}
				}

				return Math.Max(height, 32);
			}
			catch
			{
				return 40;
			}
		}

		public async void TabItemContent_ContentChanged(object? sender, TabBarItemParameter e)
		{
			if (SidebarAdaptiveViewModel.PaneHolder is null)
				return;

			var paneArgs = e.NavigationParameter as PaneNavigationArguments;
			SidebarAdaptiveViewModel.UpdateSidebarSelectedItemFromArgs(SidebarAdaptiveViewModel.PaneHolder.IsLeftPaneActive ?
				paneArgs?.LeftPaneNavPathParam : paneArgs?.RightPaneNavPathParam);

			LoadPaneChanged();
			UpdateNavToolbarProperties();
			await NavigationHelpers.UpdateInstancePropertiesAsync(paneArgs);

			// Save the updated tab list
			AppLifecycleHelper.SaveSessionTabs();
		}


		public async void MultitaskingControl_CurrentInstanceChanged(object? sender, CurrentInstanceChangedEventArgs e)
		{
			// Add null check for the event args and CurrentInstance
			if (e?.CurrentInstance == null)
				return;

			// Safely unsubscribe from previous instance
			if (SidebarAdaptiveViewModel?.PaneHolder is not null)
				SidebarAdaptiveViewModel.PaneHolder.PropertyChanged -= PaneHolder_PropertyChanged;

			var navArgs = e.CurrentInstance.TabBarItemParameter?.NavigationParameter;

			if (e.CurrentInstance is IShellPanesPage currentInstance && SidebarAdaptiveViewModel != null)
			{
				SidebarAdaptiveViewModel.PaneHolder = currentInstance;
				SidebarAdaptiveViewModel.PaneHolder.PropertyChanged += PaneHolder_PropertyChanged;
			}

			SidebarAdaptiveViewModel?.NotifyInstanceRelatedPropertiesChanged((navArgs as PaneNavigationArguments)?.LeftPaneNavPathParam);

			// Safely access nested properties with null checks
			var statusBarViewModel = SidebarAdaptiveViewModel?.PaneHolder?.ActivePaneOrColumn?.SlimContentPage?.StatusBarViewModel;
			if (statusBarViewModel is not null)
				statusBarViewModel.ShowLocals = true;

			UpdateNavToolbarProperties();
			LoadPaneChanged();

			e.CurrentInstance.ContentChanged -= TabItemContent_ContentChanged;
			e.CurrentInstance.ContentChanged += TabItemContent_ContentChanged;

			await NavigationHelpers.UpdateInstancePropertiesAsync(navArgs);

			// Blend face: BNDZUI owns focus — skip focusing hidden Files pane.
			if (!BndzShellOwnership.BndzUiFaceActive && !BndzShellOwnership.BrowserOwnsFileViewport)
			{
				await Task.Delay(100);
				if (!App.AppModel.IsMainWindowClosed && ContentPageContext?.ShellPage?.PaneHolder != null)
					ContentPageContext.ShellPage.PaneHolder.FocusActivePane();
			}
			else
			{
				WireShellListingPush();
				SchedulePushSelectionToBndzPanes();
			}
		}

		private void PaneHolder_PropertyChanged(object? sender, PropertyChangedEventArgs e)
		{
			SidebarAdaptiveViewModel.NotifyInstanceRelatedPropertiesChanged(SidebarAdaptiveViewModel.PaneHolder.ActivePane?.TabBarItemParameter?.NavigationParameter?.ToString());
			UpdateNavToolbarProperties();
			LoadPaneChanged();
		}

		private void ContentPageContext_PropertyChanged(object? sender, PropertyChangedEventArgs e)
		{
			if (e.PropertyName is nameof(IContentPageContext.PageType))
				LoadPaneChanged();

			if (e.PropertyName is nameof(IContentPageContext.SelectedItems)
				or nameof(IContentPageContext.Folder)
				or nameof(IContentPageContext.ShellPage)
				or nameof(IContentPageContext.HasSelection)
				or null)
			{
				if (BndzShellOwnership.BndzUiFaceActive)
					WireShellListingPush();
				SchedulePushSelectionToBndzPanes();
			}
		}

		private void UpdateNavToolbarProperties()
		{
			if (NavToolbar is not null)
				NavToolbar.ViewModel = SidebarAdaptiveViewModel.PaneHolder?.ActivePaneOrColumn.ToolbarViewModel;

			if (InnerNavigationToolbar is not null)
				InnerNavigationToolbar.ViewModel = SidebarAdaptiveViewModel.PaneHolder?.ActivePaneOrColumn.ToolbarViewModel;
		}

		protected override void OnNavigatedTo(NavigationEventArgs e)
		{
			_ = ViewModel.OnNavigatedToAsync(e);
		}

		protected override async void OnPreviewKeyDown(KeyRoutedEventArgs e) => await OnPreviewKeyDownAsync(e);

		private async Task OnPreviewKeyDownAsync(KeyRoutedEventArgs e)
		{
			base.OnPreviewKeyDown(e);

			switch (e.Key)
			{
				case VirtualKey.Menu:
				case VirtualKey.Control:
				case VirtualKey.Shift:
				case VirtualKey.LeftWindows:
				case VirtualKey.RightWindows:
					break;
				default:
					var currentModifiers = HotKeyHelpers.GetCurrentKeyModifiers();
					HotKey hotKey = new((Keys)e.Key, currentModifiers);
					var source = e.OriginalSource as DependencyObject;

					// A textbox takes precedence over certain hotkeys.
					if (source?.FindAscendantOrSelf<TextBox>() is not null)
						break;

					// Execute command for hotkey
					var command = Commands[hotKey];

					if (command.Code is CommandCodes.OpenItem && (source?.FindAscendantOrSelf<Omnibar>() is not null || source?.FindAscendantOrSelf<AppBarButton>() is not null))
						break;

					// Prevent ctrl + c from overriding copy in textblocks 					
					if (currentModifiers == KeyModifiers.Ctrl && e.Key is VirtualKey.C && (FrameworkElement)FocusManager.GetFocusedElement(MainWindow.Instance.Content.XamlRoot) is TextBlock)
						break;

					if (command.Code is not CommandCodes.None && keyReleased)
					{
						keyReleased = false;
						e.Handled = command.IsExecutable;
						await command.ExecuteAsync();
					}
					break;
			}
		}

		protected override void OnPreviewKeyUp(KeyRoutedEventArgs e)
		{
			base.OnPreviewKeyUp(e);

			switch (e.Key)
			{
				case VirtualKey.Menu:
				case VirtualKey.Control:
				case VirtualKey.Shift:
				case VirtualKey.LeftWindows:
				case VirtualKey.RightWindows:
					break;
				default:
					keyReleased = true;
					break;
			}
		}

		// A workaround for issue with OnPreviewKeyUp not being called when the hotkey displays a dialog
		protected override void OnLostFocus(RoutedEventArgs e)
		{
			base.OnLostFocus(e);

			keyReleased = true;
		}

		private void Page_Loaded(object sender, RoutedEventArgs e)
		{
			MainWindow.Instance.AppWindow.Changed += (_, _) => MainWindow.Instance.RaiseSetTitleBarDragRegion(SetTitleBarDragRegion);

			// Blend: materialize Files tabs + address chrome so engines and window drag work.
			try { FindName(nameof(TabControl)); } catch { /* ignore */ }
			try { FindName(nameof(NavToolbar)); } catch { /* ignore */ }
			try { FindName(nameof(InnerNavigationToolbar)); } catch { /* ignore */ }

			ApplyBndzSurfaceDefaults();
		}

		private void PreviewPane_Loaded(object sender, RoutedEventArgs e)
		{
			_updateDateDisplayTimer.Start();
		}

		private void PreviewPane_Unloaded(object sender, RoutedEventArgs e)
		{
			_updateDateDisplayTimer.Stop();
		}

		private void UpdateDateDisplayTimer_Tick(object sender, object e)
		{
			if (!App.AppModel.IsMainWindowClosed)
				InfoPane?.ViewModel.UpdateDateDisplay();
			else
				App.Logger.LogWarning("UpdateDateDisplayTimer_Tick: Timer firing after window closed!");
		}

		private void Page_SizeChanged(object sender, SizeChangedEventArgs e)
		{
			switch (InfoPane?.Position)
			{
				case PreviewPanePositions.Right when ContentColumn.ActualWidth == ContentColumn.MinWidth:
					UserSettingsService.InfoPaneSettingsService.VerticalSizePx += e.NewSize.Width - e.PreviousSize.Width;
					UpdatePositioning();
					break;
				case PreviewPanePositions.Bottom when ContentRow.ActualHeight == ContentRow.MinHeight:
					UserSettingsService.InfoPaneSettingsService.HorizontalSizePx += e.NewSize.Height - e.PreviousSize.Height;
					UpdatePositioning();
					break;
			}
		}

		private void SidebarControl_Loaded(object sender, RoutedEventArgs e)
		{
			// Set the correct tab margin on startup
			SidebarAdaptiveViewModel.UpdateTabControlMargin();
			SidebarAdaptiveViewModel.EnsureTabExpansionTrackingInitialized();

			SidebarControl.HoverToOpenDelay = TimeSpan.FromMilliseconds(Constants.DragAndDrop.HoverToOpenTimespan);
			SidebarControl.HoverToExpandDelay = TimeSpan.FromMilliseconds(Constants.DragAndDrop.HoverToExpandTimespan);

			// VM.SidebarDisplayMode rejects Minimal (it only tracks user preference) so the flat tree mirrors SidebarView.DisplayMode separately.
			SidebarAdaptiveViewModel.ActualDisplayMode = SidebarControl.DisplayMode;
			SidebarControl.RegisterPropertyChangedCallback(SidebarView.DisplayModeProperty, (_, _) =>
				SidebarAdaptiveViewModel.ActualDisplayMode = SidebarControl.DisplayMode);
		}

		private void RootGrid_SizeChanged(object sender, SizeChangedEventArgs e) => LoadPaneChanged();

		private void UpdatePositioning()
		{
			// BNDZ React preview owns the right column. Never collapse that column when Files
			// InfoPane is off — that was hiding preview and leaving only the bottom plugin dock.
			if (_bndzPreviewOpen)
			{
				try
				{
					if (InfoPane is not null)
						InfoPane.Visibility = Visibility.Collapsed;
					var preview = EnsurePreviewPaneHost();
					if (preview is not null)
					{
						preview.Visibility = Visibility.Visible;
						preview.ClearValue(FrameworkElement.WidthProperty);
						preview.MinWidth = 220;
						preview.Prewarm();
					}
					if (InfoPaneSizer is not null)
					{
						InfoPaneSizer.Visibility = Visibility.Visible;
						InfoPaneSizer.ChangeCursor(InputSystemCursor.Create(InputSystemCursorShape.SizeWestEast));
					}
					var w = UserSettingsService.InfoPaneSettingsService.VerticalSizePx;
					if (w < 220) w = 280;
					InfoPaneColumnDefinition.MinWidth = 220;
					InfoPaneColumnDefinition.Width = new GridLength(w);
					InfoPaneRowDefinition.MinHeight = 0;
					InfoPaneRowDefinition.Height = new GridLength(0);
					VisualStateManager.GoToState(this, "InfoPanePositionRight", true);
					InfoPaneColumnDefinition.MinWidth = 220;
					InfoPaneColumnDefinition.Width = new GridLength(w);
				}
				catch (Exception ex)
				{
					App.Logger.LogDebug(ex, "BNDZ preview column layout failed");
				}
				return;
			}

			if (InfoPane is null || !ViewModel.ShouldPreviewPaneBeActive)
			{
				VisualStateManager.GoToState(this, "InfoPanePositionNone", true);
			}
			else
			{
				InfoPane.UpdatePosition(RootGrid.ActualWidth, RootGrid.ActualHeight);
				switch (InfoPane.Position)
				{
					case PreviewPanePositions.None:
						VisualStateManager.GoToState(this, "InfoPanePositionNone", true);
						break;
					case PreviewPanePositions.Right:
						InfoPaneSizer.ChangeCursor(InputSystemCursor.Create(InputSystemCursorShape.SizeWestEast));
						InfoPaneColumnDefinition.Width = new(UserSettingsService.InfoPaneSettingsService.VerticalSizePx);
						VisualStateManager.GoToState(this, "InfoPanePositionRight", true);
						break;
					case PreviewPanePositions.Bottom:
						InfoPaneSizer.ChangeCursor(InputSystemCursor.Create(InputSystemCursorShape.SizeNorthSouth));
						InfoPaneRowDefinition.Height = new(UserSettingsService.InfoPaneSettingsService.HorizontalSizePx);
						VisualStateManager.GoToState(this, "InfoPanePositionBottom", true);
						break;
				}
			}
		}

		private void PaneSplitter_ManipulationCompleted(object sender, ManipulationCompletedRoutedEventArgs e)
		{
			switch (InfoPane?.Position)
			{
				case PreviewPanePositions.Right:
					UserSettingsService.InfoPaneSettingsService.VerticalSizePx = InfoPane.ActualWidth;
					break;
				case PreviewPanePositions.Bottom:
					UserSettingsService.InfoPaneSettingsService.HorizontalSizePx = InfoPane.ActualHeight;
					break;
			}

			this.ChangeCursor(InputSystemCursor.Create(InputSystemCursorShape.Arrow));
		}

		private void ApplySidebarWidthState()
		{
			if (UserSettingsService.AppearanceSettingsService.SidebarWidth > 360)
				VisualStateManager.GoToState(this, "LargeSidebarWidthState", true);
			else if (UserSettingsService.AppearanceSettingsService.SidebarWidth > 280)
				VisualStateManager.GoToState(this, "MediumSidebarWidthState", true);
			else
				VisualStateManager.GoToState(this, "SmallSidebarWidthState", true);
		}

		private void LoadPaneChanged()
		{
			try
			{
				if (BndzShellOwnership.BndzUiFaceActive || BndzShellOwnership.BrowserOwnsFileViewport)
				{
					ViewModel.ShouldPreviewPaneBeDisplayed = false;
					ViewModel.ShouldPreviewPaneBeActive = false;
					UpdatePositioning();
					return;
				}

				var isHomePage = !(SidebarAdaptiveViewModel.PaneHolder?.ActivePane?.InstanceViewModel?.IsPageTypeNotHome ?? false);
				var isReleaseNotesPage = SidebarAdaptiveViewModel.PaneHolder?.ActivePane?.InstanceViewModel?.IsPageTypeReleaseNotes ?? false;
				var isSettingsPage = SidebarAdaptiveViewModel.PaneHolder?.ActivePane?.InstanceViewModel?.IsPageTypeSettings ?? false;
				var isMultiPane = SidebarAdaptiveViewModel.PaneHolder?.IsMultiPaneActive ?? false;
				var isBigEnough = !App.AppModel.IsMainWindowClosed &&
					(MainWindow.Instance.Bounds.Width > 450 && MainWindow.Instance.Bounds.Height > 450 || RootGrid.ActualWidth > 700 && MainWindow.Instance.Bounds.Height > 360);

				ViewModel.ShouldPreviewPaneBeDisplayed = ((!isHomePage && !isReleaseNotesPage && !isSettingsPage) || isMultiPane) && isBigEnough;
				ViewModel.ShouldPreviewPaneBeActive = UserSettingsService.InfoPaneSettingsService.IsInfoPaneEnabled && ViewModel.ShouldPreviewPaneBeDisplayed;

				UpdatePositioning();
			}
			catch (Exception ex)
			{
				// Handle exception in case WinUI Windows is closed
				// (see https://github.com/files-community/Files/issues/15599)

				App.Logger.LogWarning(ex, ex.Message);
			}
		}

		private async void ViewModel_PropertyChanged(object? sender, PropertyChangedEventArgs e)
		{
			if (e.PropertyName == nameof(ViewModel.ShouldPreviewPaneBeActive) && ViewModel.ShouldPreviewPaneBeActive)
				await Ioc.Default.GetRequiredService<InfoPaneViewModel>().UpdateSelectedItemPreviewAsync();
			else if (e.PropertyName == nameof(ViewModel.SelectedTabItem))
				HandleSidebarTabChange();
		}

		private void HandleSidebarTabChange()
		{
			if (_previousSidebarTab is not null)
				_sidebarScrollByTab[_previousSidebarTab] = SidebarControl.VerticalScrollOffset;

			var newTab = ViewModel.SelectedTabItem;
			_previousSidebarTab = newTab;

			if (newTab is null)
				return;

			var savedOffset = _sidebarScrollByTab.GetValueOrDefault(newTab);
			// Defer to after the flat-tree's tab-state restoration dispatcher work so the content extent has caught up before scrolling.
			DispatcherQueue.TryEnqueue(DispatcherQueuePriority.Low, () => SidebarControl.ScrollToVerticalOffset(savedOffset));
		}

		private void RootGrid_PreviewKeyDown(object sender, KeyRoutedEventArgs e)
		{
			switch (e.Key)
			{
				case VirtualKey.Menu:
				case VirtualKey.Control:
				case VirtualKey.Shift:
				case VirtualKey.LeftWindows:
				case VirtualKey.RightWindows:
					break;
				default:
					var currentModifiers = HotKeyHelpers.GetCurrentKeyModifiers();
					HotKey hotKey = new((Keys)e.Key, currentModifiers);

					// Prevents the arrow key events from navigating the list instead of switching compact overlay
					if (Commands[hotKey].Code is CommandCodes.EnterCompactOverlay or CommandCodes.ExitCompactOverlay)
						Focus(FocusState.Keyboard);
					break;
			}
		}

		private void NavToolbar_Loaded(object sender, RoutedEventArgs e) => UpdateNavToolbarProperties();

		private void PaneSplitter_ManipulationStarted(object sender, ManipulationStartedRoutedEventArgs e)
		{
			this.ChangeCursor(InputSystemCursor.Create(InfoPane.Position == PreviewPanePositions.Right ?
				InputSystemCursorShape.SizeWestEast : InputSystemCursorShape.SizeNorthSouth));
		}

		private void SettingsButton_AccessKeyInvoked(UIElement sender, AccessKeyInvokedEventArgs args)
		{
			// Suppress access key invocation if any dialog is open
			if (VisualTreeHelper.GetOpenPopupsForXamlRoot(MainWindow.Instance.Content.XamlRoot).Any())
				args.Handled = true;
		}

		private void Page_PointerReleased(object sender, PointerRoutedEventArgs e)
		{
			// Workaround for issue where clicking an empty area in the window (toolbar, title bar etc) prevents keyboard
			// shortcuts from working properly, see https://github.com/microsoft/microsoft-ui-xaml/issues/6467
			DispatcherQueue.TryEnqueue(() => ContentPageContext.ShellPage?.PaneHolder.FocusActivePane());
		}

		private void SidebarControl_ItemContextInvoked(object sender, ItemContextInvokedArgs e)
		{
			SidebarAdaptiveViewModel.HandleItemContextInvokedAsync(sender, e);
		}

		private async void SidebarControl_ItemDragOver(object sender, ItemDragOverEventArgs e)
		{
			// GetDeferral()/Complete() can throw COMException if the underlying drag operation has already been released (e.g. canceled by the system or window closed)
			var deferral = SafetyExtensions.IgnoreExceptions(() => e.RawEvent.GetDeferral(), App.Logger);

			await SafetyExtensions.IgnoreExceptions(async () =>
			{
				await SidebarAdaptiveViewModel.HandleItemDragOverAsync(e);
			}, App.Logger);

			if (deferral is not null)
				SafetyExtensions.IgnoreExceptions(() => deferral.Complete(), App.Logger);
		}

		private async void SidebarControl_ItemDropped(object sender, ItemDroppedEventArgs e)
		{
			// GetDeferral()/Complete() can throw COMException if the underlying drag operation has already been released (e.g. canceled by the system or window closed)
			var deferral = SafetyExtensions.IgnoreExceptions(() => e.RawEvent.GetDeferral(), App.Logger);

			await SafetyExtensions.IgnoreExceptions(async () =>
			{
				await SidebarAdaptiveViewModel.HandleItemDroppedAsync(e);
			}, App.Logger);

			if (deferral is not null)
				SafetyExtensions.IgnoreExceptions(() => deferral.Complete(), App.Logger);
		}

		private void SidebarControl_ItemInvoked(object sender, ItemInvokedEventArgs e)
		{
			if (sender is not SidebarItem { Item: ISidebarItemModel item })
				return;

			if (item is INavigationControlItem navItem &&
				string.Equals(navItem.Path, "Settings", StringComparison.OrdinalIgnoreCase))
				_ = AnimateSettingsIconAsync();

			SidebarAdaptiveViewModel.HandleItemInvokedAsync(item, e.PointerUpdateKind);
		}

		private async Task AnimateSettingsIconAsync()
		{
			AnimatedIcon.SetState(SettingAnimatedIcon, "Pressed");
			await Task.Delay(140);
			AnimatedIcon.SetState(SettingAnimatedIcon, "Normal");
		}
	}
}
