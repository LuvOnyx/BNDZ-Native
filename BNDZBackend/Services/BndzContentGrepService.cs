using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

/// <summary>In-process content grep when Everything content: is unavailable.</summary>
public sealed class BndzContentGrepService
{
    private static readonly HashSet<string> TextExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        "txt", "md", "log", "json", "xml", "csv", "ini", "bat", "ps1", "js", "ts", "tsx", "jsx",
        "css", "html", "htm", "yml", "yaml", "cs", "cpp", "h", "py", "rb", "go", "rs", "sql",
    };

    private const int MaxFileBytes = 2 * 1024 * 1024;
    private const int TimeBudgetMs = 15000;

    public List<object> Grep(
        IEnumerable<string> rootPaths,
        string pattern,
        int limit,
        bool useRegex,
        bool caseSensitive = false)
    {
        var results = new List<object>();
        if (string.IsNullOrWhiteSpace(pattern)) return results;

        Regex? regex = null;
        var comparison = caseSensitive ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase;
        if (useRegex)
        {
            try { regex = new Regex(pattern, caseSensitive ? RegexOptions.None : RegexOptions.IgnoreCase); }
            catch { return results; }
        }

        var sw = System.Diagnostics.Stopwatch.StartNew();
        foreach (var raw in rootPaths.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            var root = Normalize(raw);
            if (!Directory.Exists(root)) continue;
            GrepDir(root, pattern, results, limit, comparison, regex, sw, 0, 6);
            if (results.Count >= limit || sw.ElapsedMilliseconds > TimeBudgetMs) break;
        }
        return results.Take(limit).ToList();
    }

    private static string Normalize(string p)
    {
        p = p.Replace("/", "\\").Trim();
        if (p.StartsWith("\\") && p.Length > 2 && p[1] != ':') p = p.TrimStart('\\');
        return p;
    }

    private static void GrepDir(
        string dir, string pattern, List<object> results, int limit,
        StringComparison comparison, Regex? regex, System.Diagnostics.Stopwatch sw, int depth, int maxDepth)
    {
        if (results.Count >= limit || depth > maxDepth || sw.ElapsedMilliseconds > TimeBudgetMs) return;
        try
        {
            foreach (var file in Directory.EnumerateFiles(dir))
            {
                if (results.Count >= limit || sw.ElapsedMilliseconds > TimeBudgetMs) return;
                var ext = Path.GetExtension(file).TrimStart('.');
                if (!TextExtensions.Contains(ext)) continue;
                try
                {
                    var fi = new FileInfo(file);
                    if (fi.Length > MaxFileBytes) continue;
                    var text = File.ReadAllText(file, Encoding.UTF8);
                    if (!ContentMatches(text, pattern, comparison, regex)) continue;
                    results.Add(new
                    {
                        name = fi.Name,
                        path = "/" + file.Replace("\\", "/"),
                        size = fi.Length,
                        matchType = "content",
                    });
                }
                catch { }
            }
            foreach (var sub in Directory.EnumerateDirectories(dir))
            {
                var name = Path.GetFileName(sub);
                if (name.StartsWith('.') || name is "$Recycle.Bin" or "node_modules") continue;
                GrepDir(sub, pattern, results, limit, comparison, regex, sw, depth + 1, maxDepth);
            }
        }
        catch { }
    }

    private static bool ContentMatches(string text, string pattern, StringComparison comparison, Regex? regex)
    {
        if (regex != null) return regex.IsMatch(text);
        return text.Contains(pattern, comparison);
    }
}
