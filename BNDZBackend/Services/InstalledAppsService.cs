using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Microsoft.Win32;

namespace BNDZ.Services;

public sealed class InstalledAppEntry
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string? Publisher { get; set; }
    public string? Version { get; set; }
    public string? InstallDate { get; set; }
    public long EstimatedSizeBytes { get; set; }
    public string? InstallLocation { get; set; }
    public string? UninstallString { get; set; }
    public string? QuietUninstallString { get; set; }
    public bool CanUninstall { get; set; }
    public bool IsSystemComponent { get; set; }
    public bool IsStoreApp { get; set; }
    public string Source { get; set; } = "registry";
}

public sealed class InstalledAppsListResult
{
    public List<InstalledAppEntry> Apps { get; set; } = new();
    public int TotalCount { get; set; }
}

public sealed class UninstallAppResult
{
    public bool Success { get; set; }
    public string? Error { get; set; }
    public string? LaunchedCommand { get; set; }
}

public static class InstalledAppsService
{
    private static readonly string[] UninstallRoots =
    [
        @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
    ];

    public static InstalledAppsListResult ListApps(bool includeSystemComponents = false)
    {
        var seen = new Dictionary<string, InstalledAppEntry>(StringComparer.OrdinalIgnoreCase);
        foreach (var hive in new[] { Registry.LocalMachine, Registry.CurrentUser })
        {
            foreach (var sub in UninstallRoots)
            {
                try
                {
                    using var key = hive.OpenSubKey(sub);
                    if (key == null) continue;
                    foreach (var subName in key.GetSubKeyNames())
                    {
                        try
                        {
                            using var appKey = key.OpenSubKey(subName);
                            if (appKey == null) continue;
                            var entry = ReadEntry(appKey, subName, hive == Registry.CurrentUser ? "HKCU" : "HKLM");
                            if (entry == null) continue;
                            if (!includeSystemComponents && entry.IsSystemComponent) continue;
                            if (string.IsNullOrWhiteSpace(entry.Name)) continue;
                            if (IsNoiseEntry(entry)) continue;
                            var dedupeKey = $"{entry.Name}|{entry.Publisher}|{entry.Version}".ToLowerInvariant();
                            if (!seen.ContainsKey(dedupeKey))
                                seen[dedupeKey] = entry;
                        }
                        catch { }
                    }
                }
                catch { }
            }
        }

        var list = seen.Values
            .OrderBy(a => a.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new InstalledAppsListResult { Apps = list, TotalCount = list.Count };
    }

    public static UninstallAppResult Uninstall(string appId, bool quiet = false)
    {
        if (string.IsNullOrWhiteSpace(appId))
            return new UninstallAppResult { Success = false, Error = "No app id" };

        var apps = ListApps(includeSystemComponents: true);
        var app = apps.Apps.FirstOrDefault(a => a.Id.Equals(appId, StringComparison.OrdinalIgnoreCase));
        if (app == null)
            return new UninstallAppResult { Success = false, Error = "Application not found" };

        if (!app.CanUninstall)
            return new UninstallAppResult { Success = false, Error = "This entry cannot be uninstalled from BNDZ (Start Menu shortcut only). Use Settings → Apps for Store apps." };

        var cmd = quiet && !string.IsNullOrWhiteSpace(app.QuietUninstallString)
            ? app.QuietUninstallString
            : app.UninstallString;

        if (string.IsNullOrWhiteSpace(cmd))
            return new UninstallAppResult { Success = false, Error = "No uninstall command registered for this application" };

        try
        {
            var (exe, args) = SplitUninstallCommand(cmd);
            if (string.IsNullOrWhiteSpace(exe))
                return new UninstallAppResult { Success = false, Error = "Invalid uninstall command" };

            var psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = args,
                UseShellExecute = true,
                Verb = "runas",
            };
            Process.Start(psi);
            return new UninstallAppResult { Success = true, LaunchedCommand = $"{exe} {args}".Trim() };
        }
        catch (Exception ex)
        {
            return new UninstallAppResult { Success = false, Error = ex.Message };
        }
    }

    private static InstalledAppEntry? ReadEntry(RegistryKey key, string subName, string hive)
    {
        var name = key.GetValue("DisplayName") as string;
        if (string.IsNullOrWhiteSpace(name)) return null;

        var systemComponent = key.GetValue("SystemComponent") is int sc && sc == 1;
        var noRemove = key.GetValue("NoRemove") is int nr && nr == 1;
        var uninstall = key.GetValue("UninstallString") as string;
        var quiet = key.GetValue("QuietUninstallString") as string;
        long estKb = 0;
        if (key.GetValue("EstimatedSize") is int est) estKb = est;
        else if (key.GetValue("EstimatedSize") is long estL) estKb = estL;

        var installLoc = key.GetValue("InstallLocation") as string;
        var publisher = key.GetValue("Publisher") as string;
        var version = key.GetValue("DisplayVersion") as string;
        var installDate = key.GetValue("InstallDate") as string;
        var isStore = subName.StartsWith("{"); // typical AppX guid key

        return new InstalledAppEntry
        {
            Id = $"{hive}:{subName}",
            Name = name.Trim(),
            Publisher = publisher?.Trim(),
            Version = version?.Trim(),
            InstallDate = installDate,
            EstimatedSizeBytes = estKb > 0 ? estKb * 1024L : 0,
            InstallLocation = string.IsNullOrWhiteSpace(installLoc) ? null : installLoc.Trim(),
            UninstallString = uninstall,
            QuietUninstallString = quiet,
            CanUninstall = !noRemove && !string.IsNullOrWhiteSpace(uninstall),
            IsSystemComponent = systemComponent,
            IsStoreApp = isStore,
            Source = "registry",
        };
    }

    private static bool IsNoiseEntry(InstalledAppEntry e)
    {
        var n = e.Name.ToLowerInvariant();
        if (n.Contains("update for microsoft") && n.Contains("kb")) return true;
        if (n.StartsWith("security update")) return true;
        if (n == "microsoft edge webview2 runtime") return false; // keep useful
        return false;
    }

    private static (string exe, string args) SplitUninstallCommand(string cmd)
    {
        cmd = cmd.Trim();
        if (cmd.StartsWith('"'))
        {
            var end = cmd.IndexOf('"', 1);
            if (end > 0)
            {
                var exe = cmd[1..end];
                var args = cmd[(end + 1)..].Trim();
                return (exe, args);
            }
        }
        var space = cmd.IndexOf(' ');
        if (space < 0) return (cmd, "");
        return (cmd[..space], cmd[(space + 1)..]);
    }
}
