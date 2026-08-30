using BNDZShell.Bndz;
using Microsoft.UI.Xaml;

namespace BNDZShell;

public partial class App : Application
{
	/// <summary>
	/// Must be retained — WinUI GC collects the Window if only a local in OnLaunched holds it,
	/// which leaves a dead HWND and a blank native shell (WebView2 never paints).
	/// </summary>
	private MainWindow? _mainWindow;

	public App()
	{
		InitializeComponent();
		BndzShellChromeSettings.Load();
		BndzAppNotifications.EnsureRegistered();
		UnhandledException += (_, e) =>
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] Unhandled: {e.Exception}");
			try
			{
				var logDir = System.IO.Path.Combine(
					Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
					"BNDZ");
				System.IO.Directory.CreateDirectory(logDir);
				System.IO.File.AppendAllText(
					System.IO.Path.Combine(logDir, "shell-crash.log"),
					$"{DateTime.UtcNow:o} {e.Exception}\n");
			}
			catch { /* best-effort */ }
			e.Handled = true;
			try
			{
				_mainWindow?.ShowFatalError(e.Exception?.Message ?? "Unknown error");
			}
			catch { /* ignore */ }
		};
	}

	protected override void OnLaunched(LaunchActivatedEventArgs args)
	{
		PluginWindowBoot.Parse(Environment.GetCommandLineArgs());
		_mainWindow = new MainWindow();
		_mainWindow.Activate();
	}
}
