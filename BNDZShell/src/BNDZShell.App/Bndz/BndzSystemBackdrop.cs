using Microsoft.UI.Composition.SystemBackdrops;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;

namespace BNDZShell.Bndz;

/// <summary>
/// Fluent system backdrops (Mica / Mica Alt / Desktop Acrylic) for the WinUI shell.
/// Requires a transparent root Grid so the material is visible behind chrome.
/// </summary>
internal static class BndzSystemBackdrop
{
	public static void Apply(Window window, bool enabled, string? kind = null)
	{
		ArgumentNullException.ThrowIfNull(window);
		kind ??= BndzShellChromeSettings.BackdropKind;

		if (!enabled)
		{
			window.SystemBackdrop = null;
			return;
		}

		try
		{
			window.SystemBackdrop = kind.ToLowerInvariant() switch
			{
				"micaalt" or "mica-alt" or "basealt" =>
					new MicaBackdrop { Kind = MicaKind.BaseAlt },
				"acrylic" or "desktopacrylic" or "fluent" =>
					new DesktopAcrylicBackdrop(),
				_ =>
					new MicaBackdrop { Kind = MicaKind.Base },
			};
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] system backdrop ({kind}): {ex.Message}");
			try { window.SystemBackdrop = new MicaBackdrop(); }
			catch { window.SystemBackdrop = null; }
		}
	}
}
