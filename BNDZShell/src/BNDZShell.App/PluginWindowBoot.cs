using Microsoft.UI.Xaml;

namespace BNDZShell;

/// <summary>
/// CLI boot for <c>--plugin-window</c> second-process tear-offs, plus in-process
/// pop-out tracking so stickies/plugins share the embedded backend.
/// </summary>
internal static class PluginWindowBoot
{
	public static bool IsPluginWindow { get; private set; }
	public static bool IsStickyWidget { get; private set; }
	public static string? PluginId { get; private set; }
	public static string? StickyId { get; private set; }
	public static string? Title { get; private set; }

	public static void Parse(string[] args)
	{
		IsPluginWindow = false;
		IsStickyWidget = false;
		PluginId = null;
		StickyId = null;
		Title = null;
		if (args is null || args.Length == 0) return;

		for (var i = 0; i < args.Length; i++)
		{
			var a = args[i];
			if (string.Equals(a, "--plugin-window", StringComparison.OrdinalIgnoreCase)
				|| a.StartsWith("--plugin-window=", StringComparison.OrdinalIgnoreCase))
			{
				IsPluginWindow = true;
				PluginId = a.Contains('=')
					? a[(a.IndexOf('=') + 1)..].Trim().Trim('"')
					: (i + 1 < args.Length ? args[++i].Trim().Trim('"') : null);
				continue;
			}
			if (string.Equals(a, "--sticky-id", StringComparison.OrdinalIgnoreCase)
				|| a.StartsWith("--sticky-id=", StringComparison.OrdinalIgnoreCase))
			{
				StickyId = a.Contains('=')
					? a[(a.IndexOf('=') + 1)..].Trim().Trim('"')
					: (i + 1 < args.Length ? args[++i].Trim().Trim('"') : null);
				continue;
			}
			if (string.Equals(a, "--plugin-title", StringComparison.OrdinalIgnoreCase)
				|| a.StartsWith("--plugin-title=", StringComparison.OrdinalIgnoreCase))
			{
				Title = a.Contains('=')
					? a[(a.IndexOf('=') + 1)..].Trim().Trim('"')
					: (i + 1 < args.Length ? args[++i].Trim().Trim('"') : null);
			}
		}

		if (IsPluginWindow && string.IsNullOrWhiteSpace(PluginId))
			IsPluginWindow = false;
		IsStickyWidget = IsPluginWindow && (
			!string.IsNullOrWhiteSpace(StickyId)
			|| string.Equals(PluginId, "sticky-note", StringComparison.OrdinalIgnoreCase));
	}
}

internal sealed class PluginLaunch
{
	public bool IsPlugin { get; init; }
	public bool IsSticky { get; init; }
	public string? PluginId { get; init; }
	public string? StickyId { get; init; }
	public string? Title { get; init; }

	public static PluginLaunch FromBoot() => new()
	{
		IsPlugin = PluginWindowBoot.IsPluginWindow,
		IsSticky = PluginWindowBoot.IsStickyWidget,
		PluginId = PluginWindowBoot.PluginId,
		StickyId = PluginWindowBoot.StickyId,
		Title = PluginWindowBoot.Title,
	};
}

/// <summary>Keep in-process pop-outs alive — WinUI GC-collects unreferenced Windows.</summary>
internal static class PluginWindowRegistry
{
	private static readonly List<Window> Live = new();

	public static void Track(Window window)
	{
		if (window is null) return;
		lock (Live)
		{
			if (!Live.Contains(window)) Live.Add(window);
		}
		window.Closed += (_, _) =>
		{
			lock (Live) Live.Remove(window);
		};
	}

	public static bool Open(string pluginId, string? stickyId, string? title)
	{
		try
		{
			var launch = new PluginLaunch
			{
				IsPlugin = true,
				IsSticky = !string.IsNullOrWhiteSpace(stickyId)
					|| string.Equals(pluginId, "sticky-note", StringComparison.OrdinalIgnoreCase),
				PluginId = pluginId,
				StickyId = stickyId,
				Title = title,
			};
			var window = new MainWindow(launch);
			Track(window);
			window.Activate();
			return true;
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] Open plugin window: {ex.Message}");
			return false;
		}
	}
}
