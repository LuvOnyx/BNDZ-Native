using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

/// <summary>
/// Named drop landing pads — external drops become rename + tag + route recipes in one release.
/// Persisted under %LocalAppData%/BNDZ/Magnets/.
/// </summary>
public sealed class DropMagnetService
{
    private static readonly Lazy<DropMagnetService> Lazy = new(() => new DropMagnetService());
    public static DropMagnetService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string _dir;
    private readonly string _indexPath;
    private readonly object _lock = new();
    private List<DropMagnetRecipe> _magnets = [];

    private DropMagnetService()
    {
        _dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Magnets");
        Directory.CreateDirectory(_dir);
        _indexPath = Path.Combine(_dir, "magnets.json");
        Load();
    }

    public IReadOnlyList<DropMagnetRecipe> ListMagnets()
    {
        lock (_lock)
            return _magnets.OrderBy(m => m.SortOrder).ThenBy(m => m.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public DropMagnetRecipe? GetMagnet(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return null;
        lock (_lock)
            return _magnets.FirstOrDefault(m => string.Equals(m.Id, id, StringComparison.OrdinalIgnoreCase));
    }

    public DropMagnetRecipe SaveMagnet(DropMagnetRecipe recipe)
    {
        if (string.IsNullOrWhiteSpace(recipe.Name))
            throw new ArgumentException("Magnet name is required.");
        if (string.IsNullOrWhiteSpace(recipe.TargetPath))
            throw new ArgumentException("Target path is required.");

        try
        {
            recipe.TargetPath = Path.GetFullPath(recipe.TargetPath.Trim());
        }
        catch (Exception ex)
        {
            throw new ArgumentException($"Invalid target path: {ex.Message}", ex);
        }
        if (recipe.TargetPath.Length < 3)
            throw new ArgumentException("Target path is too short.");
        recipe.Name = recipe.Name.Trim();
        recipe.RenamePattern = string.IsNullOrWhiteSpace(recipe.RenamePattern) ? "{original}" : recipe.RenamePattern.Trim();
        recipe.Tags = recipe.Tags?
            .Where(t => !string.IsNullOrWhiteSpace(t))
            .Select(t => t.Trim())
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList() ?? [];

        lock (_lock)
        {
            if (string.IsNullOrWhiteSpace(recipe.Id))
                recipe.Id = Guid.NewGuid().ToString("N")[..12];
            recipe.UpdatedUtc = DateTime.UtcNow;
            if (recipe.CreatedUtc == default)
                recipe.CreatedUtc = recipe.UpdatedUtc;

            var idx = _magnets.FindIndex(m => string.Equals(m.Id, recipe.Id, StringComparison.OrdinalIgnoreCase));
            if (idx >= 0)
                _magnets[idx] = recipe;
            else
            {
                if (recipe.SortOrder <= 0)
                    recipe.SortOrder = _magnets.Count > 0 ? _magnets.Max(m => m.SortOrder) + 1 : 1;
                _magnets.Add(recipe);
            }

            Persist();
            return recipe;
        }
    }

    public bool DeleteMagnet(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        lock (_lock)
        {
            var removed = _magnets.RemoveAll(m => string.Equals(m.Id, id, StringComparison.OrdinalIgnoreCase)) > 0;
            if (removed) Persist();
            return removed;
        }
    }

    public MagnetTransferPlan BuildTransferPlan(IEnumerable<string> sourcePaths, DropMagnetRecipe magnet)
    {
        var entries = new List<MagnetTransferEntry>();
        var counter = 1;
        foreach (var raw in sourcePaths.Where(p => !string.IsNullOrWhiteSpace(p)))
        {
            var src = Path.GetFullPath(raw.Trim());
            if (!File.Exists(src) && !Directory.Exists(src))
                continue;

            var fileName = ApplyRenamePattern(Path.GetFileName(src), magnet.RenamePattern, counter++);
            var destPath = Path.Combine(magnet.TargetPath, fileName);
            entries.Add(new MagnetTransferEntry(src, destPath));
        }

        return new MagnetTransferPlan(magnet, entries);
    }

    public static string ApplyRenamePattern(string originalFileName, string pattern, int counter)
    {
        var name = Path.GetFileNameWithoutExtension(originalFileName);
        var ext = Path.GetExtension(originalFileName);
        var now = DateTime.Now;
        var result = pattern
            .Replace("{name}", name, StringComparison.OrdinalIgnoreCase)
            .Replace("{ext}", ext, StringComparison.OrdinalIgnoreCase)
            .Replace("{original}", originalFileName, StringComparison.OrdinalIgnoreCase)
            .Replace("{date}", now.ToString("yyyy-MM-dd"), StringComparison.OrdinalIgnoreCase)
            .Replace("{datetime}", now.ToString("yyyy-MM-dd_HHmmss"), StringComparison.OrdinalIgnoreCase)
            .Replace("{counter}", counter.ToString("D3"), StringComparison.OrdinalIgnoreCase);

        result = Regex.Replace(result, @"[<>:""/\\|?*]", "_");
        return string.IsNullOrWhiteSpace(result) ? originalFileName : result;
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_indexPath))
            {
                _magnets = [];
                return;
            }

            var loaded = JsonSerializer.Deserialize<List<DropMagnetRecipe>>(File.ReadAllText(_indexPath), Json);
            _magnets = loaded ?? [];
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[DropMagnet] Load failed: {ex.Message}");
            _magnets = [];
        }
    }

    private void Persist()
    {
        File.WriteAllText(_indexPath, JsonSerializer.Serialize(_magnets, Json));
    }
}

public sealed class DropMagnetRecipe
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string TargetPath { get; set; } = "";
    public string RenamePattern { get; set; } = "{original}";
    public List<string> Tags { get; set; } = [];
    public bool Enabled { get; set; } = true;
    public int SortOrder { get; set; }
    public string? AccentColor { get; set; }
    public DateTime CreatedUtc { get; set; }
    public DateTime UpdatedUtc { get; set; }
}

public sealed class MagnetTransferEntry
{
    public MagnetTransferEntry(string source, string destination)
    {
        Source = source;
        Destination = destination;
    }

    public string Source { get; }
    public string Destination { get; }
}

public sealed class MagnetTransferPlan
{
    public MagnetTransferPlan(DropMagnetRecipe magnet, List<MagnetTransferEntry> entries)
    {
        Magnet = magnet;
        Entries = entries;
    }

    public DropMagnetRecipe Magnet { get; }
    public List<MagnetTransferEntry> Entries { get; }
}
