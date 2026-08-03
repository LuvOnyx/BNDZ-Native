using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>
/// Cross-volume mirror comparison with conflict classification.
/// </summary>
public sealed class TwinVolumeService
{
    private static readonly Lazy<TwinVolumeService> Lazy = new(() => new TwinVolumeService());
    public static TwinVolumeService Instance => Lazy.Value;

    public Task<TwinVolumeCompareResult> CompareAsync(string leftRoot, string rightRoot, bool useHashing = true)
    {
        return Task.Run(() => Compare(leftRoot, rightRoot, useHashing));
    }

    public TwinVolumeCompareResult Compare(string leftRoot, string rightRoot, bool useHashing = true)
    {
        var left = NormalizeDir(leftRoot);
        var right = NormalizeDir(rightRoot);
        if (!Directory.Exists(left))
            return TwinVolumeCompareResult.Fail($"Left root not found: {left}");
        if (!Directory.Exists(right))
            return TwinVolumeCompareResult.Fail($"Right root not found: {right}");

        var filesLeft = EnumerateFiles(left);
        var filesRight = EnumerateFiles(right);
        var allRel = filesLeft.Keys
            .Union(filesRight.Keys, StringComparer.OrdinalIgnoreCase)
            .OrderBy(k => k, StringComparer.OrdinalIgnoreCase);

        var items = new List<TwinVolumeItem>();
        foreach (var rel in allRel)
        {
            filesLeft.TryGetValue(rel, out var snapL);
            filesRight.TryGetValue(rel, out var snapR);

            string status;
            if (snapL == null)
            {
                status = "OnlyRight";
            }
            else if (snapR == null)
            {
                status = "OnlyLeft";
            }
            else if (snapL.Length == snapR.Length
                     && (!useHashing || HashesMatch(snapL.FullPath, snapR.FullPath))
                     && Math.Abs((snapL.LastWriteUtc - snapR.LastWriteUtc).TotalSeconds) < 2)
            {
                status = "Same";
            }
            else if (snapL.Length == snapR.Length
                     && useHashing
                     && HashesMatch(snapL.FullPath, snapR.FullPath))
            {
                status = snapL.LastWriteUtc > snapR.LastWriteUtc ? "NewerLeft" : "NewerRight";
            }
            else if (snapL.Length != snapR.Length
                     || (useHashing && !HashesMatch(snapL.FullPath, snapR.FullPath)))
            {
                if (snapL.LastWriteUtc == snapR.LastWriteUtc)
                    status = "Conflict";
                else
                    status = snapL.LastWriteUtc > snapR.LastWriteUtc ? "NewerLeft" : "NewerRight";
            }
            else
            {
                status = snapL.LastWriteUtc > snapR.LastWriteUtc ? "NewerLeft" : "NewerRight";
            }

            items.Add(new TwinVolumeItem
            {
                RelativePath = rel,
                Status = status,
                LeftPath = snapL?.FullPath,
                RightPath = snapR?.FullPath,
                LeftSize = snapL?.Length ?? 0,
                RightSize = snapR?.Length ?? 0,
                LeftModifiedUtc = snapL?.LastWriteUtc.ToString("o"),
                RightModifiedUtc = snapR?.LastWriteUtc.ToString("o"),
            });
        }

        return new TwinVolumeCompareResult
        {
            Ok = true,
            LeftRoot = left,
            RightRoot = right,
            Items = items,
            Summary = BuildSummary(items),
        };
    }

    public TwinVolumeResolveResult Resolve(string leftRoot, string rightRoot, string relativePath, string direction)
    {
        var left = NormalizeDir(leftRoot);
        var right = NormalizeDir(rightRoot);
        var rel = relativePath.Replace('\\', '/').TrimStart('/');
        if (string.IsNullOrWhiteSpace(rel))
            return TwinVolumeResolveResult.Fail("Relative path required.");

        var src = direction.Equals("rightToLeft", StringComparison.OrdinalIgnoreCase)
            ? Path.Combine(right, rel.Replace('/', Path.DirectorySeparatorChar))
            : Path.Combine(left, rel.Replace('/', Path.DirectorySeparatorChar));
        var dest = direction.Equals("rightToLeft", StringComparison.OrdinalIgnoreCase)
            ? Path.Combine(left, rel.Replace('/', Path.DirectorySeparatorChar))
            : Path.Combine(right, rel.Replace('/', Path.DirectorySeparatorChar));

        if (!File.Exists(src))
            return TwinVolumeResolveResult.Fail($"Source not found: {src}");

        try
        {
            var destDir = Path.GetDirectoryName(dest);
            if (!string.IsNullOrEmpty(destDir))
                Directory.CreateDirectory(destDir);
            File.Copy(src, dest, overwrite: true);
            File.SetLastWriteTimeUtc(dest, File.GetLastWriteTimeUtc(src));
            return new TwinVolumeResolveResult { Ok = true, CopiedTo = dest, Direction = direction };
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[TwinVolume] Resolve: {ex.Message}");
            return TwinVolumeResolveResult.Fail(ex.Message);
        }
    }

    private static Dictionary<string, int> BuildSummary(List<TwinVolumeItem> items)
    {
        var summary = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items)
        {
            if (!summary.ContainsKey(item.Status)) summary[item.Status] = 0;
            summary[item.Status]++;
        }
        return summary;
    }

    private static Dictionary<string, FileSnap> EnumerateFiles(string root)
    {
        var map = new Dictionary<string, FileSnap>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(root, file).Replace('\\', '/');
            try
            {
                var fi = new FileInfo(file);
                map[rel] = new FileSnap(file, fi.Length, fi.LastWriteTimeUtc);
            }
            catch { /* skip locked */ }
        }
        return map;
    }

    private static bool HashesMatch(string pathA, string pathB)
    {
        try
        {
            using var sha = SHA256.Create();
            var hashA = sha.ComputeHash(File.ReadAllBytes(pathA));
            var hashB = sha.ComputeHash(File.ReadAllBytes(pathB));
            return hashA.SequenceEqual(hashB);
        }
        catch
        {
            return false;
        }
    }

    private static string NormalizeDir(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        return Path.GetFullPath(path.Replace('/', '\\').Trim().TrimEnd('\\'));
    }

    private sealed record FileSnap(string FullPath, long Length, DateTime LastWriteUtc);
}

public sealed class TwinVolumeItem
{
    public string RelativePath { get; set; } = "";
    public string Status { get; set; } = "";
    public string? LeftPath { get; set; }
    public string? RightPath { get; set; }
    public long LeftSize { get; set; }
    public long RightSize { get; set; }
    public string? LeftModifiedUtc { get; set; }
    public string? RightModifiedUtc { get; set; }
}

public sealed class TwinVolumeCompareResult
{
    public bool Ok { get; set; }
    public string LeftRoot { get; set; } = "";
    public string RightRoot { get; set; } = "";
    public List<TwinVolumeItem> Items { get; set; } = new();
    public Dictionary<string, int> Summary { get; set; } = new();
    public string? Error { get; set; }

    public static TwinVolumeCompareResult Fail(string error) => new() { Ok = false, Error = error };
}

public sealed class TwinVolumeResolveResult
{
    public bool Ok { get; set; }
    public string? CopiedTo { get; set; }
    public string? Direction { get; set; }
    public string? Error { get; set; }

    public static TwinVolumeResolveResult Fail(string error) => new() { Ok = false, Error = error };
}
