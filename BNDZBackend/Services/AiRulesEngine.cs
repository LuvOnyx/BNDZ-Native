using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

/// <summary>
/// Deterministic rename/organize helpers used while the local model downloads or when inference fails.
/// </summary>
public static class AiRulesEngine
{
    public static List<object> BatchRename(List<string> filenames, string instructions)
    {
        var results = new List<object>();
        if (filenames.Count == 0) return results;

        var lower = (instructions ?? "").ToLowerInvariant();
        var toLower = lower.Contains("lowercase") || lower.Contains("lower case");
        var toUpper = lower.Contains("uppercase") || lower.Contains("upper case");
        var useUnderscores = lower.Contains("underscore") || lower.Contains("snake");
        var useDashes = lower.Contains("dash") || lower.Contains("kebab");
        var trimSpaces = lower.Contains("trim") || lower.Contains("clean") || lower.Contains("standard");
        var numberSeq = lower.Contains("number") || lower.Contains("sequential") || lower.Contains("001");

        var pad = filenames.Count >= 100 ? 3 : filenames.Count >= 10 ? 2 : 1;
        var index = 1;

        foreach (var original in filenames)
        {
            var stem = Path.GetFileNameWithoutExtension(original);
            var ext = Path.GetExtension(original);
            var next = stem;

            if (trimSpaces || string.IsNullOrWhiteSpace(instructions))
            {
                next = Regex.Replace(next.Trim(), @"\s+", " ");
                next = Regex.Replace(next, @"[^\w\s\-\.]", "");
            }

            if (useUnderscores) next = Regex.Replace(next, @"[\s\-]+", "_");
            else if (useDashes) next = Regex.Replace(next, @"[\s_]+", "-");

            if (toLower) next = next.ToLowerInvariant();
            else if (toUpper) next = next.ToUpperInvariant();

            if (numberSeq)
            {
                var prefix = lower.Contains("prefix") ? $"{index.ToString().PadLeft(pad, '0')}_" : "";
                var suffix = !lower.Contains("prefix") ? $"_{index.ToString().PadLeft(pad, '0')}" : "";
                next = $"{prefix}{next}{suffix}";
            }

            next = next.Trim(' ', '.', '-', '_');
            if (string.IsNullOrWhiteSpace(next)) next = $"file_{index.ToString().PadLeft(pad, '0')}";

            var newName = next + ext;
            if (!string.Equals(original, newName, StringComparison.OrdinalIgnoreCase))
            {
                results.Add(new
                {
                    originalName = original,
                    newName,
                    reason = "Rule-based rename (local AI model not ready)"
                });
            }
            index++;
        }

        return results;
    }

    public static string? TryRulesResponse(string prompt)
    {
        if (string.IsNullOrWhiteSpace(prompt)) return null;
        if (prompt.Contains("Summarize", StringComparison.OrdinalIgnoreCase))
        {
            var lines = prompt.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var bullets = lines
                .Where(l => !l.StartsWith("Summarize", StringComparison.OrdinalIgnoreCase) && l.Length > 8)
                .Take(8)
                .Select(l => $"• {Truncate(l, 120)}")
                .ToList();
            return bullets.Count > 0
                ? "Summary (offline rules):\n" + string.Join("\n", bullets)
                : "No content available to summarize.";
        }
        return null;
    }

    private static string Truncate(string value, int max)
        => value.Length <= max ? value : value[..(max - 1)] + "…";
}
