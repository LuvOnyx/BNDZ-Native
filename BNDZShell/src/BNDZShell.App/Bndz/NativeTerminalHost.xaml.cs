using System.Diagnostics;
using EasyWindowsTerminalControl;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace BNDZShell.Bndz;

/// <summary>
/// WinUI overlay that hosts a real Windows Terminal TermControl (via EasyTerminalControl)
/// over the React bottom-plugin hole. Never parented into WebView2.
/// </summary>
public sealed partial class NativeTerminalHost : UserControl
{
	private EasyTerminalControl? _term;
	private string? _sessionId;
	private string _label = "Terminal";

	public event EventHandler<string>? SessionClosed;

	public NativeTerminalHost()
	{
		InitializeComponent();
	}

	public string? SessionId => _sessionId;
	public string Label => _label;
	public bool HasSession => _term is not null && !string.IsNullOrEmpty(_sessionId);

	/// <summary>Position over the React terminal hole (CSS/DIP coords from WebView).</summary>
	public void ApplyBounds(double x, double y, double width, double height, bool visible)
	{
		if (!visible || width < 24 || height < 24)
		{
			Visibility = Visibility.Collapsed;
			IsHitTestVisible = false;
			return;
		}

		Margin = new Thickness(Math.Max(0, x), Math.Max(0, y), 0, 0);
		Width = width;
		Height = height;
		Visibility = Visibility.Visible;
		IsHitTestVisible = true;
	}

	public void Open(
		string sessionId,
		string? commandLine,
		string? workingDirectory,
		string label)
	{
		if (string.IsNullOrWhiteSpace(sessionId))
			throw new ArgumentException("sessionId required", nameof(sessionId));
		if (string.IsNullOrWhiteSpace(commandLine))
			commandLine = BuildLocalCommandLine(workingDirectory);
		else if (!string.IsNullOrWhiteSpace(workingDirectory)
			&& Directory.Exists(workingDirectory)
			&& !LooksLikeSsh(commandLine))
		{
			// Packaged EasyTerminalControl lacks WorkingDirectory DP — bake cwd into shell args.
			commandLine = BuildLocalCommandLine(workingDirectory, commandLine);
		}

		Close(notify: false);

		_sessionId = sessionId;
		_label = string.IsNullOrWhiteSpace(label) ? "Local" : label.Trim();

		var term = new EasyTerminalControl
		{
			StartupCommandLine = commandLine,
			Win32InputMode = true,
			FontFamilyWhenSettingTheme = new FontFamily("Cascadia Mono"),
			FontSizeWhenSettingTheme = 13,
			InputCapture = EasyTerminalControl.INPUT_CAPTURE.TabKey | EasyTerminalControl.INPUT_CAPTURE.DirectionKeys,
			HorizontalAlignment = HorizontalAlignment.Stretch,
			VerticalAlignment = VerticalAlignment.Stretch,
		};

		TermSlot.Children.Clear();
		TermSlot.Children.Add(term);
		_term = term;

		Visibility = Visibility.Visible;
		IsHitTestVisible = true;
	}

	public void Close(bool notify = true)
	{
		var sid = _sessionId;
		var term = _term;
		_term = null;
		_sessionId = null;
		_label = "Terminal";

		if (term is not null)
		{
			try
			{
				var pty = term.DisconnectConPTYTerm();
				pty?.StopExternalTermOnly();
			}
			catch (Exception ex)
			{
				Debug.WriteLine($"[NativeTerminalHost] close: {ex.Message}");
			}
		}

		TermSlot.Children.Clear();
		Visibility = Visibility.Collapsed;
		IsHitTestVisible = false;

		if (notify && !string.IsNullOrEmpty(sid))
			SessionClosed?.Invoke(this, sid!);
	}

	public static string ResolveDefaultShell()
	{
		try
		{
			var pwsh = FindOnPath("pwsh.exe");
			if (pwsh is not null) return $"\"{pwsh}\"";
		}
		catch { /* ignore */ }
		return "powershell.exe";
	}

	public static string BuildLocalCommandLine(string? workingDirectory, string? shellOverride = null)
	{
		var shell = string.IsNullOrWhiteSpace(shellOverride) ? ResolveDefaultShell() : shellOverride.Trim();
		if (string.IsNullOrWhiteSpace(workingDirectory) || !Directory.Exists(workingDirectory))
			return shell;

		var cwd = workingDirectory.Trim().TrimEnd('\\');
		var isPwsh = shell.Contains("pwsh", StringComparison.OrdinalIgnoreCase);
		if (isPwsh)
			return $"{shell} -NoLogo -WorkingDirectory \"{cwd}\"";

		var escaped = cwd.Replace("'", "''", StringComparison.Ordinal);
		return $"{shell} -NoLogo -NoExit -Command \"Set-Location -LiteralPath '{escaped}'\"";
	}

	private static bool LooksLikeSsh(string commandLine) =>
		commandLine.TrimStart().StartsWith("ssh", StringComparison.OrdinalIgnoreCase);

	private static string? FindOnPath(string fileName)
	{
		var path = Environment.GetEnvironmentVariable("PATH") ?? "";
		foreach (var dir in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
		{
			try
			{
				var candidate = Path.Combine(dir.Trim(), fileName);
				if (File.Exists(candidate)) return candidate;
			}
			catch { /* ignore */ }
		}
		return null;
	}
}
