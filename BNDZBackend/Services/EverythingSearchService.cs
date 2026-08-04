using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

public class EverythingSearchService
{
    private const int DefaultMaxDepth = 8;
    private const int DriveRootMaxDepth = 3;
    private const int TimeBudgetMs = 12000;

    private static readonly string[] SearchRoots =
    {
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments),
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
    };

    private static readonly HashSet<string> SkipDirs = new(StringComparer.OrdinalIgnoreCase)
    {
        "$Recycle.Bin", "System Volume Information", "Windows", "Program Files", "Program Files (x86)",
        "node_modules", ".git", "AppData"
    };

    public (List<object> Results, string Engine) Search(
        string query,
        int limit = 1000,
        bool useRegex = false,
        string rootPath = "",
        bool preferEverything = true,
        bool searchContent = false,
        bool preferBndzIndex = true)
    {
        return SearchAdvanced(query, limit, useRegex, string.IsNullOrEmpty(rootPath) ? [] : [rootPath], preferEverything, searchContent, false, preferBndzIndex);
    }

    public (List<object> Results, string Engine) SearchAdvanced(
        string query,
        int limit,
        bool useRegex,
        IReadOnlyList<string> rootPaths,
        bool preferEverything,
        bool searchContent,
        bool booleanMode,
        bool preferBndzIndex = true)
    {
        var results = new List<object>();
        if (string.IsNullOrWhiteSpace(query)) return (results, "indexed");

        var roots = rootPaths?.Where(p => !string.IsNullOrWhiteSpace(p)).ToList() ?? [];
        var primaryRoot = roots.FirstOrDefault() ?? "";

        if (preferBndzIndex && !useRegex && !booleanMode)
        {
            try
            {
                var scopePane = string.IsNullOrEmpty(primaryRoot) ? "" : "/" + primaryRoot.Replace("\\", "/").TrimStart('/');

                if (searchContent)
                {
                    var contentHits = BndzFileIndexService.Instance.SearchContent(query, limit, scopePane);
                    if (contentHits.Count > 0)
                        return (contentHits.Take(limit).ToList(), "indexed-content");
                }

                var indexed = BndzFileIndexService.Instance.Search(query, limit, scopePane);

                if (!preferEverything)
                    return (indexed.Take(limit).ToList(), indexed.Count > 0 ? "indexed" : "indexed");

                if (indexed.Count >= limit)
                    return (indexed.Take(limit).ToList(), "indexed");

                var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
                var ranked = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
                const double k = 60.0; // RRF constant

                void Accrue(IEnumerable<object> list, double weight)
                {
                    var i = 0;
                    foreach (var item in list)
                    {
                        var p = ExtractResultPath(item);
                        if (string.IsNullOrEmpty(p)) continue;
                        var score = weight / (k + i + 1);
                        ranked[p] = ranked.TryGetValue(p, out var prev) ? prev + score : score;
                        i++;
                    }
                }

                Accrue(indexed, 1.0);

                var winSearchHits = 0;
                var winSearch = new List<object>();
                try
                {
                    winSearch = new WindowsSearchService().Search(query, limit, string.IsNullOrEmpty(primaryRoot) ? null : primaryRoot);
                    Accrue(winSearch, 0.85);
                    winSearchHits = winSearch.Count;
                }
                catch { /* optional engine */ }

                var everythingHits = new List<object>();
                if (TrySearchEverything(query, limit, primaryRoot, everythingHits))
                    Accrue(everythingHits, 1.1);

                // Recency bump from index/Windows hits that carry modified ticks when available.
                foreach (var item in indexed.Concat(winSearch).Concat(everythingHits))
                {
                    var p = ExtractResultPath(item);
                    if (string.IsNullOrEmpty(p) || !ranked.ContainsKey(p)) continue;
                    try
                    {
                        var mod = item.GetType().GetProperty("modified")?.GetValue(item);
                        if (mod is long ticks && ticks > 0)
                        {
                            var ageDays = Math.Max(0, (DateTime.UtcNow - new DateTime(ticks, DateTimeKind.Utc)).TotalDays);
                            ranked[p] += 0.15 / (1.0 + ageDays / 30.0);
                        }
                    }
                    catch { /* ignore */ }
                }

                var byPath = new Dictionary<string, object>(StringComparer.OrdinalIgnoreCase);
                foreach (var item in indexed.Concat(winSearch).Concat(everythingHits))
                {
                    var p = ExtractResultPath(item);
                    if (string.IsNullOrEmpty(p) || byPath.ContainsKey(p)) continue;
                    byPath[p] = item;
                    seen.Add(p);
                }

                var fused = ranked
                    .OrderByDescending(kv => kv.Value)
                    .Select(kv => byPath.TryGetValue(kv.Key, out var o) ? o : null)
                    .Where(o => o != null)
                    .Cast<object>()
                    .Take(limit)
                    .ToList();

                if (fused.Count > 0)
                {
                    string engine = "indexed";
                    if (everythingHits.Count > 0) engine = "rrf:indexed+everything";
                    else if (winSearchHits > 0) engine = "rrf:indexed+windows-search";
                    return (fused, engine);
                }
            }
            catch { /* fall through */ }
        }

        // Windows Search alone when BNDZ index path was skipped / empty.
        if (!useRegex && !booleanMode && !searchContent)
        {
            try
            {
                var ws = new WindowsSearchService().Search(query, limit, string.IsNullOrEmpty(primaryRoot) ? null : primaryRoot);
                if (ws.Count > 0)
                    return (ws.Take(limit).ToList(), "windows-search");
            }
            catch { }
        }

        if (booleanMode && !useRegex)
        {
            var ast = BndzBooleanSearchParser.Parse(query);
            var evQuery = BndzBooleanSearchParser.ToEverythingQuery(ast);
            if (searchContent && !evQuery.Contains(':'))
                evQuery = $"content:{evQuery}";

            if (preferEverything && TrySearchEverything(evQuery, limit, primaryRoot, results))
                return (results.Take(limit).ToList(), "everything");

            foreach (var root in roots.Count > 0 ? roots : [""])
            {
                var partial = SearchFilesystemBoolean(ast, limit - results.Count, useRegex, root);
                results.AddRange(partial);
                if (results.Count >= limit) break;
            }
            if (results.Count > 0) return (results.Take(limit).ToList(), "indexed-boolean");

            if (searchContent)
            {
                var grepRoots = roots.Count > 0 ? roots : SearchRoots.ToList();
                var grep = new BndzContentGrepService().Grep(grepRoots, query, limit, useRegex);
                return (grep, "content-grep");
            }
            return (results, "indexed-boolean");
        }

        if (searchContent && !query.Contains(':', StringComparison.Ordinal))
            query = $"content:{query}";

        if (preferEverything && TrySearchEverything(query, limit, primaryRoot, results))
            return (results.Take(limit).ToList(), "everything");

        // Prefer index/Windows Search for global queries — skip whole-disk FS walks when
        // preferBndzIndex was on and no scoped root was provided.
        if (preferBndzIndex && !useRegex && !booleanMode && !searchContent
            && string.IsNullOrEmpty(primaryRoot))
        {
            return (results, "indexed");
        }

        var fs = SearchFilesystem(query, limit, useRegex, primaryRoot);
        if (fs.Count > 0) return (fs, "indexed");

        if (searchContent)
        {
            var grepRoots = roots.Count > 0 ? roots : SearchRoots.ToList();
            var grep = new BndzContentGrepService().Grep(grepRoots, query, limit, useRegex);
            return (grep, "content-grep");
        }
        return (fs, "indexed");
    }

    private List<object> SearchFilesystemBoolean(BndzBooleanSearchParser.Node ast, int limit, bool useRegex, string rootPath)
    {
        var results = new List<object>();
        var roots = new List<string>();
        int maxDepth = DefaultMaxDepth;

        if (!string.IsNullOrEmpty(rootPath))
        {
            var normalized = rootPath.Replace("/", "\\");
            if (normalized.StartsWith("\\") && normalized.Length > 2 && normalized[1] != ':')
                normalized = normalized.TrimStart('\\');
            if (Directory.Exists(normalized))
            {
                roots.Add(normalized);
                if (IsDriveRoot(normalized)) maxDepth = DriveRootMaxDepth;
            }
        }
        if (roots.Count == 0)
        {
            roots.AddRange(SearchRoots.Distinct().Where(Directory.Exists));
            maxDepth = 6;
        }

        var sw = System.Diagnostics.Stopwatch.StartNew();
        foreach (var root in roots)
        {
            SearchDirectoryBoolean(root, ast, results, limit, useRegex, maxDepth, 0, sw);
            if (results.Count >= limit || sw.ElapsedMilliseconds > TimeBudgetMs) break;
        }
        return results.Take(limit).ToList();
    }

    private static void SearchDirectoryBoolean(
        string dir, BndzBooleanSearchParser.Node ast, List<object> results, int limit,
        bool useRegex, int maxDepth, int depth, System.Diagnostics.Stopwatch sw)
    {
        if (results.Count >= limit || depth > maxDepth || sw.ElapsedMilliseconds > TimeBudgetMs) return;
        try
        {
            foreach (var file in Directory.EnumerateFiles(dir))
            {
                if (results.Count >= limit || sw.ElapsedMilliseconds > TimeBudgetMs) return;
                var name = Path.GetFileName(file);
                if (BndzBooleanSearchParser.MatchesFilename(name, ast, useRegex))
                    results.Add(new { name, path = "/" + file.Replace("\\", "/"), size = new FileInfo(file).Length });
            }
            foreach (var sub in Directory.EnumerateDirectories(dir))
            {
                if (results.Count >= limit || sw.ElapsedMilliseconds > TimeBudgetMs) return;
                var name = Path.GetFileName(sub);
                if (SkipDirs.Contains(name) || name.StartsWith('.')) continue;
                if (BndzBooleanSearchParser.MatchesFilename(name, ast, useRegex))
                    results.Add(new { name, path = "/" + sub.Replace("\\", "/"), isDirectory = true });
                SearchDirectoryBoolean(sub, ast, results, limit, useRegex, maxDepth, depth + 1, sw);
            }
        }
        catch { }
    }

    private static bool TrySearchEverything(string query, int limit, string rootPath, List<object> results)
    {
        var esPath = FindEverythingCli();
        if (esPath == null) return false;

        try
        {
            var searchTerm = BuildEverythingQuery(query, rootPath);
            var args = $"-n {Math.Max(1, Math.Min(limit, 10000))} {searchTerm}";

            var psi = new ProcessStartInfo(esPath, args)
            {
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true,
                StandardOutputEncoding = Encoding.UTF8,
            };

            using var proc = Process.Start(psi);
            if (proc == null) return false;

            if (!proc.WaitForExit(8000))
            {
                try { proc.Kill(true); } catch { }
                return false;
            }

            if (proc.ExitCode != 0) return false;

            while (results.Count < limit && proc.StandardOutput.ReadLine() is { } line)
            {
                var trimmed = line.Trim();
                if (string.IsNullOrEmpty(trimmed)) continue;
                if (!File.Exists(trimmed) && !Directory.Exists(trimmed)) continue;

                var isDir = Directory.Exists(trimmed);
                var name = Path.GetFileName(trimmed.TrimEnd('\\', '/'));
                if (string.IsNullOrEmpty(name)) name = trimmed;

                if (isDir)
                {
                    results.Add(new { name, path = "/" + trimmed.Replace("\\", "/"), isDirectory = true });
                }
                else
                {
                    long size = 0;
                    try { size = new FileInfo(trimmed).Length; } catch { }
                    results.Add(new { name, path = "/" + trimmed.Replace("\\", "/"), size });
                }
            }

            return results.Count > 0;
        }
        catch
        {
            return false;
        }
    }

    private static string BuildEverythingQuery(string query, string rootPath)
    {
        var escaped = query.Replace("\"", "\\\"");
        if (string.IsNullOrEmpty(rootPath)) return $"\"{escaped}\"";

        var normalized = rootPath.Replace("/", "\\").TrimStart('\\');
        if (normalized.StartsWith("/")) normalized = normalized.Substring(1).Replace("/", "\\");
        if (normalized.Length >= 2 && normalized[0] != '/' && normalized[1] == ':')
            normalized = normalized.TrimEnd('\\') + "\\";

        return $"\"path:{normalized} {escaped}\"";
    }

    private static string? FindEverythingCli()
    {
        var candidates = new List<string>
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Everything", "es.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Everything", "es.exe"),
            @"C:\Program Files\Everything\es.exe",
            @"C:\Program Files (x86)\Everything\es.exe",
        };

        var localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        candidates.Add(Path.Combine(localApp, "Everything", "es.exe"));

        foreach (var path in candidates.Distinct())
        {
            if (File.Exists(path)) return path;
        }
        return null;
    }

    private List<object> SearchFilesystem(string query, int limit, bool useRegex, string rootPath)
    {
        var results = new List<object>();
        var comparison = StringComparison.OrdinalIgnoreCase;
        Regex? regex = null;
        if (useRegex)
        {
            try { regex = new Regex(query, RegexOptions.IgnoreCase); }
            catch { return results; }
        }

        var roots = new List<string>();
        int maxDepth = DefaultMaxDepth;

        if (!string.IsNullOrEmpty(rootPath))
        {
            var normalized = rootPath.Replace("/", "\\");
            if (normalized.StartsWith("\\") && normalized.Length > 2 && normalized[1] != ':')
                normalized = normalized.TrimStart('\\');
            if (Directory.Exists(normalized))
            {
                roots.Add(normalized);
                if (IsDriveRoot(normalized)) maxDepth = DriveRootMaxDepth;
            }
            else if (normalized.Length >= 2 && normalized[1] == ':' && !normalized.EndsWith("\\"))
            {
                var driveRoot = normalized.Substring(0, 2) + "\\";
                if (Directory.Exists(driveRoot)) roots.Add(driveRoot);
            }
        }

        if (roots.Count == 0)
        {
            roots.AddRange(SearchRoots.Distinct().Where(Directory.Exists));
            maxDepth = 6;
        }

        var sw = Stopwatch.StartNew();

        foreach (var root in roots)
        {
            try
            {
                SearchDirectory(root, query, results, limit, comparison, regex, maxDepth, 0, sw);
            }
            catch { /* skip inaccessible roots */ }
            if (results.Count >= limit || sw.ElapsedMilliseconds > TimeBudgetMs) break;
        }

        return results.Take(limit).ToList();
    }

    private static bool IsDriveRoot(string path)
    {
        var p = path.TrimEnd('\\');
        return p.Length == 2 && p[1] == ':';
    }

    private static void SearchDirectory(
        string dir, string query, List<object> results, int limit,
        StringComparison comparison, Regex? regex, int maxDepth, int depth, Stopwatch sw)
    {
        if (results.Count >= limit || depth > maxDepth || sw.ElapsedMilliseconds > TimeBudgetMs) return;

        try
        {
            foreach (var file in Directory.EnumerateFiles(dir))
            {
                if (results.Count >= limit || sw.ElapsedMilliseconds > TimeBudgetMs) return;
                var name = Path.GetFileName(file);
                if (Matches(name, query, comparison, regex))
                {
                    results.Add(new { name, path = "/" + file.Replace("\\", "/"), size = new FileInfo(file).Length });
                }
            }

            foreach (var sub in Directory.EnumerateDirectories(dir))
            {
                if (results.Count >= limit || sw.ElapsedMilliseconds > TimeBudgetMs) return;
                var name = Path.GetFileName(sub);
                if (SkipDirs.Contains(name) || name.StartsWith('.')) continue;

                if (Matches(name, query, comparison, regex))
                {
                    results.Add(new { name, path = "/" + sub.Replace("\\", "/"), isDirectory = true });
                }
                SearchDirectory(sub, query, results, limit, comparison, regex, maxDepth, depth + 1, sw);
            }
        }
        catch { /* skip permission errors */ }
    }

    private static bool Matches(string name, string query, StringComparison comparison, Regex? regex)
    {
        if (regex != null) return regex.IsMatch(name);
        return name.Contains(query, comparison);
    }

    private static string? ExtractResultPath(object item)
    {
        if (item == null) return null;
        try
        {
            var prop = item.GetType().GetProperty("path");
            var raw = prop?.GetValue(item) as string;
            return NormalizeSearchPathKey(raw);
        }
        catch { return null; }
    }

    /// <summary>Unify pane (/C:/...) and Win32 (C:\...) paths for HashSet dedupe.</summary>
    private static string? NormalizeSearchPathKey(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return null;
        var p = path.Trim().Replace('\\', '/');
        if (p.StartsWith('/')) p = p.TrimStart('/');
        if (p.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
            p = p["file:".Length..].TrimStart('/');
        return string.IsNullOrEmpty(p) ? null : p;
    }
}
