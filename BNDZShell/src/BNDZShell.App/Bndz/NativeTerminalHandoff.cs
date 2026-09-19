using EasyWindowsTerminalControl;
using Microsoft.Terminal.Wpf;

namespace BNDZShell.Bndz;

/// <summary>
/// In-process hand-off of a warm ConPTY between the main FM window and a Remote plugin pop-out.
/// TermControl HWNDs cannot move across windows; TermPTY can.
/// </summary>
internal static class NativeTerminalHandoff
{
	private static readonly object Gate = new();
	private static TermPTY? _pty;
	private static string? _sessionId;
	private static string _label = "Local";
	private static string? _pendingCmd;
	private static string? _pendingCwd;
	private static string _fontFamily = "Cascadia Mono";
	private static int _fontSize = 11;
	private static string _foreground = "#d8dee9";
	private static string _background = "#07090e";
	private static string _cursor = "#7dd3fc";

	public static bool HasPending
	{
		get { lock (Gate) return _pty is not null && !string.IsNullOrEmpty(_sessionId); }
	}

	public static void Deposit(
		TermPTY pty,
		string sessionId,
		string label,
		string? pendingCmd,
		string? pendingCwd,
		string fontFamily,
		int fontSize,
		string foreground,
		string background,
		string cursor)
	{
		lock (Gate)
		{
			if (_pty is not null && !ReferenceEquals(_pty, pty))
			{
				try { _pty.StopExternalTermOnly(); } catch { /* ignore */ }
			}
			_pty = pty;
			_sessionId = sessionId;
			_label = string.IsNullOrWhiteSpace(label) ? "Local" : label.Trim();
			_pendingCmd = pendingCmd;
			_pendingCwd = pendingCwd;
			_fontFamily = fontFamily;
			_fontSize = fontSize;
			_foreground = foreground;
			_background = background;
			_cursor = cursor;
		}
	}

	public static bool TryTake(
		out TermPTY? pty,
		out string? sessionId,
		out string label,
		out string? pendingCmd,
		out string? pendingCwd,
		out string fontFamily,
		out int fontSize,
		out string foreground,
		out string background,
		out string cursor)
	{
		lock (Gate)
		{
			pty = _pty;
			sessionId = _sessionId;
			label = _label;
			pendingCmd = _pendingCmd;
			pendingCwd = _pendingCwd;
			fontFamily = _fontFamily;
			fontSize = _fontSize;
			foreground = _foreground;
			background = _background;
			cursor = _cursor;
			if (pty is null || string.IsNullOrEmpty(sessionId))
			{
				pty = null;
				sessionId = null;
				return false;
			}
			_pty = null;
			_sessionId = null;
			_pendingCmd = null;
			_pendingCwd = null;
			return true;
		}
	}
}
