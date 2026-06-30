using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;

namespace BNDZ.Services;

/// <summary>Fast Start Menu application index — Windows Start-menu style search without waiting on Flow IPC.</summary>
public sealed class BndzInstalledAppsIndex
{
    private static readonly Lazy<BndzInstalledAppsIndex> Instance = new(() => new BndzInstalledAppsIndex());
    public static BndzInstalledAppsIndex Shared => Instance.Value;

    private readonly object _lock = new();
    private List<AppEntry> _apps = [];
    private bool _indexed;
    private int _indexing;

    private BndzInstalledAppsIndex() { }

    public sealed class AppEntry
    {
        public string Id { get; init; } = "";
        public string Name { get; init; } = "";
        public string LaunchPath { get; init; } = "";
        public string? SourceFolder { get; init; }
    }

    public void EnsureIndexed()
    {
        if (_indexed) return;
        if (Interlocked.CompareExchange(ref _indexing, 1, 0) != 0) return;
        ThreadPool.QueueUserWorkItem(_ =>
        {
            try { Rebuild(); }
            finally { Interlocked.Exchange(ref _indexing, 0); }
        });
    }

    public void Rebuild()
    {
        var found = new Dictionary<string, AppEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var root in GetStartMenuRoots())
        {
            if (!Directory.Exists(root)) continue;
            try
            {
                foreach (var file in Directory.EnumerateFiles(root, "*.*", SearchOption.AllDirectories))
                {
                    var ext = Path.GetExtension(file);
                    if (!ext.Equals(".lnk", StringComparison.OrdinalIgnoreCase)
                        && !ext.Equals(".exe", StringComparison.OrdinalIgnoreCase)
                        && !ext.Equals(".url", StringComparison.OrdinalIgnoreCase))
                        continue;

                    var name = Path.GetFileNameWithoutExtension(file);
                    if (string.IsNullOrWhiteSpace(name)) continue;
                    if (name.StartsWith("Uninstall", StringComparison.OrdinalIgnoreCase)) continue;
                    if (name.Contains("uninstall", StringComparison.OrdinalIgnoreCase) && ext.Equals(".lnk", StringComparison.OrdinalIgnoreCase)) continue;

                    var id = $"app-{name.GetHashCode(StringComparison.OrdinalIgnoreCase):X8}";
                    if (found.ContainsKey(name)) continue;
                    found[name] = new AppEntry
                    {
                        Id = id,
                        Name = name,
                        LaunchPath = file,
                        SourceFolder = root,
                    };
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[BndzInstalledAppsIndex] scan {root}: {ex.Message}");
            }
        }

        lock (_lock)
        {
            _apps = found.Values.OrderBy(a => a.Name, StringComparer.OrdinalIgnoreCase).ToList();
            _indexed = true;
        }
    }

    public AppEntry? GetById(string id)
    {
        EnsureIndexed();
        lock (_lock)
            return _apps.FirstOrDefault(a => a.Id == id);
    }

    public IReadOnlyList<AppEntry> Search(string? query, int limit = 16)
    {
        EnsureIndexed();
        lock (_lock)
        {
            if (_apps.Count == 0) return [];
            var q = (query ?? "").Trim();
            if (string.IsNullOrEmpty(q))
                return _apps.Take(Math.Min(limit, 12)).ToList();

            return _apps
                .Select(a => new { app = a, score = Score(a, q) })
                .Where(x => x.score > 0)
                .OrderByDescending(x => x.score)
                .ThenBy(x => x.app.Name, StringComparer.OrdinalIgnoreCase)
                .Take(limit)
                .Select(x => x.app)
                .ToList();
        }
    }

    public static bool TryLaunch(string commandId)
    {
        if (!commandId.StartsWith("app-", StringComparison.Ordinal)) return false;
        var entry = Shared.GetById(commandId);
        if (entry == null || string.IsNullOrWhiteSpace(entry.LaunchPath)) return false;
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = entry.LaunchPath,
                UseShellExecute = true,
            });
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static int Score(AppEntry app, string q)
    {
        if (app.Name.Equals(q, StringComparison.OrdinalIgnoreCase)) return 100;
        if (app.Name.StartsWith(q, StringComparison.OrdinalIgnoreCase)) return 90;
        foreach (var word in app.Name.Split(' ', StringSplitOptions.RemoveEmptyEntries))
        {
            if (word.StartsWith(q, StringComparison.OrdinalIgnoreCase)) return 88;
            if (word.Equals(q, StringComparison.OrdinalIgnoreCase)) return 92;
        }
        if (app.Name.Contains(q, StringComparison.OrdinalIgnoreCase)) return 70;
        var terms = q.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (terms.Length > 1 && terms.All(t => app.Name.Contains(t, StringComparison.OrdinalIgnoreCase))) return 60;
        return 0;
    }

    private static IEnumerable<string> GetStartMenuRoots()
    {
        var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms);
        var userPrograms = Environment.GetFolderPath(Environment.SpecialFolder.Programs);
        var commonStart = Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu);
        var userStart = Environment.GetFolderPath(Environment.SpecialFolder.StartMenu);
        if (!string.IsNullOrWhiteSpace(programData)) yield return programData;
        if (!string.IsNullOrWhiteSpace(userPrograms)) yield return userPrograms;
        if (!string.IsNullOrWhiteSpace(commonStart)) yield return commonStart;
        if (!string.IsNullOrWhiteSpace(userStart)) yield return userStart;

        var desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
        var commonDesktop = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
        if (!string.IsNullOrWhiteSpace(desktop)) yield return desktop;
        if (!string.IsNullOrWhiteSpace(commonDesktop)) yield return commonDesktop;
    }
}
