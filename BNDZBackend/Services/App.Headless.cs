#if BNDZ_HEADLESS_CORE
namespace BNDZ;

public static class App
{
    public static bool IsBackendHost => true;
    public static bool IsEmbeddedInWinUiShell => true;
    public static bool IsPluginWindow => false;
    public static bool IsStageWindow => false;
    public static bool IsNativeShell => false;
    public static bool IsEmbedded => false;
    public static string? PluginWindowId => null;
    public static string? PluginStickyId => null;
}
#endif
