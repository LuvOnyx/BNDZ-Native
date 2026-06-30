using System;
using System.Collections.Generic;
using System.Linq;

namespace BNDZ.Services;

/// <summary>Built-in BNDZ Launcher catalog + safe quick-launch apps.</summary>
public static class LauncherSystemCommands
{
    public sealed class Entry
    {
        public string Id { get; init; } = "";
        public string Title { get; init; } = "";
        public string Subtitle { get; init; } = "";
        public string Category { get; init; } = "system";
        public string IconGlyph { get; init; } = "⌘";
        public string[] Keywords { get; init; } = [];
        public string? Detail { get; init; }
    }

    public static readonly IReadOnlyList<Entry> All =
    [
        new() { Id = "system-clipboard-manager", Title = "Clipboard History", Subtitle = "Paste from clipboard history", Category = "clipboard", IconGlyph = "📋", Keywords = ["clip", "clipboard", "paste"], Detail = "Browse recent clipboard entries and paste any item instantly." },
        new() { Id = "system-search-snippets", Title = "Search Snippets", Subtitle = "Text expansion snippets", Category = "snippet", IconGlyph = "✂️", Keywords = ["snippet", "snippets"], Detail = "Open the snippet manager to search, create, and paste expansion text." },
        new() { Id = "system-search-quicklinks", Title = "Quick Links", Subtitle = "Bookmarked URLs", Category = "quicklink", IconGlyph = "🔗", Keywords = ["quicklink", "link", "bookmark"], Detail = "Launch saved URL templates and bookmarks from one place." },
        new() { Id = "system-search-notes", Title = "Notes", Subtitle = "Markdown notes workspace", Category = "system", IconGlyph = "📝", Keywords = ["note", "notes", "markdown"], Detail = "Dual-pane notes manager with search, edit, and copy." },
        new() { Id = "system-file-search", Title = "File Search", Subtitle = "Search files and folders (Explorer)", Category = "file", IconGlyph = "📂", Keywords = ["file", "files", "find", "search", "folder"], Detail = "Open the dual-pane file search workspace powered by Flow Explorer." },
        new() { Id = "system-window-management", Title = "Window Management", Subtitle = "Snap and tile windows", Category = "system", IconGlyph = "🪟", Keywords = ["window", "tile", "snap", "manage"], Detail = "Visual grid for snapping the active window to screen regions." },
        new() { Id = "system-cursor-prompt", Title = "Ask AI", Subtitle = "AI assistant powered by Gemini", Category = "system", IconGlyph = "✨", Keywords = ["ai", "ask", "chat", "gpt"], Detail = "Start a focused AI prompt in the launcher." },
        new() { Id = "system-ai-chat", Title = "AI Chat", Subtitle = "Multi-turn conversation with Gemini", Category = "system", IconGlyph = "✨", Keywords = ["ai", "chat", "assistant"], Detail = "Open the full AI chat workspace with conversation history." },
        new() { Id = "bndz-open", Title = "Open BNDZ File Manager", Subtitle = "Dual-pane workspace", Category = "bndz", IconGlyph = "📁", Keywords = ["bndz", "file", "manager"], Detail = "Jump to the BNDZ dual-pane file manager." },
        new() { Id = "system-open-extensions", Title = "Extension Hub", Subtitle = "Browse installed extensions", Category = "extension", IconGlyph = "🧩", Keywords = ["extension", "extensions", "plugin", "plugins"], Detail = "See installed launcher extensions and their keywords." },
        new() { Id = "system-open-plugin-store", Title = "Plugin Store", Subtitle = "Install and manage extensions", Category = "extension", IconGlyph = "🏪", Keywords = ["store", "install", "marketplace"], Detail = "Open the plugin store to install new launcher extensions." },
        new() { Id = "system-open-settings", Title = "BNDZ Launcher Settings", Subtitle = "Configure launcher and hotkeys", Category = "system", IconGlyph = "⚙️", Keywords = ["settings", "config", "preferences"], Detail = "Hotkeys, theme, plugins, and launcher behavior." },
    ];

    public static readonly IReadOnlyList<Entry> QuickLaunch =
    [
        new() { Id = "quick-control-panel", Title = "Control Panel", Subtitle = "Classic Windows control panel", Category = "app", IconGlyph = "🎛️", Keywords = ["control", "panel", "cpl"], Detail = "Opens Control Panel via control.exe." },
        new() { Id = "quick-settings", Title = "Windows Settings", Subtitle = "Modern settings app", Category = "app", IconGlyph = "⚙️", Keywords = ["settings", "windows"], Detail = "Opens the Windows Settings app." },
        new() { Id = "quick-task-manager", Title = "Task Manager", Subtitle = "Processes and performance", Category = "app", IconGlyph = "📊", Keywords = ["task", "manager", "process"], Detail = "Monitor CPU, memory, and running apps." },
        new() { Id = "quick-device-manager", Title = "Device Manager", Subtitle = "Hardware and drivers", Category = "app", IconGlyph = "🔌", Keywords = ["device", "driver", "hardware"], Detail = "View and manage installed hardware." },
        new() { Id = "quick-notepad", Title = "Notepad", Subtitle = "Plain text editor", Category = "app", IconGlyph = "📄", Keywords = ["notepad", "text"], Detail = "Launch Windows Notepad." },
        new() { Id = "quick-calculator", Title = "Calculator", Subtitle = "Windows calculator", Category = "app", IconGlyph = "🔢", Keywords = ["calc", "calculator", "math"], Detail = "Launch Windows Calculator." },
        new() { Id = "quick-paint", Title = "Paint", Subtitle = "Simple image editor", Category = "app", IconGlyph = "🎨", Keywords = ["paint", "draw", "image"], Detail = "Launch Microsoft Paint." },
        new() { Id = "quick-cmd", Title = "Command Prompt", Subtitle = "Classic cmd.exe shell", Category = "app", IconGlyph = "⌨️", Keywords = ["cmd", "command", "terminal"], Detail = "Open a Command Prompt window." },
        new() { Id = "quick-powershell", Title = "PowerShell", Subtitle = "PowerShell terminal", Category = "app", IconGlyph = "⌨️", Keywords = ["powershell", "ps", "terminal"], Detail = "Open a PowerShell window." },
        new() { Id = "quick-explorer", Title = "File Explorer", Subtitle = "Windows file explorer", Category = "app", IconGlyph = "📂", Keywords = ["explorer", "files", "folder"], Detail = "Open a new File Explorer window." },
    ];

    public static IEnumerable<Entry> Match(string? search, bool home)
    {
        var q = (search ?? "").Trim();
        if (home || string.IsNullOrEmpty(q))
            return All.Concat(QuickLaunch);
        return All.Concat(QuickLaunch).Where(c =>
            c.Title.Contains(q, StringComparison.OrdinalIgnoreCase)
            || c.Subtitle.Contains(q, StringComparison.OrdinalIgnoreCase)
            || c.Keywords.Any(k => k.Contains(q, StringComparison.OrdinalIgnoreCase) || q.Contains(k, StringComparison.OrdinalIgnoreCase)));
    }
}
