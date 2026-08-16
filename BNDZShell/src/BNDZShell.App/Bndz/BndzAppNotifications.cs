using Microsoft.Windows.AppNotifications;
using Microsoft.Windows.AppNotifications.Builder;

namespace BNDZShell.Bndz;

/// <summary>
/// Windows Action Center / Notification Center via AppNotificationBuilder (Windows App SDK).
/// </summary>
internal static class BndzAppNotifications
{
	private static bool s_registered;

	public static void EnsureRegistered()
	{
		if (s_registered) return;
		try
		{
			var mgr = AppNotificationManager.Default;
			mgr.NotificationInvoked += (_, _) => { /* restore handled by activation args if needed */ };
			mgr.Register();
			s_registered = true;
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] AppNotification Register: {ex.Message}");
		}
	}

	public static bool TryShow(string title, string message, string? tag = null)
	{
		if (!BndzShellChromeSettings.NativeActionCenterToasts)
			return false;
		if (string.IsNullOrWhiteSpace(message))
			return false;

		EnsureRegistered();
		try
		{
			var builder = new AppNotificationBuilder()
				.AddArgument("action", "open")
				.AddText(string.IsNullOrWhiteSpace(title) ? "BNDZ" : title.Trim())
				.AddText(message.Trim());

			if (!string.IsNullOrWhiteSpace(tag))
				builder.SetTag(tag);

			var notification = builder.BuildNotification();
			AppNotificationManager.Default.Show(notification);
			return true;
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] AppNotification Show: {ex.Message}");
			return false;
		}
	}
}
