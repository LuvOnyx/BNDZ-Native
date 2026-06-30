using System;
using System.Collections.Generic;
using System.Linq;

namespace BNDZ.Services;

/// <summary>SuperCmd window-management command catalog.</summary>
public static class LauncherWindowCommands
{
    public sealed class Entry
    {
        public string Id { get; init; } = "";
        public string Title { get; init; } = "";
        public string Subtitle { get; init; } = "";
        public string[] Keywords { get; init; } = [];
    }

    public static readonly IReadOnlyList<Entry> All =
    [
        new() { Id = "system-window-management", Title = "Window Management", Subtitle = "Tile and resize the active window", Keywords = ["window", "tile", "snap", "manage"] },
        new() { Id = "system-window-management-left", Title = "Window: Left Half", Subtitle = "Snap active window to left", Keywords = ["left", "half"] },
        new() { Id = "system-window-management-right", Title = "Window: Right Half", Subtitle = "Snap active window to right", Keywords = ["right", "half"] },
        new() { Id = "system-window-management-top", Title = "Window: Top Half", Subtitle = "Snap active window to top", Keywords = ["top", "half"] },
        new() { Id = "system-window-management-bottom", Title = "Window: Bottom Half", Subtitle = "Snap active window to bottom", Keywords = ["bottom", "half"] },
        new() { Id = "system-window-management-top-left", Title = "Window: Top Left", Subtitle = "Quarter tile — top left", Keywords = ["top", "left", "quadrant"] },
        new() { Id = "system-window-management-top-right", Title = "Window: Top Right", Subtitle = "Quarter tile — top right", Keywords = ["top", "right", "quadrant"] },
        new() { Id = "system-window-management-bottom-left", Title = "Window: Bottom Left", Subtitle = "Quarter tile — bottom left", Keywords = ["bottom", "left", "quadrant"] },
        new() { Id = "system-window-management-bottom-right", Title = "Window: Bottom Right", Subtitle = "Quarter tile — bottom right", Keywords = ["bottom", "right", "quadrant"] },
        new() { Id = "system-window-management-first-third", Title = "Window: First Third", Subtitle = "Left third of screen", Keywords = ["third", "left"] },
        new() { Id = "system-window-management-center-third", Title = "Window: Center Third", Subtitle = "Center third of screen", Keywords = ["third", "center"] },
        new() { Id = "system-window-management-last-third", Title = "Window: Last Third", Subtitle = "Right third of screen", Keywords = ["third", "right"] },
        new() { Id = "system-window-management-center", Title = "Window: Center", Subtitle = "Center on screen", Keywords = ["center", "middle"] },
        new() { Id = "system-window-management-center-80", Title = "Window: Almost Maximize", Subtitle = "80% of work area", Keywords = ["almost", "maximize", "80"] },
        new() { Id = "system-window-management-fill", Title = "Window: Maximize", Subtitle = "Fill work area", Keywords = ["maximize", "fullscreen", "fill"] },
        new() { Id = "system-window-management-maximize-width", Title = "Window: Maximize Width", Subtitle = "Full width, keep height", Keywords = ["width", "horizontal"] },
        new() { Id = "system-window-management-maximize-height", Title = "Window: Maximize Height", Subtitle = "Full height, keep width", Keywords = ["height", "vertical"] },
        new() { Id = "system-window-management-increase-size-10", Title = "Window: Grow 10%", Subtitle = "Increase window size", Keywords = ["grow", "bigger", "increase"] },
        new() { Id = "system-window-management-decrease-size-10", Title = "Window: Shrink 10%", Subtitle = "Decrease window size", Keywords = ["shrink", "smaller", "decrease"] },
    ];

    public static IEnumerable<Entry> Match(string? query)
    {
        var q = (query ?? "").Trim();
        if (string.IsNullOrEmpty(q))
            return [All[0]];

        if (!q.Contains("window", StringComparison.OrdinalIgnoreCase)
            && !q.Contains("tile", StringComparison.OrdinalIgnoreCase)
            && !q.Contains("snap", StringComparison.OrdinalIgnoreCase))
            return [];

        return All.Where(c =>
            c.Title.Contains(q, StringComparison.OrdinalIgnoreCase)
            || c.Subtitle.Contains(q, StringComparison.OrdinalIgnoreCase)
            || c.Keywords.Any(k => k.Contains(q, StringComparison.OrdinalIgnoreCase) || q.Contains(k, StringComparison.OrdinalIgnoreCase)));
    }
}
