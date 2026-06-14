using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BNDZ.Services;

public sealed class LicenseRecord
{
    public string Serial { get; set; } = "";
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTime ActivatedAt { get; set; }
    public bool IsValid { get; set; }
}

/// <summary>
/// Offline license activation — replace LicenseSecret before shipping builds.
/// Serial format: BNDZ-XXXX-XXXX-CCCC where CCCC is an HMAC checksum of the middle segments.
/// </summary>
public static class LicenseService
{
    private const string LicenseSecret = "BNDZ-36-Commercial-Key-Seed-CHANGE-ME";

    private static string LicensePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "BNDZ64",
        "license.json");

    public static LicenseRecord? GetStatus()
    {
        try
        {
            if (!File.Exists(LicensePath)) return null;
            var json = File.ReadAllText(LicensePath);
            var rec = JsonSerializer.Deserialize<LicenseRecord>(json);
            if (rec == null) return null;
            rec.IsValid = ValidateSerial(rec.Serial);
            return rec;
        }
        catch
        {
            return null;
        }
    }

    public static (bool success, string message) Activate(string serial, string email, string name)
    {
        serial = (serial ?? "").Trim().ToUpperInvariant();
        email = (email ?? "").Trim();
        name = (name ?? "").Trim();

        if (string.IsNullOrWhiteSpace(serial))
            return (false, "Enter your serial number.");
        if (string.IsNullOrWhiteSpace(email))
            return (false, "Enter your registration email.");
        if (!ValidateSerial(serial))
            return (false, "Invalid serial number. Check the format and try again.");

        var rec = new LicenseRecord
        {
            Serial = serial,
            Email = email,
            Name = name,
            ActivatedAt = DateTime.UtcNow,
            IsValid = true,
        };

        var dir = Path.GetDirectoryName(LicensePath);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        File.WriteAllText(LicensePath, JsonSerializer.Serialize(rec, new JsonSerializerOptions { WriteIndented = true }));
        return (true, "BNDZ has been activated. Thank you for your purchase!");
    }

    public static void Deactivate()
    {
        try
        {
            if (File.Exists(LicensePath))
                File.Delete(LicensePath);
        }
        catch
        {
            // ignore
        }
    }

    public static bool ValidateSerial(string serial)
    {
        var parts = serial.Split('-');
        if (parts.Length != 4 || !string.Equals(parts[0], "BNDZ", StringComparison.OrdinalIgnoreCase))
            return false;

        for (var i = 1; i < 4; i++)
        {
            if (parts[i].Length != 4 || !parts[i].All(char.IsLetterOrDigit))
                return false;
        }

        var payload = $"{parts[1]}-{parts[2]}";
        var expected = ComputeChecksum(payload);
        return string.Equals(parts[3], expected, StringComparison.OrdinalIgnoreCase);
    }

    public static string MaskSerial(string serial)
    {
        if (string.IsNullOrEmpty(serial) || serial.Length < 12)
            return "BNDZ-****-****-****";
        return $"{serial[..9]}****{serial[^4..]}";
    }

    private static string ComputeChecksum(string payload)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(LicenseSecret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var sb = new StringBuilder(4);
        for (var i = 0; i < 4; i++)
            sb.Append(alphabet[hash[i] % alphabet.Length]);
        return sb.ToString();
    }
}
