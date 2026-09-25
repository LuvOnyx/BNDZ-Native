using System.Threading.Tasks;
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

	private const string TransferTag = "bndz-xfer";
	private const string TransferGroup = "transfers";
	private static int s_seq = 1;
	private static bool s_transferShown;
	private static int s_clearGen;

	/// <summary>
	/// Live Action Center progress toast for the file-transfer queue.
	/// phase: update | complete | failed | clear
	/// </summary>
	public static void UpdateTransfer(string? phase, string? title, string? detail, double? progressPercent, string? valueString, string? status)
	{
		if (!BndzShellChromeSettings.NativeActionCenterToasts)
			return;
		var p = (phase ?? "update").Trim().ToLowerInvariant();
		if (p is "clear" or "dismiss")
		{
			ClearTransfer();
			return;
		}
		EnsureRegistered();
		if (!s_registered) return;
		try
		{
			var pct = progressPercent ?? (p == "complete" ? 100 : 0);
			var value = Math.Clamp(pct / 100.0, 0, 1);
			var shownTitle = string.IsNullOrWhiteSpace(title) ? "BNDZ" : title.Trim();
			var shownStatus = string.IsNullOrWhiteSpace(status)
				? (p == "failed" ? "Failed" : p == "complete" ? "Done" : "Working")
				: status.Trim();
			var shownValue = string.IsNullOrWhiteSpace(valueString) ? $"{Math.Round(pct):0}%" : valueString.Trim();
			var shownDetail = string.IsNullOrWhiteSpace(detail) ? shownStatus : detail.Trim();

			uint seq;
			bool first;
			int gen;
			lock (typeof(BndzAppNotifications))
			{
				s_seq++;
				if (s_seq <= 0) s_seq = 1;
				seq = (uint)s_seq;
				first = !s_transferShown;
				s_transferShown = true;
				gen = ++s_clearGen;
			}

			var data = new AppNotificationProgressData(seq)
			{
				Title = shownTitle,
				Status = shownStatus,
				Value = value,
				ValueStringOverride = shownValue,
			};

			if (first)
				ShowTransfer(shownTitle, shownDetail, data);
			else
			{
				var op = AppNotificationManager.Default.UpdateAsync(data, TransferTag, TransferGroup);
				op.Completed = (asyncOp, _) =>
				{
					try
					{
						if (asyncOp.GetResults() == AppNotificationProgressResult.AppNotificationNotFound)
						{
							s_transferShown = false;
							ShowTransfer(shownTitle, shownDetail, data);
						}
					}
					catch (Exception ex)
					{
						System.Diagnostics.Debug.WriteLine($"[BNDZShell] transfer toast update: {ex.Message}");
					}
				};
			}

			if (p == "complete")
			{
				_ = Task.Run(async () =>
				{
					await Task.Delay(2200).ConfigureAwait(false);
					if (gen != s_clearGen) return;
					ClearTransfer();
				});
			}
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] transfer toast: {ex.Message}");
			BNDZ.Services.BndzBootLog.Mark("os-toast-blocked " + ex.GetType().Name + ": " + ex.Message);
		}
	}

	private static void ShowTransfer(string title, string detail, AppNotificationProgressData data)
	{
		var notification = new AppNotificationBuilder()
			.AddText(title)
			.AddText(detail)
			.AddProgressBar(new AppNotificationProgressBar()
				.BindTitle()
				.BindStatus()
				.BindValue()
				.BindValueStringOverride())
			.SetTag(TransferTag)
			.SetGroup(TransferGroup)
			.BuildNotification();
		notification.Progress = data;
		AppNotificationManager.Default.Show(notification);
		s_transferShown = true;
	}

	private static void ClearTransfer()
	{
		s_clearGen++;
		s_transferShown = false;
		try
		{
			if (!s_registered) return;
			var _ = AppNotificationManager.Default.RemoveByTagAndGroupAsync(TransferTag, TransferGroup);
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] transfer toast clear: {ex.Message}");
		}
	}
}

