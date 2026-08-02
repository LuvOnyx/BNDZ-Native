using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace BNDZ.Services;

/// <summary>Plans destination paths and byte estimates for copy/move operations.</summary>
public static class FileOperationPathPlanner
{
    public static bool ShouldRecreateStructure(IReadOnlyList<string> sources)
    {
        if (sources.Count <= 1) return false;
        var parents = sources
            .Select(s =>
            {
                var n = Normalize(s);
                if (Directory.Exists(n)) return n.TrimEnd('\\', '/');
                return Path.GetDirectoryName(n) ?? "";
            })
            .Where(p => !string.IsNullOrEmpty(p))
            .Distinct(StringComparer.OrdinalIgnoreCase);
        return parents.Count() > 1;
    }

    public static List<(string Source, string Dest)> Plan(
        string action,
        IReadOnlyList<string> sources,
        string target,
        bool recreateSourceStructure = false)
    {
        var results = new List<(string, string)>();
        action = (action ?? "copy").ToLowerInvariant();
        var targetDir = Normalize(target);
        var useStructure = recreateSourceStructure && ShouldRecreateStructure(sources);
        var commonRoot = useStructure ? GetCommonDirectory(sources.Select(SourceRootForStructure).Where(p => !string.IsNullOrEmpty(p))) : "";

        if (action is "move" or "rename" && sources.Count == 1 && !string.IsNullOrEmpty(targetDir))
        {
            var src = Normalize(sources[0]);
            // Target is the new full path (rename / move-as), not a parent container.
            if (!Directory.Exists(targetDir) && !File.Exists(targetDir))
            {
                if (File.Exists(src))
                {
                    var destFile = targetDir;
                    if (!destFile.EndsWith(Path.GetFileName(src), StringComparison.OrdinalIgnoreCase)
                        && !File.Exists(destFile) && !Directory.Exists(destFile))
                        destFile = Path.Combine(Path.GetDirectoryName(targetDir) ?? targetDir, Path.GetFileName(targetDir));
                    if (!File.Exists(destFile) || string.Equals(src, destFile, StringComparison.OrdinalIgnoreCase))
                        results.Add((src, destFile));
                    else
                        results.Add((src, Path.Combine(Path.GetDirectoryName(destFile) ?? targetDir, Path.GetFileName(src))));
                    return results;
                }

                if (Directory.Exists(src))
                {
                    // Dest IS the renamed folder — do not nest GetFileName(src) under it.
                    foreach (var file in EnumerateFilesRecursive(src))
                    {
                        var rel = Path.GetRelativePath(src, file);
                        results.Add((file, Path.Combine(targetDir, rel)));
                    }
                    // Empty folders still need a marker so callers create the root.
                    if (results.Count == 0)
                        results.Add((src, targetDir));
                    return results;
                }
            }
        }

        if (!Directory.Exists(targetDir) && sources.Count == 1 && File.Exists(sources[0]))
            targetDir = Path.GetDirectoryName(targetDir) ?? targetDir;

        foreach (var raw in sources)
        {
            var src = Normalize(raw);
            if (File.Exists(src))
            {
                results.Add((src, ResolveFileDestination(src, targetDir, useStructure, commonRoot)));
            }
            else if (Directory.Exists(src))
            {
                var destRoot = useStructure
                    ? ResolveDirectoryRootDestination(src, targetDir, commonRoot)
                    : Path.Combine(targetDir, Path.GetFileName(src.TrimEnd('\\', '/')));
                foreach (var file in EnumerateFilesRecursive(src))
                {
                    var rel = Path.GetRelativePath(src, file);
                    results.Add((file, Path.Combine(destRoot, rel)));
                }
            }
        }

        return results;
    }

    /// <summary>Enumerate files under a directory respecting followJunctions / resolveJunctions preferences.</summary>
    public static IEnumerable<string> EnumerateFilesRecursive(string root)
    {
        var prefs = FileOperationPreferences.Current;
        var stack = new Stack<string>();
        stack.Push(Normalize(root));
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            if (!visited.Add(dir)) continue;

            IEnumerable<string> files;
            IEnumerable<string> dirs;
            try
            {
                files = Directory.EnumerateFiles(dir);
                dirs = Directory.EnumerateDirectories(dir);
            }
            catch
            {
                continue;
            }

            foreach (var file in files)
            {
                if (prefs.ResolveJunctions && IsReparsePoint(file))
                {
                    var target = TryResolveReparseFile(file);
                    if (!string.IsNullOrEmpty(target) && File.Exists(target))
                    {
                        yield return target;
                        continue;
                    }
                }
                yield return file;
            }

            foreach (var sub in dirs)
            {
                if (!prefs.FollowJunctions && IsReparsePoint(sub)) continue;
                stack.Push(sub);
            }
        }
    }

    private static bool IsReparsePoint(string path)
    {
        try
        {
            return File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint);
        }
        catch
        {
            return false;
        }
    }

    private static string? TryResolveReparseFile(string linkPath)
    {
        try
        {
            if (File.Exists(linkPath) && !IsReparsePoint(linkPath)) return linkPath;
            var fi = new FileInfo(linkPath);
            if (fi.Exists && fi.LinkTarget != null) return fi.LinkTarget;
        }
        catch { /* fall through */ }
        return null;
    }

    public static IEnumerable<string> EnumerateChildDirectoriesRecursive(string root)
    {
        var normalized = Normalize(root);
        foreach (var dir in EnumerateDirectoriesRecursive(normalized))
        {
            if (!string.Equals(dir, normalized, StringComparison.OrdinalIgnoreCase))
                yield return dir;
        }
    }

    private static IEnumerable<string> EnumerateDirectoriesRecursive(string root)
    {
        var prefs = FileOperationPreferences.Current;
        var stack = new Stack<string>();
        stack.Push(Normalize(root));
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        while (stack.Count > 0)
        {
            var dir = stack.Pop();
            if (!visited.Add(dir)) continue;
            yield return dir;
            IEnumerable<string> subs;
            try { subs = Directory.EnumerateDirectories(dir); }
            catch { continue; }
            foreach (var sub in subs)
            {
                if (!prefs.FollowJunctions && IsReparsePoint(sub)) continue;
                stack.Push(sub);
            }
        }
    }

    private static string SourceRootForStructure(string raw)
    {
        var src = Normalize(raw);
        if (Directory.Exists(src)) return src.TrimEnd('\\', '/');
        return Path.GetDirectoryName(src) ?? "";
    }

    private static string ResolveFileDestination(string src, string targetDir, bool useStructure, string commonRoot)
    {
        if (!useStructure) return Path.Combine(targetDir, Path.GetFileName(src));

        if (!string.IsNullOrEmpty(commonRoot)
            && src.StartsWith(commonRoot, StringComparison.OrdinalIgnoreCase)
            && src.Length > commonRoot.Length)
        {
            var rel = Path.GetRelativePath(commonRoot, src);
            return Path.Combine(targetDir, rel);
        }

        var parent = Path.GetDirectoryName(src) ?? "";
        var parentName = Path.GetFileName(parent.TrimEnd('\\', '/'));
        if (!string.IsNullOrEmpty(parentName))
            return Path.Combine(targetDir, parentName, Path.GetFileName(src));
        return Path.Combine(targetDir, Path.GetFileName(src));
    }

    private static string ResolveDirectoryRootDestination(string src, string targetDir, string commonRoot)
    {
        var trimmed = src.TrimEnd('\\', '/');
        if (!string.IsNullOrEmpty(commonRoot)
            && trimmed.StartsWith(commonRoot, StringComparison.OrdinalIgnoreCase)
            && trimmed.Length >= commonRoot.Length)
        {
            var rel = Path.GetRelativePath(commonRoot, trimmed);
            return string.IsNullOrEmpty(rel) || rel == "."
                ? Path.Combine(targetDir, Path.GetFileName(trimmed))
                : Path.Combine(targetDir, rel);
        }

        return Path.Combine(targetDir, Path.GetFileName(trimmed));
    }

    private static string GetCommonDirectory(IEnumerable<string> paths)
    {
        var list = paths.Where(p => !string.IsNullOrWhiteSpace(p)).Select(Normalize).ToList();
        if (list.Count == 0) return "";
        if (list.Count == 1) return list[0].TrimEnd('\\', '/');

        var segments = list
            .Select(p => p.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar))
            .ToList();
        var minLen = segments.Min(s => s.Length);
        var common = new List<string>();
        for (int i = 0; i < minLen; i++)
        {
            var seg = segments[0][i];
            if (segments.All(s => string.Equals(s[i], seg, StringComparison.OrdinalIgnoreCase)))
                common.Add(seg);
            else break;
        }

        return common.Count > 0
            ? string.Join(Path.DirectorySeparatorChar, common).TrimEnd('\\', '/')
            : "";
    }

    public static long EstimateBytes(IReadOnlyList<string> sources)
    {
        long total = 0;
        foreach (var raw in sources)
        {
            var src = Normalize(raw);
            if (File.Exists(src)) total += new FileInfo(src).Length;
            else if (Directory.Exists(src))
            {
                foreach (var file in Directory.EnumerateFiles(src, "*", SearchOption.AllDirectories))
                    total += new FileInfo(file).Length;
            }
        }
        return total;
    }

    public static long EstimateBytesForPlan(IEnumerable<(string Source, string Dest)> plan)
    {
        long total = 0;
        foreach (var (source, _) in plan)
        {
            if (File.Exists(source)) total += new FileInfo(source).Length;
        }
        return total;
    }

    public static bool IsCrossVolume(IReadOnlyList<string> sources, string target)
    {
        var targetRoot = Path.GetPathRoot(Normalize(target)) ?? "";
        if (string.IsNullOrEmpty(targetRoot)) return false;
        return sources.Any(s =>
        {
            var root = Path.GetPathRoot(Normalize(s)) ?? "";
            return !string.Equals(root, targetRoot, StringComparison.OrdinalIgnoreCase);
        });
    }

    public static void EnsureDestinationSpace(string targetDir, long requiredBytes)
    {
        if (requiredBytes <= 0) return;
        var root = Path.GetPathRoot(Normalize(targetDir));
        if (string.IsNullOrEmpty(root)) return;
        var drive = new DriveInfo(root);
        if (drive.IsReady && drive.AvailableFreeSpace < requiredBytes)
        {
            throw new IOException(
                $"Not enough free space on {root.TrimEnd('\\')}. Need {FormatBytes(requiredBytes)}, have {FormatBytes(drive.AvailableFreeSpace)}.");
        }
    }

    private static string FormatBytes(long bytes)
    {
        string[] units = { "B", "KB", "MB", "GB", "TB" };
        double v = bytes;
        int i = 0;
        while (v >= 1024 && i < units.Length - 1) { v /= 1024; i++; }
        return $"{v:0.##} {units[i]}";
    }

    private static string Normalize(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        if (path.StartsWith("/")) path = path[1..];
        path = path.Replace('/', '\\');
        while (path.Contains("\\\\")) path = path.Replace("\\\\", "\\");
        if (path.Length == 2 && path[1] == ':') path += "\\";
        return path;
    }
}
