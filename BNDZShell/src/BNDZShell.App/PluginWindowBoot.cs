namespace BNDZShell;

/// <summary>
/// CLI boot for <c>--plugin-window</c> second-process tear-offs.
/// Mirrors classic BNDZBackend App.IsPluginWindow parsing so pop-out does not
/// spawn a full second shell face.
/// </summary>
internal static class PluginWindowBoot
{
	public static bool IsPluginWindow { get; private set; }
	public static string? PluginId { get; private set; }
	public static string? StickyId { get; private set; }
	public static string? Title { get; private set; }

	public static void Parse(string[] args)
	{
		IsPluginWindow = false;
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
	}
}
