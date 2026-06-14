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
            new SystemCommand { Id = "system-search-files", Title = "Search Files", Subtitle = "Fast indexed file search", Keywords = new[] { "file", "files", "find" }, Score = 84 },
            new SystemCommand { Id = "system-cursor-prompt", Title = "Ask AI", Subtitle = "Inline AI prompt (coming soon)", Keywords = new[] { "ai", "ask", "gpt", "chat" }, Score = 82 },
            new SystemCommand { Id = "system-search-notes", Title = "Search Notes", Subtitle = "In-launcher notes (coming soon)", Keywords = new[] { "note", "notes" }, Score = 80 },
            new SystemCommand { Id = "system-window-management", Title = "Window Management", Subtitle = "Tile and resize windows (coming soon)", Keywords = new[] { "window", "tile", "snap" }, Score = 78 },
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
