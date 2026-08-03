using System.Globalization;

namespace BNDZ.Services;

/// <summary>Shared helpers for automation block field parsing and file matching.</summary>
internal static class BndzAutomationExtensions
{
    public static string GetField(Dictionary<string, string> data, string key, string fallback = "")
        => data.TryGetValue(key, out var v) && !string.IsNullOrWhiteSpace(v) ? v.Trim() : fallback;

    public static bool GetBool(Dictionary<string, string> data, string key, bool fallback = false)
    {
        if (!data.TryGetValue(key, out var v) || string.IsNullOrWhiteSpace(v)) return fallback;
        return v.Equals("true", StringComparison.OrdinalIgnoreCase)
            || v.Equals("1", StringComparison.Ordinal)
            || v.Equals("yes", StringComparison.OrdinalIgnoreCase)
            || v.Equals("on", StringComparison.OrdinalIgnoreCase);
    }

    public static long ParseSizeBytes(string raw, long fallback = 0)
    {
        if (string.IsNullOrWhiteSpace(raw)) return fallback;
        raw = raw.Trim();
        var suffix = 1L;
        if (raw.EndsWith("KB", StringComparison.OrdinalIgnoreCase)) { suffix = 1024; raw = raw[..^2]; }
        else if (raw.EndsWith("MB", StringComparison.OrdinalIgnoreCase)) { suffix = 1024 * 1024; raw = raw[..^2]; }
        else if (raw.EndsWith("GB", StringComparison.OrdinalIgnoreCase)) { suffix = 1024L * 1024 * 1024; raw = raw[..^2]; }
        else if (raw.EndsWith("K", StringComparison.OrdinalIgnoreCase)) { suffix = 1024; raw = raw[..^1]; }
        else if (raw.EndsWith("M", StringComparison.OrdinalIgnoreCase)) { suffix = 1024 * 1024; raw = raw[..^1]; }
        else if (raw.EndsWith("G", StringComparison.OrdinalIgnoreCase)) { suffix = 1024L * 1024 * 1024; raw = raw[..^1]; }
        return long.TryParse(raw.Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n)
            ? Math.Max(0, n * suffix)
            : fallback;
    }

    public static HashSet<string> ParseExtensionList(string raw, bool allowWildcard = false)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var part in raw.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
        {
            var e = part.Trim().TrimStart('.').ToLowerInvariant();
            if (string.IsNullOrEmpty(e)) continue;
            if (e == "*" && allowWildcard) set.Add("*");
            else set.Add(e);
        }
        return set;
    }

    /// <summary>Match file path against extension tokens including compound forms like tar.gz.</summary>
    public static bool MatchesExtension(string filePath, HashSet<string> extensions)
    {
        if (extensions.Count == 0 || extensions.Contains("*")) return true;
        var compound = GetCompoundExtension(filePath);
        if (extensions.Contains(compound)) return true;
        var simple = Path.GetExtension(filePath).TrimStart('.').ToLowerInvariant();
        return !string.IsNullOrEmpty(simple) && extensions.Contains(simple);
    }

    public static string GetCompoundExtension(string filePath)
    {
        var name = Path.GetFileName(filePath).ToLowerInvariant();
        var dot = name.IndexOf('.');
        if (dot <= 0) return "";
        var rest = name[(dot + 1)..];
        // tar.gz, tar.bz2, tar.xz
        if (rest.StartsWith("tar.", StringComparison.Ordinal))
            return rest;
        var simple = Path.GetExtension(filePath).TrimStart('.').ToLowerInvariant();
        return simple;
    }

    public static bool IsTriggerType(string type) =>
        type is "watchFolder" or "manualRun" or "onSchedule" or "onStartup" or "indexChanged" or "spatialPin";

    public static bool IsTerminalType(string type) =>
        type is "log" or "notifyToast" or "recycleBin" or "delay" or "stopAbort"
            or "script" or "healthGate" or "sandboxCheckpoint" or "capacityApprove" or "branchCreate";

    public static List<string> ExistingFiles(IEnumerable<string> files) =>
        files.Where(p => File.Exists(p)).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
}
