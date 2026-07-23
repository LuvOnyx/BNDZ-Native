using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Microsoft.Extensions.FileSystemGlobbing;

namespace BNDZ.Services;

/// <summary>
/// Index / Smart Tools exclude rules via Microsoft.Extensions.FileSystemGlobbing.
/// Patterns are gitignore-style globs relative to a root (e.g. **/node_modules/**, *.tmp).
/// </summary>
public static class IndexPathGlobbing
{
    private static readonly string[] DefaultExcludePatterns =
    {
        "**/node_modules/**",
        "**/.git/**",
        "**/bin/**",
        "**/obj/**",
        "**/.vs/**",
        "**/__pycache__/**",
        "**/.cache/**",
        "**/*.tmp",
        "**/*.temp",
        "**/Thumbs.db",
        "**/desktop.ini",
    };

    private static Matcher? _excludeMatcher;
    private static string _excludeSignature = "";

    public static IReadOnlyList<string> DefaultExcludes => DefaultExcludePatterns;

    public static void ConfigureExcludes(IEnumerable<string>? extraPatterns = null)
    {
        var patterns = new List<string>(DefaultExcludePatterns);
        if (extraPatterns != null)
        {
            foreach (var p in extraPatterns)
            {
                if (!string.IsNullOrWhiteSpace(p))
                    patterns.Add(p.Trim());
            }
        }

        var sig = string.Join("\n", patterns);
        if (sig == _excludeSignature && _excludeMatcher != null) return;

        var matcher = new Matcher(StringComparison.OrdinalIgnoreCase);
        foreach (var p in patterns)
            matcher.AddInclude(p); // "include" in matcher = paths that match exclude rules for us
        _excludeMatcher = matcher;
        _excludeSignature = sig;
    }

    public static bool IsExcluded(string absolutePath, string? rootForRelative = null)
    {
        if (_excludeMatcher == null)
            ConfigureExcludes();

        try
        {
            var full = Path.GetFullPath(absolutePath);
            var root = string.IsNullOrEmpty(rootForRelative)
                ? Path.GetPathRoot(full) ?? full
                : Path.GetFullPath(rootForRelative);

            var rel = Path.GetRelativePath(root, full).Replace('\\', '/');
            if (rel.StartsWith(".."))
                rel = full.Replace('\\', '/').TrimStart('/');

            // Matcher.Match returns MatchResult with HasMatches
            var result = _excludeMatcher!.Match(rel);
            if (result.HasMatches) return true;

            // Also match directory name shortcuts used historically.
            var name = Path.GetFileName(full.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
            if (string.Equals(name, "node_modules", StringComparison.OrdinalIgnoreCase)) return true;
            if (string.Equals(name, ".git", StringComparison.OrdinalIgnoreCase)) return true;
            if (name.StartsWith('.')) return true;
            return false;
        }
        catch
        {
            return false;
        }
    }
}
