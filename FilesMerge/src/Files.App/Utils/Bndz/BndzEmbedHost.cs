// Copyright (c) BNDZ — Files merge integration
// Files Community portions remain MIT (see LICENSE-MIT).
//
// REFERENCE ONLY — not product UX.
// Architecture #3 (BNDZ_NATIVE.md): WinUI/FilesMerge owns chrome + file list;
// BNDZ React surfaces are hosted panes later. Full-window HWND embed of classic
// BNDZ.exe (--embedded) was an A/B glue experiment and must not be wired back
// into MainPage as the primary experience.

using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;

namespace Files.App.Utils.Bndz;

/// <summary>
/// Historical A/B helper: HWND-reparent classic <c>BNDZ.exe --embedded</c> into Files.
/// Kept for reference only — superseded by architecture #3. Do not call from MainPage.
/// </summary>
internal static class BndzEmbedHost
{
	private const string HwndFileName = "bndz-embed-hwnd.txt";

	[DllImport("user32.dll", SetLastError = true)]
	private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

	[DllImport("user32.dll", SetLastError = true)]
	private static extern bool MoveWindow(IntPtr hWnd, int X, int Y, int nWidth, int nHeight, bool bRepaint);

	[DllImport("user32.dll", SetLastError = true)]
	private static extern int GetWindowLong(IntPtr hWnd, int nIndex);

	[DllImport("user32.dll", SetLastError = true)]
	private static extern int SetWindowLong(IntPtr hWnd, int nIndex, int dwNewLong);

	[DllImport("user32.dll")]
	private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

	[DllImport("user32.dll")]
	private static extern bool IsWindow(IntPtr hWnd);

	private const int GWL_STYLE = -16;
	private const int WS_CAPTION = 0x00C00000;
	private const int WS_THICKFRAME = 0x00040000;
	private const int WS_POPUP = unchecked((int)0x80000000);
	private const int WS_CHILD = 0x40000000;
	private const int SW_SHOW = 5;

	private static Process? _bndzProcess;
	private static IntPtr _bndzHwnd = IntPtr.Zero;

	public static bool IsActive { get; private set; }

	public static async Task<bool> ShowAsync(FrameworkElement host, CancellationToken ct = default)
	{
		var parentHwnd = MainWindow.Instance.WindowHandle;
		if (parentHwnd == IntPtr.Zero)
			return false;

		if (_bndzHwnd == IntPtr.Zero || !IsWindow(_bndzHwnd))
		{
			_bndzHwnd = await StartEmbeddedBndzAsync(ct).ConfigureAwait(true);
			if (_bndzHwnd == IntPtr.Zero)
				return false;
		}

		TryMakeChildWindow(_bndzHwnd);
		SetParent(_bndzHwnd, parentHwnd);
		ShowWindow(_bndzHwnd, SW_SHOW);
		Layout(host);
		IsActive = true;
		return true;
	}

	public static void Layout(FrameworkElement host)
	{
		if (_bndzHwnd == IntPtr.Zero || host is null)
			return;

		try
		{
			var transform = host.TransformToVisual(null);
			var point = transform.TransformPoint(new Windows.Foundation.Point(0, 0));
			var scale = host.XamlRoot?.RasterizationScale ?? 1.0;
			var x = (int)Math.Round(point.X * scale);
			var y = (int)Math.Round(point.Y * scale);
			var w = (int)Math.Round(host.ActualWidth * scale);
			var h = (int)Math.Round(host.ActualHeight * scale);
			if (w > 0 && h > 0)
				MoveWindow(_bndzHwnd, x, y, w, h, true);
		}
		catch
		{
			// ignore layout races during resize
		}
	}

	public static void Hide()
	{
		IsActive = false;
		if (_bndzHwnd != IntPtr.Zero)
		{
			try { ShowWindow(_bndzHwnd, 0); } catch { }
		}
	}

	public static void Shutdown()
	{
		Hide();
		try
		{
			if (_bndzProcess is { HasExited: false })
				_bndzProcess.Kill(entireProcessTree: true);
		}
		catch { }
		_bndzProcess = null;
		_bndzHwnd = IntPtr.Zero;
	}

	private static async Task<IntPtr> StartEmbeddedBndzAsync(CancellationToken ct)
	{
		var exe = ResolveBndzExe();
		if (exe is null)
			return IntPtr.Zero;

		var hwndPath = SystemIO.Path.Combine(SystemIO.Path.GetTempPath(), HwndFileName);
		try { if (SystemIO.File.Exists(hwndPath)) SystemIO.File.Delete(hwndPath); } catch { }

		_bndzProcess = Process.Start(new ProcessStartInfo
		{
			FileName = exe,
			Arguments = "--embedded --skip-elevation",
			UseShellExecute = true,
			WorkingDirectory = SystemIO.Path.GetDirectoryName(exe)!,
		});

		if (_bndzProcess is null)
			return IntPtr.Zero;

		for (var i = 0; i < 100; i++)
		{
			ct.ThrowIfCancellationRequested();
			await Task.Delay(100, ct).ConfigureAwait(true);
			if (!SystemIO.File.Exists(hwndPath))
				continue;
			try
			{
				var text = await SystemIO.File.ReadAllTextAsync(hwndPath, ct).ConfigureAwait(true);
				if (long.TryParse(text.Trim(), out var hwndVal) && hwndVal != 0)
					return (IntPtr)hwndVal;
			}
			catch { }
		}

		return IntPtr.Zero;
	}

	private static string? ResolveBndzExe()
	{
		var baseDir = AppContext.BaseDirectory;
		var candidates = new[]
		{
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "bndz-host", "BNDZ.exe")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "BNDZ.exe")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "BNDZBackend", "bin", "Debug", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "BNDZBackend", "bin", "Release", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(Environment.CurrentDirectory, "BNDZBackend", "bin", "Debug", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
		};
		foreach (var c in candidates)
		{
			if (SystemIO.File.Exists(c))
				return c;
		}
		return null;
	}

	private static void TryMakeChildWindow(IntPtr hwnd)
	{
		try
		{
			var style = GetWindowLong(hwnd, GWL_STYLE);
			style &= ~WS_CAPTION;
			style &= ~WS_THICKFRAME;
			style &= ~WS_POPUP;
			style |= WS_CHILD;
			SetWindowLong(hwnd, GWL_STYLE, style);
		}
		catch { }
	}
}
