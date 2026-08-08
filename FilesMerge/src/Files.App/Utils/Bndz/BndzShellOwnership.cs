// Copyright (c) BNDZ — FilesMerge filesHost ownership flag.

namespace Files.App.Utils.Bndz;

/// <summary>
/// When true, full classic BNDZUI (<c>?filesHost=1</c>) owns the browsing viewport.
/// Files tabs remain path holders — WinUI list enumerate/thumbnail must not duplicate that work.
/// </summary>
internal static class BndzShellOwnership
{
	public static bool BrowserOwnsFileViewport { get; set; }
}
