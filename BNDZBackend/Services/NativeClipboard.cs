using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>
/// Cheap clipboard-change detector. Sequence number increments only when the
/// clipboard contents actually change — never use BitmapSource.GetHashCode()
/// (that is object identity, so every GetImage() looks "new" and rewrites disk).
/// </summary>
internal static class NativeClipboard
{
    [DllImport("user32.dll")]
    private static extern uint GetClipboardSequenceNumber();

    public static uint GetSequenceNumber()
    {
        try { return GetClipboardSequenceNumber(); }
        catch { return 0; }
    }
}
