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

public sealed class TrialRecord
{
    public DateTime FirstRunUtc { get; set; }
    public string Integrity { get; set; } = "";
}

public sealed class LicenseStatusDto
{
    public bool Activated { get; set; }
    public bool CanUseApp { get; set; }
    public bool TrialExpired { get; set; }
    public int TrialDaysTotal { get; set; }
    public int TrialDaysRemaining { get; set; }
    public string? TrialEndsAt { get; set; }
    public string? Email { get; set; }
    public string? Name { get; set; }
    public string? SerialMasked { get; set; }
}

/// <summary>
/// Offline license + 14-day trial. Set BNDZ_LICENSE_SECRET env var for retail builds.
/// Serial format: BNDZ-XXXX-XXXX-CCCC
/// </summary>
public static class LicenseService
{
    public const int TrialDays = 14;
    private const string DefaultDevSecret = "BNDZ-36-Commercial-Key-Seed-CHANGE-ME";

    private static string AppDataDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "BNDZ64");

    private static string LicensePath => Path.Combine(AppDataDir, "license.json");
    private static string TrialPath => Path.Combine(AppDataDir, "trial.json");

    private static string LicenseSecret =>
        Environment.GetEnvironmentVariable("BNDZ_LICENSE_SECRET")?.Trim() is { Length: > 0 } s
            ? s
            : DefaultDevSecret;

    public static bool IsUsingDefaultSecret =>
        string.Equals(LicenseSecret, DefaultDevSecret, StringComparison.Ordinal);

    public static LicenseRecord? GetActivatedRecord()
    {
        try
        {
            if (!File.Exists(LicensePath)) return null;
            var json = File.ReadAllText(LicensePath);
            var rec = JsonSerializer.Deserialize<LicenseRecord>(json);
            if (rec == null) return null;
            rec.IsValid = ValidateSerial(rec.Serial);
            return rec.IsValid ? rec : null;
        }
        catch
        {
            return null;
        }
    }

    public static LicenseStatusDto GetStatus()
    {
        var activated = GetActivatedRecord();
        if (activated != null)
        {
            return new LicenseStatusDto
            {
                Activated = true,
                CanUseApp = true,
                TrialExpired = false,
                TrialDaysTotal = TrialDays,
                TrialDaysRemaining = TrialDays,
                Email = activated.Email,
                Name = activated.Name,
                SerialMasked = MaskSerial(activated.Serial),
            };
        }

        var trial = EnsureTrialRecord();
        var endsAt = trial.FirstRunUtc.AddDays(TrialDays);
        var remaining = (int)Math.Ceiling((endsAt - DateTime.UtcNow).TotalDays);
        if (remaining < 0) remaining = 0;
        var expired = DateTime.UtcNow >= endsAt;

        return new LicenseStatusDto
        {
            Activated = false,
            CanUseApp = !expired,
            TrialExpired = expired,
            TrialDaysTotal = TrialDays,
            TrialDaysRemaining = remaining,
            TrialEndsAt = endsAt.ToString("o"),
        };
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

        Directory.CreateDirectory(AppDataDir);
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

    private static TrialRecord EnsureTrialRecord()
    {
        try
        {
            if (File.Exists(TrialPath))
            {
                var existing = JsonSerializer.Deserialize<TrialRecord>(File.ReadAllText(TrialPath));
                if (existing != null && ValidateTrialIntegrity(existing))
                    return existing;
            }
        }
        catch
        {
            // fall through to create fresh trial
        }

        var trial = new TrialRecord
        {
            FirstRunUtc = DateTime.UtcNow,
        };
        trial.Integrity = SignTrial(trial.FirstRunUtc);
        Directory.CreateDirectory(AppDataDir);
        File.WriteAllText(TrialPath, JsonSerializer.Serialize(trial, new JsonSerializerOptions { WriteIndented = true }));
        return trial;
    }

    private static bool ValidateTrialIntegrity(TrialRecord trial)
    {
        if (trial.FirstRunUtc > DateTime.UtcNow.AddDays(1))
            return false;
        var expected = SignTrial(trial.FirstRunUtc);
        return string.Equals(trial.Integrity, expected, StringComparison.Ordinal);
    }

    private static string SignTrial(DateTime firstRunUtc)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(LicenseSecret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(firstRunUtc.Ticks.ToString()));
        return Convert.ToHexString(hash.AsSpan(0, 8));
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
