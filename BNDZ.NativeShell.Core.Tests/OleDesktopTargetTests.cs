using BNDZ.Services;
using Xunit;

namespace BNDZ.NativeShell.Core.Tests;

public class OleDesktopTargetTests
{
    [Fact]
    public void WorkerW_wallpaper_is_desktop()
    {
        Assert.True(OleDesktopTarget.IsDesktopClassChain(["WorkerW"]));
        Assert.True(OleDesktopTarget.IsDesktopClassChain(["SysListView32", "SHELLDLL_DefView", "Progman"]));
        Assert.True(OleDesktopTarget.IsDesktopClassChain(["SHELLDLL_DefView", "WorkerW"]));
    }

    [Fact]
    public void Explorer_folder_and_taskbar_are_not_desktop()
    {
        Assert.False(OleDesktopTarget.IsDesktopClassChain(["DirectUIHWND", "CabinetWClass"]));
        Assert.False(OleDesktopTarget.IsDesktopClassChain(["SysListView32", "SHELLDLL_DefView", "CabinetWClass"]));
        Assert.False(OleDesktopTarget.IsDesktopClassChain(["MSTaskListWClass", "Shell_TrayWnd"]));
        Assert.False(OleDesktopTarget.IsDesktopClassChain(["Chrome_WidgetWin_1"]));
    }
}
