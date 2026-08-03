using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

public sealed class SemanticClusterDto
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public int Count { get; set; }
    public List<string> Paths { get; set; } = new();
}

public sealed class SemanticDeskClusterResult
{
    public List<SemanticClusterDto> Clusters { get; set; } = new();
    public int ItemCount { get; set; }
    public int ClusterCount { get; set; }
}

public sealed class SemanticDeskService
{
    private static readonly Lazy<SemanticDeskService> Lazy = new(() => new SemanticDeskService());
    public static SemanticDeskService Instance => Lazy.Value;

    private static readonly Regex TokenRx = new(@"[a-zA-Z0-9]+", RegexOptions.Compiled);

    private SemanticDeskService() { }

    public SemanticDeskClusterResult ClusterPaths(IEnumerable<string> paths, int? desiredClusters = null)
    {
        var items = new List<(string Path, double[] Vec)>();
        foreach (var raw in paths)
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            var full = Path.GetFullPath(raw);
            if (!File.Exists(full) && !Directory.Exists(full)) continue;
            items.Add((full, BuildFeatureVector(full)));
        }

        if (items.Count == 0)
            return new SemanticDeskClusterResult();

        int k = desiredClusters ?? ComputeK(items.Count);
        k = Math.Clamp(k, 3, Math.Min(8, items.Count));

        var centroids = InitializeCentroids(items, k);
        var assignments = new int[items.Count];

        for (int iter = 0; iter < 24; iter++)
        {
            for (int i = 0; i < items.Count; i++)
                assignments[i] = ArgMinDistance(items[i].Vec, centroids);

            var newCentroids = new double[k][];
            var counts = new int[k];
            for (int c = 0; c < k; c++)
                newCentroids[c] = new double[FeatureDim];

            for (int i = 0; i < items.Count; i++)
            {
                var a = assignments[i];
                counts[a]++;
                for (int d = 0; d < FeatureDim; d++)
                    newCentroids[a][d] += items[i].Vec[d];
            }

            for (int c = 0; c < k; c++)
            {
                if (counts[c] == 0) continue;
                for (int d = 0; d < FeatureDim; d++)
                    newCentroids[c][d] /= counts[c];
            }
            centroids = newCentroids;
        }

        var clusters = new List<SemanticClusterDto>();
        for (int c = 0; c < k; c++)
        {
            var clusterPaths = new List<string>();
            for (int i = 0; i < items.Count; i++)
            {
                if (assignments[i] == c)
                    clusterPaths.Add(items[i].Path);
            }
            if (clusterPaths.Count == 0) continue;

            clusters.Add(new SemanticClusterDto
            {
                Id = $"pile_{c + 1}",
                Label = LabelForCluster(clusterPaths),
                Count = clusterPaths.Count,
                Paths = clusterPaths,
            });
        }

        clusters = clusters.OrderByDescending(c => c.Count).ToList();
        return new SemanticDeskClusterResult
        {
            Clusters = clusters,
            ItemCount = items.Count,
            ClusterCount = clusters.Count,
        };
    }

    public SemanticDeskClusterResult ClusterFolder(string folderPath, int? desiredClusters = null)
    {
        if (string.IsNullOrWhiteSpace(folderPath) || !Directory.Exists(folderPath))
            return new SemanticDeskClusterResult();

        var paths = new List<string>();
        try
        {
            foreach (var entry in Directory.EnumerateFileSystemEntries(folderPath))
                paths.Add(entry);
        }
        catch
        {
            return new SemanticDeskClusterResult();
        }

        return ClusterPaths(paths, desiredClusters);
    }

    private const int FeatureDim = 12;

    private static int ComputeK(int n)
    {
        if (n <= 3) return n;
        var k = (int)Math.Round(Math.Sqrt(n / 2.0));
        return Math.Clamp(k, 3, 8);
    }

    private static double[] BuildFeatureVector(string path)
    {
        var vec = new double[FeatureDim];
        var isDir = Directory.Exists(path);
        var name = Path.GetFileName(path) ?? "";
        var ext = Path.GetExtension(path).ToLowerInvariant();
        long size = 0;
        if (!isDir && File.Exists(path))
            try { size = new FileInfo(path).Length; } catch { }

        vec[0] = isDir ? 1 : 0;
        vec[1] = IsImageExt(ext) ? 1 : 0;
        vec[2] = IsAudioExt(ext) ? 1 : 0;
        vec[3] = IsVideoExt(ext) ? 1 : 0;
        vec[4] = IsDocExt(ext) ? 1 : 0;
        vec[5] = IsCodeExt(ext) ? 1 : 0;
        vec[6] = Math.Min(1.0, Math.Log10(size + 1) / 10.0);
        vec[7] = Math.Min(1.0, name.Length / 64.0);

        var tokens = TokenRx.Matches(name.ToLowerInvariant()).Select(m => m.Value).Take(3).ToList();
        for (int t = 0; t < 3; t++)
        {
            var hash = t < tokens.Count ? StableHash(tokens[t]) : 0;
            vec[8 + t] = (hash % 1000) / 1000.0;
        }

        return vec;
    }

    private static double[][] InitializeCentroids(List<(string Path, double[] Vec)> items, int k)
    {
        var centroids = new double[k][];
        var rnd = new Random(42);
        var picked = new HashSet<int>();
        for (int c = 0; c < k; c++)
        {
            int idx;
            do { idx = rnd.Next(items.Count); } while (picked.Contains(idx) && picked.Count < items.Count);
            picked.Add(idx);
            centroids[c] = (double[])items[idx].Vec.Clone();
        }
        return centroids;
    }

    private static int ArgMinDistance(double[] vec, double[][] centroids)
    {
        int best = 0;
        double bestDist = double.MaxValue;
        for (int c = 0; c < centroids.Length; c++)
        {
            var d = SquaredDistance(vec, centroids[c]);
            if (d < bestDist)
            {
                bestDist = d;
                best = c;
            }
        }
        return best;
    }

    private static double SquaredDistance(double[] a, double[] b)
    {
        double sum = 0;
        for (int i = 0; i < a.Length; i++)
        {
            var diff = a[i] - b[i];
            sum += diff * diff;
        }
        return sum;
    }

    private static string LabelForCluster(List<string> paths)
    {
        if (paths.All(p => Directory.Exists(p)))
            return "Folders";

        var extCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        int folders = 0;
        foreach (var p in paths)
        {
            if (Directory.Exists(p))
            {
                folders++;
                continue;
            }
            var ext = Path.GetExtension(p);
            if (string.IsNullOrEmpty(ext)) ext = "(none)";
            extCounts[ext] = extCounts.GetValueOrDefault(ext) + 1;
        }

        if (folders > paths.Count / 2)
            return "Folders & containers";

        var topExt = extCounts.OrderByDescending(kv => kv.Value).FirstOrDefault();
        if (topExt.Key != null)
        {
            var label = ExtensionLabel(topExt.Key);
            if (extCounts.Count > 1)
                return $"{label} mix";
            return label;
        }
        return "Misc pile";
    }

    private static string ExtensionLabel(string ext)
    {
        ext = ext.ToLowerInvariant();
        if (IsImageExt(ext)) return "Images";
        if (IsAudioExt(ext)) return "Audio";
        if (IsVideoExt(ext)) return "Video";
        if (IsDocExt(ext)) return "Documents";
        if (IsCodeExt(ext)) return "Code";
        if (ext == "(none)") return "No extension";
        return ext.TrimStart('.').ToUpperInvariant() + " files";
    }

    private static bool IsImageExt(string ext) =>
        ext is ".png" or ".jpg" or ".jpeg" or ".gif" or ".bmp" or ".webp" or ".svg" or ".ico" or ".tif" or ".tiff";

    private static bool IsAudioExt(string ext) =>
        ext is ".mp3" or ".wav" or ".flac" or ".aac" or ".ogg" or ".m4a" or ".aiff";

    private static bool IsVideoExt(string ext) =>
        ext is ".mp4" or ".mkv" or ".avi" or ".mov" or ".wmv" or ".webm";

    private static bool IsDocExt(string ext) =>
        ext is ".pdf" or ".doc" or ".docx" or ".txt" or ".md" or ".rtf" or ".odt" or ".xlsx" or ".pptx";

    private static bool IsCodeExt(string ext) =>
        ext is ".cs" or ".ts" or ".tsx" or ".js" or ".jsx" or ".py" or ".go" or ".rs" or ".cpp" or ".h" or ".json" or ".xml" or ".yaml" or ".yml";

    private static int StableHash(string s)
    {
        unchecked
        {
            int hash = 17;
            foreach (var ch in s)
                hash = hash * 31 + ch;
            return hash;
        }
    }
}
