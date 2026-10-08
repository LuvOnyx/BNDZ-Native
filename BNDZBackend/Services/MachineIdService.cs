using System.Security.Cryptography;
using System.Text;
using System.Threading.Tasks;
using Microsoft.Win32;

namespace BNDZ.Services;

/// <summary>Stable per-machine id for 1-seat license binding (SHA-256 hash; never store raw identifiers).</summary>
public static class MachineIdService
{
    private static string? _cached;

    public static string GetHardwareId()
    {
        if (!string.IsNullOrEmpty(_cached)) return _cached!;
        var id = ComputeHardwareId(includeOsVersionFallback: false, processorCountOverride: null, out var driveRead);
        // A system-drive probe that timed out (busy disk at cold boot) yields a different hash;
        // don't pin that for the whole session, retry on the next call instead.
        if (driveRead) _cached = id;
        return id;
    }

    /// <summary>
    /// True when <paramref name="stored"/> matches the current machine id, or the short-lived
    /// alternate hash from a DriveFormat-removal patch (so seats are not wiped after that build).
    /// </summary>
    public static bool MatchesStoredHardwareId(string? stored)
    {
        if (string.IsNullOrWhiteSpace(stored)) return true;
        if (string.Equals(stored, GetHardwareId(), StringComparison.OrdinalIgnoreCase))
            return true;
        // Alternate id used briefly when DriveInfo.DriveFormat was removed from the material.
        var alt = ComputeHardwareId(includeOsVersionFallback: true, processorCountOverride: null, out _);
        if (string.Equals(stored, alt, StringComparison.OrdinalIgnoreCase))
            return true;
        return MatchesWithDifferentProcessorCount(stored);
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, bool> ToleranceCache =
        new(StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// Environment.ProcessorCount is part of the legacy material, but it moves with BIOS/SMT
    /// toggles, msconfig core limits, VM resizing and CPU swaps (a 16-thread seat reported 14 on
    /// the dev PC and fell back to trial). MachineGuid, machine name and system drive must still
    /// match; only the logical-processor count may differ. The activation token stays verified
    /// against the stored id, so the seat is not rebound or re-signed.
    /// </summary>
    private static bool MatchesWithDifferentProcessorCount(string stored)
    {
        return ToleranceCache.GetOrAdd(stored, s =>
        {
            var current = Environment.ProcessorCount;
            for (var n = 1; n <= 1024; n++)
            {
                if (n == current) continue;
                if (string.Equals(s, ComputeHardwareId(false, n, out _), StringComparison.OrdinalIgnoreCase)
                    || string.Equals(s, ComputeHardwareId(true, n, out _), StringComparison.OrdinalIgnoreCase))
                    return true;
            }
            return false;
        });
    }

    private static string ComputeHardwareId(bool includeOsVersionFallback, int? processorCountOverride, out bool driveRead)
    {
        driveRead = false;
        var parts = new List<string>();
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Cryptography");
            var guid = key?.GetValue("MachineGuid") as string;
            if (!string.IsNullOrWhiteSpace(guid)) parts.Add(guid.Trim());
        }
        catch { /* ignore */ }

        try
        {
            parts.Add(Environment.MachineName);
            parts.Add((processorCountOverride ?? Environment.ProcessorCount).ToString());
            parts.Add(Environment.Is64BitOperatingSystem ? "x64" : "x86");
        }
        catch { /* ignore */ }

        // Legacy material (must stay stable for activated seats). Probe with a timeout so a
        // wedged volume never hangs the IPC / license path.
        try
        {
            var sysDrive = Path.GetPathRoot(Environment.SystemDirectory) ?? "C:\\";
            var letter = sysDrive.TrimEnd('\\', '/');
            if (letter.Length >= 1)
            {
                var drivePart = TryReadSystemDriveMaterial(letter, timeoutMs: 600);
                if (!string.IsNullOrEmpty(drivePart))
                {
                    parts.Add(drivePart);
                    driveRead = true;
                }
                else if (includeOsVersionFallback)
                    parts.Add(Environment.OSVersion.VersionString);
            }
            else if (includeOsVersionFallback)
            {
                parts.Add(Environment.OSVersion.VersionString);
            }
        }
        catch
        {
            if (includeOsVersionFallback)
            {
                try { parts.Add(Environment.OSVersion.VersionString); }
                catch { /* ignore */ }
            }
        }

        if (parts.Count == 0)
            parts.Add("bndz-fallback|" + Environment.UserDomainName);

        var material = string.Join("|", parts);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static string? _driveMaterial;

    private static string? TryReadSystemDriveMaterial(string letter, int timeoutMs)
    {
        if (_driveMaterial is not null) return _driveMaterial;
        var read = TryReadSystemDriveMaterialCore(letter, timeoutMs);
        if (read is not null) _driveMaterial = read;
        return read;
    }

    private static string? TryReadSystemDriveMaterialCore(string letter, int timeoutMs)
    {
        try
        {
            var task = Task.Run(() =>
            {
                try
                {
                    var free = new DriveInfo(letter + "\\");
                    // Same format as historical MachineIdService — do not change.
                    return $"{letter}:{free.DriveType}:{free.DriveFormat}";
                }
                catch
                {
                    return null;
                }
            });
            return task.Wait(timeoutMs) ? task.Result : null;
        }
        catch
        {
            return null;
        }
    }
}
