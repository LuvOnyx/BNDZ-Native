using System;
using System.Reflection;
using System.Threading;
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
	/// <summary>ConPTY kept alive while TermControl HWND is detached (tab switch away from Remote).</summary>
	private TermPTY? _warmPty;
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
	/// <summary>Non-zero while ParkTermHwnd / DestroyTermControlUi is on the stack (Dispose may pump messages).</summary>
	private int _parkGate;
	/// <summary>Non-zero for the whole DestroyTermControlUiCore call (incl. async enqueue).</summary>
	private int _teardownActive;
	/// <summary>True after a successful hide-park until the next intentional visible ApplyBounds.</summary>
	private bool _parkedInactive;
		/// <summary>Environment.TickCount64 deadline; ignore LAYOUT hide so Open mount isn't parked by hole blips.</summary>
		private long _ignoreHideUntilTick;
		/// <summary>After keepAlive soft-hide, ignore visible:true briefly so stale FE layout pulses do not un-hide HWND over the next plugin.</summary>
		private long _ignoreShowUntilTick;
		/// <summary>KeepAlive soft-hide sticky: ignore visible:true until intentional unpark (Remote+Terminal).</summary>
		private bool _softParked;
		/// <summary>After keepAlive park, first intentional unpark remounts TermControl UI (ConPTY kept) — ShowWindow alone leaves a blank surface.</summary>
		private bool _warmRemountOnUnpark;
		/// <summary>Serialize warm remount so FE layout cannot nest Dispose/Destroy (crash after a few switches).</summary>
		private int _remountBusy;
		/// <summary>Close clicked while warm remount in flight — run Close after remount settles.</summary>
		private bool _closeAfterRemount;
		/// <summary>Coalesce duplicate FE ApplyBounds show frames (post-remount thrash).</summary>
		private long _lastShowBoundsTick;
		private double _lastShowW, _lastShowH, _lastShowX, _lastShowY;
		/// <summary>Coalesce PulseTermPaintAfterUnpark within a short window.</summary>
		private long _lastPulsePaintTick;

		/// <summary>HWNDs reparented to HWND_MESSAGE on keepAlive park — restored on unpark.</summary>
		private readonly System.Collections.Generic.List<(IntPtr Hwnd, IntPtr Parent)> _parkedHwnds = new(4);
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
	public void ApplyBounds(double x, double y, double width, double height, bool visible, bool unpark = false)
	{
		if (Volatile.Read(ref _remountBusy) != 0)
		{
			TermLog($"ApplyBounds ignore during remount visible={visible} unpark={unpark} size={width:F0}x{height:F0}");
			return;
		}
				if (!visible || width < 24 || height < 24)
		{
			// Undersized *show* during open grace only — never swallow intentional visible:false
			// (plugin leave). Ignoring leave hide made the first tab click look like a no-op.
			if (visible
				&& Environment.TickCount64 < _ignoreHideUntilTick
				&& !string.IsNullOrEmpty(_sessionId))
			{
				TermLog($"ApplyBounds undersized-show ignored (open grace) size={width:F0}x{height:F0}");
				return;
			}
			ParkTermHwnd(reason: "ApplyBounds-hide");
			return;
		}

		// Dispose(HwndHost) / DestroyWindow pumps the UI queue. Stale NATIVE_TERMINAL_LAYOUT
		// (visible:true) must not remount mid-park — that nested mount/park StackOverflows BNDZ.
		if (Volatile.Read(ref _parkGate) != 0 || Volatile.Read(ref _teardownActive) != 0)
		{
			TermLog($"ApplyBounds ignore visible during teardown/park size={width:F0}x{height:F0}");
			return;
		}
		if (_parkedInactive && string.IsNullOrEmpty(_sessionId))
		{
			TermLog("ApplyBounds ignore visible: parked with no session");
			SoftCollapseHost();
			return;
		}

		// Sticky soft-park: after plugin leave, ignore visible:true unless FE sends unpark
		// (Remote+Terminal intentional). Stale hole/open pulses were un-hiding HWND over the next plugin.
		if (_softParked)
		{
			// Without unpark: stay sticky (stale hole pulses must not cover the next plugin).
			if (!unpark)
			{
				TermLog($"ApplyBounds show ignored (softParked sticky) unpark=False size={width:F0}x{height:F0}");
				return;
			}
			// Brief leave-race window only. The old 800ms gate swallowed warm-return
			// unpark pulses at 0/32/160ms so the HWND stayed blank until Close/New.
			if (Environment.TickCount64 < _ignoreShowUntilTick)
			{
				TermLog($"ApplyBounds show deferred (softParked leave-race) unpark=True size={width:F0}x{height:F0}");
				return;
			}
			_softParked = false;
		}

		_parkedInactive = false;
		_ignoreShowUntilTick = 0;

		// Duplicate FE layout frames after remount/unpark spam Pulse+TryShow dozens of times/sec.
		var ax = Math.Max(0, x);
		var ay = Math.Max(0, y);
		if (_term is not null
			&& !_warmRemountOnUnpark
			&& Visibility == Visibility.Visible
			&& Opacity >= 1
			&& Math.Abs(_lastShowW - width) < 1.5
			&& Math.Abs(_lastShowH - height) < 1.5
			&& Math.Abs(_lastShowX - ax) < 1.5
			&& Math.Abs(_lastShowY - ay) < 1.5
			&& Environment.TickCount64 - _lastShowBoundsTick < 90)
		{
			return;
		}
		_lastShowBoundsTick = Environment.TickCount64;
		_lastShowW = width;
		_lastShowH = height;
		_lastShowX = ax;
		_lastShowY = ay;

		Margin = new Thickness(ax, ay, 0, 0);
		Width = width;
		Height = height;
		HorizontalAlignment = HorizontalAlignment.Left;
		VerticalAlignment = VerticalAlignment.Top;
		Visibility = Visibility.Visible;
		Opacity = 1;
		IsHitTestVisible = true;

		if (_term is not null)
		{
			// keepAlive park leaves HWND "shown" but TermControl surface blank until Close/New.
			// Remount UI once on intentional unpark; ConPTY stays in _warmPty across DisposeTerm(false).
			if (_warmRemountOnUnpark)
			{
				_warmRemountOnUnpark = false;
				RemountWarmSurfaceAfterUnpark(x, y, width, height);
				return;
			}
			TryShowTermHwnds(_term);
			PulseTermPaintAfterUnpark(width, height);
			TermLog($"ApplyBounds unpark show size={width:F0}x{height:F0}");
			return;
		}

		if (!string.IsNullOrEmpty(_sessionId) && Width >= 48 && Height >= 48)
		{
			// Warm handoff / remount: skip 100ms debounce so pop-out paints as soon as the hole exists.
			if (_warmPty is not null && _term is null)
				TryMountTermNow();
			else
				EnsureTermAtSize();
		}
	}

	public void SetStripActive(bool active)
	{
		if (!active)
			ParkTermHwnd(reason: "SetStripActive");
	}

	/// <summary>
	/// Remove TermControl HWND from the visual tree without killing ConPTY.
	/// EasyWindowsTerminalControl documents detach/reattach of live TermPTY instances.
	/// </summary>
	private void ParkTermHwnd(string reason, bool keepAlive = true)
	{
		if (Volatile.Read(ref _remountBusy) != 0)
		{
			TermLog($"ParkTermHwnd skip during remount reason={reason}");
			return;
		}
		// Re-entrant park (Dispose/DestroyWindow pumps NATIVE_TERMINAL_LAYOUT) must not nest
		// another DestroyTermControlUi - that StackOverflowException killed BNDZ @ 12:55 CT.
		if (Interlocked.CompareExchange(ref _parkGate, 1, 0) != 0)
		{
			TermLog($"ParkTermHwnd reentrant skip reason={reason} warm={_warmPty is not null} keep={_term is not null}");
			SoftCollapseHost();
			return;
		}

		var releaseGate = true;
		try
		{
			_parkedInactive = true;
			CancelTermDebounce();
			SoftCollapseHost();

			if (_term is null)
			{
				TermLog($"ParkTermHwnd already detached reason={reason} warm={_warmPty is not null}");
				return;
			}

			// Plugin-switch thrash (log 11:31): detach+Destroy+remount every tab flip StackOverflows
			// after a few cycles. Keep TermControl+ConPTY, SoftCollapse + Win32 SW_HIDE only.
			if (keepAlive)
			{
				TryHideTermHwnds(_term, reparentToMessage: true, trackForRestore: true);
				_softParked = true;
				_warmRemountOnUnpark = true;
				_ignoreShowUntilTick = Environment.TickCount64 + 120;
				TermLog($"ParkTermHwnd soft-hide keepAlive reason={reason} ignoreShow=120ms reparent=True warmRemount=True");
				return;
			}

			var term = _term;
			_term = null;
			try
			{
				var pty = term.DisconnectConPTYTerm();
				if (pty is not null)
					_warmPty = pty;
				TermLog($"ParkTermHwnd detach ok reason={reason} warm={_warmPty is not null}");
			}
			catch (Exception ex)
			{
				TermLog($"ParkTermHwnd detach failed reason={reason}: {ex.Message}");
			}
			Interlocked.Exchange(ref _teardownActive, 1);
			releaseGate = DestroyTermControlUi(term, reason, releaseGateAfter: true);
		}
		finally
		{
			if (releaseGate)
			{
				Interlocked.Exchange(ref _teardownActive, 0);
				Interlocked.Exchange(ref _parkGate, 0);
			}
		}
	}

	/// <summary>
	/// Rebuild TermControl after keepAlive HWND_MESSAGE park while preserving ConPTY.
	/// SoftCollapse + SetParent restore alone leave a blank surface (Mikey: Close/New required).
	/// Deferred fullDispose + second-tick mount — sync remount StackOverflow'd after a few switches.
	/// </summary>
	private void RemountWarmSurfaceAfterUnpark(double x, double y, double width, double height)
	{
		if (Interlocked.CompareExchange(ref _remountBusy, 1, 0) != 0)
		{
			TermLog("RemountWarmSurfaceAfterUnpark busy skip");
			return;
		}

		var w = Math.Max(48, width);
		var h = Math.Max(48, height);
		var mx = Math.Max(0, x);
		var my = Math.Max(0, y);
		TermLog($"RemountWarmSurfaceAfterUnpark begin size={w:F0}x{h:F0}");

		SoftCollapseHost();
		CancelTermDebounce();
		_softParked = false;
		_warmRemountOnUnpark = false;
		_ignoreShowUntilTick = 0;
		_parkedHwnds.Clear();

		var term = _term;
		_term = null;
		if (term is null)
		{
			try { FinishWarmRemount(mx, my, w, h); }
			finally { Interlocked.Exchange(ref _remountBusy, 0); }
			return;
		}

		try
		{
			var pty = term.DisconnectConPTYTerm();
			if (pty is not null)
				_warmPty = pty;
		}
		catch (Exception ex)
		{
			TermLog($"RemountWarmSurfaceAfterUnpark disconnect: {ex.Message}");
		}

		var dq = DispatcherQueue;
		if (dq is null)
		{
			try { DestroyTermControlUiCore(term, "DisposeTerm-warm-remount"); }
			catch (Exception ex) { TermLog($"RemountWarmSurfaceAfterUnpark destroy: {ex.Message}"); }
			try { FinishWarmRemount(mx, my, w, h); }
			finally { Interlocked.Exchange(ref _remountBusy, 0); }
			return;
		}

		// Hold gates through deferred HWND Dispose so FE cannot remount mid-DestroyWindow.
		Interlocked.Exchange(ref _parkGate, 1);
		Interlocked.Exchange(ref _teardownActive, 1);
		TermLog("RemountWarmSurfaceAfterUnpark enqueue dispose+remount");
		dq.TryEnqueue(() =>
		{
			try
			{
				DestroyTermControlUiCore(term, "DisposeTerm-warm-remount");
			}
			catch (Exception ex)
			{
				TermLog($"RemountWarmSurfaceAfterUnpark destroy: {ex.Message}");
			}
			finally
			{
				Interlocked.Exchange(ref _teardownActive, 0);
				Interlocked.Exchange(ref _parkGate, 0);
			}

			dq.TryEnqueue(() =>
			{
				try { FinishWarmRemount(mx, my, w, h); }
				finally { Interlocked.Exchange(ref _remountBusy, 0); }
			});
		});
	}

	private void FinishWarmRemount(double x, double y, double width, double height)
	{
		_parkedInactive = false;
		_softParked = false;
		_ignoreShowUntilTick = 0;
		Margin = new Thickness(x, y, 0, 0);
		Width = width;
		Height = height;
		HorizontalAlignment = HorizontalAlignment.Left;
		VerticalAlignment = VerticalAlignment.Top;
		Visibility = Visibility.Visible;
		Opacity = 1;
		IsHitTestVisible = true;
		try { UpdateLayout(); } catch { /* ignore */ }

		if (!TryMountTermNow())
		{
			TermLog($"RemountWarmSurfaceAfterUnpark mount failed size={Width:F0}x{Height:F0}");
			return;
		}
		// Re-assert hole size — TryMount used to SoftCollapse to 0x0 via DisposeTerm.
		Margin = new Thickness(x, y, 0, 0);
		Width = width;
		Height = height;
		Opacity = 1;
		Visibility = Visibility.Visible;
		IsHitTestVisible = true;

		if (_term is not null)
		{
			TryShowTermHwnds(_term);
			PulseTermPaintAfterUnpark(width, height);
		}
		TermLog($"RemountWarmSurfaceAfterUnpark done warm={_warmPty is not null} term={_term is not null} size={Width:F0}x{Height:F0}");

		if (_closeAfterRemount)
		{
			_closeAfterRemount = false;
			// Remount callers clear _remountBusy in finally AFTER this method returns.
			// Drop the gate first or Close would re-defer forever.
			Interlocked.Exchange(ref _remountBusy, 0);
			TermLog("Close running after remount");
			Close(notify: true);
		}
	}

	private void SoftCollapseHost()
	{
		// Keep Visibility.Visible: Collapsed + later Visible leaves TermControl HWND black
		// after HWND_MESSAGE reparent until Close/New remounts the surface.
		Width = 0;
		Height = 0;
		Margin = new Thickness(-10000, -10000, 0, 0);
		Visibility = Visibility.Visible;
		Opacity = 0;
		IsHitTestVisible = false;
	}

	private void CancelTermDebounce()
	{
		try { _debounceTimer?.Stop(); } catch { /* ignore */ }
		Interlocked.Increment(ref _ensureSeq);
	}

	public void Open(
		string sessionId,
		string? commandLine,
		string? workingDirectory,
		string label)
	{
		if (string.IsNullOrWhiteSpace(sessionId))
			throw new ArgumentException("sessionId required", nameof(sessionId));

		// Do NOT Close()/SoftCollapse here — that zeroed the host before ApplyBounds mount
		// (black hole + Dispose race). Tear down prior UI/PTY without collapsing bounds.
		CancelTermDebounce();
		Interlocked.Increment(ref _createGen);
		if (_term is not null)
			DisposeTerm(stopPty: true);
		else if (_warmPty is not null)
		{
			try { _warmPty.StopExternalTermOnly(); } catch { /* ignore */ }
			_warmPty = null;
		}

		_sessionId = sessionId;
		_label = string.IsNullOrWhiteSpace(label) ? "Local" : label.Trim();
		_pendingCmd = string.IsNullOrWhiteSpace(commandLine) ? null : commandLine.Trim();
		_pendingCwd = string.IsNullOrWhiteSpace(workingDirectory) ? null : workingDirectory.Trim();
		_awaitingSizedStart = true;
		// Arm remount for the new session (no SoftCollapse from Open).
		_parkedInactive = false;
		_softParked = false;
		_ignoreHideUntilTick = Environment.TickCount64 + 3000;

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

	/// <summary>
	/// Park TermControl HWND and move warm ConPTY into <see cref="NativeTerminalHandoff"/>
	/// for another in-process window (Remote pop-out). Does not kill the shell.
	/// </summary>
	public bool DepositHandoff()
	{
		if (string.IsNullOrEmpty(_sessionId))
			return false;

		ParkTermHwnd(reason: "DepositHandoff", keepAlive: false);
		var pty = _warmPty;
		if (pty is null)
		{
			TermLog("DepositHandoff: no warm Pty after park");
			return false;
		}

		NativeTerminalHandoff.Deposit(
			pty,
			_sessionId!,
			_label,
			_pendingCmd,
			_pendingCwd,
			_fontFamily,
			_fontSize,
			_foreground,
			_background,
			_cursor);

		_warmPty = null;
		var sid = _sessionId;
		_sessionId = null;
		_label = "Terminal";
		_pendingCmd = null;
		_pendingCwd = null;
		_awaitingSizedStart = false;
		Interlocked.Increment(ref _createGen);
		TermLog($"DepositHandoff ok sid={sid}");
		return true;
	}

	/// <summary>
	/// Adopt a warm ConPTY previously deposited by another window. Arms session; mount on next visible bounds.
	/// </summary>
	public bool TryAdoptHandoff()
	{
		if (!NativeTerminalHandoff.TryTake(
			out var pty,
			out var sessionId,
			out var label,
			out var pendingCmd,
			out var pendingCwd,
			out var fontFamily,
			out var fontSize,
			out var foreground,
			out var background,
			out var cursor)
			|| pty is null
			|| string.IsNullOrEmpty(sessionId))
		{
			return false;
		}

		// Drop any local UI/session without stopping the incoming Pty.
		DisposeTerm(stopPty: false);
		if (_warmPty is not null && !ReferenceEquals(_warmPty, pty))
		{
			try { _warmPty.StopExternalTermOnly(); } catch { /* ignore */ }
		}

		_warmPty = pty;
		_sessionId = sessionId;
		_label = label;
		_pendingCmd = pendingCmd;
		_pendingCwd = pendingCwd;
		_fontFamily = fontFamily;
		_fontSize = fontSize;
		_foreground = foreground;
		_background = background;
		_cursor = cursor;
		_awaitingSizedStart = true;
		ParkTermHwnd(reason: "TryAdoptHandoff-armed", keepAlive: false);
		TermLog($"TryAdoptHandoff ok sid={_sessionId} label={_label}");
		return true;
	}


		public void Close(bool notify = true)
	{
		_warmRemountOnUnpark = false;
		if (Volatile.Read(ref _remountBusy) != 0)
		{
			_closeAfterRemount = true;
			TermLog("Close deferred until remount idle");
			return;
		}

		_ignoreHideUntilTick = 0;
		var sid = _sessionId;
		// Soft-collapse + drop session BEFORE DisposeTerm. DestroyWindow pumps the UI queue;
		// a stale NATIVE_TERMINAL_LAYOUT(visible:true) would remount mid-dispose and StackOverflow.
		SoftCollapseHost();
		CancelTermDebounce();
		_parkedInactive = true;
		_sessionId = null;
		_label = "Terminal";
		_pendingCmd = null;
		_pendingCwd = null;
		_awaitingSizedStart = false;
		Interlocked.Increment(ref _createGen);

		if (_term is not null)
			DisposeTerm(stopPty: true);
		else if (_warmPty is not null)
		{
			// Already parked (LAYOUT hide raced ahead) — kill warm PTY only; do not
			// nest a second DestroyWindow under Park's teardown (StackOverflow @ Close).
			try { _warmPty.StopExternalTermOnly(); } catch { /* ignore */ }
			_warmPty = null;
			TermLog("Close: already parked; warm PTY stopped");
		}

		SoftCollapseHost();

		if (notify && !string.IsNullOrEmpty(sid))
			SessionClosed?.Invoke(this, sid!);
	}

	private void EnsureTermAtSize()
	{
		if (string.IsNullOrEmpty(_sessionId)) return;
		if (Volatile.Read(ref _parkGate) != 0 || Volatile.Read(ref _teardownActive) != 0 || _parkedInactive) return;
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

		// Debounce on a DispatcherQueueTimer â€” Tick always runs on the UI thread.
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
		TermPTY? warmOwned = null;
		try
		{
			if (seq >= 0 && seq != Volatile.Read(ref _ensureSeq)) return _term is not null;
			if (string.IsNullOrEmpty(_sessionId)) return false;
			if (Volatile.Read(ref _parkGate) != 0 || Volatile.Read(ref _teardownActive) != 0 || _parkedInactive)
			{
				TermLog($"TryMountTermNow blocked parkGate={Volatile.Read(ref _parkGate)} teardown={Volatile.Read(ref _teardownActive)} inactive={_parkedInactive}");
				return false;
			}
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

			TermPTY? warm = _warmPty;
			TermLog($"TryMountTermNow cmd={cmd} size={Width:F0}x{Height:F0} warm={warm is not null} uiThread={dq?.HasThreadAccess}");


			// Drop leftover UI only. Never SoftCollapse here — DisposeTerm SoftCollapses to 0x0
			// and wiped FinishWarmRemount's hole size (log: mounted size=0x0). Remount already
			// nulled _term + disposed the old control.
			if (_term is not null)
			{
				DisposeTerm(stopPty: false);
				warm ??= _warmPty;
			}
			else
			{
				try { TermSlot.Children.Clear(); } catch { /* ignore */ }
			}
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

			// MUST assign warm ConPTY before visual-tree insert: constructor creates an empty TermPTY,
			// and Loaded/StartTerm would spawn a second shell if TermProcIsStarted is still false.
			if (warm is not null)
			{
				term.ConPTYTerm = warm;
				warmOwned = warm;
				_warmPty = null;
			}

			TermSlot.Children.Clear();
			TermSlot.Children.Add(term);
			_term = term;
			_awaitingSizedStart = false;
			TermLog($"Term mounted gen={gen} size={Width:F0}x{Height:F0} actual={ActualWidth:F0}x{ActualHeight:F0} reattach={warm is not null}");
			try { term.Focus(FocusState.Programmatic); } catch { /* ignore */ }
			TermMountFinished?.Invoke(this, true);
			return true;
		}
		catch (Exception ex)
		{
			_awaitingSizedStart = true;
			_term = null;
			try { TermSlot.Children.Clear(); } catch { /* ignore */ }
			if (warmOwned is not null && _warmPty is null)
				_warmPty = warmOwned;
			var hr = ex is COMException cex ? $" HR=0x{cex.HResult:X8}" : "";
			TermLog($"TryMountTermNow failed: {ex.GetType().Name}: {ex.Message}{hr} warmRestored={_warmPty is not null}");
			TermMountFinished?.Invoke(this, false);
			return false;
		}
	}

	/// <param name="stopPty">
	/// True = kill ConPTY (Close / replace session). False = detach UI only (warm park remount).
	/// </param>
	private void DisposeTerm(bool stopPty = true)
	{
		// Hold _parkGate through DestroyTermControlUiCore (even if enqueue). Releasing early
		// let LAYOUT remount mid-DestroyWindow ? StackOverflow on Close (00:57 CT).
		if (Interlocked.CompareExchange(ref _parkGate, 1, 0) != 0)
		{
			TermLog($"DisposeTerm reentrant skip stopPty={stopPty}");
			SoftCollapseHost();
			return;
		}
		var releaseGate = true;
		try
		{
			SoftCollapseHost();
			CancelTermDebounce();
			_parkedInactive = true;
			_softParked = false;
			_warmRemountOnUnpark = false;
			_ignoreShowUntilTick = 0;
			_parkedHwnds.Clear();
			Interlocked.Exchange(ref _teardownActive, 1);

			var term = _term;
			_term = null;
			if (term is not null)
			{
				try
				{
					var pty = term.DisconnectConPTYTerm();
					if (stopPty)
					{
						try { pty?.StopExternalTermOnly(); } catch { /* ignore */ }
					}
					else if (pty is not null)
					{
						_warmPty = pty;
					}
				}
				catch (Exception ex)
				{
					Debug.WriteLine($"[NativeTerminalHost] dispose: {ex.Message}");
				}
				releaseGate = DestroyTermControlUi(term, stopPty ? "DisposeTerm-stop" : "DisposeTerm-warm", releaseGateAfter: true);
			}

			if (stopPty && _warmPty is not null)
			{
				try { _warmPty.StopExternalTermOnly(); } catch { /* ignore */ }
				_warmPty = null;
			}
		}
		finally
		{
			if (releaseGate)
			{
				Interlocked.Exchange(ref _teardownActive, 0);
				Interlocked.Exchange(ref _parkGate, 0);
			}
		}
	}

	/// <summary>
	/// Tear down EasyTerminalControl / TermControl HwndHost on the UI thread.
	/// Never abandon an HwndHost to GC — its finalizer calls DestroyWindow via DispatcherQueue
	/// and throws ObjectDisposedException (CLR 0xe0434352), killing the whole process.
	/// Call only after DisconnectConPTYTerm so a warm ConPTY is preserved.
	/// Returns true if teardown finished synchronously (caller may release gates).
	/// Returns false if work was enqueued — gates released in the queued finally.
	/// </summary>
	private bool DestroyTermControlUi(EasyTerminalControl term, string reason, bool releaseGateAfter = false)
	{
		try
		{
			var dq = DispatcherQueue;
			// Always defer stop Dispose one tick so SoftCollapse + LAYOUT ignore settle first.
			// Sync Dispose/DestroyWindow on the Close click stack StackOverflow'd (log DisposeTerm-stop).
			var defer = reason.Contains("stop", StringComparison.OrdinalIgnoreCase)
				|| (dq is not null && !dq.HasThreadAccess);
			if (dq is not null && defer)
			{
				TermLog($"DestroyTermControlUi enqueue reason={reason}");
				dq.TryEnqueue(() =>
				{
					try { DestroyTermControlUiCore(term, reason); }
					finally
					{
						if (releaseGateAfter)
						{
							Interlocked.Exchange(ref _teardownActive, 0);
							Interlocked.Exchange(ref _parkGate, 0);
						}
					}
				});
				return false;
			}
			DestroyTermControlUiCore(term, reason);
			return true;
		}
		catch (Exception ex)
		{
			TermLog($"DestroyTermControlUi failed reason={reason}: {ex.Message}");
			return true;
		}
	}
	private void DestroyTermControlUiCore(EasyTerminalControl term, string reason)
	{
		try
		{
			// Detach from the visual tree FIRST so DestroyWindow is not racing layout against
			// a still-parented HwndHost. Then dispose nested TerminalContainer on the UI thread.
			// Children.Clear alone orphans HwndHost for GC; Finalize -> DestroyWindow ->
			// get_DispatcherQueue throws ObjectDisposedException (CLR 0xe0434352) and kills BNDZ.exe.
			// Gates (_parkGate/_teardownActive) must stay held for this whole method — releasing
			// before Dispose (9cd0b40b finally) lets FE visible:true remount mid-DestroyWindow = SO.
			TermLog($"DestroyTermControlUiCore begin reason={reason}");
			try
			{
				if (TermSlot.Children.Contains(term))
					TermSlot.Children.Remove(term);
			}
			catch { /* ignore */ }
			TermLog($"DestroyTermControlUiCore removed reason={reason}");
			try { TermSlot.Children.Clear(); } catch { /* ignore */ }
			try { term.Content = null; } catch { /* ignore */ }

			// Warm park (ApplyBounds-hide / DisposeTerm-warm): SoftCollapse + tree detach is enough
			// for airspace. termContainer.Dispose()/DestroyWindow pumps the queue and StackOverflows
			// when FE still has a live session (seen: begin+removed, never "disposed").
			// Full HWND Dispose only when killing the session (DisposeTerm-stop / Close).
			var fullDispose = reason.Contains("stop", StringComparison.OrdinalIgnoreCase)
				|| reason.Contains("Close", StringComparison.OrdinalIgnoreCase)
				|| reason.Contains("remount", StringComparison.OrdinalIgnoreCase)
				|| reason.StartsWith("DisposeTerm-stop", StringComparison.Ordinal);
			if (fullDispose)
			{
				TermLog($"DestroyTermControlUiCore fullDispose reason={reason}");
				// Pull HWND out of airspace before managed Dispose/DestroyWindow.
				try { TryHideTermHwnds(term, reparentToMessage: true, trackForRestore: false); } catch { /* ignore */ }
				DisposeNestedTermHwndHosts(term);
			}
			else
			{
				// Hide Win32 HWND without HwndHost.Dispose (DestroyWindow pumps ? StackOverflow).
				TermLog($"DestroyTermControlUiCore detachOnly reason={reason}");
				TryHideTermHwnds(term, reparentToMessage: true);
			}

			TermLog($"DestroyTermControlUi disposed reason={reason}");
		}
		catch (Exception ex)
		{
			TermLog($"DestroyTermControlUiCore failed reason={reason}: {ex.Message}");
		}
	}

[DllImport("user32.dll")]
	private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

	[DllImport("user32.dll", SetLastError = true)]
	private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

	[DllImport("user32.dll", SetLastError = true)]
	private static extern IntPtr GetParent(IntPtr hWnd);

	[DllImport("user32.dll", SetLastError = true)]
	private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

	[DllImport("user32.dll")]
	private static extern bool InvalidateRect(IntPtr hWnd, IntPtr lpRect, bool bErase);

	[DllImport("user32.dll")]
	private static extern bool UpdateWindow(IntPtr hWnd);

	private const uint SwpNoZOrder = 0x0004;
	private const uint SwpNoActivate = 0x0010;
	private const uint SwpShowWindow = 0x0040;
	private const uint SwpFrameChanged = 0x0020;

	private const int SwHide = 0;
	private static readonly IntPtr HwndMessage = new(-3);
	private static readonly IntPtr HwndTop = new(-1);

	/// <summary>Pull TermControl HWNDs out of airspace without managed Dispose/DestroyWindow pump.</summary>
		private const int SwShow = 5;

	private void TryHideTermHwnds(EasyTerminalControl term, bool reparentToMessage = false, bool trackForRestore = false)
	{
		try
		{
			if (trackForRestore)
				_parkedHwnds.Clear();

			var victims = new System.Collections.Generic.List<IntPtr>(4);
			CollectTermHwnds(term, victims, depth: 0);
			try
			{
				var terminal = term.Terminal;
				if (terminal is not null)
				{
					var field = terminal.GetType().GetField(
						"termContainer",
						BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.FlattenHierarchy);
					var container = field?.GetValue(terminal);
					if (container is DependencyObject dep)
						CollectTermHwnds(dep, victims, depth: 0);
					// Never null termContainer on keepAlive restore path — only on discard detachOnly.
					if (reparentToMessage && !trackForRestore)
					{
						try { field?.SetValue(terminal, null); } catch { /* ignore */ }
					}
				}
			}
			catch (Exception ex) { TermLog($"TryHideTermHwnds reflect: {ex.Message}"); }

			foreach (var hwnd in victims)
			{
				if (hwnd == IntPtr.Zero) continue;
				IntPtr prev = IntPtr.Zero;
				try { prev = GetParent(hwnd); } catch { /* ignore */ }
				try { ShowWindow(hwnd, SwHide); } catch { /* ignore */ }
				if (reparentToMessage)
				{
					try { SetParent(hwnd, HwndMessage); } catch { /* ignore */ }
					if (trackForRestore && prev != IntPtr.Zero && prev != HwndMessage)
						_parkedHwnds.Add((hwnd, prev));
				}
			}
			TermLog($"TryHideTermHwnds count={victims.Count} reparent={reparentToMessage} tracked={_parkedHwnds.Count}");
		}
		catch (Exception ex)
		{
			TermLog($"TryHideTermHwnds: {ex.Message}");
		}
	}

	private void TryShowTermHwnds(EasyTerminalControl term)
	{
		try
		{
			// Restore parents captured at soft-park (HWND_MESSAGE ? original host).
			if (_parkedHwnds.Count > 0)
			{
				foreach (var (hwnd, parent) in _parkedHwnds)
				{
					if (hwnd == IntPtr.Zero) continue;
					try { SetParent(hwnd, parent); } catch { /* ignore */ }
					try { ShowWindow(hwnd, SwShow); } catch { /* ignore */ }
				}
				TermLog($"TryShowTermHwnds restored tracked={_parkedHwnds.Count}");
				_parkedHwnds.Clear();
			}

			var victims = new System.Collections.Generic.List<IntPtr>(4);
			CollectTermHwnds(term, victims, depth: 0);
			try
			{
				var terminal = term.Terminal;
				if (terminal is not null)
				{
					var field = terminal.GetType().GetField(
						"termContainer",
						BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.FlattenHierarchy);
					var container = field?.GetValue(terminal);
					if (container is DependencyObject dep)
						CollectTermHwnds(dep, victims, depth: 0);
				}
			}
			catch { /* ignore */ }

			var pxW = Math.Max(1, (int)Math.Round(ActualWidth > 0 ? ActualWidth : Width));
			var pxH = Math.Max(1, (int)Math.Round(ActualHeight > 0 ? ActualHeight : Height));
			foreach (var hwnd in victims)
			{
				if (hwnd == IntPtr.Zero) continue;
				try { ShowWindow(hwnd, SwShow); } catch { /* ignore */ }
				try
				{
					// Bring above WebView2 airspace after HWND_MESSAGE reparent (NoZOrder left HWND blank).
					SetWindowPos(hwnd, HwndTop, 0, 0, pxW, pxH,
						SwpNoActivate | SwpShowWindow | SwpFrameChanged);
				}
				catch { /* ignore */ }
				try { InvalidateRect(hwnd, IntPtr.Zero, true); } catch { /* ignore */ }
				try { UpdateWindow(hwnd); } catch { /* ignore */ }
			}
			TermLog($"TryShowTermHwnds count={victims.Count} size={pxW}x{pxH}");
		}
		catch (Exception ex)
		{
			TermLog($"TryShowTermHwnds: {ex.Message}");
		}
	}

	/// <summary>
	/// After HWND reparent from HWND_MESSAGE, TermControl often stays black until a layout/size pulse.
	/// </summary>
	private void PulseTermPaintAfterUnpark(double width, double height)
	{
		if (Volatile.Read(ref _remountBusy) != 0 || _parkedInactive || string.IsNullOrEmpty(_sessionId))
			return;
		// One paint nudge per short window — FE can call ApplyBounds unpark 20+ times after remount.
		var now = Environment.TickCount64;
		if (now - _lastPulsePaintTick < 150
			&& Math.Abs(_lastShowW - width) < 1.5
			&& Math.Abs(_lastShowH - height) < 1.5)
			return;
		_lastPulsePaintTick = now;
		try
		{
			InvalidateMeasure();
			InvalidateArrange();
			UpdateLayout();
			if (_term is FrameworkElement fe)
			{
				fe.InvalidateMeasure();
				fe.InvalidateArrange();
				fe.UpdateLayout();
			}
		}
		catch { /* ignore */ }

		// Deferred +/-1px size nudge so ConPTY/TermControl repaints after SetParent restore.
		var w = width;
		var h = height;
		var dq = DispatcherQueue;
		if (dq is null)
		{
			TermLog("PulseTermPaintAfterUnpark: DispatcherQueue is null");
			return;
		}
		dq.TryEnqueue(DispatcherQueuePriority.Normal, () =>
		{
			if (_term is null || _softParked || _parkedInactive || string.IsNullOrEmpty(_sessionId) || Volatile.Read(ref _remountBusy) != 0) return;
			if (w < 48 || h < 48) return;
			try
			{
				Width = Math.Max(48, w - 1);
				Height = Math.Max(48, h - 1);
				UpdateLayout();
				TryShowTermHwnds(_term);
				Width = w;
				Height = h;
				UpdateLayout();
				TryShowTermHwnds(_term);
				TermLog($"PulseTermPaintAfterUnpark nudged size={w:F0}x{h:F0}");
			}
			catch (Exception ex)
			{
				TermLog($"PulseTermPaintAfterUnpark: {ex.Message}");
			}
		});
	}

	private static void CollectTermHwnds(DependencyObject? root, System.Collections.Generic.List<IntPtr> victims, int depth)
	{
		if (root is null || depth > 32) return;
		try
		{
			var t = root.GetType();
			foreach (var propName in new[] { "Handle", "Hwnd", "WindowHandle" })
			{
				var handleProp = t.GetProperty(propName, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic);
				if (handleProp?.PropertyType == typeof(IntPtr))
				{
					var hwnd = (IntPtr)(handleProp.GetValue(root) ?? IntPtr.Zero);
					if (hwnd != IntPtr.Zero && !victims.Contains(hwnd))
						victims.Add(hwnd);
				}
			}
		}
		catch { /* ignore */ }

		int n;
		try { n = VisualTreeHelper.GetChildrenCount(root); }
		catch { return; }
		for (var i = 0; i < n; i++)
		{
			DependencyObject? child = null;
			try { child = VisualTreeHelper.GetChild(root, i); } catch { continue; }
			if (child is not null)
				CollectTermHwnds(child, victims, depth + 1);
		}
	}

	/// <summary>
	/// Dispose WinUI TerminalContainer / HwndHost under <paramref name="term"/> before detaching.
	/// </summary>
	private static void DisposeNestedTermHwndHosts(EasyTerminalControl term)
	{
		try
		{
			var terminal = term.Terminal;
			if (terminal is not null)
			{
				// TerminalControl.termContainer is private; reflect then Dispose (IDisposable / HwndHost).
				var field = terminal.GetType().GetField(
					"termContainer",
					BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.FlattenHierarchy);
				var container = field?.GetValue(terminal);
				if (container is IDisposable disposable)
				{
					try { disposable.Dispose(); }
					catch (Exception ex) { TermLog($"termContainer.Dispose: {ex.Message}"); }
					try { field?.SetValue(terminal, null); } catch { /* ignore */ }
					return;
				}
			}
		}
		catch (Exception ex)
		{
			TermLog($"DisposeNestedTermHwndHosts reflect: {ex.Message}");
		}

		try { WalkDisposeHwndHosts(term); }
		catch (Exception ex) { TermLog($"WalkDisposeHwndHosts: {ex.Message}"); }
	}

	private static void WalkDisposeHwndHosts(DependencyObject root)
	{
		// Collect first, dispose after walk — disposing mid-walk can pump messages / mutate the
		// visual tree and recurse back into park (StackOverflowException).
		var victims = new System.Collections.Generic.List<IDisposable>(4);
		CollectHwndHosts(root, victims, depth: 0);
		foreach (var d in victims)
		{
			try { d.Dispose(); }
			catch (Exception ex) { TermLog($"Dispose {d.GetType().Name}: {ex.Message}"); }
		}
	}

	private static void CollectHwndHosts(DependencyObject root, System.Collections.Generic.List<IDisposable> victims, int depth)
	{
		if (root is null || depth > 32) return;
		int n;
		try { n = VisualTreeHelper.GetChildrenCount(root); }
		catch { return; }
		for (var i = 0; i < n; i++)
		{
			DependencyObject? child = null;
			try { child = VisualTreeHelper.GetChild(root, i); } catch { continue; }
			if (child is not null)
				CollectHwndHosts(child, victims, depth + 1);
		}

		if (root is IDisposable d && root is not EasyTerminalControl)
		{
			var name = root.GetType().Name;
			if (name.Contains("HwndHost", StringComparison.Ordinal) ||
			    name.Contains("TerminalContainer", StringComparison.Ordinal))
			{
				victims.Add(d);
			}
		}
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
	/// Drive roots must keep a trailing slash â€” "C:" alone does not Set-Location / -WorkingDirectory correctly.
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

	/// <summary>COLORREF packer (0x00BBGGRR) â€” no System.Drawing dependency.</summary>
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
