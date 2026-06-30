using System;
using System.Collections.Generic;
using System.Linq;

namespace Flow.Launcher.Plugin.BNDZ
{
    /// <summary>SuperCmd system-* command catalog — ported IDs for feature parity tracking.</summary>
    internal static class BndzSystemCommands
    {
        internal sealed class SystemCommand
        {
            public string Id { get; init; } = "";
            public string Title { get; init; } = "";
            public string Subtitle { get; init; } = "";
            public string[] Keywords { get; init; } = Array.Empty<string>();
            public int Score { get; init; } = 90;
        }

        public static readonly IReadOnlyList<SystemCommand> All = new[]
        {
            new SystemCommand { Id = "system-clipboard-manager", Title = "Clipboard History", Subtitle = "SuperCmd-style clipboard manager", Keywords = new[] { "clip", "clipboard", "paste" }, Score = 100 },
            new SystemCommand { Id = "system-search-snippets", Title = "Search Snippets", Subtitle = "Text expansion snippets", Keywords = new[] { "snippet", "snippets", "expand" }, Score = 88 },
            new SystemCommand { Id = "system-search-quicklinks", Title = "Quick Links", Subtitle = "Bookmarked URLs from the launcher", Keywords = new[] { "quicklink", "quick", "link", "bookmark" }, Score = 86 },
            new SystemCommand { Id = "system-open-settings", Title = "BNDZ Launcher Settings", Subtitle = "Configure launcher and hotkeys", Keywords = new[] { "settings", "config", "preferences" }, Score = 92 },
            new SystemCommand { Id = "system-open-extensions", Title = "Extension Hub", Subtitle = "Browse installed Flow plugins", Keywords = new[] { "extension", "extensions", "plugin", "plugins" }, Score = 85 },
            new SystemCommand { Id = "system-open-plugin-store", Title = "Plugin Store", Subtitle = "Install Flow plugins", Keywords = new[] { "store", "install", "marketplace" }, Score = 84 },
            new SystemCommand { Id = "system-file-search", Title = "Search Files", Subtitle = "Fast indexed file search", Keywords = new[] { "file", "files", "find" }, Score = 84 },
            new SystemCommand { Id = "system-cursor-prompt", Title = "Ask AI", Subtitle = "AI assistant powered by Gemini", Keywords = new[] { "ai", "ask", "gpt", "chat" }, Score = 82 },
            new SystemCommand { Id = "system-ai-chat", Title = "AI Chat", Subtitle = "Multi-turn Gemini conversation", Keywords = new[] { "ai", "chat", "assistant", "gemini" }, Score = 81 },
            new SystemCommand { Id = "system-search-notes", Title = "Search Notes", Subtitle = "Quick notes in BNDZ Launcher", Keywords = new[] { "note", "notes" }, Score = 80 },
            new SystemCommand { Id = "system-window-management", Title = "Window Management", Subtitle = "Tile and resize the active window", Keywords = new[] { "window", "tile", "snap" }, Score = 78 },
        };

        public static IEnumerable<SystemCommand> Match(string search)
        {
            var q = (search ?? string.Empty).Trim();
            if (string.IsNullOrEmpty(q))
                return All;

            return All.Where(c =>
                c.Title.Contains(q, StringComparison.OrdinalIgnoreCase)
                || c.Subtitle.Contains(q, StringComparison.OrdinalIgnoreCase)
                || Array.Exists(c.Keywords, k => k.Contains(q, StringComparison.OrdinalIgnoreCase) || q.Contains(k, StringComparison.OrdinalIgnoreCase)));
        }
    }
}
