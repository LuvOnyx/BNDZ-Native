using System.Diagnostics;
using Microsoft.Extensions.FileSystemGlobbing;

namespace BNDZ.Services.GhostLink;

public sealed class GhostLinkScanner
{
    public IEnumerable<string> ScanRule(GhostLinkRule rule, CancellationToken ct = default)
    {
        if (!rule.Enabled || string.IsNullOrWhiteSpace(rule.ColdStorageRoot)) yield break;

        var roots = rule.SourceRoots.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        var extensions = rule.Extensions.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(e => e.TrimStart('.').ToLowerInvariant()).ToHashSet();
        var cutoff = DateTime.UtcNow.AddDays(-rule.IdleDays);

        foreach (var root in roots)
        {
            if (!Directory.Exists(root)) continue;
            var matcher = new Matcher();
            matcher.AddInclude(rule.PathGlob);

            foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
            {
                ct.ThrowIfCancellationRequested();
                FileInfo? fi = null;
                try { fi = new FileInfo(file); }
                catch { continue; }

                if (fi.Length < rule.MinSizeBytes) continue;
                if (extensions.Count > 0)
                {
                    var ext = fi.Extension.TrimStart('.').ToLowerInvariant();
                    if (!extensions.Contains(ext)) continue;
                }

                var rel = Path.GetRelativePath(root, file);
                if (!matcher.Match(rel).HasMatches) continue;

                if (fi.LastAccessTimeUtc > cutoff) continue;

                var attrs = File.GetAttributes(file);
                if (attrs.HasFlag(FileAttributes.ReparsePoint)) continue;

                yield return file;
            }
        }
    }
}
