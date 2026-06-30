using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BNDZ.Services;

/// <summary>SuperCmd notes-store port — markdown notes under launcher UserData.</summary>
public sealed class BndzNoteStore
{
    private readonly string _path;
    private List<NoteEntry> _items = [];

    public BndzNoteStore(string launcherUserDataDir)
    {
        var dir = Path.Combine(launcherUserDataDir, "BNDZ");
        Directory.CreateDirectory(dir);
        _path = Path.Combine(dir, "notes.json");
        Load();
        EnsureSamples();
    }

    public IReadOnlyList<NoteEntry> Search(string? query)
    {
        var q = (query ?? "").Trim();
        IEnumerable<NoteEntry> src = _items.OrderByDescending(n => n.Pinned).ThenByDescending(n => n.UpdatedAt);
        if (string.IsNullOrEmpty(q)) return src.Take(40).ToList();
        return src.Where(n =>
            n.Title.Contains(q, StringComparison.OrdinalIgnoreCase)
            || n.Content.Contains(q, StringComparison.OrdinalIgnoreCase)).Take(40).ToList();
    }

    public IReadOnlyList<NoteEntry> GetAll() =>
        _items.OrderByDescending(n => n.Pinned).ThenByDescending(n => n.UpdatedAt).ToList();

    public bool Delete(string id)
    {
        var removed = _items.RemoveAll(i => i.Id == id);
        if (removed > 0) Save();
        return removed > 0;
    }

    public NoteEntry? Upsert(string? id, string title, string content)
    {
        title = title.Trim();
        content = content.Trim();
        if (string.IsNullOrEmpty(title)) return null;
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (!string.IsNullOrEmpty(id))
        {
            var existing = _items.FirstOrDefault(i => i.Id == id);
            if (existing != null)
            {
                existing.Title = title;
                existing.Content = content;
                existing.UpdatedAt = now;
                Save();
                return existing;
            }
        }
        var entry = new NoteEntry
        {
            Id = Guid.NewGuid().ToString("N"),
            Title = title,
            Content = content,
            CreatedAt = now,
            UpdatedAt = now,
        };
        _items.Add(entry);
        Save();
        return entry;
    }

    private void EnsureSamples()
    {
        if (_items.Count > 0) return;
        Upsert(null, "Welcome to BNDZ Notes", "# BNDZ Notes\n\nCapture ideas, links, and checklists right from the launcher.\n\n- Search with `notes`\n- Markdown supported");
    }

    private void Load()
    {
        if (!File.Exists(_path)) return;
        try
        {
            _items = JsonSerializer.Deserialize<List<NoteEntry>>(File.ReadAllText(_path)) ?? [];
        }
        catch { _items = []; }
    }

    private void Save()
    {
        File.WriteAllText(_path, JsonSerializer.Serialize(_items, new JsonSerializerOptions { WriteIndented = true }));
    }
}

public sealed class NoteEntry
{
    public string Id { get; set; } = "";
    public string Title { get; set; } = "";
    public string Content { get; set; } = "";
    public bool Pinned { get; set; }
    public long CreatedAt { get; set; }
    public long UpdatedAt { get; set; }
}
