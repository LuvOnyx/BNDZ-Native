using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

/// <summary>SuperCmd quicklink-store port — bookmarked URL templates.</summary>
public sealed class BndzQuickLinkStore
{
    private readonly string _path;
    private List<QuickLinkEntry> _items = [];

    public BndzQuickLinkStore(string launcherUserDataDir)
    {
        var dir = Path.Combine(launcherUserDataDir, "BNDZ");
        Directory.CreateDirectory(dir);
        _path = Path.Combine(dir, "quicklinks.json");
        Load();
        EnsureSamples();
    }

    public IReadOnlyList<QuickLinkEntry> Search(string? query)
    {
        var q = (query ?? "").Trim();
        IEnumerable<QuickLinkEntry> src = _items.OrderByDescending(l => l.UpdatedAt);
        if (string.IsNullOrEmpty(q)) return src.Take(40).ToList();
        return src.Where(l =>
            l.Name.Contains(q, StringComparison.OrdinalIgnoreCase)
            || l.UrlTemplate.Contains(q, StringComparison.OrdinalIgnoreCase)).Take(40).ToList();
    }

    public IReadOnlyList<QuickLinkEntry> GetAll() =>
        _items.OrderByDescending(l => l.UpdatedAt).ToList();

    public bool Delete(string id)
    {
        var removed = _items.RemoveAll(i => i.Id == id);
        if (removed > 0) Save();
        return removed > 0;
    }

    public string? ResolveUrl(string id, IReadOnlyDictionary<string, string>? fields = null)
    {
        var link = _items.FirstOrDefault(i => i.Id == id);
        if (link == null) return null;
        var url = link.UrlTemplate;
        if (fields != null)
        {
            foreach (var kv in fields)
                url = url.Replace($"{{{kv.Key}}}", Uri.EscapeDataString(kv.Value), StringComparison.OrdinalIgnoreCase);
        }
        url = Regex.Replace(url, @"\{query\}", fields != null && fields.TryGetValue("query", out var q) ? Uri.EscapeDataString(q) : "", RegexOptions.IgnoreCase);
        return url;
    }

    public QuickLinkEntry? Upsert(string? id, string name, string urlTemplate)
    {
        name = name.Trim();
        urlTemplate = urlTemplate.Trim();
        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(urlTemplate)) return null;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (!string.IsNullOrEmpty(id))
        {
            var existing = _items.FirstOrDefault(i => i.Id == id);
            if (existing != null)
            {
                existing.Name = name;
                existing.UrlTemplate = urlTemplate;
                existing.UpdatedAt = now;
                Save();
                return existing;
            }
        }
        var entry = new QuickLinkEntry
        {
            Id = Guid.NewGuid().ToString("N"),
            Name = name,
            UrlTemplate = urlTemplate,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _items.Insert(0, entry);
        Save();
        return entry;
    }

    private void Load()
    {
        if (!File.Exists(_path)) return;
        try
        {
            var list = JsonSerializer.Deserialize<List<QuickLinkEntry>>(File.ReadAllText(_path));
            if (list != null) _items = list;
        }
        catch { }
    }

    private void Save()
    {
        File.WriteAllText(_path, JsonSerializer.Serialize(_items, new JsonSerializerOptions { WriteIndented = true }));
    }

    private void EnsureSamples()
    {
        if (_items.Count > 0) return;
        Upsert(null, "Google Search", "https://www.google.com/search?q={query}");
        Upsert(null, "GitHub", "https://github.com/search?q={query}&type=repositories");
    }
}

public sealed class QuickLinkEntry
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string UrlTemplate { get; set; } = "";
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
}
