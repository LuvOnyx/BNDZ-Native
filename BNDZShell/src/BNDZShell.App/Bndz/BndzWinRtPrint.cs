using System.Diagnostics;
using Windows.Graphics.Printing;
using Windows.Storage;
using WinRT.Interop;

namespace BNDZShell.Bndz;

/// <summary>
/// Native Windows print pathways — PrintManagerInterop UI + shell print verb.
/// </summary>
internal static class BndzWinRtPrint
{
	public static async Task<bool> ShowPrintUiAsync(IntPtr hwnd)
	{
		try
		{
			// Desktop / WinUI 3: PrintManagerInterop (not UWP GetForCurrentView).
			return await PrintManagerInterop.ShowPrintUIForWindowAsync(hwnd);
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[BNDZShell] ShowPrintUI: {ex.Message}");
			return false;
		}
	}

	public static async Task<bool> PrintPathAsync(IntPtr hwnd, string? path)
	{
		if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
			return await ShowPrintUiAsync(hwnd);

		try
		{
			try
			{
				var psi = new ProcessStartInfo
				{
					FileName = path,
					Verb = "print",
					UseShellExecute = true,
					CreateNoWindow = true,
					WindowStyle = ProcessWindowStyle.Hidden,
				};
				if (psi.Verbs.Any(v => string.Equals(v, "print", StringComparison.OrdinalIgnoreCase)))
				{
					Process.Start(psi);
					return true;
				}
			}
			catch (Exception shellEx)
			{
				Debug.WriteLine($"[BNDZShell] shell print: {shellEx.Message}");
			}

			var file = await StorageFile.GetFileFromPathAsync(path);
			var options = new Windows.System.LauncherOptions
			{
				DisplayApplicationPicker = false,
			};
			InitializeWithWindow.Initialize(options, hwnd);
			return await Windows.System.Launcher.LaunchFileAsync(file, options);
		}
		catch (Exception ex)
		{
			Debug.WriteLine($"[BNDZShell] PrintPath: {ex.Message}");
			return await ShowPrintUiAsync(hwnd);
		}
	}
}
