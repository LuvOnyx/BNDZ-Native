// Copyright (c) BNDZ — FilesMerge ownership flags for the Files↔BNDZ blend.

namespace Files.App.Utils.Bndz;

/// <summary>
/// Full blend (default): Files browse engines own cwd/items; BNDZ React owns plugins/preview/workspace craft.
/// When <see cref="BrowserOwnsFileViewport"/> is true, classic <c>?filesHost=1</c> takes the viewport
/// and WinUI enumerate is skipped — do not use that for the product blend path.
/// </summary>
internal static class BndzShellOwnership
{
	public static bool BrowserOwnsFileViewport { get; set; }
}
