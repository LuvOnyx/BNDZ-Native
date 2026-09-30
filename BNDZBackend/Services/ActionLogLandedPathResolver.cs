using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;

namespace BNDZ.Services;

/// <summary>
/// Best-effort map of planned copy/move destinations to what actually landed on disk
/// after conflict "keep both" / rename-on-collision (native, TeraCopy, or planner drift).
/// </summary>
public static class ActionLogLandedPathResolver
{
    /// <summary>
    /// Snapshot paths that already exist for planned destinations and their keep-both siblings
    /// (<c>name (2).ext</c> …). Pass the result into <see cref="Resolve"/> after the op.
    /// </summary>
    public static HashSet<string> SnapshotExistingCandidates(IEnumerable<string> plannedDests, int maxSuffix = 32)
    {
        var set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var planned in plannedDests)
        {
            if (string.IsNullOrWhiteSpace(planned)) continue;
            foreach (var candidate in EnumerateKeepBothCandidates(planned, maxSuffix))
            {
                if (File.Exists(candidate) || Directory.Exists(candidate))
                    set.Add(Normalize(candidate));
            }
        }
        return set;
    }

    /// <summary>
    /// Resolve 1:1 source → actual destination pairs for Action Log undo.
    /// Prefers newly appeared keep-both siblings when the planned path still exists.
    /// </summary>
    public static (List<string> Sources, List<string> Destinations) Resolve(
        IReadOnlyList<string> sources,
        IReadOnlyList<string> plannedDests,
        bool isMove,
        IReadOnlySet<string>? existingBefore = null)
    {
        var pairedSrc = new List<string>();
        var pairedDest = new List<string>();
        if (sources == null || sources.Count == 0) return (pairedSrc, pairedDest);

        var n = Math.Min(sources.Count, plannedDests?.Count ?? 0);
        // When lengths differ, still try basename matching against planned list / target folder.
        if (n == 0 && plannedDests is { Count: > 0 })
        {
            // Fall through with empty planned pairing — try infer from source names below.
        }

        for (var i = 0; i < sources.Count; i++)
        {
            var src = sources[i];
            if (string.IsNullOrWhiteSpace(src)) continue;

            string? planned = null;
            if (plannedDests != null && i < plannedDests.Count)
                planned = plannedDests[i];
            else if (plannedDests != null && plannedDests.Count > 0)
            {
                var leaf = Path.GetFileName(src.TrimEnd('\\', '/'));
                planned = plannedDests.FirstOrDefault(d =>
                    string.Equals(Path.GetFileName(d.TrimEnd('\\', '/')), leaf, StringComparison.OrdinalIgnoreCase));
            }

            if (string.IsNullOrWhiteSpace(planned)) continue;

            if (isMove && (File.Exists(src) || Directory.Exists(src)))
            {
                // Source still present → skip / failed for this item; do not log a fake land.
                continue;
            }

            var landed = ResolveOne(planned, existingBefore);
            if (string.IsNullOrWhiteSpace(landed)) continue;
            if (!File.Exists(landed) && !Directory.Exists(landed)) continue;

            pairedSrc.Add(src);
            pairedDest.Add(landed);
        }

        return (pairedSrc, pairedDest);
    }

    /// <summary>
    /// Pick top-level destinations 1:1 with sources from a flat list of landed paths
    /// (BNDZ engine may include files inside moved folders).
    /// </summary>
    public static (List<string> Sources, List<string> Destinations) PairTopLevel(
        IReadOnlyList<string> sources,
        string targetDir,
        IReadOnlyList<string> landedPaths)
    {
        var pairedSrc = new List<string>();
        var pairedDest = new List<string>();
        if (sources == null || sources.Count == 0) return (pairedSrc, pairedDest);

        var landed = (landedPaths ?? Array.Empty<string>())
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(Normalize)
            .ToList();

        foreach (var src in sources)
        {
            if (string.IsNullOrWhiteSpace(src)) continue;
            var leaf = Path.GetFileName(src.TrimEnd('\\', '/'));
            if (string.IsNullOrEmpty(leaf)) continue;

            string? planned = null;
            if (!string.IsNullOrWhiteSpace(targetDir))
            {
                // Exact final path (rename / move-as) when target is not an existing directory.
                if (!Directory.Exists(targetDir) && sources.Count == 1)
                    planned = targetDir;
                else
                    planned = Path.Combine(targetDir, leaf);
            }

            string? match = null;
            if (!string.IsNullOrWhiteSpace(planned))
            {
                var plannedNorm = Normalize(planned);
                match = landed.FirstOrDefault(p => string.Equals(p, plannedNorm, StringComparison.OrdinalIgnoreCase));
                if (match == null)
                {
                    // keep-both: name (N).ext under same parent
                    foreach (var candidate in EnumerateKeepBothCandidates(planned, 64).Skip(1))
                    {
                        var cNorm = Normalize(candidate);
                        match = landed.FirstOrDefault(p => string.Equals(p, cNorm, StringComparison.OrdinalIgnoreCase));
                        if (match != null) break;
                        if (File.Exists(candidate) || Directory.Exists(candidate))
                        {
                            match = cNorm;
                            break;
                        }
                    }
                }
            }

            if (match == null)
            {
                // Basename match among landed top-level names (including keep-both suffixes).
                match = landed.FirstOrDefault(p =>
                {
                    var name = Path.GetFileName(p.TrimEnd('\\', '/'));
                    if (string.Equals(name, leaf, StringComparison.OrdinalIgnoreCase)) return true;
                    return IsKeepBothSiblingName(leaf, name);
                });
            }

            if (match == null) continue;
            pairedSrc.Add(src);
            pairedDest.Add(match);
        }

        return (pairedSrc, pairedDest);
    }

    private static string? ResolveOne(string planned, IReadOnlySet<string>? existingBefore)
    {
        var plannedNorm = Normalize(planned);
        var plannedExists = File.Exists(planned) || Directory.Exists(planned);

        // Prefer a keep-both sibling that appeared during the op.
        foreach (var candidate in EnumerateKeepBothCandidates(planned, 64).Skip(1))
        {
            if (!File.Exists(candidate) && !Directory.Exists(candidate)) continue;
            var cNorm = Normalize(candidate);
            var wasThere = existingBefore != null && existingBefore.Contains(cNorm);
            if (!wasThere)
                return candidate;
        }

        if (plannedExists)
        {
            // Replace / no-conflict: planned path is the land site.
            // If it existed before AND a new sibling also exists we already preferred sibling above.
            return planned;
        }

        // Planned missing — maybe only a keep-both sibling exists (and was pre-existing filter missed).
        foreach (var candidate in EnumerateKeepBothCandidates(planned, 64).Skip(1))
        {
            if (File.Exists(candidate) || Directory.Exists(candidate))
                return candidate;
        }

        return null;
    }

    /// <summary>Yield planned path, then name (2).ext, name (3).ext, …</summary>
    public static IEnumerable<string> EnumerateKeepBothCandidates(string planned, int maxSuffix)
    {
        if (string.IsNullOrWhiteSpace(planned)) yield break;
        yield return planned;
        var dir = Path.GetDirectoryName(planned) ?? "";
        var name = Path.GetFileNameWithoutExtension(planned);
        var ext = Path.GetExtension(planned);
        // Directories may have no extension; GetFileNameWithoutExtension still works.
        if (string.IsNullOrEmpty(name))
            name = Path.GetFileName(planned.TrimEnd('\\', '/'));
        for (var n = 2; n <= maxSuffix; n++)
            yield return Path.Combine(dir, $"{name} ({n}){ext}");
    }

    public static bool IsKeepBothSiblingName(string originalLeaf, string candidateLeaf)
    {
        if (string.IsNullOrEmpty(originalLeaf) || string.IsNullOrEmpty(candidateLeaf)) return false;
        var origName = Path.GetFileNameWithoutExtension(originalLeaf);
        var origExt = Path.GetExtension(originalLeaf);
        var candName = Path.GetFileNameWithoutExtension(candidateLeaf);
        var candExt = Path.GetExtension(candidateLeaf);
        if (!string.Equals(origExt, candExt, StringComparison.OrdinalIgnoreCase)) return false;
        if (!candName.StartsWith(origName + " (", StringComparison.OrdinalIgnoreCase)) return false;
        if (!candName.EndsWith(")", StringComparison.OrdinalIgnoreCase)) return false;
        var inner = candName.Substring(origName.Length + 2, candName.Length - origName.Length - 3);
        return int.TryParse(inner, out var n) && n >= 2;
    }

    private static string Normalize(string p) =>
        string.IsNullOrWhiteSpace(p) ? "" : p.Replace('/', '\\').TrimEnd('\\');
}
