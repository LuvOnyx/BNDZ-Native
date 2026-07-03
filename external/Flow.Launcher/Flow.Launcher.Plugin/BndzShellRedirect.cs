#nullable enable
using System;

namespace Flow.Launcher.Plugin;

/// <summary>Allows Flow.Launcher.Plugin.BNDZ to redirect ShowMainWindow to the BNDZ WebView2 shell.</summary>
public static class BndzShellRedirect
{
    public static Func<bool>? TryRedirect { get; set; }
    public static Func<bool>? TryToggle { get; set; }
}
