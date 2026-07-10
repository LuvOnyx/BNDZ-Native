using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace BNDZ.Services;

/// <summary>Plans destination paths and byte estimates for copy/move operations.</summary>
public static class FileOperationPathPlanner
{
    public static List<(string Source, string Dest)> Plan(string action, IReadOnlyList<string> sources, string target)
    {
        var results = new List<(string, string)>();
        action = (action ?? "copy").ToLowerInvariant();
        var targetDir = Normalize(target);

        if (action is "move" or "rename" && sources.Count == 1 && !string.IsNullOrEmpty(targetDir))
        {
            var src = Normalize(sources[0]);
            if (File.Exists(src) && !Directory.Exists(targetDir))
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
        }

        if (!Directory.Exists(targetDir) && sources.Count == 1 && File.Exists(sources[0]))
            targetDir = Path.GetDirectoryName(targetDir) ?? targetDir;

        foreach (var raw in sources)
        {
            var src = Normalize(raw);
            if (File.Exists(src))
            {
                results.Add((src, Path.Combine(targetDir, Path.GetFileName(src))));
            }
            else if (Directory.Exists(src))
            {
                var destRoot = Path.Combine(targetDir, Path.GetFileName(src.TrimEnd('\\', '/')));
                foreach (var file in Directory.EnumerateFiles(src, "*", SearchOption.AllDirectories))
                {
                    var rel = Path.GetRelativePath(src, file);
                    results.Add((file, Path.Combine(destRoot, rel)));
                }
            }
        }

        return results;
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
