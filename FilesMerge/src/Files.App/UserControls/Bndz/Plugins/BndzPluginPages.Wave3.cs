// Copyright (c) BNDZ - Wave 3 remaining bottom-panel WinUI plugin bodies.
// Launch Ready A1: Ghost Link / RAM Staging page classes deleted (not just unregistered).

using System.Text.Json;
using CommunityToolkit.WinUI;
using Files.App.Utils.Bndz;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Files.App.UserControls.Bndz.Plugins;

/// <summary>Generic IPC console body for marketplace bottom plugins until bespoke UI lands.</summary>
internal sealed class BndzMarketplacePluginPage : BndzPluginPageBase
{
	private readonly string _id;
	private readonly string _title;
	private readonly string _subtitle;
	private readonly ListView _out = new() { SelectionMode = ListViewSelectionMode.None };
	private readonly string[] _actions;

	public override string PluginId => _id;
	protected override string Title => _title;
	protected override string Subtitle => _subtitle;

	public BndzMarketplacePluginPage(string id, string title, string subtitle, params string[] probeTypes)
	{
		_id = id;
		_title = title;
		_subtitle = subtitle;
		_actions = probeTypes.Length > 0 ? probeTypes : [$"PING_{id.ToUpperInvariant().Replace('-', '_')}"];

		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		foreach (var action in _actions)
		{
			var captured = action;
			row.Children.Add(MakeChipButton(ShortLabel(captured), async (_, _) => await ProbeAsync(captured)));
		}
		row.Children.Add(MakeChipButton("Use selection", (_, _) =>
		{
			_out.Items.Clear();
			foreach (var p in Selection.Paths)
				_out.Items.Add(p);
			SetStatus($"{Selection.Count} paths ready for {_id}");
		}));
		panel.Children.Add(row);
		panel.Children.Add(_out);
		SetBody(panel);
	}

	private static string ShortLabel(string type)
	{
		var parts = type.Split('_', StringSplitOptions.RemoveEmptyEntries);
		return parts.Length <= 2 ? type : string.Join(' ', parts.TakeLast(2).Select(p => p[0] + p[1..].ToLowerInvariant()));
	}

	private async Task ProbeAsync(string type)
	{
		_out.Items.Clear();
		await RunBusyAsync($"{type}…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync(
				type,
				new
				{
					paths = Selection.Paths.ToArray(),
					path = Selection.FirstPath,
					folder = Selection.FolderPath,
					pluginId = _id,
				},
				120000);
			_out.Items.Add(payload?.ToString() ?? "(null payload)");
			SetStatus(payload is null ? "No response (host offline?)" : "OK");
		});
	}
}

internal static class BndzPluginPageFactory
{
	private static readonly Dictionary<string, Func<IBndzPluginPage>> s_ctors = new(StringComparer.OrdinalIgnoreCase)
	{
		["properties"] = () => new BndzPropertiesPage(),
		["context-menu-manager"] = () => new BndzShellMenusPage(),
		["batch-rename"] = () => new BndzBatchRenamePage(),
		["find"] = () => new BndzFindPage(),
		["dropstack"] = () => new BndzDropStackPage(),
		["filters"] = () => new BndzFiltersPage(),
		["metadata"] = () => new BndzMetadataPage(),
		["storage-cleanup"] = () => new BndzStorageCleanupPage(),
		["folder-sync"] = () => new BndzFolderSyncPage(),
		["catalog"] = () => new BndzCatalogPage(),
		["action-log"] = () => new BndzActionLogPage(),
		["compare"] = () => new BndzComparePage(),
		// Launch Ready A1: ghost-link / ram-staging — page classes removed; do not re-register.
		["icon-studio"] = () => new BndzMarketplacePluginPage("icon-studio", "Icon Studio", "FolderIco-style icon libraries.", "ICON_STUDIO_LIST_LIBRARIES", "ICON_STUDIO_APPLY"),
		["remote-mesh"] = () => new BndzMarketplacePluginPage("remote-mesh", "Remote Mesh", "SSH/SFTP mesh browsing and deploy.", "MESH_LIST_HOSTS", "MESH_CONNECT"),
		["project-sandbox"] = () => new BndzMarketplacePluginPage("project-sandbox", "Project Sandbox", "Isolated sandbox sessions.", "PROJECT_SANDBOX_LIST", "PROJECT_SANDBOX_CREATE"),
		["library-health"] = () => new BndzMarketplacePluginPage("library-health", "Library Health", "Broken links and orphan scans.", "LIBRARY_HEALTH_SCAN"),
		["capacity-solver"] = () => new BndzMarketplacePluginPage("capacity-solver", "Capacity Solver", "Volume cleanup plans.", "CAPACITY_SOLVER_ANALYZE"),
		["inbound-volume"] = () => new BndzMarketplacePluginPage("inbound-volume", "Inbound Volume", "Clipboard / inbound catcher.", "INBOUND_VOLUME_LIST"),
		["branching-time"] = () => new BndzMarketplacePluginPage("branching-time", "Branching Time", "Folder branches and snapshots.", "BRANCHING_TIME_LIST"),
		["drop-magnet"] = () => new BndzMarketplacePluginPage("drop-magnet", "Drop Magnet", "Named landing pads.", "DROP_MAGNET_LIST"),
		["capture-inbox"] = () => new BndzMarketplacePluginPage("capture-inbox", "Capture Inbox", "Screenshot / clipboard capture.", "CAPTURE_INBOX_LIST"),
		["reality-check"] = () => new BndzMarketplacePluginPage("reality-check", "Reality Check", "Session reference integrity.", "REALITY_CHECK_SCAN"),
		["transcode-rack"] = () => new BndzMarketplacePluginPage("transcode-rack", "Transcode Rack", "Batch image encode queue.", "TRANSCODE_RACK_LIST"),
		["semantic-desk"] = () => new BndzMarketplacePluginPage("semantic-desk", "Semantic Desk", "Cluster folder items into piles.", "SEMANTIC_DESK_CLUSTER"),
		["policy-pack"] = () => new BndzMarketplacePluginPage("policy-pack", "Policy Packs", "Governed ops policies.", "POLICY_PACK_LIST"),
		["zk-vault"] = () => new BndzMarketplacePluginPage("zk-vault", "ZK Vault", "Notes vault tooling.", "ZK_VAULT_STATUS"),
	};

	private static readonly Dictionary<string, IBndzPluginPage> s_cache = new(StringComparer.OrdinalIgnoreCase);

	public static IBndzPluginPage GetOrCreate(string pluginId)
	{
		if (s_cache.TryGetValue(pluginId, out var page))
			return page;
		if (!s_ctors.TryGetValue(pluginId, out var ctor))
		{
			page = new BndzMarketplacePluginPage(pluginId, pluginId, "Native WinUI body for marketplace plugin.");
			s_cache[pluginId] = page;
			return page;
		}
		page = ctor();
		s_cache[pluginId] = page;
		return page;
	}

	public static bool IsKnown(string pluginId) => s_ctors.ContainsKey(pluginId);
}
