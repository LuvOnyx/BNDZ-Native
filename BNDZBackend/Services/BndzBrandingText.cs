using System;

namespace BNDZ.Services;

public static class BndzBrandingText
{
    public static string Sanitize(string? text)
    {
        if (string.IsNullOrEmpty(text)) return text ?? "";
        return text
            .Replace("FlowLauncher", "BNDZ Launcher", StringComparison.OrdinalIgnoreCase)
            .Replace("Flow Launcher", "BNDZ Launcher", StringComparison.OrdinalIgnoreCase)
            .Replace("Flow launcher's", "BNDZ Launcher's", StringComparison.OrdinalIgnoreCase)
            .Replace("from Flow", "from BNDZ Launcher", StringComparison.OrdinalIgnoreCase)
            .Replace("in Flow", "in BNDZ Launcher", StringComparison.OrdinalIgnoreCase)
            .Replace("via Flow", "via BNDZ Launcher", StringComparison.OrdinalIgnoreCase);
    }
}
