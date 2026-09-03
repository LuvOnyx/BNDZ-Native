using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace BNDZ.Services;

/// <summary>
/// Undo of extract/sync must never treat the destination folder as "created by the op".
/// The action log records the folder extracted/synced <em>into</em>, which typically already
/// held unrelated files. Recursive-deleting that folder is data loss.
/// </summary>
public static class ActionLogUndoSafety
{
    /// <summary>
    /// Maps archive/sync relative paths onto children of <paramref name="destRoot"/>.
    /// Rejects rooted paths, <c>..</c> escapes, and the destination root itself.
    /// </summary>
    public static List<string> CollectUndoTargets(string destRoot, IEnumerable<string> relativePaths)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (string.IsNullOrWhiteSpace(destRoot) || relativePaths == null)
            return new List<string>();

        foreach (var rel in relativePaths)
        {
            if (TryResolveContainedChild(destRoot, rel, out var full))
                set.Add(full);
        }

        return set.OrderByDescending(p => p.Length).ToList();
    }

    public static bool TryResolveContainedChild(string destRoot, string? relative, out string fullPath)
    {
        fullPath = "";
        if (string.IsNullOrWhiteSpace(destRoot) || string.IsNullOrWhiteSpace(relative))
            return false;

        if (!TryNormalizeRoot(destRoot, out var rootFull, out var rootPrefix))
            return false;

        var relRaw = relative.Replace('/', Path.DirectorySeparatorChar)
            .Replace('\\', Path.DirectorySeparatorChar)
            .Trim();
        // Rooted check before stripping separators — "/etc/passwd" must not become "etc/passwd".
        if (Path.IsPathRooted(relRaw))
            return false;

        var rel = relRaw.Trim(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (string.IsNullOrEmpty(rel) || rel == ".")
            return false;

        var segments = rel.Split(new[] { Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar },
            StringSplitOptions.RemoveEmptyEntries);
        if (segments.Length == 0 || segments.Any(s => s == ".."))
            return false;

        string combined;
        try
        {
            combined = Path.GetFullPath(Path.Combine(rootFull, rel));
        }
        catch
        {
            return false;
        }

        return IsStrictChild(rootFull, rootPrefix, combined, out fullPath);
    }

    /// <summary>
    /// Deletes contained files, then prunes empty directories left behind.
    /// Never deletes <paramref name="destRoot"/> itself, even if it becomes empty.
    /// Never recursively deletes a directory that still has unrelated children.
    /// </summary>
    public static void DeleteContainedTargets(string destRoot, IReadOnlyList<string> targets)
    {
        if (string.IsNullOrWhiteSpace(destRoot) || targets == null || targets.Count == 0)
            return;
        if (!TryNormalizeRoot(destRoot, out var rootFull, out var rootPrefix))
            return;

        var files = new List<string>();
        var dirs = new List<string>();
        foreach (var raw in targets)
        {
            if (!IsStrictChild(rootFull, rootPrefix, raw, out var full))
                continue;
            try
            {
                if (File.Exists(full)) files.Add(full);
                else if (Directory.Exists(full)) dirs.Add(full);
            }
            catch
            {
                /* skip inaccessible */
            }
        }

        foreach (var file in files)
        {
            try { File.Delete(file); }
            catch { /* best-effort per item */ }
            PruneEmptyParents(file, rootFull, rootPrefix);
        }

        foreach (var dir in dirs.Distinct(StringComparer.OrdinalIgnoreCase).OrderByDescending(p => p.Length))
        {
            try
            {
                if (!Directory.Exists(dir)) continue;
                if (Directory.EnumerateFileSystemEntries(dir).Any()) continue;
                Directory.Delete(dir, recursive: false);
            }
            catch { /* best-effort per item */ }
            PruneEmptyParents(dir, rootFull, rootPrefix);
        }
    }

    private static void PruneEmptyParents(string path, string rootFull, string rootPrefix)
    {
        string? dir;
        try { dir = Path.GetDirectoryName(Path.GetFullPath(path)); }
        catch { return; }

        while (!string.IsNullOrEmpty(dir))
        {
            string full;
            try { full = Path.GetFullPath(dir); }
            catch { return; }

            if (!IsStrictChild(rootFull, rootPrefix, full, out _))
                break;

            try
            {
                if (!Directory.Exists(full) || Directory.EnumerateFileSystemEntries(full).Any())
                    break;
                Directory.Delete(full, recursive: false);
            }
            catch
            {
                break;
            }

            dir = Path.GetDirectoryName(full);
        }
    }

    private static bool TryNormalizeRoot(string destRoot, out string rootFull, out string rootPrefix)
    {
        rootFull = "";
        rootPrefix = "";
        try
        {
            rootFull = Path.GetFullPath(destRoot);
        }
        catch
        {
            return false;
        }

        rootPrefix = rootFull.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                     + Path.DirectorySeparatorChar;
        return true;
    }

    private static bool IsStrictChild(string rootFull, string rootPrefix, string candidate, out string fullPath)
    {
        fullPath = "";
        if (string.IsNullOrWhiteSpace(candidate))
            return false;

        string combinedFull;
        try { combinedFull = Path.GetFullPath(candidate); }
        catch { return false; }

        var rootCmp = rootFull.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var combinedCmp = combinedFull.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (string.Equals(combinedCmp, rootCmp, StringComparison.OrdinalIgnoreCase))
            return false;
        if (!combinedFull.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
            return false;

        fullPath = combinedFull;
        return true;
    }
}
