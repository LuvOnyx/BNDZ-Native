using System;
using System.Collections.Generic;
using System.IO;
using Microsoft.Win32;

namespace BNDZ.Services;

public class CloudStorageService
{
    private static readonly (string Id, string DisplayName, string Icon)[] KnownProviders =
    {
        ("onedrive", "OneDrive", "onedrive"),
        ("googledrive", "Google Drive", "gdrive"),
        ("dropbox", "Dropbox", "dropbox"),
        ("icloud", "iCloud Drive", "icloud"),
        ("box", "Box", "box"),
    };

    public List<object> GetProviders()
    {
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var providers = new List<object>();

        void Add(string name, string path, string icon)
        {
            if (string.IsNullOrEmpty(path) || !Directory.Exists(path)) return;
            var key = path.TrimEnd('\\', '/').ToLowerInvariant();
            if (!seen.Add(key)) return;
            providers.Add(new { name, path = "/" + path.Replace("\\", "/"), icon });
        }

        // Environment variables (most reliable for OneDrive)
        TryEnv("OneDrive", "OneDrive", "onedrive", Add);
        TryEnv("OneDriveCommercial", "OneDrive", "onedrive", Add);
        TryEnv("OneDriveConsumer", "OneDrive", "onedrive", Add);

        var userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);

        // Well-known folder locations
        Add("OneDrive", Path.Combine(userProfile, "OneDrive"), "onedrive");
        Add("Google Drive", Path.Combine(userProfile, "Google Drive"), "gdrive");
        Add("Google Drive", @"G:\My Drive", "gdrive");
        Add("Google Drive", @"G:\", "gdrive");
        Add("Dropbox", Path.Combine(userProfile, "Dropbox"), "dropbox");
        Add("iCloud Drive", Path.Combine(userProfile, "iCloudDrive"), "icloud");
        Add("iCloud Photos", Path.Combine(userProfile, "iCloudPhotos"), "icloud");
        Add("Box", Path.Combine(userProfile, "Box"), "box");

        // Windows Sync Engine registry
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(@"Software\SyncEngines\Providers");
            if (key != null)
            {
                foreach (var providerId in key.GetSubKeyNames())
                {
                    using var providerKey = key.OpenSubKey(providerId);
                    if (providerKey == null) continue;

                    var displayName = ResolveDisplayName(providerId, providerKey);
                    var icon = ResolveIcon(providerId);

                    string? mount = providerKey.GetValue("MountPoint") as string;
                    if (!string.IsNullOrEmpty(mount))
                        Add(displayName, mount, icon);

                    foreach (var instance in providerKey.GetSubKeyNames())
                    {
                        using var instanceKey = providerKey.OpenSubKey(instance);
                        mount = instanceKey?.GetValue("MountPoint") as string;
                        if (!string.IsNullOrEmpty(mount))
                            Add(displayName, mount, icon);
                    }
                }
            }
        }
        catch { }

        // Shell namespace fallbacks under UserProfile
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

        return providers;
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
        return "cloud";
    }
}
