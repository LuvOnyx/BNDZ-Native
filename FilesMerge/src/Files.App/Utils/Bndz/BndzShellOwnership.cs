// Copyright (c) BNDZ — FilesMerge ownership flags for the Files↔BNDZ blend.

namespace Files.App.Utils.Bndz;

/// <summary>
/// Full blend: Files browse engines always enumerate (cwd/items truth).
/// When <see cref="BndzUiFaceActive"/> is true, classic BNDZUI (<c>?filesHost=1</c>) paints
/// tabs/tree/list/plugins/preview while Files stays the engine underneath.
/// <see cref="BrowserOwnsFileViewport"/> is legacy — when true, WinUI enumerate is skipped
/// (do not use for the product blend).
/// </summary>
internal static class BndzShellOwnership
{
	/// <summary>Legacy: skip WinUI enumerate. Keep false for blend so Files feeds the list.</summary>
	public static bool BrowserOwnsFileViewport { get; set; }

	/// <summary>BNDZUI browser host is the visible face (still fed by Files engines).</summary>
	public static bool BndzUiFaceActive { get; set; }
}
