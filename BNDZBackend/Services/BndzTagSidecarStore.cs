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
        ApplyMeta(path, label, comment, tags);
        Save();
    }

    public void SetMetaBatch(IEnumerable<(string path, string? label, string? comment, List<string>? tags)> items)
    {
        foreach (var (path, label, comment, tags) in items)
            ApplyMeta(path, label, comment, tags);
        Save();
    }

    private void ApplyMeta(string path, string? label, string? comment, IEnumerable<string>? tags)
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
    }

    public IReadOnlyList<TagSidecarEntry> GetAll() => _map.Values.OrderBy(v => v.Path).ToList();

    /// <summary>Remove a tag key from every sidecar entry (tag definition deleted in Tag Manager).</summary>
    public int PurgeTagKey(string tagKey)
    {
        if (string.IsNullOrWhiteSpace(tagKey)) return 0;
        var changed = 0;
        foreach (var entry in _map.Values)
        {
            var before = entry.Tags.Count;
            entry.Tags = entry.Tags
                .Where(t => !string.Equals(t, tagKey, StringComparison.OrdinalIgnoreCase))
                .ToList();
            if (entry.Tags.Count != before)
            {
                entry.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
                changed++;
            }
        }
        if (changed > 0) Save();
        return changed;
    }

    /// <summary>Rename a tag key across all sidecar entries.</summary>
    public int RenameTagKey(string oldKey, string newKey)
    {
        if (string.IsNullOrWhiteSpace(oldKey) || string.IsNullOrWhiteSpace(newKey)) return 0;
        if (string.Equals(oldKey, newKey, StringComparison.OrdinalIgnoreCase)) return 0;
        var changed = 0;
        foreach (var entry in _map.Values)
        {
            var idx = entry.Tags.FindIndex(t => string.Equals(t, oldKey, StringComparison.OrdinalIgnoreCase));
            if (idx < 0) continue;
            if (entry.Tags.Any(t => string.Equals(t, newKey, StringComparison.OrdinalIgnoreCase)))
                entry.Tags.RemoveAt(idx);
            else
                entry.Tags[idx] = newKey;
            entry.UpdatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            changed++;
        }
        if (changed > 0) Save();
        return changed;
    }

    /// <summary>Copy label, comment, and tags from source paths to destination paths after copy/sync.</summary>
    public void CopyMetadata(IEnumerable<(string source, string dest)> mappings)
    {
        var changed = false;
        foreach (var (source, dest) in mappings)
        {
            var entry = Get(source);
            if (entry == null) continue;
            if (entry.Tags.Count == 0 && string.IsNullOrWhiteSpace(entry.Label) && string.IsNullOrWhiteSpace(entry.Comment))
                continue;
            ApplyMeta(dest, entry.Label, entry.Comment, entry.Tags);
            changed = true;
        }
        if (changed) Save();
    }

    public static List<Dictionary<string, object?>> EnrichDirResults(List<object> results, BndzTagSidecarStore store)
    {
        // Must camelCase — ShellChildItem records serialize as PascalCase by default, and
        // dictionary keys are not renamed by the outer DIR_CONTENTS CamelCase options.
        // Without this, the UI sees { Name, Path } and falls back to "Item 1", "Item 2", …
        var camel = new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        var list = new List<Dictionary<string, object?>>();
        foreach (var item in results)
        {
            var json = JsonSerializer.Serialize(item, camel);
            var dict = JsonSerializer.Deserialize<Dictionary<string, object?>>(json, camel) ?? new Dictionary<string, object?>();
            string? lookupPath = null;
            if (dict.TryGetValue("path", out var pathObj) && pathObj is JsonElement pe && pe.ValueKind == JsonValueKind.String)
                lookupPath = pe.GetString();
            else if (dict.TryGetValue("path", out pathObj) && pathObj is string path)
                lookupPath = path;
            else if (dict.TryGetValue("id", out var idObj) && idObj is JsonElement ie && ie.ValueKind == JsonValueKind.String)
                lookupPath = ie.GetString();
            else if (dict.TryGetValue("id", out idObj) && idObj is string id)
                lookupPath = id;

            if (!string.IsNullOrEmpty(lookupPath))
            {
                var side = store.Get(lookupPath);
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
