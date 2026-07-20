using System.Security.Cryptography;
using System.Text;
using Microsoft.Win32;

namespace BNDZ.Services;

/// <summary>Stable per-machine id for 1-seat license binding (SHA-256 hash; never store raw identifiers).</summary>
public static class MachineIdService
{
    private static string? _cached;

    public static string GetHardwareId()
    {
        if (!string.IsNullOrEmpty(_cached)) return _cached!;

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

        try
        {
            var sysDrive = Path.GetPathRoot(Environment.SystemDirectory) ?? "C:\\";
            var letter = sysDrive.TrimEnd('\\', '/');
            if (letter.Length >= 1)
            {
                var free = new DriveInfo(letter + "\\");
                parts.Add($"{letter}:{free.DriveType}:{free.DriveFormat}");
            }
        }
        catch { /* ignore */ }

        if (parts.Count == 0)
            parts.Add("bndz-fallback|" + Environment.UserDomainName);

        var material = string.Join("|", parts);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(material));
        _cached = Convert.ToHexString(hash).ToLowerInvariant();
        return _cached;
    }
}
