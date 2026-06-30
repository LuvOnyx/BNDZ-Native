using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows.Forms;

namespace BNDZ.Services;

public static class LauncherCommandService
{
    private static BndzSnippetStore? _snippets;
    private static BndzQuickLinkStore? _quickLinks;
    private static BndzNoteStore? _notes;

    private static string UserDataDir =>
        Path.Combine(BndzFlowLauncherService.Instance.LauncherDirectory, "UserData");

    private static BndzSnippetStore Snippets => _snippets ??= new BndzSnippetStore(UserDataDir);
    private static BndzQuickLinkStore QuickLinks => _quickLinks ??= new BndzQuickLinkStore(UserDataDir);
    private static BndzNoteStore Notes => _notes ??= new BndzNoteStore(UserDataDir);

    public sealed class CommandDto
    {
        public string id { get; set; } = "";
        public string title { get; set; } = "";
        public string? subtitle { get; set; }
        public string category { get; set; } = "system";
        public string? iconGlyph { get; set; }
        public string? iconUrl { get; set; }
        public string? detail { get; set; }
        public string? openPath { get; set; }
        public string? previewPath { get; set; }
        public string? previewKind { get; set; }
        public string? pluginId { get; set; }
        public string? actionKeyword { get; set; }
    }

    public sealed class QueryResponse
    {
        public string query { get; set; } = "";
        public List<CommandDto> commands { get; set; } = [];
        public List<SectionDto> sections { get; set; } = [];
    }

    public sealed class SectionDto
    {
        public string title { get; set; } = "";
        public List<CommandDto> items { get; set; } = [];
    }

    public static QueryResponse Search(string? query) => SearchLocal(query);

    public static QueryResponse SearchLocal(string? query)
    {
        var q = (query ?? "").Trim();
        var home = string.IsNullOrEmpty(q);
        var bndzItems = new List<CommandDto>();
        var quickItems = new List<CommandDto>();
        var snippetItems = new List<CommandDto>();
        var quickLinkItems = new List<CommandDto>();
        var clipItems = new List<CommandDto>();
        var noteItems = new List<CommandDto>();
        var windowItems = new List<CommandDto>();
        var appItems = new List<CommandDto>();

        BndzInstalledAppsIndex.Shared.EnsureIndexed();
        foreach (var app in BndzInstalledAppsIndex.Shared.Search(home ? "" : q, home ? 12 : 16))
        {
            string? iconUrl = null;
            if (!string.IsNullOrWhiteSpace(app.LaunchPath) && File.Exists(app.LaunchPath))
                iconUrl = $"https://bndz.launcher.local/icon?path={Uri.EscapeDataString(app.LaunchPath)}";

            appItems.Add(new CommandDto
            {
                id = app.Id,
                title = app.Name,
                subtitle = "Application",
                category = "app",
                iconGlyph = "📱",
                iconUrl = iconUrl,
                detail = app.LaunchPath,
            });
        }

        foreach (var cmd in LauncherSystemCommands.All.Where(c => home || MatchesQuery(c, q)))
        {
            bndzItems.Add(ToDto(cmd));
        }

        foreach (var cmd in LauncherSystemCommands.QuickLaunch.Where(c => home || MatchesQuery(c, q)))
        {
            quickItems.Add(ToDto(cmd));
        }

        if (home || q.Contains("clip", StringComparison.OrdinalIgnoreCase))
            clipItems.AddRange(ReadClipboardItems(q));

        if (home || q.Contains("snippet", StringComparison.OrdinalIgnoreCase) || q.Length > 1)
        {
            var snippetQ = q.StartsWith("snippet", StringComparison.OrdinalIgnoreCase) ? q[7..].Trim() : q;
            foreach (var s in Snippets.Search(home ? "" : snippetQ))
            {
                snippetItems.Add(new CommandDto
                {
                    id = $"snippet-{s.Id}",
                    title = s.Name,
                    subtitle = s.Keyword != null ? $"Snippet · {s.Keyword}" : "Snippet",
                    category = "snippet",
                    iconGlyph = "✂️",
                    detail = s.Content.Length > 180 ? s.Content[..180] + "…" : s.Content,
                    previewKind = "text",
                });
            }
        }

        if (home || q.Contains("quick", StringComparison.OrdinalIgnoreCase) || q.Contains("link", StringComparison.OrdinalIgnoreCase) || q.Length > 1)
        {
            foreach (var l in QuickLinks.Search(home ? "" : q))
            {
                quickLinkItems.Add(new CommandDto
                {
                    id = $"quicklink-{l.Id}",
                    title = l.Name,
                    subtitle = l.UrlTemplate,
                    category = "quicklink",
                    iconGlyph = "🔗",
                    detail = l.UrlTemplate,
                });
            }
        }

        if (home || q.Contains("note", StringComparison.OrdinalIgnoreCase) || q.Length > 1)
        {
            var noteQ = q.StartsWith("note", StringComparison.OrdinalIgnoreCase) ? q[4..].Trim() : q;
            foreach (var n in Notes.Search(home ? "" : noteQ))
            {
                noteItems.Add(new CommandDto
                {
                    id = $"note-{n.Id}",
                    title = n.Title,
                    subtitle = "Note",
                    category = "system",
                    iconGlyph = "📝",
                    detail = n.Content.Length > 220 ? n.Content[..220] + "…" : n.Content,
                    previewKind = "text",
                });
            }
        }

        foreach (var w in LauncherWindowCommands.Match(q))
        {
            windowItems.Add(new CommandDto
            {
                id = w.Id,
                title = w.Title,
                subtitle = w.Subtitle,
                category = "system",
                iconGlyph = "🪟",
                detail = w.Subtitle,
            });
        }

        return BuildResponse(q, bndzItems, quickItems, appItems, clipItems, snippetItems, quickLinkItems, noteItems, windowItems, []);
    }

    public static QueryResponse MergeFlowResults(QueryResponse local, BndzShellQueryClient.FlowQueryResult? flow)
    {
        if (flow?.commands == null || flow.commands.Count == 0) return local;

        var knownIds = new HashSet<string>(
            (local.commands ?? []).Select(c => c.id),
            StringComparer.Ordinal);
        var knownAppTitles = new HashSet<string>(
            (local.commands ?? []).Where(c => c.category == "app").Select(c => c.title.Trim()),
            StringComparer.OrdinalIgnoreCase);

        var flowItems = flow.commands
            .Select(MapFlowCommand)
            .Where(c => !knownIds.Contains(c.id))
            .Where(c => c.category != "app" || !knownAppTitles.Contains(c.title.Trim()))
            .ToList();

        foreach (var item in flowItems)
            knownIds.Add(item.id);

        var sectionMap = new Dictionary<string, List<CommandDto>>(StringComparer.OrdinalIgnoreCase);
        foreach (var sec in local.sections ?? [])
            sectionMap[sec.title] = sec.items.ToList();

        foreach (var section in flow.sections ?? [])
        {
            var secItems = section.items
                .Select(MapFlowCommand)
                .Where(c => !knownIds.Contains(c.id))
                .Where(c => c.category != "app" || !knownAppTitles.Contains(c.title.Trim()))
                .ToList();
            if (secItems.Count == 0) continue;

            foreach (var item in secItems)
                knownIds.Add(item.id);

            if (!sectionMap.TryGetValue(section.title, out var bucket))
            {
                sectionMap[section.title] = secItems;
                continue;
            }

            var bucketIds = new HashSet<string>(bucket.Select(c => c.id), StringComparer.Ordinal);
            foreach (var item in secItems)
            {
                if (bucketIds.Add(item.id))
                    bucket.Add(item);
            }
        }

        var all = (local.commands ?? []).Concat(flowItems).ToList();
        var sections = sectionMap
            .Where(kv => kv.Value.Count > 0)
            .Select(kv => new SectionDto { title = kv.Key, items = kv.Value })
            .OrderBy(s => SectionSortKey(s.title))
            .ToList();

        return new QueryResponse
        {
            query = local.query,
            commands = all,
            sections = sections.Count > 0 ? sections : local.sections,
        };
    }

    private static QueryResponse BuildResponse(
        string q,
        List<CommandDto> bndzItems,
        List<CommandDto> quickItems,
        List<CommandDto> appItems,
        List<CommandDto> clipItems,
        List<CommandDto> snippetItems,
        List<CommandDto> quickLinkItems,
        List<CommandDto> noteItems,
        List<CommandDto> windowItems,
        List<CommandDto> extensionItems)
    {
        var all = bndzItems
            .Concat(appItems)
            .Concat(quickItems)
            .Concat(clipItems)
            .Concat(snippetItems)
            .Concat(quickLinkItems)
            .Concat(noteItems)
            .Concat(windowItems)
            .Concat(extensionItems)
            .ToList();
        var sections = new List<SectionDto>();
        if (bndzItems.Count > 0) sections.Add(new SectionDto { title = "BNDZ Launcher", items = bndzItems });
        if (appItems.Count > 0) sections.Add(new SectionDto { title = "Applications", items = appItems });
        if (quickItems.Count > 0) sections.Add(new SectionDto { title = "Apps & System", items = quickItems });
        if (clipItems.Count > 0) sections.Add(new SectionDto { title = "Clipboard", items = clipItems });
        if (snippetItems.Count > 0) sections.Add(new SectionDto { title = "Snippets", items = snippetItems });
        if (quickLinkItems.Count > 0) sections.Add(new SectionDto { title = "Quick Links", items = quickLinkItems });
        if (noteItems.Count > 0) sections.Add(new SectionDto { title = "Notes", items = noteItems });
        if (windowItems.Count > 0) sections.Add(new SectionDto { title = "Window Management", items = windowItems });
        if (extensionItems.Count > 0) sections.Add(new SectionDto { title = "Extensions", items = extensionItems });
        sections = sections.OrderBy(s => SectionSortKey(s.title)).ToList();
        return new QueryResponse
        {
            query = q,
            commands = all,
            sections = sections.Count > 0 ? sections : [new SectionDto { title = "BNDZ Launcher", items = all }],
        };
    }

    private static int SectionSortKey(string title) => title switch
    {
        "Applications" => 0,
        "BNDZ Launcher" => 1,
        "Apps & System" => 2,
        "Files" => 3,
        "Settings" => 4,
        "Snippets" => 5,
        "Quick Links" => 6,
        "Notes" => 7,
        "Clipboard" => 8,
        "Window Management" => 9,
        _ => 50,
    };

    private static bool MatchesQuery(LauncherSystemCommands.Entry cmd, string q) =>
        cmd.Title.Contains(q, StringComparison.OrdinalIgnoreCase)
        || cmd.Subtitle.Contains(q, StringComparison.OrdinalIgnoreCase)
        || cmd.Keywords.Any(k => k.Contains(q, StringComparison.OrdinalIgnoreCase) || q.Contains(k, StringComparison.OrdinalIgnoreCase));

    private static CommandDto ToDto(LauncherSystemCommands.Entry cmd) => new()
    {
        id = cmd.Id,
        title = cmd.Title,
        subtitle = cmd.Subtitle,
        category = cmd.Category,
        iconGlyph = cmd.IconGlyph,
        detail = cmd.Detail,
    };

    public static QueryResponse SearchWithFlow(string? query)
    {
        var local = SearchLocal(query);
        var q = (query ?? "").Trim();
        if (string.IsNullOrEmpty(q)) return local;
        var flow = BndzShellQueryClient.QueryFlowPlugins(q);
        return MergeFlowResults(local, flow);
    }

    private static readonly Dictionary<string, string> FlowOpenPaths = new(StringComparer.Ordinal);

    public static bool Execute(string commandId, string? query = null)
    {
        if (string.IsNullOrWhiteSpace(commandId)) return false;

        if (commandId.StartsWith("app-", StringComparison.Ordinal))
            return BndzInstalledAppsIndex.TryLaunch(commandId);

        if (commandId.StartsWith("quick-", StringComparison.Ordinal))
            return BndzShellExecute.TryLaunchQuick(commandId);

        if (commandId.StartsWith("clip-", StringComparison.Ordinal))
            return TryPasteClipboardHistory(commandId["clip-".Length..]);

        if (commandId.StartsWith("snippet-", StringComparison.Ordinal))
        {
            var text = Snippets.RenderContent(commandId["snippet-".Length..]);
            if (string.IsNullOrEmpty(text)) return false;
            Clipboard.SetText(text);
            return true;
        }

        if (commandId.StartsWith("quicklink-", StringComparison.Ordinal))
        {
            var url = QuickLinks.ResolveUrl(commandId["quicklink-".Length..]);
            if (string.IsNullOrWhiteSpace(url)) return false;
            try
            {
                Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
                return true;
            }
            catch { return false; }
        }

        if (commandId.StartsWith("bndz-openpath-", StringComparison.Ordinal))
        {
            if (FlowOpenPaths.TryGetValue(commandId, out var openPath) && !string.IsNullOrWhiteSpace(openPath))
            {
                BndzHostCoordinator.Instance.OpenPathInFileManager(openPath);
                return true;
            }
            return false;
        }

        if (commandId.StartsWith("flow-", StringComparison.Ordinal))
            return BndzShellQueryClient.ExecuteFlowCommand(commandId, query);

        if (commandId.StartsWith("note-", StringComparison.Ordinal))
        {
            var note = Notes.GetAll().FirstOrDefault(n => n.Id == commandId["note-".Length..]);
            if (note == null) return false;
            Clipboard.SetText(note.Content);
            return true;
        }

        if (commandId.StartsWith("system-window-management", StringComparison.Ordinal))
            return BndzWindowLayoutService.Apply(commandId);

        switch (commandId)
        {
            case "bndz-open":
                BndzHostCoordinator.Instance.ShowFileManager();
                return true;
            case "system-clipboard-manager":
                return true;
            case "system-open-settings":
                BndzLauncherPendingActions.RequestOpenSettings();
                return true;
            case "system-window-management":
            case "system-file-search":
            case "system-search-files":
                return true;
            case "system-open-extensions":
            case "system-open-plugin-store":
                return BndzShellQueryClient.OpenPluginStore();
            default:
                return false;
        }
    }

    private static IEnumerable<CommandDto> ReadClipboardItems(string query)
    {
        var path = Path.Combine(UserDataDir, "BNDZ", "clipboard-history.json");
        if (!File.Exists(path)) return [];

        List<ClipboardJsonEntry>? list = null;
        try
        {
            list = JsonSerializer.Deserialize<List<ClipboardJsonEntry>>(File.ReadAllText(path));
        }
        catch { return []; }

        if (list == null) return [];
        var q = query.Trim();
        var results = new List<CommandDto>();
        foreach (var item in list.OrderByDescending(i => i.Timestamp).Take(20))
        {
            if (!string.IsNullOrEmpty(q) && q.Length > 2
                && !item.Preview.Contains(q, StringComparison.OrdinalIgnoreCase)
                && !item.Content.Contains(q, StringComparison.OrdinalIgnoreCase))
                continue;
            results.Add(new CommandDto
            {
                id = $"clip-{item.Id}",
                title = item.Preview,
                subtitle = item.Kind switch { "image" => "Clipboard · Image", "files" => "Clipboard · Files", _ => "Clipboard" },
                category = "clipboard",
                iconGlyph = item.Kind switch { "image" => "🖼", "files" => "📁", _ => "📋" },
                previewPath = item.Kind == "files" && item.FilePaths?.Count > 0
                    ? item.FilePaths[0]
                    : LooksLikeWindowsPath(item.Content) ? item.Content.Trim() : item.ImagePath,
                previewKind = item.Kind switch { "image" => "image", "files" => "folder", _ => "text" },
                detail = item.Content.Length > 500 ? item.Content[..500] + "…" : item.Content,
            });
        }
        return results;
    }

    private static bool TryPasteClipboardHistory(string id)
    {
        var path = Path.Combine(UserDataDir, "BNDZ", "clipboard-history.json");
        if (!File.Exists(path)) return false;
        try
        {
            var list = JsonSerializer.Deserialize<List<ClipboardJsonEntry>>(File.ReadAllText(path));
            var item = list?.FirstOrDefault(i => i.Id == id);
            if (item == null) return false;
            if (item.Kind == "files" && item.FilePaths?.Count > 0)
            {
                var col = new System.Collections.Specialized.StringCollection();
                foreach (var p in item.FilePaths) col.Add(p);
                Clipboard.SetFileDropList(col);
                return true;
            }
            if (item.Kind == "image" && !string.IsNullOrEmpty(item.ImagePath) && File.Exists(item.ImagePath))
            {
                using var img = System.Drawing.Image.FromFile(item.ImagePath);
                Clipboard.SetImage(img);
                return true;
            }
            Clipboard.SetText(item.Content);
            return true;
        }
        catch { return false; }
    }

    private static CommandDto MapFlowCommand(BndzShellQueryClient.FlowCommandDto cmd)
    {
        if (!string.IsNullOrWhiteSpace(cmd.openPath))
            FlowOpenPaths[cmd.id] = cmd.openPath!;
        var dto = new CommandDto
        {
            id = cmd.id,
            title = BndzBrandingText.Sanitize(cmd.title),
            subtitle = BndzBrandingText.Sanitize(cmd.subtitle),
            category = cmd.category,
            iconUrl = cmd.iconUrl,
            iconGlyph = string.IsNullOrEmpty(cmd.iconUrl) ? "🔌" : null,
            openPath = cmd.openPath,
            previewPath = cmd.previewPath,
            previewKind = cmd.previewKind,
            pluginId = cmd.pluginId,
            actionKeyword = cmd.actionKeyword,
        };
        EnrichPreview(dto);
        return dto;
    }

    private static void EnrichPreview(CommandDto cmd)
    {
        if (!string.IsNullOrWhiteSpace(cmd.previewPath) && !string.IsNullOrWhiteSpace(cmd.previewKind))
            return;

        var path = cmd.previewPath ?? cmd.openPath;
        if (string.IsNullOrWhiteSpace(path) && LooksLikeWindowsPath(cmd.subtitle))
            path = cmd.subtitle;

        if (string.IsNullOrWhiteSpace(path)) return;

        cmd.previewPath ??= path;
        cmd.previewKind ??= FilePreviewMetaService.InferKind(path);
    }

    private static bool LooksLikeWindowsPath(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return false;
        if (text.Length < 3) return false;
        if (char.IsLetter(text[0]) && text[1] == ':' && (text[2] == '\\' || text[2] == '/')) return true;
        if (text.StartsWith("\\\\")) return true;
        return false;
    }

    private sealed class ClipboardJsonEntry
    {
        public string Id { get; set; } = "";
        public string Kind { get; set; } = "text";
        public string Content { get; set; } = "";
        public string Preview { get; set; } = "";
        public List<string> FilePaths { get; set; } = [];
        public string? ImagePath { get; set; }
        public bool Pinned { get; set; }
        public long Timestamp { get; set; }
    }
}
