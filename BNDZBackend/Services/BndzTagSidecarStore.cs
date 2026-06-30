using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;

namespace BNDZ.Services;

/// <summary>Per-path tag + label + comment metadata (XYplorer tagging lite).</summary>
public sealed class BndzTagSidecarStore
{
    private readonly string _path;
    private Dictionary<string, TagSidecarEntry> _map = new(StringComparer.OrdinalIgnoreCase);

    public BndzTagSidecarStore()
    {
        var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
        var dir = Path.Combine(appData, "BNDZ64");
        Directory.CreateDirectory(dir);
        _path = Path.Combine(dir, "tag-sidecar.json");
        Load();
    }

    public TagSidecarEntry? Get(string path)
    {
        var key = Normalize(path);
        return _map.TryGetValue(key, out var e) ? e : null;
    }

    public void ApplyTags(IEnumerable<string> paths, IEnumerable<string> tags)
    {
        var tagList = tags.Where(t => !string.IsNullOrWhiteSpace(t)).Select(t => t.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
        foreach (var raw in paths)
        {
            var key = Normalize(raw);
            if (!_map.TryGetValue(key, out var entry))
            {
                entry = new TagSidecarEntry { Path = key };
                _map[key] = entry;
            }
            foreach (var t in tagList)
                if (!entry.Tags.Contains(t, StringComparer.OrdinalIgnoreCase))
                    entry.Tags.Add(t);
            entry.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        }
        Save();
    }

    public void SetMeta(string path, string? label, string? comment, IEnumerable<string>? tags = null)
    {
        var key = Normalize(path);
        if (!_map.TryGetValue(key, out var entry))
        {
            entry = new TagSidecarEntry { Path = key, Tags = [] };
            _map[key] = entry;
        }
        if (label != null) entry.Label = label.Trim();
        if (comment != null) entry.Comment = comment.Trim();
        if (tags != null)
        {
            entry.Tags = tags
                .Where(t => !string.IsNullOrWhiteSpace(t))
                .Select(t => t.Trim())
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
        }
        entry.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        Save();
    }

    public IReadOnlyList<TagSidecarEntry> GetAll() => _map.Values.OrderBy(v => v.Path).ToList();

    public static List<Dictionary<string, object?>> EnrichDirResults(List<object> results, BndzTagSidecarStore store)
    {
        var list = new List<Dictionary<string, object?>>();
        foreach (var item in results)
        {
            var json = JsonSerializer.Serialize(item);
            var dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json) ?? new Dictionary<string, object?>();
            if (dict.TryGetValue("path", out var pathObj) && pathObj is string path)
            {
                var side = store.Get(path);
                if (side != null)
                {
                    dict["tags"] = side.Tags;
                    if (!string.IsNullOrWhiteSpace(side.Label)) dict["label"] = side.Label;
                    if (!string.IsNullOrWhiteSpace(side.Comment)) dict["comment"] = side.Comment;
                }
            }
            list.Add(dict);
        }
        return list;
    }

    private static string Normalize(string path) =>
        path.Replace('/', '\\').TrimEnd('\\');

    private void Load()
    {
        if (!File.Exists(_path)) return;
        try
        {
            var list = JsonSerializer.Deserialize<List<TagSidecarEntry>>(File.ReadAllText(_path)) ?? [];
            _map = list.ToDictionary(e => Normalize(e.Path), e => e, StringComparer.OrdinalIgnoreCase);
        }
        catch { }
    }

    private void Save()
    {
        var list = _map.Values.OrderBy(v => v.Path).ToList();
        File.WriteAllText(_path, JsonSerializer.Serialize(list, new JsonSerializerOptions { WriteIndented = true }));
    }
}

public sealed class TagSidecarEntry
{
    public string Path { get; set; } = "";
    public List<string> Tags { get; set; } = [];
    public string? Label { get; set; }
    public string? Comment { get; set; }
    public long UpdatedAt { get; set; }
}
