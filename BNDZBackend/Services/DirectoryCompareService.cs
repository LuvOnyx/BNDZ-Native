using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading.Tasks;

namespace BNDZ.Services;

public static class DirectoryCompareService
{
    public static Task<List<object>> CompareAsync(string pathA, string pathB, bool useHashing)
    {
        return Task.Run(() =>
        {
            var results = new List<object>();
            try
            {
                var winA = Normalize(pathA);
                var winB = Normalize(pathB);
                if (!Directory.Exists(winA) || !Directory.Exists(winB))
                    return results;

                var filesA = EnumerateFiles(winA);
                var filesB = EnumerateFiles(winB);
                var allNames = filesA.Keys.Union(filesB.Keys, StringComparer.OrdinalIgnoreCase).OrderBy(n => n, StringComparer.OrdinalIgnoreCase);

                foreach (var name in allNames)
                {
                    filesA.TryGetValue(name, out var infoA);
                    filesB.TryGetValue(name, out var infoB);

                    string status;
                    if (infoA == null) status = "onlyRight";
                    else if (infoB == null) status = "onlyLeft";
                    else if (infoA.Length != infoB.Length) status = "different";
                    else if (useHashing && !HashesMatch(infoA.FullPath, infoB.FullPath)) status = "different";
                    else if (infoA.LastWriteUtc != infoB.LastWriteUtc) status = "different";
                    else status = "same";

                    results.Add(new
                    {
                        id = name,
                        name,
                        status,
                        leftSize = infoA?.Length ?? 0L,
                        rightSize = infoB?.Length ?? 0L,
                        leftModified = infoA?.LastWriteUtc.ToString("o"),
                        rightModified = infoB?.LastWriteUtc.ToString("o"),
                    });
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine($"DirectoryCompareService: {ex.Message}");
            }

            return results;
        });
    }

    private static string Normalize(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        var p = path.Replace('/', '\\').Trim();
        if (p.StartsWith("\\") && p.Length > 2 && p[1] != '\\') p = p.TrimStart('\\');
        return p;
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

    private sealed record FileSnap(string FullPath, long Length, DateTime LastWriteUtc);
}
