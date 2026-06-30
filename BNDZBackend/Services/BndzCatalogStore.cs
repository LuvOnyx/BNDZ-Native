using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

/// <summary>XYplorer-style catalog — virtual collections of paths and saved searches.</summary>
public sealed class BndzCatalogStore
{
    private readonly string _path;
    private List<CatalogEntry> _items = [];

    public BndzCatalogStore()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var dir = Path.Combine(appData, "BNDZ64");
        Directory.CreateDirectory(dir);
        _path = Path.Combine(dir, "catalog.json");
        Load();
    }

    public IReadOnlyList<CatalogEntry> GetAll() =>
        _items.OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase).ToList();

    public CatalogEntry? GetById(string id) =>
        _items.FirstOrDefault(c => c.Id.Equals(id, StringComparison.OrdinalIgnoreCase));

    public CatalogEntry? GetBySlug(string slug)
    {
        var s = Slugify(slug);
        return _items.FirstOrDefault(c =>
            c.Id.Equals(slug, StringComparison.OrdinalIgnoreCase)
            || Slugify(c.Name).Equals(s, StringComparison.OrdinalIgnoreCase));
    }

    public CatalogEntry? Upsert(string? id, string name, List<string>? paths, string? query)
    {
        name = name.Trim();
        if (string.IsNullOrEmpty(name)) return null;
        paths ??= [];
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();

        if (!string.IsNullOrEmpty(id))
        {
            var existing = _items.FirstOrDefault(c => c.Id == id);
            if (existing != null)
            {
                existing.Name = name;
                existing.Paths = paths.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
                existing.Query = string.IsNullOrWhiteSpace(query) ? null : query.Trim();
                existing.UpdatedAt = now;
                Save();
                return existing;
            }
        }

        var entry = new CatalogEntry
        {
            Id = string.IsNullOrEmpty(id) ? Guid.NewGuid().ToString("N") : id,
            Name = name,
            Paths = paths.Distinct(StringComparer.OrdinalIgnoreCase).ToList(),
            Query = string.IsNullOrWhiteSpace(query) ? null : query.Trim(),
            CreatedAt = now,
            UpdatedAt = now,
        };
        _items.Add(entry);
        Save();
        return entry;
    }

    public bool Delete(string id)
    {
        var removed = _items.RemoveAll(c => c.Id == id);
        if (removed > 0) Save();
        return removed > 0;
    }

    public List<object> ListAsVirtualFolders() =>
        _items.OrderBy(c => c.Name, StringComparer.OrdinalIgnoreCase).Select(c => new
        {
            id = $"catalog-{c.Id}",
            name = c.Name,
            type = "directory",
            path = $"/vf/{c.Id}",
            size = 0L,
            modified = DateTimeOffset.FromUnixTimeSeconds(c.UpdatedAt).UtcDateTime.ToString("O"),
            catalogId = c.Id,
            itemCount = c.Paths.Count,
        }).Cast<object>().ToList();

    public List<object> ResolveContents(CatalogEntry entry, BndzTagSidecarStore tags)
    {
        var results = BuildPathResults(entry, tags);

        if (!string.IsNullOrWhiteSpace(entry.Query))
            results = results.Where(r => MatchesQuery(GetResultName(r), entry.Query!)).ToList();

        return results;
    }

    /// <summary>Resolve catalog with optional Everything search for query-only or scoped saved searches.</summary>
    public List<object> ResolveContentsWithSearch(CatalogEntry entry, BndzTagSidecarStore tags, EverythingSearchService search, int limit = 500)
    {
        if (string.IsNullOrWhiteSpace(entry.Query))
            return ResolveContents(entry, tags);

        var query = entry.Query!.Trim();
        var roots = entry.Paths
            .Select(p => p.Replace('/', '\\').TrimEnd('\\'))
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .ToList();

        if (roots.Count == 0)
        {
            var (hits, engine) = search.Search(query, limit, false, "", true, false);
            return hits.Select(h => MapSearchHit(h, entry.Id, tags, engine)).ToList();
        }

        var merged = new List<object>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var root in roots)
        {
            var paneRoot = "/" + root.Replace("\\", "/");
            var (hits, _) = search.Search(query, limit, false, paneRoot, true, false);
            foreach (var h in hits)
            {
                var mapped = MapSearchHit(h, entry.Id, tags, "catalog-scoped");
                var path = GetResultPath(mapped);
                if (!string.IsNullOrEmpty(path) && seen.Add(path))
                    merged.Add(mapped);
            }
            merged.AddRange(BuildPathResults(CloneWithPaths(entry, root), tags)
                .Where(r => MatchesQuery(GetResultName(r), query)));
        }

        return merged
            .DistinctBy(GetResultPath, StringComparer.OrdinalIgnoreCase)
            .Take(limit)
            .ToList();
    }

    private static CatalogEntry CloneWithPaths(CatalogEntry entry, string singlePath) => new()
    {
        Id = entry.Id,
        Name = entry.Name,
        Paths = new List<string> { singlePath },
        Query = entry.Query,
        CreatedAt = entry.CreatedAt,
        UpdatedAt = entry.UpdatedAt,
    };

    private List<object> BuildPathResults(CatalogEntry entry, BndzTagSidecarStore tags)
    {
        var results = new List<object>();
        foreach (var raw in entry.Paths)
        {
            var win = raw.Replace('/', '\\').TrimEnd('\\');
            if (string.IsNullOrWhiteSpace(win)) continue;
            var side = tags.Get(win);
            if (Directory.Exists(win))
            {
                var di = new DirectoryInfo(win);
                results.Add(new
                {
                    id = $"vf-item-{entry.Id}-{win.Replace('\\', '/')}",
                    name = di.Name,
                    type = "directory",
                    path = win.Replace('\\', '/'),
                    size = 0L,
                    modified = di.LastWriteTimeUtc.ToString("O"),
                    created = di.CreationTimeUtc.ToString("O"),
                    tags = side?.Tags ?? new List<string>(),
                    label = side?.Label,
                    comment = side?.Comment,
                });
            }
            else if (File.Exists(win))
            {
                var fi = new FileInfo(win);
                results.Add(new
                {
                    id = $"vf-item-{entry.Id}-{win.Replace('\\', '/')}",
                    name = fi.Name,
                    type = "file",
                    path = win.Replace('\\', '/'),
                    size = fi.Length,
                    extension = fi.Extension.TrimStart('.').ToLowerInvariant(),
                    modified = fi.LastWriteTimeUtc.ToString("O"),
                    created = fi.CreationTimeUtc.ToString("O"),
                    tags = side?.Tags ?? new List<string>(),
                    label = side?.Label,
                    comment = side?.Comment,
                });
            }
            else
            {
                var name = Path.GetFileName(win.TrimEnd('\\')) ?? win;
                results.Add(new
                {
                    id = $"vf-missing-{entry.Id}-{win.Replace('\\', '/')}",
                    name,
                    type = "file",
                    path = win.Replace('\\', '/'),
                    size = 0L,
                    missing = true,
                    tags = side?.Tags ?? new List<string>(),
                    label = side?.Label,
                    comment = side?.Comment,
                });
            }
        }

        return results;
    }

    private static object MapSearchHit(object hit, string catalogId, BndzTagSidecarStore tags, string engine)
    {
        var type = hit.GetType();
        var name = type.GetProperty("name")?.GetValue(hit)?.ToString() ?? "";
        var path = type.GetProperty("path")?.GetValue(hit)?.ToString()?.TrimStart('/') ?? "";
        var isDir = type.GetProperty("isDirectory")?.GetValue(hit) is true;
        var size = type.GetProperty("size")?.GetValue(hit) is long l ? l : 0L;
        var win = path.Replace('/', '\\');
        var side = tags.Get(win);
        return new
        {
            id = $"vf-search-{catalogId}-{path.Replace('/', '-')}",
            name,
            type = isDir ? "directory" : "file",
            path,
            size,
            catalogSearch = true,
            searchEngine = engine,
            tags = side?.Tags ?? new List<string>(),
            label = side?.Label,
            comment = side?.Comment,
        };
    }

    private static string GetResultPath(object row)
    {
        var prop = row.GetType().GetProperty("path");
        return prop?.GetValue(row)?.ToString() ?? "";
    }

    private static string GetResultName(object row)
    {
        var prop = row.GetType().GetProperty("name");
        return prop?.GetValue(row)?.ToString() ?? "";
    }

    private static bool MatchesQuery(string name, string query)
    {
        query = query.Trim();
        if (string.IsNullOrEmpty(query)) return true;
        if (query.Contains('*') || query.Contains('?'))
        {
            var pattern = "^" + Regex.Escape(query).Replace("\\*", ".*").Replace("\\?", ".") + "$";
            return Regex.IsMatch(name, pattern, RegexOptions.IgnoreCase);
        }
        return name.Contains(query, StringComparison.OrdinalIgnoreCase);
    }

    private static string Slugify(string name) =>
        new string(name.ToLowerInvariant().Where(ch => char.IsLetterOrDigit(ch)).ToArray());

    private void Load()
    {
        if (!File.Exists(_path)) return;
        try
        {
            var list = JsonSerializer.Deserialize<List<CatalogEntry>>(File.ReadAllText(_path));
            if (list != null) _items = list;
        }
        catch { }
    }

    private void Save()
    {
        File.WriteAllText(_path, JsonSerializer.Serialize(_items, new JsonSerializerOptions { WriteIndented = true }));
    }
}

public sealed class CatalogEntry
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public List<string> Paths { get; set; } = [];
    public string? Query { get; set; }
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
}
