// Copyright (c) BNDZ — WinUI plugin / Command Deck catalog for FilesMerge.

using System.Collections.ObjectModel;

namespace Files.App.Utils.Bndz;

internal sealed record BndzPluginDescriptor(string Id, string Name, string Description);

internal sealed record BndzDeckTool(string Id, string Label, string? PluginId);

/// <summary>Installed-by-default bottom plugins + Command Deck tool routing (mirrors classic registry).</summary>
internal static class BndzPluginCatalog
{
		public static readonly BndzPluginDescriptor[] DefaultInstalled =
		[
			// Empty — marketplace / Hub install only (matches React DEFAULT_INSTALLED_PLUGINS).
		];

	public static readonly BndzPluginDescriptor[] Marketplace =
	[
		new("properties", "System Properties", "Hashes, ACL, attributes, BNDZ tips."),
		new("context-menu-manager", "Shell Menus", "Inside-BNDZ menus and Explorer verb forge."),
		new("batch-rename", "Batch Rename", "Pattern rename with live preview."),
		new("find", "Fast Search", "Index-backed search across volumes."),
		new("dropstack", "Drop Stack", "Stage paths then flush to the active folder."),
		new("filters", "Visual Filters", "Mask the list by type, size, and tags."),
		new("metadata", "Metadata Inspect", "EXIF / media / document inspect."),
		new("storage-cleanup", "Storage Cleanup", "Large files and cleanup workflows."),
		new("folder-sync", "Folder Sync", "Robocopy watchers and sync jobs."),
		new("catalog", "Catalog", "Virtual collections as /vf folders."),
		new("action-log", "Action Log", "Reversible ops history."),
		new("compare", "Compare", "Side-by-side folder/file compare."),
		new("ghost-link", "Ghost Link", "Placeholder links into deep trees."),
		new("ram-staging", "RAM Staging", "ImDisk / AIM scratch volumes."),
		new("icon-studio", "Icon Studio", "FolderIco-style icon libraries."),
		new("remote-mesh", "Remote Mesh", "SSH/SFTP mesh."),
		new("project-sandbox", "Project Sandbox", "Isolated sandbox sessions."),
		new("library-health", "Library Health", "Broken links and orphan scans."),
		new("capacity-solver", "Capacity Solver", "Volume cleanup plans."),
		new("inbound-volume", "Inbound Volume", "Clipboard / inbound catcher."),
		new("branching-time", "Branching Time", "Folder branches and snapshots."),
		new("drop-magnet", "Drop Magnet", "Named landing pads."),
		new("capture-inbox", "Capture Inbox", "Screenshot / clipboard capture."),
		new("reality-check", "Reality Check", "Session reference integrity."),
		new("transcode-rack", "Transcode Rack", "Batch image encode queue."),
		new("semantic-desk", "Semantic Desk", "Cluster folder items."),
		new("policy-pack", "Policy Packs", "Governed ops policies."),
		new("zk-vault", "ZK Vault", "Notes vault tooling."),
	];

	public static ObservableCollection<BndzPluginDescriptor> CreateDefaultCollection()
		=> new(DefaultInstalled);

	public static string? PluginIdForDeckTool(string toolId) => toolId switch
	{
		"properties" => "properties",
		"batch-rename" => "batch-rename",
		"compare" => "compare",
		"mesh-drop" => "remote-mesh",
		"storage-cleanup" => "storage-cleanup",
		"ghost-link" => "ghost-link",
		"ram-staging" or "flush-ram-zone" => "ram-staging",
		"dropstack" => "dropstack",
		"catalog" => "catalog",
		"folder-sync" => "folder-sync",
		"shell-menus" => "context-menu-manager",
		"analyze-audio" or "waveform" or "metadata" => "metadata",
		"find" => "find",
		"project-sandbox" => "project-sandbox",
		"library-health" => "library-health",
		"capacity-solver" => "capacity-solver",
		"inbound-volume" => "inbound-volume",
		"branching-time" => "branching-time",
		"transcode-rack" => "transcode-rack",
		"semantic-desk" => "semantic-desk",
		_ => null,
	};

	public static IReadOnlyList<BndzDeckTool> ToolsForSelection(int selectedCount, bool hasFolder, string? firstExt)
	{
		var ext = (firstExt ?? string.Empty).TrimStart('.').ToLowerInvariant();
		var isAudio = ext is "mp3" or "wav" or "flac" or "aiff" or "aif" or "m4a" or "ogg" or "wma";
		var isImage = ext is "png" or "jpg" or "jpeg" or "webp" or "gif" or "bmp" or "tif" or "tiff";

		if (selectedCount <= 0)
		{
			return
			[
				new("find", "Fast Search", "find"),
				new("storage-cleanup", "Cleanup", "storage-cleanup"),
				new("folder-sync", "Sync", "folder-sync"),
				new("shell-menus", "Shell Menus", "context-menu-manager"),
				new("catalog", "Catalog", "catalog"),
			];
		}

		if (selectedCount > 1)
		{
			return
			[
				new("compare", "Compare", "compare"),
				new("batch-rename", "Batch rename", "batch-rename"),
				new("dropstack", "Drop Stack", "dropstack"),
				new("catalog", "Catalog", "catalog"),
				new("properties", "Properties", "properties"),
			];
		}

		if (isAudio)
		{
			return
			[
				new("waveform", "Waveform", "metadata"),
				new("analyze-audio", "Analyze BPM/Key", "metadata"),
				new("batch-rename", "Rename", "batch-rename"),
				new("properties", "Properties", "properties"),
			];
		}

		if (isImage)
		{
			return
			[
				new("loupe", "Loupe", null),
				new("histogram", "Luma", null),
				new("quick-look", "Quick Look", null),
				new("properties", "Properties", "properties"),
			];
		}

		if (hasFolder)
		{
			return
			[
				new("index-folder", "Index", null),
				new("folder-sync", "Sync", "folder-sync"),
				new("storage-cleanup", "Cleanup", "storage-cleanup"),
				new("properties", "Properties", "properties"),
			];
		}

		return
		[
			new("properties", "Properties", "properties"),
			new("batch-rename", "Rename", "batch-rename"),
			new("metadata", "Metadata", "metadata"),
			new("dropstack", "Drop Stack", "dropstack"),
			new("shell-menus", "Shell Menus", "context-menu-manager"),
		];
	}
}
