namespace BNDZ.Services;

/// <summary>
/// HWND class-chain test for the shell Desktop (Progman / WorkerW wallpaper / DefView).
/// WindowFromPoint on empty wallpaper often hits WorkerW, which has no IDropTarget —
/// OLE GiveFeedback is NONE even though dropping there should land in the Desktop folder.
/// </summary>
public static class OleDesktopTarget
{
    public static bool IsDesktopWindowClass(string? cls)
        => cls is "Progman" or "WorkerW" or "SHELLDLL_DefView";

    public static bool IsExplorerCabinetClass(string? cls)
        => cls is "CabinetWClass" or "ExploreWClass";

    public static bool IsTaskbarClass(string? cls)
        => cls is "Shell_TrayWnd" or "Shell_SecondaryTrayWnd" or "MSTaskSwWClass"
            or "MSTaskListWClass" or "TrayNotifyWnd" or "NotifyIconOverflowWindow"
            or "ForegroundStaging";

    /// <summary>
    /// <paramref name="classChain"/> is hit window first, then parents/root ancestors.
    /// Explorer folder windows are not Desktop. Taskbar is not Desktop.
    /// </summary>
    public static bool IsDesktopClassChain(IEnumerable<string> classChain)
    {
        var sawDesktop = false;
        foreach (var cls in classChain)
        {
            if (string.IsNullOrEmpty(cls)) continue;
            if (IsExplorerCabinetClass(cls) || IsTaskbarClass(cls))
                return false;
            if (IsDesktopWindowClass(cls))
                sawDesktop = true;
        }
        return sawDesktop;
    }
}
