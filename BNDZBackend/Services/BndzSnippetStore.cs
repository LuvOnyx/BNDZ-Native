using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

/// <summary>SuperCmd snippet-store port — JSON persistence under launcher UserData.</summary>
public sealed class BndzSnippetStore
{
    private readonly string _path;
    private List<SnippetEntry> _items = [];

    public BndzSnippetStore(string launcherUserDataDir)
    {
        var dir = Path.Combine(launcherUserDataDir, "BNDZ");
        Directory.CreateDirectory(dir);
        _path = Path.Combine(dir, "snippets.json");
        Load();
        EnsureSamples();
    }

    public IReadOnlyList<SnippetEntry> Search(string? query)
    {
        var q = (query ?? "").Trim();
        IEnumerable<SnippetEntry> src = _items.OrderByDescending(s => s.Pinned).ThenByDescending(s => s.UpdatedAt);
        if (string.IsNullOrEmpty(q)) return src.Take(40).ToList();
        return src.Where(s =>
            s.Name.Contains(q, StringComparison.OrdinalIgnoreCase)
            || s.Content.Contains(q, StringComparison.OrdinalIgnoreCase)
            || (s.Keyword?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false)).Take(40).ToList();
    }

    public IReadOnlyList<SnippetEntry> GetAll() =>
        _items.OrderByDescending(s => s.Pinned).ThenByDescending(s => s.UpdatedAt).ToList();

    public bool Delete(string id)
    {
        var removed = _items.RemoveAll(i => i.Id == id);
        if (removed > 0) Save();
        return removed > 0;
    }

    public string? RenderContent(string id)
    {
        var s = _items.FirstOrDefault(i => i.Id == id);
        if (s == null) return null;
        var text = s.Content;
        text = text.Replace("{clipboard}", GetClipboardSafe(), StringComparison.OrdinalIgnoreCase);
        text = text.Replace("{date}", DateTime.Now.ToString("yyyy-MM-dd"), StringComparison.OrdinalIgnoreCase);
        text = text.Replace("{time}", DateTime.Now.ToString("HH:mm"), StringComparison.OrdinalIgnoreCase);
        text = Regex.Replace(text, @"\{date:([^}]+)\}", m => DateTime.Now.ToString(m.Groups[1].Value), RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"\{time:([^}]+)\}", m => DateTime.Now.ToString(m.Groups[1].Value), RegexOptions.IgnoreCase);
        return text;
    }

    public SnippetEntry? Upsert(string? id, string name, string content, string? keyword = null)
    {
        name = name.Trim();
        content = content.Trim();
        if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(content)) return null;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (!string.IsNullOrEmpty(id))
        {
            var existing = _items.FirstOrDefault(i => i.Id == id);
            if (existing != null)
            {
                existing.Name = name;
                existing.Content = content;
                existing.Keyword = keyword?.Trim();
                existing.UpdatedAt = now;
                Save();
                return existing;
            }
        }
        var entry = new SnippetEntry
        {
            Id = Guid.NewGuid().ToString("N"),
            Name = name,
            Content = content,
            Keyword = keyword?.Trim(),
            CreatedAt = now,
            UpdatedAt = now,
        };
        _items.Insert(0, entry);
        Save();
        return entry;
    }

    private static string GetClipboardSafe()
    {
        try { return System.Windows.Forms.Clipboard.ContainsText() ? System.Windows.Forms.Clipboard.GetText() : ""; }
        catch { return ""; }
    }

    private void Load()
    {
        if (!File.Exists(_path)) return;
        try
        {
            var list = JsonSerializer.Deserialize<List<SnippetEntry>>(File.ReadAllText(_path));
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
        Upsert(null, "Email signature", "—\nSent from BNDZ", "sig");
        Upsert(null, "Current date", "Today is {date}", "date");
    }
}

public sealed class SnippetEntry
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Content { get; set; } = "";
    public string? Keyword { get; set; }
    public bool Pinned { get; set; }
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
}
