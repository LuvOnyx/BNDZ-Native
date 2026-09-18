using System.Diagnostics;
using EasyWindowsTerminalControl;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace BNDZShell.Bndz;

/// <summary>
/// Legacy WinUI TermControl overlay slot. Creation is disabled — EasyTerminalControl
/// HWND + ConPTY over WebView2 freezes the UI thread and deadlocks caption Close.
/// Local shell is ConPTY → xterm.js via MESH_TERMINAL_OPEN. This control only tears down
/// leftover overlays from older builds.
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
		_ = (x, y);
		if (!visible || width < 24 || height < 24)
		{
			Visibility = Visibility.Collapsed;
			IsHitTestVisible = false;
			return;
		}

		// Never show — overlay path is retired.
		Visibility = Visibility.Collapsed;
		IsHitTestVisible = false;
	}

	/// <summary>
	/// Retired: EasyTerminalControl HWND + ConPTY over WebView2 freezes the UI thread
	/// and deadlocks caption Close. Local shell is ConPTY → xterm via MESH_TERMINAL_OPEN.
	/// </summary>
	public void Open(
		string sessionId,
		string? commandLine,
		string? workingDirectory,
		string label)
	{
		_ = (sessionId, commandLine, workingDirectory, label);
		Close(notify: false);
		throw new InvalidOperationException(
			"WinUI TermControl overlay disabled — use ConPTY→xterm (meshTerminalOpen).");
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
