using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using Microsoft.Win32;

namespace BNDZ.Services;

public sealed class BndzNamespaceRoot
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public string PanePath { get; set; } = "";
    public string ProtocolUrl { get; set; } = "";
    public string Description { get; set; } = "";
}

public sealed class BndzMagnetPin
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Label { get; set; } = "";
    public string TargetPath { get; set; } = "";
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

/// <summary>BNDZ virtual namespace portal — Health, Magnets, Sandboxes, Capture.</summary>
public sealed class BndzNamespaceService
{
    private static readonly Lazy<BndzNamespaceService> Lazy = new(() => new BndzNamespaceService());
    public static BndzNamespaceService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private readonly string _magnetsPath;
    private List<BndzMagnetPin> _magnets = new();

    private BndzNamespaceService()
    {
        var local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ");
        _magnetsPath = Path.Combine(local, "Namespace", "magnets.json");
        Directory.CreateDirectory(Path.GetDirectoryName(_magnetsPath)!);
        LoadMagnets();
    }

    public List<BndzNamespaceRoot> ListRoots()
    {
        return new List<BndzNamespaceRoot>
        {
            new()
            {
                Id = "health",
                Label = "Health",
                PanePath = "/bndz/port/health",
                ProtocolUrl = "bndz://health",
                Description = "Library health problems and scans",
            },
            new()
            {
                Id = "magnets",
                Label = "Magnets",
                PanePath = "/bndz/port/magnets",
                ProtocolUrl = "bndz://magnets",
                Description = "Pinned folder magnets and shortcuts",
            },
            new()
            {
                Id = "sandboxes",
                Label = "Sandboxes",
                PanePath = "/bndz/port/sandboxes",
                ProtocolUrl = "bndz://sandboxes",
                Description = "Project sandbox sessions",
            },
            new()
            {
                Id = "capture",
                Label = "Capture",
                PanePath = "/bndz/port/capture",
                ProtocolUrl = "bndz://capture",
                Description = "Inbound capture queue",
            },
        };
    }

    public List<object> ListPortalRootEntries()
    {
        return ListRoots().Select(r => new
        {
            id = $"portal:{r.Id}",
            name = r.Label,
            type = "directory",
            path = r.PanePath,
            typeDescription = r.Description,
        }).Cast<object>().ToList();
    }

    public List<object> ResolvePortalView(string viewId, int limit = 500)
    {
        switch (viewId.ToLowerInvariant())
        {
            case "health":
                return LibraryHealthService.Instance.ListProblems(null, limit)
                    .Select(p => (object)new
                    {
                        id = p.Id,
                        name = Path.GetFileName(p.Path) is { Length: > 0 } n ? n : p.Path,
                        type = "file",
                        path = p.Path,
                        size = 0L,
                        modified = p.ScannedUtc,
                        detail = p.Detail,
                        kind = p.Kind,
                        severity = p.Severity,
                    }).ToList();
            case "sandboxes":
                return ProjectSandboxService.Instance.ListSessions()
                    .Select(s => (object)new
                    {
                        id = s.Id,
                        name = s.Name,
                        type = "directory",
                        path = s.RootWinPath,
                        size = 0L,
                        modified = s.CreatedUtc,
                        typeDescription = "Sandbox session",
                    }).ToList();
            case "magnets":
                return _magnets.Select(m => (object)new
                {
                    id = m.Id,
                    name = m.Label,
                    type = "directory",
                    path = m.TargetPath,
                    size = 0L,
                    modified = m.CreatedUtc,
                    typeDescription = "Magnet pin",
                }).ToList();
            case "capture":
                return InboundVolumeService.Instance.ListEntries()
                    .Select(e => (object)new
                    {
                        id = e.Id,
                        name = e.Name,
                        type = e.Type == "files" ? "directory" : "file",
                        path = e.Path,
                        size = e.Size,
                        modified = e.CreatedUtc,
                    }).ToList();
            default:
                return new List<object>();
        }
    }

    public BndzMagnetPin AddMagnet(string label, string targetPath)
    {
        var pin = new BndzMagnetPin
        {
            Label = string.IsNullOrWhiteSpace(label) ? Path.GetFileName(targetPath) : label.Trim(),
            TargetPath = Path.GetFullPath(targetPath),
        };
        _magnets.Add(pin);
        SaveMagnets();
        return pin;
    }

    public bool RemoveMagnet(string id)
    {
        var removed = _magnets.RemoveAll(m => string.Equals(m.Id, id, StringComparison.OrdinalIgnoreCase)) > 0;
        if (removed) SaveMagnets();
        return removed;
    }

  public string? ResolveProtocolUrl(string url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        var trimmed = url.Trim();
        if (trimmed.StartsWith("file://bndz/", StringComparison.OrdinalIgnoreCase))
            trimmed = "bndz://" + trimmed.Substring("file://bndz/".Length);
        if (!trimmed.StartsWith("bndz://", StringComparison.OrdinalIgnoreCase)) return null;

        var token = trimmed.Substring("bndz://".Length).Trim('/');
        var root = ListRoots().FirstOrDefault(r =>
            string.Equals(r.Id, token, StringComparison.OrdinalIgnoreCase));
        return root?.PanePath;
    }

    public void TryRegisterShellIntegration(string exePath)
    {
        try
        {
            using var protocol = Registry.CurrentUser.CreateSubKey(@"Software\Classes\bndz");
            protocol?.SetValue("", "URL:BNDZ Protocol");
            protocol?.SetValue("URL Protocol", "");
            using var icon = protocol?.CreateSubKey("DefaultIcon");
            icon?.SetValue("", exePath + ",0");
            using var cmd = protocol?.CreateSubKey(@"shell\open\command");
            cmd?.SetValue("", $"\"{exePath}\" --open-url \"%1\"");

            using var folder = Registry.CurrentUser.CreateSubKey(@"Software\Classes\BNDZ.Portal");
            folder?.SetValue("", "BNDZ Portal");
            using var folderIcon = folder?.CreateSubKey("DefaultIcon");
            folderIcon?.SetValue("", exePath + ",0");
            using var folderCmd = folder?.CreateSubKey(@"shell\open\command");
            folderCmd?.SetValue("", $"\"{exePath}\" --open-url \"bndz://health\"");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Namespace] Registry registration failed: {ex.Message}");
        }
    }

    private void LoadMagnets()
    {
        try
        {
            if (!File.Exists(_magnetsPath)) return;
            _magnets = JsonSerializer.Deserialize<List<BndzMagnetPin>>(File.ReadAllText(_magnetsPath), Json)
                ?? new List<BndzMagnetPin>();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Namespace] magnets load failed: {ex.Message}");
            _magnets = new List<BndzMagnetPin>();
        }
    }

    private void SaveMagnets()
    {
        try
        {
            File.WriteAllText(_magnetsPath, JsonSerializer.Serialize(_magnets, Json));
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Namespace] magnets save failed: {ex.Message}");
        }
    }
}
