using Vanara.PInvoke;
using Vanara.Windows.Shell;
using static Vanara.PInvoke.Gdi32;
using static Vanara.PInvoke.Shell32;

namespace BNDZ.Services;

/// <summary>
/// Shell thumbnails/icons through IShellItemImageFactory only.
/// Vanara's <c>ShellItem.GetImage</c> falls back to the legacy IExtractImage path whenever the factory
/// misses (including every InCacheOnly cache miss). That path loads old third-party shell extensions
/// straight into BNDZ.exe, and one of them crashed the whole app with an access violation, which .NET
/// cannot catch (Event Log 2026-10-08 15:08, ShellThumbnailCacheService → LoadImageFromExtractImage).
/// The modern factory runs isolated thumbnail providers out of process, so a bad provider can't take us down.
/// </summary>
internal static class ShellImageFactory
{
    public static SafeHBITMAP? TryGetImage(ShellItem item, SIZE size, ShellItemGetImageOptions flags)
    {
        if (item.IShellItem is not IShellItemImageFactory factory)
            return null;
        var hr = factory.GetImage(size, (SIIGBF)flags, out var hbmp);
        if (hr.Failed || hbmp == null || hbmp.IsInvalid)
        {
            hbmp?.Dispose();
            return null;
        }
        return hbmp;
    }
}
