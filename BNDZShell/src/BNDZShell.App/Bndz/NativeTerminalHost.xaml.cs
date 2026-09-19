using System.Diagnostics;
using System.Runtime.InteropServices;
using EasyWindowsTerminalControl;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Terminal.Wpf;

namespace BNDZShell.Bndz;

/// <summary>
/// WinUI overlay hosting Windows Terminal TermControl (EasyTerminalControl)
/// over the React Remote plugin hole. Never parented into WebView2.
/// </summary>
public sealed partial class NativeTerminalHost : UserControl
{
	private EasyTerminalControl? _term;
	private string? _sessionId;
	private string _label = "Terminal";
	private string? _pendingCmd;
	private string? _pendingCwd;
	private bool _awaitingSizedStart;
	private int _createGen;
	private int _ensureSeq;
	private DispatcherQueueTimer? _debounceTimer;
	private int _debounceSeq;
	private string _fontFamily = "Cascadia Mono";
	private int _fontSize = 11;
	private string _foreground = "#d8dee9";
	private string _background = "#07090e";
	private string _cursor = "#7dd3fc";
	public event EventHandler<bool>? TermMountFinished;

	public event EventHandler<string>? SessionClosed;

	public NativeTerminalHost()
	{
		InitializeComponent();
	}

	public string? SessionId => _sessionId;
	public string Label => _label;
	public bool HasSession => !string.IsNullOrEmpty(_sessionId);

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
		HorizontalAlignment = HorizontalAlignment.Left;
		VerticalAlignment = VerticalAlignment.Top;
		Visibility = Visibility.Visible;
		IsHitTestVisible = true;

		// Create (or retry) only with a real hole size. Armed session + no term => ensure.

		// Creating too early => blinking cursor, no PowerShell text.

		if (!string.IsNullOrEmpty(_sessionId) && _term is null && Width >= 48 && Height >= 48)

			EnsureTermAtSize();
	}

	public void SetStripActive(bool active)
	{
		if (!active)
		{
			Visibility = Visibility.Collapsed;
			IsHitTestVisible = false;
		}
	}

	public void Open(
		string sessionId,
		string? commandLine,
		string? workingDirectory,
		string label)
	{
		if (string.IsNullOrWhiteSpace(sessionId))
			throw new ArgumentException("sessionId required", nameof(sessionId));

		Close(notify: false);

		_sessionId = sessionId;
		_label = string.IsNullOrWhiteSpace(label) ? "Local" : label.Trim();
		_pendingCmd = string.IsNullOrWhiteSpace(commandLine) ? null : commandLine.Trim();
		_pendingCwd = string.IsNullOrWhiteSpace(workingDirectory) ? null : workingDirectory.Trim();
		_awaitingSizedStart = true;

		TermLog($"Open sid={_sessionId} label={_label} cwd={_pendingCwd ?? ""} cmd={_pendingCmd ?? "(default shell)"}");
	}

	public Task OpenAsync(
		string sessionId,
		string? commandLine,
		string? workingDirectory,
		string label,
		CancellationToken cancellationToken = default)
	{
		_ = cancellationToken;
		Open(sessionId, commandLine, workingDirectory, label);
		return Task.CompletedTask;
	}


	public void ApplyThemePrefs(
		string? fontFamily = null,
		int? fontSize = null,
		string? foreground = null,
		string? background = null,
		string? cursor = null)
	{
		if (!string.IsNullOrWhiteSpace(fontFamily))
			_fontFamily = fontFamily.Trim();
		if (fontSize is int fs && fs > 0)
			_fontSize = Math.Clamp(fs, 8, 32);
		if (!string.IsNullOrWhiteSpace(foreground))
			_foreground = NormalizeHex(foreground);
		if (!string.IsNullOrWhiteSpace(background))
			_background = NormalizeHex(background);
		if (!string.IsNullOrWhiteSpace(cursor))
			_cursor = NormalizeHex(cursor);

		ApplyThemeToLiveControl();
	}

	private void ApplyThemeToLiveControl()
	{
		if (_term is null) return;
		try
		{
			_term.FontFamilyWhenSettingTheme = new FontFamily(ResolveFontFace(_fontFamily));
			_term.FontSizeWhenSettingTheme = Math.Clamp(_fontSize, 8, 32);
			_term.Theme = BuildTerminalTheme(_foreground, _background, _cursor);
		}
		catch (Exception ex)
		{
			TermLog($"ApplyThemeToLiveControl: {ex.Message}");
		}
	}

	public void Close(bool notify = true)
	{
		var sid = _sessionId;
		DisposeTerm();
		_sessionId = null;
		_label = "Terminal";
		_pendingCmd = null;
		_pendingCwd = null;
		_awaitingSizedStart = false;
		Interlocked.Increment(ref _createGen);

		Visibility = Visibility.Collapsed;
		IsHitTestVisible = false;
		Width = double.NaN;
		Height = double.NaN;

		if (notify && !string.IsNullOrEmpty(sid))
			SessionClosed?.Invoke(this, sid!);
	}

	private void EnsureTermAtSize()
	{
		if (string.IsNullOrEmpty(_sessionId)) return;
		if (Width < 48 || Height < 48) return;
		if (_term is not null)
		{
			_awaitingSizedStart = false;
			return;
		}

		var dq = DispatcherQueue;
		if (dq is null)
		{
			TermLog("EnsureTermAtSize: DispatcherQueue is null");
			return;
		}

		// Debounce on a DispatcherQueueTimer — Tick always runs on the UI thread.
		// Task.Delay continuations were hopping off-thread (RPC_E_WRONG_THREAD / 0x8001010E).
		_debounceSeq = Interlocked.Increment(ref _ensureSeq);
		_debounceTimer ??= dq.CreateTimer();
		_debounceTimer.IsRepeating = false;
		_debounceTimer.Interval = TimeSpan.FromMilliseconds(100);
		_debounceTimer.Tick -= OnDebounceTick;
		_debounceTimer.Tick += OnDebounceTick;
		_debounceTimer.Stop();
		_debounceTimer.Start();
	}

	private void OnDebounceTick(DispatcherQueueTimer sender, object args)
	{
		sender.Stop();
		var seq = _debounceSeq;
		if (seq != Volatile.Read(ref _ensureSeq)) return;
		TryMountTermNow(seq);
	}

	/// <summary>Synchronous UI-thread mount. Returns true if TermControl is alive.</summary>
	public bool TryMountTermNow(int seq = -1)
	{
		try
		{
			if (seq >= 0 && seq != Volatile.Read(ref _ensureSeq)) return _term is not null;
			if (string.IsNullOrEmpty(_sessionId)) return false;
			if (_term is not null)
			{
				_awaitingSizedStart = false;
				return true;
			}
			if (Width < 48 || Height < 48 || Visibility != Visibility.Visible)
			{
				_awaitingSizedStart = true;
				TermLog($"TryMountTermNow defer size={Width:F0}x{Height:F0} vis={Visibility}");
				return false;
			}

			var dq = DispatcherQueue;
			if (dq is not null && !dq.HasThreadAccess)
			{
				TermLog("TryMountTermNow: wrong thread - enqueue");
				dq.TryEnqueue(() => TryMountTermNow(seq));
				return false;
			}

			var gen = Interlocked.Increment(ref _createGen);
			var cwd = NormalizeLocalWorkingDirectory(_pendingCwd);
			if (!string.IsNullOrEmpty(cwd) && !Directory.Exists(cwd))
				cwd = null;

			var cmd = _pendingCmd;
			if (string.IsNullOrWhiteSpace(cmd))
				cmd = string.IsNullOrEmpty(cwd) ? ResolveDefaultShell() : BuildLocalCommandLine(cwd);
			else if (!LooksLikeSsh(cmd) && !string.IsNullOrEmpty(cwd))
				cmd = BuildLocalCommandLine(cwd, cmd);

			TermLog($"TryMountTermNow cmd={cmd} size={Width:F0}x{Height:F0} uiThread={dq?.HasThreadAccess}");

			DisposeTerm();

			var term = new EasyTerminalControl
			{
				StartupCommandLine = cmd,
				Win32InputMode = true,
				FontFamilyWhenSettingTheme = new FontFamily(ResolveFontFace(_fontFamily)),
				FontSizeWhenSettingTheme = Math.Clamp(_fontSize, 8, 32),
				Theme = BuildTerminalTheme(_foreground, _background, _cursor),
				InputCapture = EasyTerminalControl.INPUT_CAPTURE.TabKey | EasyTerminalControl.INPUT_CAPTURE.DirectionKeys,
				HorizontalAlignment = HorizontalAlignment.Stretch,
				VerticalAlignment = VerticalAlignment.Stretch,
			};
			TermSlot.Children.Clear();
			TermSlot.Children.Add(term);
			_term = term;
			_awaitingSizedStart = false;
			TermLog($"Term mounted gen={gen} size={Width:F0}x{Height:F0} actual={ActualWidth:F0}x{ActualHeight:F0}");
			try { term.Focus(FocusState.Programmatic); } catch { /* ignore */ }
			TermMountFinished?.Invoke(this, true);
			return true;
		}
		catch (Exception ex)
		{
			_awaitingSizedStart = true;
			_term = null;
			var hr = ex is COMException cex ? $" HR=0x{cex.HResult:X8}" : "";
			TermLog($"TryMountTermNow failed: {ex.GetType().Name}: {ex.Message}{hr}");
			TermMountFinished?.Invoke(this, false);
			return false;
		}
	}

	private void DisposeTerm()
	{
		var term = _term;
		_term = null;
		if (term is not null)
		{
			try
			{
				var pty = term.DisconnectConPTYTerm();
				pty?.StopExternalTermOnly();
			}
			catch (Exception ex)
			{
				Debug.WriteLine($"[NativeTerminalHost] dispose: {ex.Message}");
			}
		}
		try { TermSlot.Children.Clear(); } catch { /* ignore */ }
	}

	public static string ResolveDefaultShell()
	{
		// Never use WindowsApps pwsh.exe - execution-alias stub. ConPTY cannot start it.
		foreach (var candidate in CandidatePwshPaths())
		{
			if (File.Exists(candidate))
				return $"\"{candidate}\" -NoLogo";
		}
		try
		{
			var pwsh = FindOnPath("pwsh.exe", skipWindowsApps: true);
			if (pwsh is not null) return $"\"{pwsh}\" -NoLogo";
		}
		catch { /* ignore */ }
		return "powershell.exe -NoLogo";
	}

	private static System.Collections.Generic.IEnumerable<string> CandidatePwshPaths()
	{
		var pf = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
		var pf86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
		yield return Path.Combine(pf, "PowerShell", "7", "pwsh.exe");
		yield return Path.Combine(pf, "PowerShell", "7-preview", "pwsh.exe");
		yield return Path.Combine(pf, "PowerShell", "6", "pwsh.exe");
		if (!string.Equals(pf, pf86, StringComparison.OrdinalIgnoreCase))
			yield return Path.Combine(pf86, "PowerShell", "7", "pwsh.exe");
	}

	/// <summary>
	/// Drive roots must keep a trailing slash — "C:" alone does not Set-Location / -WorkingDirectory correctly.
	/// </summary>
	public static string? NormalizeLocalWorkingDirectory(string? workingDirectory)
	{
		if (string.IsNullOrWhiteSpace(workingDirectory)) return null;
		var cwd = workingDirectory.Trim();
		if (cwd.Length >= 2 && cwd[1] == ':' && (cwd.Length == 2 || (cwd.Length == 3 && (cwd[2] == '\\' || cwd[2] == '/'))))
			return char.ToUpperInvariant(cwd[0]) + ":\\";
		return cwd.TrimEnd('\\', '/');
	}

	public static string BuildLocalCommandLine(string? workingDirectory, string? shellOverride = null)
	{
		var shell = string.IsNullOrWhiteSpace(shellOverride) ? ResolveDefaultShell() : shellOverride.Trim();
		var cwd = NormalizeLocalWorkingDirectory(workingDirectory);
		if (string.IsNullOrEmpty(cwd) || !Directory.Exists(cwd))
			return shell;

		var exe = ExtractShellExe(shell);
		var isPwsh = exe.Contains("pwsh", StringComparison.OrdinalIgnoreCase);
		if (isPwsh)
			return $"{exe} -NoLogo -WorkingDirectory \"{cwd}\"";

		var escaped = cwd.Replace("'", "''", StringComparison.Ordinal);
		return $"{exe} -NoLogo -NoExit -Command \"Set-Location -LiteralPath '{escaped}'\"";
	}

	private static string ExtractShellExe(string shellCmd)
	{
		var s = shellCmd.Trim();
		if (s.StartsWith('"'))
		{
			var end = s.IndexOf('"', 1);
			if (end > 1) return s[..(end + 1)];
		}
		var sp = s.IndexOf(' ');
		return sp > 0 ? s[..sp] : s;
	}

	private static bool LooksLikeSsh(string commandLine) =>
		commandLine.TrimStart().StartsWith("ssh", StringComparison.OrdinalIgnoreCase);

	private static string? FindOnPath(string fileName, bool skipWindowsApps = true)
	{
		var pathEnv = Environment.GetEnvironmentVariable("PATH") ?? "";
		var apps = Path.Combine(
			Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
			"Microsoft", "WindowsApps");
		foreach (var dir in pathEnv.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
		{
			try
			{
				var trimmed = dir.Trim().Trim('"');
				if (skipWindowsApps && trimmed.StartsWith(apps, StringComparison.OrdinalIgnoreCase))
					continue;
				var candidate = Path.Combine(trimmed, fileName);
				if (File.Exists(candidate)) return candidate;
			}
			catch { /* ignore */ }
		}
		return null;
	}


	private static string ResolveFontFace(string? family)
	{
		if (string.IsNullOrWhiteSpace(family)) return "Cascadia Mono";
		var s = family.Trim();
		if (s.Length >= 2 && (s[0] == '"' || s[0] == '\''))
		{
			var q = s[0];
			var end = s.IndexOf(q, 1);
			if (end > 1) return s.Substring(1, end - 1).Trim();
		}
		var comma = s.IndexOf(',');
		if (comma > 0) s = s.Substring(0, comma).Trim();
		return string.IsNullOrWhiteSpace(s) ? "Cascadia Mono" : s.Trim().Trim('"').Trim('\'');
	}

	private static string NormalizeHex(string hex)
	{
		var h = hex.Trim();
		if (!h.StartsWith('#')) h = "#" + h;
		return h.Length >= 7 ? h.Substring(0, 7) : h;
	}

	/// <summary>COLORREF packer (0x00BBGGRR) — no System.Drawing dependency.</summary>
	private static uint ColorToVal(byte r, byte g, byte b) =>
		(uint)(r | (g << 8) | (b << 16));

	private static bool TryParseHexColor(string hex, out byte r, out byte g, out byte b)
	{
		r = g = b = 0;
		var h = hex.Trim().TrimStart('#');
		if (h.Length == 3)
			h = string.Concat(h[0], h[0], h[1], h[1], h[2], h[2]);
		if (h.Length != 6) return false;
		try
		{
			r = Convert.ToByte(h.Substring(0, 2), 16);
			g = Convert.ToByte(h.Substring(2, 2), 16);
			b = Convert.ToByte(h.Substring(4, 2), 16);
			return true;
		}
		catch { return false; }
	}

	private static TerminalTheme BuildTerminalTheme(string foreground, string background, string cursor)
	{
		if (!TryParseHexColor(foreground, out var fr, out var fg, out var fb))
		{ fr = 0xd8; fg = 0xde; fb = 0xe9; }
		if (!TryParseHexColor(background, out var br, out var bg, out var bb))
		{ br = 0x07; bg = 0x09; bb = 0x0e; }
		_ = cursor;

		return new TerminalTheme
		{
			DefaultBackground = ColorToVal(br, bg, bb),
			DefaultForeground = ColorToVal(fr, fg, fb),
			DefaultSelectionBackground = ColorToVal(0xCC, 0xCC, 0xCC),
			CursorStyle = CursorStyle.BlinkingBar,
			ColorTable = new uint[]
			{
				0x0C0C0C, 0x1F0FC5, 0x0EA113, 0x009CC1,
				0xDA3700, 0x981788, 0xDD963A, 0xCCCCCC,
				0x767676, 0x5648E7, 0x0CC616, 0xA5F1F9,
				0xFF783B, 0x9E00B4, 0xD6D661, 0xF2F2F2,
			},
		};
	}

	private static void TermLog(string message)
	{
		try
		{
			var dir = Path.Combine(
				Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
				"BNDZ");
			Directory.CreateDirectory(dir);
			File.AppendAllText(
				Path.Combine(dir, "native-term.log"),
				$"{DateTime.Now:HH:mm:ss.fff} {message}{Environment.NewLine}");
		}
		catch { /* best-effort */ }
	}
}
