// Copyright (c) BNDZ - Wave 3 remaining bottom-panel WinUI plugin bodies.

using System.Text.Json;
using CommunityToolkit.WinUI;
using Files.App.Utils.Bndz;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Files.App.UserControls.Bndz.Plugins;

internal sealed class BndzGhostLinkPage : BndzPluginPageBase
{
	private readonly ListView _rules = new();
	public override string PluginId => "ghost-link";
	protected override string Title => "Ghost Link";
	protected override string Subtitle => "Offload inactive files to cold storage; preserve paths via symlinks.";

	public BndzGhostLinkPage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(MakeChipButton("Refresh rules", async (_, _) => await LoadAsync()));
		row.Children.Add(MakeChipButton("Scan selected rule", async (_, _) => await ScanAsync()));
		row.Children.Add(MakeChipButton("Offload selection", async (_, _) => await OffloadAsync()));
		row.Children.Add(MakeChipButton("Restore path", async (_, _) => await RestoreAsync()));
		panel.Children.Add(row);
		panel.Children.Add(_rules);
		SetBody(panel);
		_ = LoadAsync();
	}

	private async Task LoadAsync()
	{
		_rules.Items.Clear();
		await RunBusyAsync("Loading Ghost Link…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync("GHOST_LINK_GET_RULES", new { }, 15000);
			if (payload is JsonElement el)
			{
				JsonElement rules = el;
				if (el.TryGetProperty("rules", out var r)) rules = r;
				if (rules.ValueKind == JsonValueKind.Array)
				{
					foreach (var rule in rules.EnumerateArray())
					{
						var id = BndzIpcHelpers.GetString(rule, "id") ?? "?";
						var name = BndzIpcHelpers.GetString(rule, "name") ?? id;
						_rules.Items.Add(new RuleRow(id!, name!));
					}
				}
			}
			_rules.DisplayMemberPath = nameof(RuleRow.Name);
			var stats = await BndzIpcHelpers.InvokePayloadAsync("GHOST_LINK_GET_STATS", new { }, 15000);
			SetStatus(stats is JsonElement s ? $"Rules {_rules.Items.Count} · {s}" : $"{_rules.Items.Count} rules");
		});
	}

	private async Task ScanAsync()
	{
		if (_rules.SelectedItem is not RuleRow row)
		{
			SetStatus("Select a rule.");
			return;
		}
		await RunBusyAsync("Scanning…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync("GHOST_LINK_RUN_SCAN", new { ruleId = row.Id }, 3600000);
			SetStatus(payload?.ToString() ?? "Scan finished");
		});
	}

	private async Task OffloadAsync()
	{
		if (Selection.Count == 0)
		{
			SetStatus("Select paths to offload.");
			return;
		}
		await RunBusyAsync("Offloading…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync(
				"GHOST_LINK_OFFLOAD_PATHS",
				new { paths = Selection.Paths.ToArray(), coldStorageRoot = (string?)null },
				3600000);
			SetStatus("Offload requested.");
		});
	}

	private async Task RestoreAsync()
	{
		if (Selection.FirstPath is null)
		{
			SetStatus("Select a ghost path.");
			return;
		}
		await RunBusyAsync("Restoring…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync("GHOST_LINK_RESTORE", new { path = Selection.FirstPath }, 120000);
			SetStatus("Restore requested.");
		});
	}

	private sealed record RuleRow(string Id, string Name);
}

internal sealed class BndzRamStagingPage : BndzPluginPageBase
{
	private readonly ListView _zones = new();
	private readonly TextBox _name = MakeField("Zone name", "Scratch");
	private readonly TextBox _sizeMb = MakeField("Size MB", "1024");
	public override string PluginId => "ram-staging";
	protected override string Title => "RAM Staging";
	protected override string Subtitle => "ImDisk / AIM staging zones — list, create, stage, flush.";

	public BndzRamStagingPage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(_name);
		row.Children.Add(_sizeMb);
		row.Children.Add(MakeChipButton("Refresh", async (_, _) => await LoadAsync()));
		row.Children.Add(MakeChipButton("Create zone", async (_, _) => await CreateAsync()));
		row.Children.Add(MakeChipButton("Stage selection", async (_, _) => await StageAsync()));
		row.Children.Add(MakeChipButton("Flush", async (_, _) => await FlushAsync()));
		row.Children.Add(MakeChipButton("Delete", async (_, _) => await DeleteAsync()));
		panel.Children.Add(row);
		panel.Children.Add(_zones);
		SetBody(panel);
		_ = LoadAsync();
	}

	private async Task LoadAsync()
	{
		_zones.Items.Clear();
		await RunBusyAsync("Loading zones…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync("RAM_STAGING_LIST_ZONES", new { }, 15000);
			if (payload is JsonElement el)
			{
				JsonElement zones = el;
				if (el.TryGetProperty("zones", out var z)) zones = z;
				if (zones.ValueKind == JsonValueKind.Array)
				{
					foreach (var zone in zones.EnumerateArray())
					{
						var id = BndzIpcHelpers.GetString(zone, "id") ?? BndzIpcHelpers.GetString(zone, "zoneId") ?? "?";
						var name = BndzIpcHelpers.GetString(zone, "name") ?? id;
						var mount = BndzIpcHelpers.GetString(zone, "mountPath") ?? BndzIpcHelpers.GetString(zone, "path");
						_zones.Items.Add(new ZoneRow(id!, string.IsNullOrWhiteSpace(mount) ? name! : $"{name} · {mount}"));
					}
				}
			}
			_zones.DisplayMemberPath = nameof(ZoneRow.Label);
			SetStatus($"{_zones.Items.Count} zones");
		});
	}

	private async Task CreateAsync()
	{
		_ = int.TryParse(_sizeMb.Text, out var mb);
		if (mb <= 0) mb = 1024;
		await RunBusyAsync("Creating zone…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync(
				"RAM_STAGING_CREATE_ZONE",
				new { name = string.IsNullOrWhiteSpace(_name.Text) ? "Scratch" : _name.Text, sizeBudgetMb = mb, preferRam = true },
				120000);
			await LoadAsync();
		});
	}

	private string? SelectedZoneId => (_zones.SelectedItem as ZoneRow)?.Id;

	private async Task StageAsync()
	{
		var zoneId = SelectedZoneId;
		if (zoneId is null || Selection.Count == 0)
		{
			SetStatus("Pick a zone + selection.");
			return;
		}
		await RunBusyAsync("Staging…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync(
				"RAM_STAGING_STAGE_PATHS",
				new { zoneId, paths = Selection.Paths.ToArray() },
				3600000);
			SetStatus("Stage requested.");
		});
	}

	private async Task FlushAsync()
	{
		var zoneId = SelectedZoneId;
		if (zoneId is null)
		{
			SetStatus("Pick a zone.");
			return;
		}
		await RunBusyAsync("Flushing…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync("RAM_STAGING_FLUSH_ZONE", new { zoneId }, 3600000);
			SetStatus("Flush requested.");
		});
	}

	private async Task DeleteAsync()
	{
		var zoneId = SelectedZoneId;
		if (zoneId is null)
		{
			SetStatus("Pick a zone.");
			return;
		}
		await RunBusyAsync("Deleting zone…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync("RAM_STAGING_DELETE_ZONE", new { zoneId, flushFirst = true }, 3600000);
			await LoadAsync();
		});
	}

	private sealed record ZoneRow(string Id, string Label);
}

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
		["ghost-link"] = () => new BndzGhostLinkPage(),
		["ram-staging"] = () => new BndzRamStagingPage(),
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
