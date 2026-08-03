using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

public sealed class PathHealIssue
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string LongPath { get; set; } = "";
    public string Issue { get; set; } = "";
    public string ProposedJunction { get; set; } = "";
    public string ProposedShortRoot { get; set; } = "";
    public string ShortLinkPath { get; set; } = "";
    public int Depth { get; set; }
}

public sealed class PathHealApplyResult
{
    public bool Ok { get; set; }
    public int Applied { get; set; }
    public List<string> Errors { get; set; } = new();
}

/// <summary>Detect MAX_PATH disasters and propose junction shortenings under ShortLinks.</summary>
public sealed class PathHealerService
{
    private static readonly Lazy<PathHealerService> Lazy = new(() => new PathHealerService());
    public static PathHealerService Instance => Lazy.Value;

    private const int MaxSafePathChars = 240;
    private static readonly Regex InvalidChars = new(@"[<>:""|?*]", RegexOptions.Compiled);

    private readonly string _shortLinksRoot;

    private PathHealerService()
    {
        _shortLinksRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "ShortLinks");
        Directory.CreateDirectory(_shortLinksRoot);
    }

    public string ShortLinksRoot => _shortLinksRoot;

    public List<PathHealIssue> Scan(string rootWinPath, int maxResults = 200)
    {
        var results = new List<PathHealIssue>();
        if (string.IsNullOrWhiteSpace(rootWinPath) || !Directory.Exists(rootWinPath)) return results;

        var root = Path.GetFullPath(rootWinPath);
        try
        {
            foreach (var dir in Directory.EnumerateDirectories(root, "*", SearchOption.AllDirectories))
            {
                if (results.Count >= maxResults) break;
                TryAddIssue(dir, results);
            }
            foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
            {
                if (results.Count >= maxResults) break;
                var parent = Path.GetDirectoryName(file);
                if (!string.IsNullOrEmpty(parent)) TryAddIssue(parent, results);
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[PathHealer] Scan error: {ex.Message}");
        }
        return results;
    }

    private void TryAddIssue(string path, List<PathHealIssue> results)
    {
        if (results.Any(r => string.Equals(r.LongPath, path, StringComparison.OrdinalIgnoreCase))) return;

        var issue = DetectIssue(path);
        if (issue == null) return;

        var shortName = BuildShortName(path);
        var junction = Path.Combine(_shortLinksRoot, shortName);
        var shortRoot = TruncatePath(path, MaxSafePathChars - 20);

        results.Add(new PathHealIssue
        {
            LongPath = path,
            Issue = issue,
            ProposedJunction = junction,
            ProposedShortRoot = shortRoot,
            ShortLinkPath = junction,
            Depth = path.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).Length,
        });
    }

    private static string? DetectIssue(string path)
    {
        if (path.Length > MaxSafePathChars) return $"Path length {path.Length} exceeds {MaxSafePathChars}";
        if (InvalidChars.IsMatch(path)) return "Path contains invalid Windows characters";
        if (path.Any(c => c < 32)) return "Path contains control characters";
        return null;
    }

    public PathHealApplyResult Apply(IReadOnlyList<string> issueIds, IReadOnlyList<PathHealIssue> scanned)
    {
        var result = new PathHealApplyResult { Ok = true };
        foreach (var id in issueIds)
        {
            var item = scanned.FirstOrDefault(s => string.Equals(s.Id, id, StringComparison.OrdinalIgnoreCase));
            if (item == null) continue;
            try
            {
                ApplyJunction(item.LongPath, item.ProposedJunction);
                result.Applied++;
            }
            catch (Exception ex)
            {
                result.Errors.Add($"{item.LongPath}: {ex.Message}");
                result.Ok = false;
            }
        }
        return result;
    }

    public void ApplyJunction(string targetPath, string junctionPath)
    {
        if (!Directory.Exists(targetPath)) throw new DirectoryNotFoundException(targetPath);
        var parent = Path.GetDirectoryName(junctionPath);
        if (!string.IsNullOrEmpty(parent)) Directory.CreateDirectory(parent);
        if (Directory.Exists(junctionPath) || File.Exists(junctionPath))
            throw new IOException($"Short link already exists: {junctionPath}");

        var psi = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c mklink /J \"{junctionPath}\" \"{targetPath}\"",
            CreateNoWindow = true,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        using var proc = Process.Start(psi);
        if (proc == null) throw new InvalidOperationException("Failed to start mklink");
        proc.WaitForExit(15000);
        if (proc.ExitCode != 0)
        {
            var err = proc.StandardError.ReadToEnd();
            throw new IOException(string.IsNullOrWhiteSpace(err) ? "mklink failed" : err.Trim());
        }
    }

    private static string BuildShortName(string path)
    {
        var hash = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(
            System.Text.Encoding.UTF8.GetBytes(path.ToLowerInvariant()))).Substring(0, 10);
        var leaf = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        if (string.IsNullOrEmpty(leaf)) leaf = "root";
        leaf = Regex.Replace(leaf, @"[<>:""|?*]", "_");
        if (leaf.Length > 24) leaf = leaf[..24];
        return $"{leaf}_{hash}";
    }

    private static string TruncatePath(string path, int maxLen)
    {
        if (path.Length <= maxLen) return path;
        var root = Path.GetPathRoot(path) ?? "";
        var tail = path.Substring(path.Length - (maxLen - root.Length - 3));
        return root + "..." + tail;
    }
}
