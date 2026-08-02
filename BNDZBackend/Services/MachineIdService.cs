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
        _cached = ComputeHardwareId(includeOsVersionFallback: false);
        return _cached;
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
        var alt = ComputeHardwareId(includeOsVersionFallback: true);
        return string.Equals(stored, alt, StringComparison.OrdinalIgnoreCase);
    }

    private static string ComputeHardwareId(bool includeOsVersionFallback)
    {
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
            parts.Add(Environment.ProcessorCount.ToString());
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
                    parts.Add(drivePart);
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

    private static string? TryReadSystemDriveMaterial(string letter, int timeoutMs)
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
