using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;

namespace BNDZ.Services;

public enum QuotaEnforcement
{
    Off,
    Soft,
    Hard,
}

public sealed class VolumeQuotaPolicy
{
    public string VolumeRoot { get; set; } = "";
    public QuotaEnforcement Enforcement { get; set; } = QuotaEnforcement.Off;
    public long SoftLimitBytes { get; set; }
    public long HardLimitBytes { get; set; }
    public bool Enabled { get; set; } = true;
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
}

public sealed class GovernorCheckResult
{
    public bool Allowed { get; set; } = true;
    public bool SoftWarning { get; set; }
    public bool HardBlock { get; set; }
    public string? Message { get; set; }
    public long CurrentUsedBytes { get; set; }
    public long AfterUsedBytes { get; set; }
    public long SoftLimitBytes { get; set; }
    public long HardLimitBytes { get; set; }
    public long TotalBytes { get; set; }
    public double AfterUsedPct { get; set; }
}

public sealed class BudgetGovernorService
{
    private static readonly Lazy<BudgetGovernorService> _instance = new(() => new BudgetGovernorService());
    public static BudgetGovernorService Instance => _instance.Value;

    private readonly ConcurrentDictionary<string, VolumeQuotaPolicy> _policies = new(StringComparer.OrdinalIgnoreCase);
    private readonly string _configPath;
    private readonly ReaderWriterLockSlim _lock = new();

    private BudgetGovernorService()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "Governor");
        Directory.CreateDirectory(dir);
        _configPath = Path.Combine(dir, "policies.json");
        LoadPolicies();
    }

    public List<VolumeQuotaPolicy> GetPolicies() => _policies.Values.ToList();

    public VolumeQuotaPolicy? GetPolicy(string volumeRoot)
    {
        var key = NormalizeRoot(volumeRoot);
        return _policies.TryGetValue(key, out var p) ? p : null;
    }

    public void SetPolicy(VolumeQuotaPolicy policy)
    {
        var key = NormalizeRoot(policy.VolumeRoot);
        policy.VolumeRoot = key;
        _policies[key] = policy;
        SavePolicies();
    }

    public bool RemovePolicy(string volumeRoot)
    {
        var key = NormalizeRoot(volumeRoot);
        var removed = _policies.TryRemove(key, out _);
        if (removed) SavePolicies();
        return removed;
    }

    /// <summary>
    /// Check whether a transfer of <paramref name="incomingBytes"/> to the volume at <paramref name="targetPath"/> is permitted.
    /// Returns allowed=true when governor is off or within budget.
    /// </summary>
    public GovernorCheckResult CheckTransfer(string targetPath, long incomingBytes)
    {
        var result = new GovernorCheckResult { Allowed = true };
        try
        {
            var root = Path.GetPathRoot(Path.GetFullPath(targetPath));
            if (string.IsNullOrEmpty(root)) return result;

            var policy = FindPolicyForPath(root);
            if (policy == null || !policy.Enabled || policy.Enforcement == QuotaEnforcement.Off)
                return result;

            var driveInfo = new DriveInfo(root);
            if (!driveInfo.IsReady) return result;

            long total = driveInfo.TotalSize;
            long used = total - driveInfo.AvailableFreeSpace;
            long afterUsed = used + incomingBytes;

            result.CurrentUsedBytes = used;
            result.AfterUsedBytes = afterUsed;
            result.TotalBytes = total;
            result.SoftLimitBytes = policy.SoftLimitBytes;
            result.HardLimitBytes = policy.HardLimitBytes;
            result.AfterUsedPct = total > 0 ? Math.Round(afterUsed * 100.0 / total, 1) : 0;

            if (policy.HardLimitBytes > 0 && afterUsed > policy.HardLimitBytes)
            {
                result.Allowed = false;
                result.HardBlock = true;
                result.Message = $"Hard budget exceeded: transfer would use {FormatBytes(afterUsed)} of {FormatBytes(policy.HardLimitBytes)} limit on {root}";
                return result;
            }

            if (policy.SoftLimitBytes > 0 && afterUsed > policy.SoftLimitBytes)
            {
                result.Allowed = true;
                result.SoftWarning = true;
                result.Message = $"Soft budget warning: transfer will use {FormatBytes(afterUsed)} of {FormatBytes(policy.SoftLimitBytes)} soft limit on {root}";
                return result;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BudgetGovernor] CheckTransfer error: {ex.Message}");
        }
        return result;
    }

    /// <summary>Find matching policy for a volume root (exact or prefix match).</summary>
    private VolumeQuotaPolicy? FindPolicyForPath(string root)
    {
        var key = NormalizeRoot(root);
        if (_policies.TryGetValue(key, out var exact)) return exact;
        return _policies.Values
            .Where(p => p.Enabled && key.StartsWith(NormalizeRoot(p.VolumeRoot), StringComparison.OrdinalIgnoreCase))
            .OrderByDescending(p => p.VolumeRoot.Length)
            .FirstOrDefault();
    }

    private static string NormalizeRoot(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        var full = Path.GetFullPath(path.Trim()).TrimEnd('\\', '/');
        return full.ToUpperInvariant();
    }

    private void LoadPolicies()
    {
        if (!File.Exists(_configPath)) return;
        try
        {
            var json = File.ReadAllText(_configPath);
            var list = JsonSerializer.Deserialize<List<VolumeQuotaPolicy>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (list == null) return;
            foreach (var p in list)
            {
                var key = NormalizeRoot(p.VolumeRoot);
                p.VolumeRoot = key;
                _policies[key] = p;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BudgetGovernor] Load failed: {ex.Message}");
        }
    }

    private void SavePolicies()
    {
        try
        {
            var json = JsonSerializer.Serialize(_policies.Values.ToList(), new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(_configPath, json);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BudgetGovernor] Save failed: {ex.Message}");
        }
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        if (bytes < 1024L * 1024) return $"{bytes / 1024.0:F1} KB";
        if (bytes < 1024L * 1024 * 1024) return $"{bytes / (1024.0 * 1024):F1} MB";
        return $"{bytes / (1024.0 * 1024 * 1024):F2} GB";
    }
}
