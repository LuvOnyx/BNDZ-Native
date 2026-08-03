using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace BNDZ.Services;

public class CloudStorageService
{
    private static readonly (string Id, string DisplayName, string Icon)[] KnownProviders =
    {
        ("onedrive", "OneDrive", "onedrive"),
        ("googledrive", "Google Drive", "gdrive"),
        ("google", "Google Drive", "gdrive"),
        ("dropbox", "Dropbox", "dropbox"),
        ("icloud", "iCloud Drive", "icloud"),
        ("box", "Box", "box"),
    };

    private static readonly Regex EmailLabel = new(
        @"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    /// <summary>
    /// DriveInfo.IsReady / VolumeLabel can hang for tens of seconds on flaky network,
    /// Google Drive File Stream, or optical volumes — never call them on the UI/IPC thread
    /// without a timeout.
    /// </summary>
    private static bool TryDriveReady(DriveInfo d, int timeoutMs = 750)
    {
        try
        {
            var task = Task.Run(() =>
            {
                try { return d.IsReady; }
                catch { return false; }
            });
            return task.Wait(timeoutMs) && task.Result;
        }
        catch { return false; }
    }

    private static bool TryReadDriveMeta(DriveInfo d, out string label, out long total, out long free, out string format, int timeoutMs = 750)
    {
        label = "";
        total = 0;
        free = 0;
        format = "";
        try
        {
            var task = Task.Run<(bool Ok, string Label, long Total, long Free, string Format)>(() =>
            {
                try
                {
                    return (
                        Ok: true,
                        Label: d.VolumeLabel ?? "",
                        Total: d.TotalSize,
                        Free: d.TotalFreeSpace,
                        Format: d.DriveFormat ?? ""
                    );
                }
                catch
                {
                    return (Ok: false, Label: "", Total: 0L, Free: 0L, Format: "");
                }
            });
            if (!task.Wait(timeoutMs)) return false;
            var r = task.Result;
            if (!r.Ok) return false;
            label = r.Label;
            total = r.Total;
            free = r.Free;
            format = r.Format;
            return true;
        }
        catch { return false; }
    }

    private static IEnumerable<DriveInfo> EnumerateReadyDrives()
    {
        DriveInfo[] drives;
        try { drives = DriveInfo.GetDrives(); }
        catch { yield break; }

        foreach (var d in drives)
        {
            if (TryDriveReady(d))
                yield return d;
        }
    }

    public List<object> GetProviders()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var providers = new List<object>();

        void Add(string name, string path, string icon) => AddLabeled(name, path, icon, null);

        void AddLabeled(string name, string path, string icon, string? accountLabel)
        {
            if (string.IsNullOrWhiteSpace(path)) return;
            path = path.Trim();
            // Drive-letter roots: trust DriveInfo readiness instead of Directory.Exists
            // (Google Drive File Stream can fail Exists intermittently while still mounted).
            if (IsDriveRootPath(path))
            {
                try
                {
                    var di = new DriveInfo(path.Substring(0, 1) + ":\\");
                    if (!TryDriveReady(di)) return;
                }
                catch { return; }
            }
            else if (!Directory.Exists(path))
            {
                return;
            }

            var key = path.TrimEnd('\\', '/').ToLowerInvariant();
            if (!seen.Add(key)) return;
            providers.Add(new
            {
                name,
                path = "/" + path.Replace("\\", "/").TrimEnd('/'),
                icon,
                syncStatus = ResolveSyncStatus(path),
                accountLabel,
            });
        }

        TryEnv("OneDrive", "OneDrive", "onedrive", Add);
        TryEnv("OneDriveCommercial", "OneDrive", "onedrive", Add);
        TryEnv("OneDriveConsumer", "OneDrive", "onedrive", Add);

        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        Add("OneDrive", Path.Combine(userProfile, "OneDrive"), "onedrive");
        Add("Google Drive", Path.Combine(userProfile, "Google Drive"), "gdrive");
        Add("Dropbox", Path.Combine(userProfile, "Dropbox"), "dropbox");
        Add("iCloud Drive", Path.Combine(userProfile, "iCloudDrive"), "icloud");
        Add("iCloud Photos", Path.Combine(userProfile, "iCloudPhotos"), "icloud");
        Add("Box", Path.Combine(userProfile, "Box"), "box");

        foreach (var mount in EnumerateSyncEngineMounts())
            AddLabeled(mount.DisplayName, mount.MountPoint, mount.Icon, mount.AccountLabel);

        // Volume roots that look like Google Drive File Stream (email volume label).
        foreach (var drive in EnumerateReadyDrives())
        {
            if (!TryReadDriveMeta(drive, out var label, out _, out _, out _)) continue;
            if (!LooksLikeGoogleDriveLabel(label)) continue;
            AddLabeled("Google Drive", drive.Name, "gdrive", label.Trim());
        }

        try
        {
            foreach (var dir in Directory.GetDirectories(userProfile))
            {
                var name = Path.GetFileName(dir);
                if (name.Contains("OneDrive", StringComparison.OrdinalIgnoreCase))
                    Add("OneDrive", dir, "onedrive");
                else if (name.Contains("Google Drive", StringComparison.OrdinalIgnoreCase))
                    Add("Google Drive", dir, "gdrive");
                else if (name.Equals("Dropbox", StringComparison.OrdinalIgnoreCase))
                    Add("Dropbox", dir, "dropbox");
                else if (name.Contains("iCloud", StringComparison.OrdinalIgnoreCase))
                    Add("iCloud Drive", dir, "icloud");
            }
        }
        catch { }

        return providers;
    }

    // TTL cache — serialises concurrent DriveInfo probes so multiple rapid callers
    // (BNDZ_UI_READY → PushDrivesUpdate, GET_DRIVES, CONTINUUM_FINGERPRINT_REQUEST)
    // share one in-flight enumeration instead of each running their own 400ms-per-drive probes.
    private static readonly SemaphoreSlim _drivesWorkSemaphore = new(1, 1);
    private static volatile List<object>? _annotatedDrivesCache;
    private static long _annotatedDrivesCacheExpiryTicks = long.MinValue;

    /// <summary>
    /// Drive list with cloud ownership flags so the UI can keep local Drives vs Cloud Drives correct.
    /// Never drops a ready volume solely because VolumeLabel/size timed out — that left This PC empty.
    /// Callers are always inside Task.Run; blocking on the semaphore is intentional and safe.
    /// </summary>
    public List<object> GetAnnotatedDrives()
    {
        // Hot path: return fresh cached snapshot without acquiring the semaphore.
        var cached = _annotatedDrivesCache;
        if (cached != null && DateTime.UtcNow.Ticks < Volatile.Read(ref _annotatedDrivesCacheExpiryTicks))
            return cached;

        // Serialize expensive work so latecomers get the freshly-built result for free.
        _drivesWorkSemaphore.Wait();
        try
        {
            // Re-check after acquiring — another caller may have already refreshed.
            cached = _annotatedDrivesCache;
            if (cached != null && DateTime.UtcNow.Ticks < Volatile.Read(ref _annotatedDrivesCacheExpiryTicks))
                return cached;

            var result = BuildAnnotatedDrivesCore();

            if (result.Count > 0)
            {
                _annotatedDrivesCache = result;
                Volatile.Write(ref _annotatedDrivesCacheExpiryTicks, DateTime.UtcNow.AddSeconds(2.5).Ticks);
            }
            else if (_annotatedDrivesCache is { Count: > 0 })
            {
                // Return stale data rather than an empty list.
                return _annotatedDrivesCache;
            }

            return result;
        }
        finally
        {
            _drivesWorkSemaphore.Release();
        }
    }

    private List<object> BuildAnnotatedDrivesCore()
    {
        var dedicated = BuildDedicatedCloudVolumeMap();
        var list = new List<object>();

        DriveInfo[] all;
        try { all = DriveInfo.GetDrives(); }
        catch { all = Array.Empty<DriveInfo>(); }

        foreach (var d in all)
        {
            // Skip obvious non-volumes; still include Fixed/Removable/Ram even when IsReady is slow.
            if (d.DriveType is DriveType.Unknown or DriveType.NoRootDirectory)
                continue;
            if (d.DriveType == DriveType.Network)
                continue; // network letters live under Network tree, not This PC local drives

            var ready = TryDriveReady(d, timeoutMs: 400);
            // Fixed drives: include even when readiness probe times out (common with GDFS / antivirus).
            if (!ready && d.DriveType != DriveType.Fixed && d.DriveType != DriveType.Ram)
                continue;

            var hasMeta = TryReadDriveMeta(d, out var label, out var total, out var free, out var format, timeoutMs: 400);
            if (!hasMeta)
            {
                label = "";
                total = 0;
                free = 0;
                format = "";
            }

            var letter = (d.Name.Length >= 2 ? d.Name.Substring(0, 2) : d.Name).ToUpperInvariant(); // "G:"
            dedicated.TryGetValue(letter, out var cloud);

            var googleByLabel = LooksLikeGoogleDriveLabel(label);
            var isGoogle = googleByLabel
                || string.Equals(cloud?.Icon, "gdrive", StringComparison.OrdinalIgnoreCase);
            var isCloudVolume = isGoogle || cloud != null;

            list.Add(new
            {
                name = "/" + d.Name.Replace("\\", ""),
                label = string.IsNullOrWhiteSpace(label) ? "Local Disk" : label,
                totalSpace = total,
                freeSpace = free,
                fileSystem = format,
                isCloudVolume,
                cloudProvider = isGoogle ? "gdrive" : cloud?.Icon,
                cloudAccountLabel = isGoogle
                    ? (ExtractEmail(label) ?? cloud?.AccountLabel ?? label)
                    : cloud?.AccountLabel,
            });
        }

        return list;
    }

    private Dictionary<string, CloudVolumeInfo> BuildDedicatedCloudVolumeMap()
    {
        var map = new Dictionary<string, CloudVolumeInfo>(StringComparer.OrdinalIgnoreCase);

        void Consider(string displayName, string mount, string icon, string? accountLabel)
        {
            if (string.IsNullOrWhiteSpace(mount)) return;
            if (!IsDedicatedCloudVolumeMount(mount)) return;
            var letter = mount.Trim()[0].ToString().ToUpperInvariant() + ":";
            // Prefer Google / labeled entries over generic
            if (map.TryGetValue(letter, out var existing)
                && existing.Icon == "gdrive"
                && icon != "gdrive")
                return;
            map[letter] = new CloudVolumeInfo(displayName, mount, icon, accountLabel);
        }

        foreach (var mount in EnumerateSyncEngineMounts())
            Consider(mount.DisplayName, mount.MountPoint, mount.Icon, mount.AccountLabel);

        foreach (var d in EnumerateReadyDrives())
        {
            if (!TryReadDriveMeta(d, out var label, out _, out _, out _)) continue;
            if (!LooksLikeGoogleDriveLabel(label)) continue;
            Consider("Google Drive", d.Name, "gdrive", label.Trim());
        }

        return map;
    }

    private IEnumerable<SyncMount> EnumerateSyncEngineMounts()
    {
        var results = new List<SyncMount>();
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\SyncEngines\Providers");
            if (key == null) return results;

            foreach (var providerId in key.GetSubKeyNames())
            {
                using var providerKey = key.OpenSubKey(providerId);
                if (providerKey == null) continue;

                var displayName = ResolveDisplayName(providerId, providerKey);
                var icon = ResolveIcon(providerId);

                var rootMount = providerKey.GetValue("MountPoint") as string;
                if (!string.IsNullOrEmpty(rootMount))
                    results.Add(new SyncMount(displayName, rootMount, icon, null));

                foreach (var instance in providerKey.GetSubKeyNames())
                {
                    using var instanceKey = providerKey.OpenSubKey(instance);
                    var mount = instanceKey?.GetValue("MountPoint") as string;
                    if (string.IsNullOrEmpty(mount)) continue;
                    var accountLabel = instanceKey?.GetValue("DisplayName") as string
                        ?? instanceKey?.GetValue("UserName") as string
                        ?? instance;
                    results.Add(new SyncMount(displayName, mount, icon, accountLabel));
                }
            }
        }
        catch { }

        return results;
    }

    public static bool IsDedicatedCloudVolumeMount(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var win = path.Replace('/', '\\').TrimEnd('\\');
        if (Regex.IsMatch(win, @"^[A-Za-z]:$")) return true;
        var m = Regex.Match(win, @"^([A-Za-z]:)\\(.*)$");
        if (!m.Success) return false;
        var rest = m.Groups[2].Value.TrimEnd('\\');
        if (string.IsNullOrEmpty(rest)) return true;
        return rest.Equals("My Drive", StringComparison.OrdinalIgnoreCase)
            || rest.Equals("Google Drive", StringComparison.OrdinalIgnoreCase);
    }

    private static bool IsDriveRootPath(string path)
    {
        var win = path.Replace('/', '\\').TrimEnd('\\');
        return Regex.IsMatch(win, @"^[A-Za-z]:$");
    }

    private static bool LooksLikeGoogleDriveLabel(string? label)
    {
        if (string.IsNullOrWhiteSpace(label)) return false;
        if (EmailLabel.IsMatch(label)) return true;
        var lower = label.Trim().ToLowerInvariant();
        return lower.Contains("google drive") || lower == "google";
    }

    private static string? ExtractEmail(string? label)
    {
        if (string.IsNullOrWhiteSpace(label)) return null;
        var m = EmailLabel.Match(label);
        return m.Success ? m.Value : null;
    }

    private static void TryEnv(string envVar, string name, string icon, Action<string, string, string> add)
    {
        var val = Environment.GetEnvironmentVariable(envVar);
        if (!string.IsNullOrEmpty(val)) add(name, val, icon);
    }

    private static string ResolveDisplayName(string providerId, RegistryKey key)
    {
        var display = key.GetValue("DisplayName") as string;
        if (!string.IsNullOrEmpty(display)) return display;

        foreach (var known in KnownProviders)
        {
            if (providerId.Contains(known.Id, StringComparison.OrdinalIgnoreCase))
                return known.DisplayName;
        }
        return providerId;
    }

    private static string ResolveIcon(string providerId)
    {
        foreach (var known in KnownProviders)
        {
            if (providerId.Contains(known.Id, StringComparison.OrdinalIgnoreCase))
                return known.Icon;
        }
        // Google Drive File Stream provider ids vary (GoogleDriveFS, etc.)
        if (providerId.Contains("google", StringComparison.OrdinalIgnoreCase))
            return "gdrive";
        return "cloud";
    }

    private static string ResolveSyncStatus(string path)
    {
        try
        {
            if (IsDriveRootPath(path))
            {
                try
                {
                    var di = new DriveInfo(path.Substring(0, 1) + ":\\");
                    if (!di.IsReady) return "missing";
                }
                catch { return "unknown"; }
            }
            else if (!Directory.Exists(path))
            {
                return "missing";
            }

            var attrs = File.GetAttributes(path);
            const int recallOnAccess = 0x00400000;
            const int pinned = 0x00080000;
            var raw = (int)attrs;
            if ((attrs & FileAttributes.Offline) != 0 || (raw & recallOnAccess) != 0)
                return "online-only";
            if ((raw & pinned) != 0)
                return "pinned";
            return "available";
        }
        catch
        {
            return "unknown";
        }
    }

    private sealed record SyncMount(string DisplayName, string MountPoint, string Icon, string? AccountLabel);
    private sealed record CloudVolumeInfo(string DisplayName, string MountPoint, string Icon, string? AccountLabel);
}
