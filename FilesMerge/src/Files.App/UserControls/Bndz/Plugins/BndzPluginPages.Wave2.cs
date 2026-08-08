// Copyright (c) BNDZ - Wave 2 dock-order WinUI plugin bodies (IPC to BNDZBackend).

using System.Text.Json;
using CommunityToolkit.WinUI;
using Files.App.Utils.Bndz;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace Files.App.UserControls.Bndz.Plugins;

internal sealed class BndzPropertiesPage : BndzPluginPageBase
{
	private readonly ListView _list = new() { SelectionMode = ListViewSelectionMode.None };
	public override string PluginId => "properties";
	protected override string Title => "System Properties";
	protected override string Subtitle => "Hashes, ACL, attributes, and BNDZ tips for the selection.";

	public BndzPropertiesPage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(MakeChipButton("Open Windows Properties", async (_, _) => await OpenNativePropsAsync()));
		row.Children.Add(MakeChipButton("Refresh hashes", async (_, _) => await LoadAsync()));
		panel.Children.Add(row);
		panel.Children.Add(_list);
		SetBody(panel);
	}

	protected override void OnSelectionChanged() => _ = LoadAsync();

	private async Task OpenNativePropsAsync()
	{
		await RunBusyAsync("Opening properties…", async () =>
		{
			await DispatcherQueue.EnqueueAsync(() =>
			{
				var shell = Ioc.Default.GetService<IContentPageContext>()?.ShellPage;
				if (shell is not null)
					FilePropertiesHelpers.OpenPropertiesWindow(shell);
				else
					SetStatus("No active shell pane.");
			});
		});
	}

	private async Task LoadAsync()
	{
		_list.Items.Clear();
		if (Selection.Count <= 0)
		{
			SetStatus("Select a file or folder.");
			return;
		}

		await RunBusyAsync("Loading metadata…", async () =>
		{
			var path = Selection.FirstPath!;
			_list.Items.Add($"Path: {path}");
			var meta = await BndzIpcHelpers.InvokePayloadAsync("GET_EXTENDED_METADATA", new { path }, 30000);
			if (meta is JsonElement m && m.ValueKind == JsonValueKind.Object)
			{
				foreach (var prop in m.EnumerateObject().Take(40))
					_list.Items.Add($"{prop.Name}: {prop.Value}");
			}

			var hashes = await BndzIpcHelpers.InvokePayloadAsync("GET_ASYNC_HASHES", new { path }, 60000);
			if (hashes is JsonElement h)
			{
				var md5 = BndzIpcHelpers.GetString(h, "md5");
				var sha = BndzIpcHelpers.GetString(h, "sha256");
				if (!string.IsNullOrWhiteSpace(md5)) _list.Items.Add($"MD5: {md5}");
				if (!string.IsNullOrWhiteSpace(sha)) _list.Items.Add($"SHA-256: {sha}");
			}
			SetStatus($"Loaded props for {Selection.FirstName}");
		});
	}
}

internal sealed class BndzShellMenusPage : BndzPluginPageBase
{
	private readonly ListView _verbs = new();
	public override string PluginId => "context-menu-manager";
	protected override string Title => "Shell Menus";
	protected override string Subtitle => "Explorer verbs and Inside-BNDZ context actions for the selection.";

	public BndzShellMenusPage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(MakeChipButton("Refresh verbs", async (_, _) => await LoadVerbsAsync()));
		row.Children.Add(MakeChipButton("Run selected verb", async (_, _) => await RunSelectedAsync()));
		panel.Children.Add(row);
		panel.Children.Add(_verbs);
		SetBody(panel);
	}

	protected override void OnSelectionChanged() => _ = LoadVerbsAsync();

	private async Task LoadVerbsAsync()
	{
		_verbs.Items.Clear();
		if (Selection.Count <= 0)
		{
			SetStatus("Select items to inspect shell verbs.");
			return;
		}

		await RunBusyAsync("Querying shell verbs…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync(
				"GET_CONTEXT_MENU_ITEMS",
				new { paths = Selection.Paths.ToArray() },
				20000);
			if (payload is not JsonElement el)
			{
				SetStatus("No verb payload from host.");
				return;
			}

			JsonElement items = el;
			if (el.ValueKind == JsonValueKind.Object && el.TryGetProperty("items", out var arr))
				items = arr;
			if (items.ValueKind != JsonValueKind.Array)
			{
				SetStatus(el.ToString());
				return;
			}

			foreach (var item in items.EnumerateArray())
			{
				var label = BndzIpcHelpers.GetString(item, "label")
					?? BndzIpcHelpers.GetString(item, "name")
					?? BndzIpcHelpers.GetString(item, "verb")
					?? item.ToString();
				var verb = BndzIpcHelpers.GetString(item, "verb") ?? label;
				_verbs.Items.Add(new VerbRow(label!, verb!));
			}
			_verbs.DisplayMemberPath = nameof(VerbRow.Label);
			SetStatus($"{_verbs.Items.Count} verbs");
		});
	}

	private async Task RunSelectedAsync()
	{
		if (_verbs.SelectedItem is not VerbRow row)
		{
			SetStatus("Pick a verb first.");
			return;
		}

		await RunBusyAsync($"Running {row.Verb}…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync(
				"EXECUTE_CONTEXT_MENU_VERB",
				new { verb = row.Verb, paths = Selection.Paths.ToArray() },
				60000);
			SetStatus($"Ran verb “{row.Label}”");
		});
	}

	private sealed record VerbRow(string Label, string Verb);
}

internal sealed class BndzBatchRenamePage : BndzPluginPageBase
{
	private readonly TextBox _pattern = MakeField("Pattern e.g. Item_{n}{ext}", "Item_{n}{ext}");
	private readonly ListView _preview = new() { SelectionMode = ListViewSelectionMode.None };
	public override string PluginId => "batch-rename";
	protected override string Title => "Batch Rename";
	protected override string Subtitle => "Pattern rename with live preview, then EXECUTE_BATCH_RENAME.";

	public BndzBatchRenamePage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(_pattern);
		row.Children.Add(MakeChipButton("Preview", (_, _) => BuildPreview()));
		row.Children.Add(MakeChipButton("Apply", async (_, _) => await ApplyAsync()));
		panel.Children.Add(row);
		panel.Children.Add(_preview);
		_pattern.TextChanged += (_, _) => BuildPreview();
		SetBody(panel);
	}

	protected override void OnSelectionChanged() => BuildPreview();

	private List<(string Source, string Target)> BuildPairs()
	{
		var pairs = new List<(string, string)>();
		var pattern = _pattern.Text ?? "Item_{n}{ext}";
		var n = 1;
		foreach (var path in Selection.Paths)
		{
			if (string.Equals(Selection.Types.ElementAtOrDefault(n - 1), "directory", StringComparison.OrdinalIgnoreCase))
			{
				n++;
				continue;
			}
			var name = SystemIO.Path.GetFileName(path);
			var ext = SystemIO.Path.GetExtension(path);
			var stem = SystemIO.Path.GetFileNameWithoutExtension(path);
			var newName = pattern
				.Replace("{n}", n.ToString("D3"), StringComparison.OrdinalIgnoreCase)
				.Replace("{name}", stem, StringComparison.OrdinalIgnoreCase)
				.Replace("{ext}", ext, StringComparison.OrdinalIgnoreCase)
				.Replace("{extn}", ext.TrimStart('.'), StringComparison.OrdinalIgnoreCase);
			var dir = SystemIO.Path.GetDirectoryName(path) ?? string.Empty;
			var target = SystemIO.Path.Combine(dir, newName);
			pairs.Add((path, target));
			n++;
		}
		return pairs;
	}

	private void BuildPreview()
	{
		_preview.Items.Clear();
		foreach (var (source, target) in BuildPairs())
			_preview.Items.Add($"{SystemIO.Path.GetFileName(source)} → {SystemIO.Path.GetFileName(target)}");
		SetStatus(_preview.Items.Count > 0 ? $"{_preview.Items.Count} renames ready" : "Select files to rename.");
	}

	private async Task ApplyAsync()
	{
		var pairs = BuildPairs();
		if (pairs.Count == 0)
		{
			SetStatus("Nothing to rename.");
			return;
		}

		await RunBusyAsync("Renaming…", async () =>
		{
			var renames = pairs.Select(p => new { source = p.Source, target = p.Target }).ToArray();
			var payload = await BndzIpcHelpers.InvokePayloadAsync(
				"EXECUTE_BATCH_RENAME",
				new { operationId = Guid.NewGuid().ToString("N"), renames, label = "WinUI batch rename" },
				300000);
			if (payload is JsonElement el)
			{
				var renamed = BndzIpcHelpers.GetString(el, "renamed") ?? "?";
				var failed = BndzIpcHelpers.GetString(el, "failed") ?? "0";
				SetStatus($"Done — renamed {renamed}, failed {failed}");
			}
			else
				SetStatus("No response from host.");
		});
	}
}

internal sealed class BndzFindPage : BndzPluginPageBase
{
	private readonly TextBox _query = MakeField("Search query", string.Empty);
	private readonly ListView _results = new();
	public override string PluginId => "find";
	protected override string Title => "Fast Search";
	protected override string Subtitle => "Index-backed global search via PERFORM_GLOBAL_SEARCH.";

	public BndzFindPage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(_query);
		row.Children.Add(MakeChipButton("Search", async (_, _) => await SearchAsync()));
		panel.Children.Add(row);
		panel.Children.Add(_results);
		_results.DoubleTapped += async (_, _) =>
		{
			if (_results.SelectedItem is SearchHit hit)
				await NavigateAsync(hit.Path);
		};
		SetBody(panel);
	}

	private async Task SearchAsync()
	{
		var q = (_query.Text ?? string.Empty).Trim();
		if (q.Length == 0)
		{
			SetStatus("Enter a query.");
			return;
		}

		_results.Items.Clear();
		await RunBusyAsync("Searching…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync(
				"PERFORM_GLOBAL_SEARCH",
				new
				{
					query = q,
					limit = 200,
					useRegex = false,
					rootPath = Selection.FolderPath ?? string.Empty,
					useEverything = true,
					searchContent = false,
					preferBndzIndex = true,
				},
				45000);

			IEnumerable<JsonElement> items = Enumerable.Empty<JsonElement>();
			if (payload is JsonElement el)
			{
				if (el.ValueKind == JsonValueKind.Array)
					items = el.EnumerateArray();
				else if (el.TryGetProperty("items", out var arr) && arr.ValueKind == JsonValueKind.Array)
					items = arr.EnumerateArray();
			}

			foreach (var item in items.Take(200))
			{
				var path = BndzIpcHelpers.GetString(item, "path")
					?? BndzIpcHelpers.GetString(item, "fullPath")
					?? BndzIpcHelpers.GetString(item, "itemPath")
					?? string.Empty;
				if (string.IsNullOrWhiteSpace(path))
					continue;
				_results.Items.Add(new SearchHit(path, SystemIO.Path.GetFileName(path)));
			}
			_results.DisplayMemberPath = nameof(SearchHit.Label);
			SetStatus($"{_results.Items.Count} hits");
		});
	}

	private async Task NavigateAsync(string path)
	{
		await DispatcherQueue.EnqueueAsync(() =>
		{
			var shell = Ioc.Default.GetService<IContentPageContext>()?.ShellPage;
			if (shell is null) return;
			var target = SystemIO.File.Exists(path) ? (SystemIO.Path.GetDirectoryName(path) ?? path) : path;
			shell.NavigateToPath(target);
		});
	}

	private sealed record SearchHit(string Path, string Label);
}

internal sealed class BndzDropStackPage : BndzPluginPageBase
{
	private static readonly ObservableCollection<string> s_stack = [];
	private readonly ListView _list = new() { SelectionMode = ListViewSelectionMode.Extended };
	public override string PluginId => "dropstack";
	protected override string Title => "Drop Stack";
	protected override string Subtitle => "Stage paths, then copy or move into the active folder.";

	public BndzDropStackPage()
	{
		_list.ItemsSource = s_stack;
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(MakeChipButton("Stage selection", (_, _) => StageSelection()));
		row.Children.Add(MakeChipButton("Copy → folder", async (_, _) => await FlushAsync(copy: true)));
		row.Children.Add(MakeChipButton("Move → folder", async (_, _) => await FlushAsync(copy: false)));
		row.Children.Add(MakeChipButton("Clear", (_, _) => { s_stack.Clear(); SetStatus("Stack cleared."); }));
		panel.Children.Add(row);
		panel.Children.Add(_list);
		SetBody(panel);
	}

	private void StageSelection()
	{
		foreach (var p in Selection.Paths)
		{
			if (!s_stack.Contains(p, StringComparer.OrdinalIgnoreCase))
				s_stack.Add(p);
		}
		SetStatus($"{s_stack.Count} staged");
	}

	private async Task FlushAsync(bool copy)
	{
		var dest = Selection.FolderPath;
		if (string.IsNullOrWhiteSpace(dest) || s_stack.Count == 0)
		{
			SetStatus("Need a folder + staged paths.");
			return;
		}

		await RunBusyAsync(copy ? "Copying…" : "Moving…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync(
				"SET_SHELL_CLIPBOARD",
				new { paths = s_stack.ToArray(), cut = !copy },
				10000);

			await DispatcherQueue.EnqueueAsync(() =>
			{
				var shell = Ioc.Default.GetService<IContentPageContext>()?.ShellPage;
				shell?.NavigateToPath(dest!);
			});

			if (!copy)
				s_stack.Clear();
			SetStatus(copy
				? $"Clipboard copy ({s_stack.Count}) → paste in {dest}"
				: $"Clipboard cut → paste in {dest}");
		});
	}
}

internal sealed class BndzFiltersPage : BndzPluginPageBase
{
	private readonly TextBox _mask = MakeField("Glob / extension e.g. *.png;*.jpg", string.Empty);
	private readonly CheckBox _foldersOnly = new() { Content = "Folders only", Margin = new Thickness(0, 0, 8, 6) };
	private readonly CheckBox _filesOnly = new() { Content = "Files only", Margin = new Thickness(0, 0, 8, 6) };
	public override string PluginId => "filters";
	protected override string Title => "Visual Filters";
	protected override string Subtitle => "Mask the active Files list by type / extension (local filter overlay).";

	public BndzFiltersPage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(_mask);
		row.Children.Add(_foldersOnly);
		row.Children.Add(_filesOnly);
		row.Children.Add(MakeChipButton("Apply", (_, _) => ApplyFilter()));
		row.Children.Add(MakeChipButton("Clear", (_, _) => ClearFilter()));
		panel.Children.Add(row);
		panel.Children.Add(new TextBlock
		{
			Text = "Filters apply through ShellViewModel.FilesAndFolders display filtering when available; otherwise status shows the mask for Automation hooks.",
			FontSize = 11,
			TextWrapping = TextWrapping.WrapWholeWords,
			Foreground = (Brush)Application.Current.Resources["BndzInkMutedBrush"],
		});
		SetBody(panel);
	}

	private void ApplyFilter()
	{
		var mask = (_mask.Text ?? string.Empty).Trim();
		try
		{
			var shell = Ioc.Default.GetService<IContentPageContext>()?.ShellPage;
			var svm = shell?.ShellViewModel;
			if (svm is not null)
			{
				svm.FilesAndFoldersFilter = string.IsNullOrWhiteSpace(mask) ? null : mask;
				SetStatus($"Filter applied: {mask}");
				return;
			}
		}
		catch { /* fall through */ }

		SetStatus($"Filter armed: {mask} (folders={_foldersOnly.IsChecked} files={_filesOnly.IsChecked})");
	}

	private void ClearFilter()
	{
		_mask.Text = string.Empty;
		_foldersOnly.IsChecked = false;
		_filesOnly.IsChecked = false;
		try
		{
			var shell = Ioc.Default.GetService<IContentPageContext>()?.ShellPage;
			if (shell?.ShellViewModel is not null)
				shell.ShellViewModel.FilesAndFoldersFilter = null;
		}
		catch { /* ignore */ }
		SetStatus("Filter cleared.");
	}
}

internal sealed class BndzMetadataPage : BndzPluginPageBase
{
	private readonly ListView _list = new() { SelectionMode = ListViewSelectionMode.None };
	public override string PluginId => "metadata";
	protected override string Title => "Metadata Inspect";
	protected override string Subtitle => "EXIF / media / document fields via GET_EXTENDED_METADATA.";

	public BndzMetadataPage()
	{
		var panel = new StackPanel { Spacing = 8 };
		panel.Children.Add(MakeChipButton("Refresh", async (_, _) => await LoadAsync()));
		panel.Children.Add(_list);
		SetBody(panel);
	}

	protected override void OnSelectionChanged() => _ = LoadAsync();

	private async Task LoadAsync()
	{
		_list.Items.Clear();
		if (Selection.FirstPath is null)
		{
			SetStatus("Select a file.");
			return;
		}

		await RunBusyAsync("Reading metadata…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync(
				"GET_EXTENDED_METADATA",
				new { path = Selection.FirstPath },
				30000);
			if (payload is JsonElement el && el.ValueKind == JsonValueKind.Object)
			{
				foreach (var p in el.EnumerateObject())
					_list.Items.Add($"{p.Name}: {p.Value}");
				SetStatus($"{_list.Items.Count} fields");
			}
			else
				SetStatus("No metadata returned.");
		});
	}
}

internal sealed class BndzStorageCleanupPage : BndzPluginPageBase
{
	private readonly ListView _list = new() { SelectionMode = ListViewSelectionMode.Extended };
	private JsonElement? _lastItems;
	public override string PluginId => "storage-cleanup";
	protected override string Title => "Storage Cleanup";
	protected override string Subtitle => "Large-file discovery and cleanup execute via STORAGE_CLEANUP_*.";

	public BndzStorageCleanupPage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(MakeChipButton("Scan folder", async (_, _) => await ScanAsync()));
		row.Children.Add(MakeChipButton("Delete selected", async (_, _) => await ExecuteAsync()));
		panel.Children.Add(row);
		panel.Children.Add(_list);
		SetBody(panel);
	}

	private async Task ScanAsync()
	{
		var root = Selection.FolderPath ?? Selection.FirstPath;
		if (string.IsNullOrWhiteSpace(root))
		{
			SetStatus("Open a folder to scan.");
			return;
		}

		_list.Items.Clear();
		await RunBusyAsync("Scanning…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync(
				"STORAGE_CLEANUP_SCAN",
				new { path = root, rootPath = root },
				600000);
			_lastItems = payload;
			if (payload is JsonElement el)
			{
				JsonElement items = el;
				if (el.TryGetProperty("items", out var arr))
					items = arr;
				if (items.ValueKind == JsonValueKind.Array)
				{
					foreach (var item in items.EnumerateArray().Take(500))
					{
						var path = BndzIpcHelpers.GetString(item, "path") ?? item.ToString();
						var size = BndzIpcHelpers.GetString(item, "size") ?? BndzIpcHelpers.GetString(item, "bytes");
						_list.Items.Add(string.IsNullOrWhiteSpace(size) ? path : $"{path} · {size}");
					}
				}
			}
			SetStatus($"{_list.Items.Count} candidates");
		});
	}

	private async Task ExecuteAsync()
	{
		if (_list.SelectedItems.Count == 0)
		{
			SetStatus("Select scan hits to delete.");
			return;
		}

		var paths = _list.SelectedItems.Cast<object>().Select(o =>
		{
			var s = o.ToString() ?? string.Empty;
			var idx = s.IndexOf(" · ", StringComparison.Ordinal);
			return idx > 0 ? s[..idx] : s;
		}).Where(p => !string.IsNullOrWhiteSpace(p)).ToArray();

		await RunBusyAsync("Executing cleanup…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync(
				"STORAGE_CLEANUP_EXECUTE",
				new { items = paths.Select(p => new { path = p }).ToArray() },
				600000);
			SetStatus($"Cleanup requested for {paths.Length} items.");
		});
	}
}

internal sealed class BndzFolderSyncPage : BndzPluginPageBase
{
	private readonly ListView _jobs = new();
	public override string PluginId => "folder-sync";
	protected override string Title => "Folder Sync";
	protected override string Subtitle => "Robocopy jobs — list, preview, and run via FOLDER_SYNC_*.";

	public BndzFolderSyncPage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(MakeChipButton("Refresh jobs", async (_, _) => await LoadJobsAsync()));
		row.Children.Add(MakeChipButton("Preview", async (_, _) => await PreviewAsync()));
		row.Children.Add(MakeChipButton("Run", async (_, _) => await RunAsync()));
		panel.Children.Add(row);
		panel.Children.Add(_jobs);
		SetBody(panel);
		_ = LoadJobsAsync();
	}

	private async Task LoadJobsAsync()
	{
		_jobs.Items.Clear();
		await RunBusyAsync("Loading jobs…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync("FOLDER_SYNC_GET_JOBS", new { }, 15000);
			if (payload is JsonElement el)
			{
				var arr = el.ValueKind == JsonValueKind.Array ? el : el.TryGetProperty("jobs", out var j) ? j : el;
				if (arr.ValueKind == JsonValueKind.Array)
				{
					foreach (var job in arr.EnumerateArray())
					{
						var id = BndzIpcHelpers.GetString(job, "id") ?? BndzIpcHelpers.GetString(job, "jobId") ?? "?";
						var name = BndzIpcHelpers.GetString(job, "name") ?? id;
						_jobs.Items.Add(new JobRow(id!, name!, job.GetRawText()));
					}
				}
			}
			_jobs.DisplayMemberPath = nameof(JobRow.Name);
			SetStatus($"{_jobs.Items.Count} jobs");
		});
	}

	private async Task PreviewAsync()
	{
		if (_jobs.SelectedItem is not JobRow job)
		{
			SetStatus("Select a job.");
			return;
		}
		await RunBusyAsync("Preview…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync("FOLDER_SYNC_PREVIEW", new { jobId = job.Id }, 120000);
			SetStatus(payload?.ToString() ?? "No preview payload");
		});
	}

	private async Task RunAsync()
	{
		if (_jobs.SelectedItem is not JobRow job)
		{
			SetStatus("Select a job.");
			return;
		}
		await RunBusyAsync("Running sync…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync("FOLDER_SYNC_RUN", new { jobId = job.Id }, 600000);
			SetStatus($"Run requested for {job.Name}");
		});
	}

	private sealed record JobRow(string Id, string Name, string Raw);
}

internal sealed class BndzCatalogPage : BndzPluginPageBase
{
	private readonly ListView _list = new();
	private readonly TextBox _name = MakeField("New catalog name", "Selection");
	public override string PluginId => "catalog";
	protected override string Title => "Catalog";
	protected override string Subtitle => "Virtual collections via CATALOG_* — browse as /vf folders.";

	public BndzCatalogPage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(_name);
		row.Children.Add(MakeChipButton("Refresh", async (_, _) => await LoadAsync()));
		row.Children.Add(MakeChipButton("Add selection", async (_, _) => await UpsertAsync()));
		row.Children.Add(MakeChipButton("Delete", async (_, _) => await DeleteAsync()));
		panel.Children.Add(row);
		panel.Children.Add(_list);
		SetBody(panel);
		_ = LoadAsync();
	}

	private async Task LoadAsync()
	{
		_list.Items.Clear();
		await RunBusyAsync("Loading catalogs…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync("CATALOG_LIST", new { }, 15000);
			if (payload is JsonElement el && el.ValueKind == JsonValueKind.Array)
			{
				foreach (var c in el.EnumerateArray())
				{
					var id = BndzIpcHelpers.GetString(c, "id") ?? "?";
					var name = BndzIpcHelpers.GetString(c, "name") ?? id;
					_list.Items.Add(new CatRow(id!, name!));
				}
			}
			_list.DisplayMemberPath = nameof(CatRow.Name);
			SetStatus($"{_list.Items.Count} catalogs");
		});
	}

	private async Task UpsertAsync()
	{
		if (Selection.Count == 0)
		{
			SetStatus("Select paths to add.");
			return;
		}
		await RunBusyAsync("Saving catalog…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync(
				"CATALOG_UPSERT",
				new
				{
					id = Guid.NewGuid().ToString("N"),
					name = string.IsNullOrWhiteSpace(_name.Text) ? "Selection" : _name.Text,
					paths = Selection.Paths.ToArray(),
				},
				15000);
			await LoadAsync();
		});
	}

	private async Task DeleteAsync()
	{
		if (_list.SelectedItem is not CatRow row)
		{
			SetStatus("Select a catalog.");
			return;
		}
		await RunBusyAsync("Deleting…", async () =>
		{
			await BndzIpcHelpers.InvokePayloadAsync("CATALOG_DELETE", new { id = row.Id }, 15000);
			await LoadAsync();
		});
	}

	private sealed record CatRow(string Id, string Name);
}

internal sealed class BndzActionLogPage : BndzPluginPageBase
{
	private readonly ListView _list = new();
	public override string PluginId => "action-log";
	protected override string Title => "Action Log";
	protected override string Subtitle => "Reversible ops — GET_ACTION_LOG / EXECUTE_UNDO / EXECUTE_REDO.";

	public BndzActionLogPage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(MakeChipButton("Refresh", async (_, _) => await LoadAsync()));
		row.Children.Add(MakeChipButton("Undo", async (_, _) => await UndoRedoAsync(true)));
		row.Children.Add(MakeChipButton("Redo", async (_, _) => await UndoRedoAsync(false)));
		panel.Children.Add(row);
		panel.Children.Add(_list);
		SetBody(panel);
		_ = LoadAsync();
	}

	private async Task LoadAsync()
	{
		_list.Items.Clear();
		await RunBusyAsync("Loading log…", async () =>
		{
			var payload = await BndzIpcHelpers.InvokePayloadAsync("GET_ACTION_LOG", new { max = 100 }, 15000);
			if (payload is JsonElement el)
			{
				JsonElement items = el;
				if (el.TryGetProperty("items", out var arr))
					items = arr;
				if (items.ValueKind == JsonValueKind.Array)
				{
					foreach (var item in items.EnumerateArray())
					{
						var label = BndzIpcHelpers.GetString(item, "label") ?? BndzIpcHelpers.GetString(item, "kind") ?? item.ToString();
						var utc = BndzIpcHelpers.GetString(item, "utc");
						_list.Items.Add(string.IsNullOrWhiteSpace(utc) ? label : $"{utc} · {label}");
					}
				}
				var canUndo = el.TryGetProperty("canUndo", out _) && BndzIpcHelpers.GetBool(el, "canUndo");
				var canRedo = el.TryGetProperty("canRedo", out _) && BndzIpcHelpers.GetBool(el, "canRedo");
				SetStatus($"{_list.Items.Count} entries · undo={canUndo} redo={canRedo}");
			}
			else
				SetStatus("No log payload.");
		});
	}

	private async Task UndoRedoAsync(bool undo)
	{
		await RunBusyAsync(undo ? "Undo…" : "Redo…", async () =>
		{
			var type = undo ? "EXECUTE_UNDO" : "EXECUTE_REDO";
			var payload = await BndzIpcHelpers.InvokePayloadAsync(type, new { }, 120000);
			SetStatus(payload?.ToString() ?? "Done");
			await LoadAsync();
		});
	}
}

internal sealed class BndzComparePage : BndzPluginPageBase
{
	private readonly TextBox _pathA = MakeField("Path A");
	private readonly TextBox _pathB = MakeField("Path B");
	private readonly ListView _diff = new() { SelectionMode = ListViewSelectionMode.None };
	public override string PluginId => "compare";
	protected override string Title => "Compare";
	protected override string Subtitle => "Side-by-side folder/file compare via COMPARE_DIRECTORIES / COMPARE_FILES.";

	public BndzComparePage()
	{
		var panel = new StackPanel { Spacing = 8 };
		var row = new StackPanel { Orientation = Orientation.Horizontal };
		row.Children.Add(_pathA);
		row.Children.Add(_pathB);
		row.Children.Add(MakeChipButton("From selection", (_, _) => FromSelection()));
		row.Children.Add(MakeChipButton("Compare", async (_, _) => await CompareAsync()));
		panel.Children.Add(row);
		panel.Children.Add(_diff);
		SetBody(panel);
	}

	protected override void OnSelectionChanged() => FromSelection();

	private void FromSelection()
	{
		if (Selection.Paths.Count >= 1) _pathA.Text = Selection.Paths[0];
		if (Selection.Paths.Count >= 2) _pathB.Text = Selection.Paths[1];
	}

	private async Task CompareAsync()
	{
		var a = (_pathA.Text ?? string.Empty).Trim();
		var b = (_pathB.Text ?? string.Empty).Trim();
		if (a.Length == 0 || b.Length == 0)
		{
			SetStatus("Need two paths.");
			return;
		}

		_diff.Items.Clear();
		await RunBusyAsync("Comparing…", async () =>
		{
			var aIsDir = SystemIO.Directory.Exists(a);
			var bIsDir = SystemIO.Directory.Exists(b);
			JsonElement? payload;
			if (aIsDir && bIsDir)
			{
				payload = await BndzIpcHelpers.InvokePayloadAsync(
					"COMPARE_DIRECTORIES",
					new { pathA = a, pathB = b, useHashing = false },
					300000);
			}
			else
			{
				payload = await BndzIpcHelpers.InvokePayloadAsync(
					"COMPARE_FILES",
					new { pathA = a, pathB = b },
					120000);
			}

			if (payload is JsonElement el)
			{
				_diff.Items.Add(el.ToString());
				if (el.TryGetProperty("diff", out var d) && d.ValueKind == JsonValueKind.Array)
				{
					_diff.Items.Clear();
					foreach (var row in d.EnumerateArray().Take(400))
						_diff.Items.Add(row.ToString());
				}
				else if (el.TryGetProperty("items", out var items) && items.ValueKind == JsonValueKind.Array)
				{
					_diff.Items.Clear();
					foreach (var row in items.EnumerateArray().Take(400))
						_diff.Items.Add(row.ToString());
				}
			}
			SetStatus($"{_diff.Items.Count} result rows");
		});
	}
}
