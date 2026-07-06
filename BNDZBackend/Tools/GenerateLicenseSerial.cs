// Build-time / internal tool: dotnet script or run from test harness.
// Usage: GenerateLicenseSerial.Create("DEMO", "2026") => BNDZ-DEMO-2026-XXXX
using System.Security.Cryptography;
using System.Text;
using BNDZ.Services;

namespace BNDZ.Tools;

public static class GenerateLicenseSerial
{
    private static string LicenseSecret =>
        Environment.GetEnvironmentVariable("BNDZ_LICENSE_SECRET")?.Trim() is { Length: > 0 } s
            ? s
            : "BNDZ-36-Commercial-Key-Seed-CHANGE-ME";

    public static string Create(string segmentA, string segmentB)
    {
        segmentA = segmentA.ToUpperInvariant().PadRight(4).Substring(0, 4).Trim();
        segmentB = segmentB.ToUpperInvariant().PadRight(4).Substring(0, 4).Trim();
        var payload = $"{segmentA}-{segmentB}";
        var checksum = ComputeChecksum(payload);
        return $"BNDZ-{payload}-{checksum}";
    }

    public static bool Verify(string serial) => LicenseService.ValidateSerial(serial);

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
