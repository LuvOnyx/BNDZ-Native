// Copyright (c) BNDZ — WinUI Command Deck + plugin tab strip + body host.

using Files.App.UserControls.Bndz.Plugins;
using Files.App.Utils.Bndz;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Media;

namespace Files.App.UserControls.Bndz;

public sealed partial class BndzNativeDock : UserControl
{
	private BndzPluginSelection _selection = BndzPluginSelection.Empty;
	private string _activePluginId = "properties";
	private readonly List<ToggleButton> _tabButtons = [];

	public BndzNativeDock()
	{
		InitializeComponent();
		Loaded += BndzNativeDock_Loaded;
	}

	public string ActivePluginId => _activePluginId;

	public event EventHandler<string>? PluginActivated;
	public event EventHandler<string>? DeckToolActivated;

	private void BndzNativeDock_Loaded(object sender, RoutedEventArgs e)
	{
		RebuildTabs();
		SelectPlugin(_activePluginId);
		RefreshDeck();
	}

	public void ApplySelection(string? folderPath, IReadOnlyList<string>? paths, IReadOnlyList<string>? names, IReadOnlyList<string>? types)
	{
		_selection = new BndzPluginSelection(
			folderPath,
			paths?.ToList() ?? [],
			names?.ToList() ?? [],
			types?.ToList() ?? []);

		SelectionBadgeText.Text = _selection.Count switch
		{
			0 => string.IsNullOrWhiteSpace(folderPath) ? "No selection" : "Folder context",
			1 => _selection.FirstName ?? "1 item",
			_ => $"{_selection.Count} items",
		};

		RefreshDeck();

		if (PluginBodyHost.Content is IBndzPluginPage page)
			page.ApplySelection(_selection);
	}

	public void SelectPlugin(string? pluginId)
	{
		if (string.IsNullOrWhiteSpace(pluginId))
			return;

		_activePluginId = pluginId.Trim();
		EnsureTabExists(_activePluginId);

		foreach (var btn in _tabButtons)
			btn.IsChecked = string.Equals(btn.Tag as string, _activePluginId, StringComparison.OrdinalIgnoreCase);

		var page = BndzPluginPageFactory.GetOrCreate(_activePluginId);
		page.ApplySelection(_selection);
		PluginBodyHost.Content = page;
		PluginActivated?.Invoke(this, _activePluginId);
	}

	private void EnsureTabExists(string pluginId)
	{
		if (_tabButtons.Any(b => string.Equals(b.Tag as string, pluginId, StringComparison.OrdinalIgnoreCase)))
			return;

		var desc = BndzPluginCatalog.DefaultInstalled.FirstOrDefault(d => d.Id == pluginId)
			?? BndzPluginCatalog.Marketplace.FirstOrDefault(d => d.Id == pluginId)
			?? new BndzPluginDescriptor(pluginId, pluginId, string.Empty);
		AddTabButton(desc);
	}

	private void RebuildTabs()
	{
		PluginTabsHost.Items.Clear();
		_tabButtons.Clear();
		foreach (var plugin in BndzPluginCatalog.DefaultInstalled)
			AddTabButton(plugin);
	}

	private void AddTabButton(BndzPluginDescriptor plugin)
	{
		var btn = new ToggleButton
		{
			Content = plugin.Name,
			Tag = plugin.Id,
			Style = (Style)Application.Current.Resources["BndzPluginTabStyle"],
			IsChecked = string.Equals(plugin.Id, _activePluginId, StringComparison.OrdinalIgnoreCase),
		};
		ToolTipService.SetToolTip(btn, plugin.Description);
		btn.Click += (_, _) => SelectPlugin(plugin.Id);
		_tabButtons.Add(btn);
		PluginTabsHost.Items.Add(btn);
	}

	private void RefreshDeck()
	{
		DeckToolsHost.Items.Clear();
		var tools = BndzPluginCatalog.ToolsForSelection(
			_selection.Count,
			_selection.HasFolderSelected,
			_selection.FirstExt);

		foreach (var tool in tools)
		{
			var captured = tool;
			var btn = new Button
			{
				Content = captured.Label,
				Tag = captured.Id,
				Style = (Style)Application.Current.Resources["BndzChipButtonStyle"],
			};
			btn.Click += (_, _) => OnDeckTool(captured);
			DeckToolsHost.Items.Add(btn);
		}
	}

	private void OnDeckTool(BndzDeckTool tool)
	{
		DeckToolActivated?.Invoke(this, tool.Id);
		var pluginId = tool.PluginId ?? BndzPluginCatalog.PluginIdForDeckTool(tool.Id);
		if (!string.IsNullOrWhiteSpace(pluginId))
			SelectPlugin(pluginId);
	}
}
