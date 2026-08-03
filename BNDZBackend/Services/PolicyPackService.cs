using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace BNDZ.Services;

public sealed class PolicyPack
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "Untitled pack";
    public List<string> AllowedExtensions { get; set; } = new();
    public long MaxSizeBytes { get; set; }
    public List<string> RequiredTags { get; set; } = new();
    public List<string> DenyPatterns { get; set; } = new();
    public bool EnforceOnDrop { get; set; } = true;
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedUtc { get; set; } = DateTime.UtcNow;
}

public sealed class PolicyViolation
{
    public string SourcePath { get; set; } = "";
    public string Rule { get; set; } = "";
    public string Message { get; set; } = "";
}

public sealed class PolicyValidationResult
{
    public bool Allowed { get; set; } = true;
    public string? PackId { get; set; }
    public string? PackName { get; set; }
    public List<PolicyViolation> Violations { get; set; } = new();
}

/// <summary>Shareable folder policies — eslint for directories. Enforced on drop/move.</summary>
public sealed class PolicyPackService
{
    private static readonly Lazy<PolicyPackService> Lazy = new(() => new PolicyPackService());
    public static PolicyPackService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private readonly string _packDir;
    private readonly string _bindingsPath;
    private Dictionary<string, string> _folderBindings = new(StringComparer.OrdinalIgnoreCase);

    private PolicyPackService()
    {
        var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "PolicyPacks");
        Directory.CreateDirectory(root);
        _packDir = root;
        _bindingsPath = Path.Combine(root, "bindings.json");
        LoadBindings();
    }

    public List<PolicyPack> ListPacks()
    {
        var list = new List<PolicyPack>();
        foreach (var file in Directory.EnumerateFiles(_packDir, "*.json"))
        {
            if (string.Equals(Path.GetFileName(file), "bindings.json", StringComparison.OrdinalIgnoreCase)) continue;
            try
            {
                var pack = JsonSerializer.Deserialize<PolicyPack>(File.ReadAllText(file), Json);
                if (pack != null) list.Add(pack);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[PolicyPack] Failed to load {file}: {ex.Message}");
            }
        }
        return list.OrderBy(p => p.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public PolicyPack? GetPack(string packId)
    {
        if (string.IsNullOrWhiteSpace(packId)) return null;
        var path = PackFilePath(packId);
        if (!File.Exists(path)) return null;
        try
        {
            return JsonSerializer.Deserialize<PolicyPack>(File.ReadAllText(path), Json);
        }
        catch
        {
            return null;
        }
    }

    public PolicyPack SavePack(PolicyPack pack)
    {
        if (string.IsNullOrWhiteSpace(pack.Id)) pack.Id = Guid.NewGuid().ToString("N");
        pack.UpdatedUtc = DateTime.UtcNow;
        if (pack.CreatedUtc == default) pack.CreatedUtc = pack.UpdatedUtc;
        var path = PackFilePath(pack.Id);
        File.WriteAllText(path, JsonSerializer.Serialize(pack, Json));
        return pack;
    }

    public bool DeletePack(string packId)
    {
        var path = PackFilePath(packId);
        if (!File.Exists(path)) return false;
        File.Delete(path);
        foreach (var kv in _folderBindings.Where(kv => string.Equals(kv.Value, packId, StringComparison.OrdinalIgnoreCase)).ToList())
            _folderBindings.Remove(kv.Key);
        SaveBindings();
        return true;
    }

    public void ApplyPackToFolder(string folderWinPath, string packId)
    {
        var folder = Path.GetFullPath(folderWinPath);
        if (!Directory.Exists(folder)) throw new DirectoryNotFoundException(folder);
        _folderBindings[NormalizeFolderKey(folder)] = packId;
        SaveBindings();

        var marker = Path.Combine(folder, ".bndz-policy.json");
        File.WriteAllText(marker, JsonSerializer.Serialize(new { packId }, Json));
    }

    public void RemovePackFromFolder(string folderWinPath)
    {
        var folder = Path.GetFullPath(folderWinPath);
        _folderBindings.Remove(NormalizeFolderKey(folder));
        SaveBindings();
        var marker = Path.Combine(folder, ".bndz-policy.json");
        if (File.Exists(marker)) File.Delete(marker);
    }

    public PolicyPack? ResolvePackForDestination(string destinationWinPath)
    {
        try
        {
            var folder = Directory.Exists(destinationWinPath)
                ? Path.GetFullPath(destinationWinPath)
                : Path.GetDirectoryName(Path.GetFullPath(destinationWinPath));
            if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder)) return null;

            while (!string.IsNullOrEmpty(folder))
            {
                var marker = Path.Combine(folder, ".bndz-policy.json");
                if (File.Exists(marker))
                {
                    try
                    {
                        using var doc = JsonDocument.Parse(File.ReadAllText(marker));
                        if (doc.RootElement.TryGetProperty("packId", out var idEl))
                        {
                            var pack = GetPack(idEl.GetString() ?? "");
                            if (pack != null) return pack;
                        }
                    }
                    catch { /* fall through */ }
                }

                var key = NormalizeFolderKey(folder);
                if (_folderBindings.TryGetValue(key, out var packId))
                {
                    var pack = GetPack(packId);
                    if (pack != null) return pack;
                }

                var parent = Directory.GetParent(folder)?.FullName;
                if (string.IsNullOrEmpty(parent) || string.Equals(parent, folder, StringComparison.OrdinalIgnoreCase)) break;
                folder = parent;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[PolicyPack] Resolve failed: {ex.Message}");
        }
        return null;
    }

    public PolicyValidationResult ValidateTransfer(
        string destinationWinPath,
        IReadOnlyList<string> sourceWinPaths,
        BndzTagSidecarStore? tagStore = null)
    {
        var result = new PolicyValidationResult { Allowed = true };
        var pack = ResolvePackForDestination(destinationWinPath);
        if (pack == null || !pack.EnforceOnDrop) return result;

        result.PackId = pack.Id;
        result.PackName = pack.Name;

        var denyRegexes = pack.DenyPatterns
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(BuildGlobRegex)
            .Where(r => r != null)
            .Cast<Regex>()
            .ToList();

        foreach (var src in sourceWinPaths)
        {
            if (string.IsNullOrWhiteSpace(src)) continue;
            var full = Path.GetFullPath(src);
            if (Directory.Exists(full))
            {
                foreach (var file in Directory.EnumerateFiles(full, "*", SearchOption.AllDirectories))
                    ValidateFile(file, pack, denyRegexes, tagStore, result);
            }
            else if (File.Exists(full))
                ValidateFile(full, pack, denyRegexes, tagStore, result);
        }

        result.Allowed = result.Violations.Count == 0;
        return result;
    }

    private static void ValidateFile(
        string filePath,
        PolicyPack pack,
        List<Regex> denyRegexes,
        BndzTagSidecarStore? tagStore,
        PolicyValidationResult result)
    {
        var ext = Path.GetExtension(filePath);
        if (pack.AllowedExtensions.Count > 0)
        {
            var allowed = pack.AllowedExtensions.Any(a =>
                string.Equals(a.TrimStart('.'), ext.TrimStart('.'), StringComparison.OrdinalIgnoreCase));
            if (!allowed)
            {
                result.Violations.Add(new PolicyViolation
                {
                    SourcePath = filePath,
                    Rule = "allowedExtensions",
                    Message = $"Extension '{ext}' is not allowed by pack '{pack.Name}'.",
                });
            }
        }

        if (pack.MaxSizeBytes > 0)
        {
            try
            {
                var len = new FileInfo(filePath).Length;
                if (len > pack.MaxSizeBytes)
                {
                    result.Violations.Add(new PolicyViolation
                    {
                        SourcePath = filePath,
                        Rule = "maxSizeBytes",
                        Message = $"File exceeds max size ({len} > {pack.MaxSizeBytes} bytes).",
                    });
                }
            }
            catch { /* skip */ }
        }

        var leaf = Path.GetFileName(filePath);
        foreach (var rx in denyRegexes)
        {
            if (rx.IsMatch(leaf))
            {
                result.Violations.Add(new PolicyViolation
                {
                    SourcePath = filePath,
                    Rule = "denyPattern",
                    Message = $"Filename matches deny pattern for pack '{pack.Name}'.",
                });
                break;
            }
        }

        if (pack.RequiredTags.Count > 0 && tagStore != null)
        {
            var entry = tagStore.Get(filePath);
            var tags = entry?.Tags ?? new List<string>();
            foreach (var req in pack.RequiredTags)
            {
                if (!tags.Contains(req, StringComparer.OrdinalIgnoreCase))
                {
                    result.Violations.Add(new PolicyViolation
                    {
                        SourcePath = filePath,
                        Rule = "requiredTags",
                        Message = $"Missing required tag '{req}' on file.",
                    });
                }
            }
        }
    }

    private static Regex? BuildGlobRegex(string pattern)
    {
        try
        {
            var escaped = Regex.Escape(pattern.Trim()).Replace("\\*", ".*").Replace("\\?", ".");
            return new Regex("^" + escaped + "$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
        }
        catch
        {
            return null;
        }
    }

    private string PackFilePath(string packId) => Path.Combine(_packDir, $"{packId}.json");

    private static string NormalizeFolderKey(string folder) =>
        Path.GetFullPath(folder).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

    private void LoadBindings()
    {
        try
        {
            if (!File.Exists(_bindingsPath)) return;
            var map = JsonSerializer.Deserialize<Dictionary<string, string>>(File.ReadAllText(_bindingsPath), Json);
            if (map != null)
                _folderBindings = new Dictionary<string, string>(map, StringComparer.OrdinalIgnoreCase);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[PolicyPack] bindings load failed: {ex.Message}");
        }
    }

    private void SaveBindings()
    {
        try
        {
            File.WriteAllText(_bindingsPath, JsonSerializer.Serialize(_folderBindings, Json));
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[PolicyPack] bindings save failed: {ex.Message}");
        }
    }
}
