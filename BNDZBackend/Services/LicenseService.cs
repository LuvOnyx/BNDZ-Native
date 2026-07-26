using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Win32;

namespace BNDZ.Services;

public sealed class LicenseRecord
{
    public string Serial { get; set; } = "";
    public string Email { get; set; } = "";
    public string Name { get; set; } = "";
    public DateTime ActivatedAt { get; set; }
    public bool IsValid { get; set; }
    /** Online activation token (JWT HS256). Empty for legacy offline-only records. */
    public string Token { get; set; } = "";
    public string Hwid { get; set; } = "";
    public DateTime? LastValidatedUtc { get; set; }
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
    public bool OnlineBound { get; set; }
    public string? LicenseMode { get; set; }
}

/// <summary>
/// Online 1-seat activation (Cloudflare) + 14-day trial.
/// Activation is stored under HKCU\Software\BNDZ\License (DPAPI blob) so AppData
/// cleaners / roaming profile wipes do not drop a paid seat. Legacy AppData files
/// are migrated on first successful read.
/// </summary>
public static class LicenseService
{
    public const int TrialDays = 14;
    public const string DefaultDevSecret = "BNDZ-36-Commercial-Key-Seed-CHANGE-ME";
    public const string DefaultLicenseApiBase = "https://bndz-license-api.mikeyrespondi.workers.dev";

    private const string LicenseRegistryKeyPath = @"Software\BNDZ\License";
    private const string LicenseRegistryValueName = "Activation";

    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };
    private static readonly byte[] DpapiEntropy = Encoding.UTF8.GetBytes("BNDZ64-License-v2");
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static readonly HashSet<string> UnlicensedIpcAllowList = new(StringComparer.OrdinalIgnoreCase)
    {
        "GET_LICENSE_STATUS",
        "ACTIVATE_LICENSE",
        "DEACTIVATE_LICENSE",
        "LOAD_SETTINGS",
        "SAVE_SETTINGS",
        "GET_APP_VERSION",
        "GET_APP_RUNTIME_INFO",
        "GET_WINDOW_STATE",
        "REQUEST_CLOSE",
        "OPEN_LEGAL_DOC",
        // Startup shell reads — must not 15s-timeout behind the license gate.
        "GET_ICON_LIBRARIES",
        "GET_DRIVES",
        "GET_SYSTEM_SHORTCUTS",
        "GET_TAGS_CONFIG",
        "GET_CLOUD_PROVIDERS",
        "GET_NETWORK_LOCATIONS",
        "BNDZ_UI_READY",
    };

    private static string AppDataDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
        "BNDZ64");

    private static string LocalDataDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "BNDZ64");

    private static string LicensePath => Path.Combine(AppDataDir, "license.dat");
    private static string LicensePathLegacy => Path.Combine(AppDataDir, "license.json");
    private static string TrialPath => Path.Combine(AppDataDir, "trial.dat");
    private static string TrialPathLegacy => Path.Combine(AppDataDir, "trial.json");
    private static string TrialMarkerPath => Path.Combine(LocalDataDir, "trial.marker");

    private static string LicenseSecret
    {
        get
        {
            var env = Environment.GetEnvironmentVariable("BNDZ_LICENSE_SECRET")?.Trim();
            if (!string.IsNullOrEmpty(env)) return env;
            var embedded = LicenseSecretEmbedded.Value;
            if (!string.IsNullOrEmpty(embedded)) return embedded;
            return DefaultDevSecret;
        }
    }

    private static string TokenSecret
    {
        get
        {
            var env = Environment.GetEnvironmentVariable("BNDZ_TOKEN_HMAC_SECRET")?.Trim();
            if (!string.IsNullOrEmpty(env)) return env;
            var embedded = LicenseTokenSecretEmbedded.Value;
            if (!string.IsNullOrEmpty(embedded)) return embedded;
            // Dev fallback: derive from license secret so local/dev still verifies tokens from wrangler dev
            return "token:" + LicenseSecret;
        }
    }

    private static string? LegacyLicenseSecret =>
        Environment.GetEnvironmentVariable("BNDZ_LICENSE_SECRET_LEGACY")?.Trim() is { Length: > 0 } s ? s : null;

    public static string LicenseApiBase
    {
        get
        {
            var env = Environment.GetEnvironmentVariable("BNDZ_LICENSE_API")?.Trim();
            if (!string.IsNullOrEmpty(env)) return env.TrimEnd('/');
            return DefaultLicenseApiBase.TrimEnd('/');
        }
    }

    public static bool IsUsingDefaultSecret =>
        string.Equals(LicenseSecret, DefaultDevSecret, StringComparison.Ordinal);

    public static bool IsIpcAllowedWhenUnlicensed(string? type) =>
        !string.IsNullOrEmpty(type) && UnlicensedIpcAllowList.Contains(type);

    /// <summary>
    /// Map request type → response type the WebView listens for.
    /// GET_* → strip prefix (GET_ICON_LIBRARIES → ICON_LIBRARIES_RESULT).
    /// </summary>
    public static string ResolveIpcResultType(string requestType)
    {
        if (string.IsNullOrEmpty(requestType))
            return "IPC_RESULT";
        if (requestType.StartsWith("GET_", StringComparison.OrdinalIgnoreCase))
            return requestType.Substring(4) + "_RESULT";
        return requestType + "_RESULT";
    }

    private static LicenseStatusDto? _statusCache;
    private static long _statusCacheTicks;

    public static void InvalidateStatusCache()
    {
        _statusCache = null;
        _statusCacheTicks = 0;
    }

    public static LicenseStatusDto GetStatusCached(int ttlMs = 1500)
    {
        var now = Environment.TickCount64;
        if (_statusCache != null && now - _statusCacheTicks < ttlMs)
            return _statusCache;
        _statusCache = GetStatus();
        _statusCacheTicks = now;
        return _statusCache;
    }

    public static LicenseStatusDto GetStatus()
    {
        var activated = GetActivatedRecord();
        if (activated != null)
        {
            // Fire-and-forget online revalidation (revocation / seat moves).
            _ = Task.Run(() => TryValidateOnline(activated));

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
                OnlineBound = !string.IsNullOrEmpty(activated.Token),
                LicenseMode = string.IsNullOrEmpty(activated.Token) ? "legacy-offline" : "online",
            };
        }

        var trial = ResolveTrialRecord();
        var endsAt = trial.FirstRunUtc.AddDays(TrialDays);
        var remaining = (int)Math.Ceiling((endsAt - DateTime.UtcNow).TotalDays);
        if (remaining < 0) remaining = 0;
        var expired = DateTime.UtcNow >= endsAt || trial.ForceExpired;

        return new LicenseStatusDto
        {
            Activated = false,
            CanUseApp = !expired,
            TrialExpired = expired,
            TrialDaysTotal = TrialDays,
            TrialDaysRemaining = remaining,
            TrialEndsAt = endsAt.ToString("o"),
            OnlineBound = false,
            LicenseMode = "trial",
        };
    }

    public static async Task<(bool success, string message)> ActivateAsync(string serial, string email, string name)
    {
        serial = (serial ?? "").Trim().ToUpperInvariant();
        email = (email ?? "").Trim();
        name = (name ?? "").Trim();

        if (string.IsNullOrWhiteSpace(serial))
            return (false, "Enter your serial number.");
        if (string.IsNullOrWhiteSpace(email))
            return (false, "Enter your registration email.");
        // Retail builds verify the serial HMAC locally. Debug (default secret) trusts
        // the activation API — customer keys are signed with the retail secret.
        if (!IsUsingDefaultSecret && !ValidateSerial(serial))
            return (false, "Invalid serial number. Check the format and try again.");

        var hwid = MachineIdService.GetHardwareId();
        try
        {
            using var resp = await Http.PostAsJsonAsync($"{LicenseApiBase}/v1/activate", new
            {
                serial,
                email,
                name,
                hwid,
                appVersion = "1.0.0",
            }, JsonOpts).ConfigureAwait(false);

            var payload = await resp.Content.ReadFromJsonAsync<ActivateApiResponse>(JsonOpts).ConfigureAwait(false);
            if (!resp.IsSuccessStatusCode || payload == null || payload.Ok != true || string.IsNullOrEmpty(payload.Token))
            {
                var err = payload?.Error ?? $"Activation server returned {(int)resp.StatusCode}";
                return (false, err);
            }

            if (!IsUsingDefaultSecret && !VerifyActivationToken(payload.Token, serial, hwid))
                return (false, "Activation token failed local verification.");

            var rec = new LicenseRecord
            {
                Serial = serial,
                Email = payload.Email ?? email,
                Name = payload.Name ?? name,
                ActivatedAt = DateTime.UtcNow,
                IsValid = true,
                Token = payload.Token,
                Hwid = hwid,
                LastValidatedUtc = DateTime.UtcNow,
            };

            PersistLicenseRecord(rec);
            InvalidateStatusCache();
            return (true, payload.Message ?? "BNDZ has been activated on this PC.");
        }
        catch (Exception ex)
        {
            return (false, "Could not reach the activation server. Check your internet connection and try again. (" + ex.GetType().Name + ")");
        }
    }

    /** Sync wrapper for existing IPC (blocks briefly). Prefer ActivateAsync. */
    public static (bool success, string message) Activate(string serial, string email, string name) =>
        ActivateAsync(serial, email, name).GetAwaiter().GetResult();

    public static async Task DeactivateAsync()
    {
        var rec = ReadLicenseRecord();
        var hwid = MachineIdService.GetHardwareId();
        if (rec != null && !string.IsNullOrEmpty(rec.Token))
        {
            try
            {
                using var resp = await Http.PostAsJsonAsync($"{LicenseApiBase}/v1/deactivate", new
                {
                    serial = rec.Serial,
                    hwid,
                    token = rec.Token,
                }, JsonOpts).ConfigureAwait(false);
                _ = resp;
            }
            catch
            {
                // Still clear local seat so the user can re-activate after server-side revoke/admin free.
            }
        }

        ClearPersistedLicense();
        InvalidateStatusCache();
    }

    public static void Deactivate() => DeactivateAsync().GetAwaiter().GetResult();

    public static LicenseRecord? GetActivatedRecord()
    {
        try
        {
            var rec = ReadLicenseRecord();
            if (rec == null) return null;
            if (string.IsNullOrWhiteSpace(rec.Serial))
                return null;

            var hwid = MachineIdService.GetHardwareId();

            // Debug / missing retail embeds: still honor a DPAPI-bound seat from the
            // installed retail build on this same Windows user (HKCU). Crypto verify
            // would fail against DefaultDevSecret and falsely show "Enter license key".
            if (IsUsingDefaultSecret)
            {
                if (!string.IsNullOrEmpty(rec.Hwid) &&
                    !string.Equals(rec.Hwid, hwid, StringComparison.OrdinalIgnoreCase))
                    return null;
                if (string.IsNullOrEmpty(rec.Token) && !rec.IsValid)
                    return null;
                rec.IsValid = true;
                return rec;
            }

            if (!ValidateSerial(rec.Serial))
                return null;

            if (!string.IsNullOrEmpty(rec.Token))
            {
                if (!VerifyActivationToken(rec.Token, rec.Serial, hwid))
                    return null;
                if (!string.IsNullOrEmpty(rec.Hwid) &&
                    !string.Equals(rec.Hwid, hwid, StringComparison.OrdinalIgnoreCase))
                    return null;
            }

            rec.IsValid = true;
            return rec;
        }
        catch
        {
            return null;
        }
    }

    private static void TryValidateOnline(LicenseRecord rec)
    {
        try
        {
            if (string.IsNullOrEmpty(rec.Token)) return;
            var hwid = MachineIdService.GetHardwareId();
            using var resp = Http.PostAsJsonAsync($"{LicenseApiBase}/v1/validate", new
            {
                serial = rec.Serial,
                hwid,
                token = rec.Token,
            }, JsonOpts).GetAwaiter().GetResult();

            var payload = resp.Content.ReadFromJsonAsync<ValidateApiResponse>(JsonOpts).GetAwaiter().GetResult();
            if (resp.IsSuccessStatusCode && payload?.Valid == true)
            {
                rec.LastValidatedUtc = DateTime.UtcNow;
                PersistLicenseRecord(rec);
                return;
            }

            var reason = payload?.Reason ?? "";
            // Only hard-clear on confirmed revoke. Transient API / seat drift must not
            // wipe a locally verified activation and bounce the user back to trial.
            if (string.Equals(reason, "revoked", StringComparison.OrdinalIgnoreCase))
            {
                ClearPersistedLicense();
                InvalidateStatusCache();
            }
        }
        catch
        {
            // Offline: keep local activation.
        }
    }

    public static bool ValidateSerial(string serial)
    {
        if (!TryParseSerial(serial, out var payload, out var checksum))
            return false;

        if (string.Equals(checksum, ComputeChecksum(payload, LicenseSecret), StringComparison.OrdinalIgnoreCase))
            return true;

        var legacy = LegacyLicenseSecret;
        if (legacy != null &&
            string.Equals(checksum, ComputeChecksum(payload, legacy), StringComparison.OrdinalIgnoreCase))
            return true;

        return false;
    }

    public static string MaskSerial(string serial)
    {
        if (string.IsNullOrEmpty(serial) || serial.Length < 12)
            return "BNDZ-****-****-****";
        return $"{serial[..9]}****{serial[^4..]}";
    }

    public static bool VerifyActivationToken(string token, string expectedSerial, string expectedHwid)
    {
        try
        {
            var parts = token.Split('.');
            if (parts.Length != 3) return false;
            var signingInput = $"{parts[0]}.{parts[1]}";
            using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(TokenSecret));
            var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(signingInput));
            var expectedSig = Base64UrlEncode(hash);
            var expectedBytes = Encoding.UTF8.GetBytes(expectedSig);
            var actualBytes = Encoding.UTF8.GetBytes(parts[2]);
            if (expectedBytes.Length != actualBytes.Length) return false;
            if (!CryptographicOperations.FixedTimeEquals(expectedBytes, actualBytes))
                return false;

            var json = Encoding.UTF8.GetString(Base64UrlDecode(parts[1]));
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var sub = root.TryGetProperty("sub", out var s) ? s.GetString() : null;
            var hwid = root.TryGetProperty("hwid", out var h) ? h.GetString() : null;
            return string.Equals(sub, expectedSerial, StringComparison.OrdinalIgnoreCase)
                && string.Equals(hwid, expectedHwid, StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private sealed class TrialState
    {
        public DateTime FirstRunUtc { get; init; }
        public bool ForceExpired { get; init; }
    }

    private sealed class ActivateApiResponse
    {
        public bool? Ok { get; set; }
        public string? Token { get; set; }
        public string? Serial { get; set; }
        public string? Email { get; set; }
        public string? Name { get; set; }
        public string? Message { get; set; }
        public string? Error { get; set; }
    }

    private sealed class ValidateApiResponse
    {
        public bool? Ok { get; set; }
        public bool? Valid { get; set; }
        public string? Reason { get; set; }
    }

    private static TrialState ResolveTrialRecord()
    {
        var markerTicks = TryReadMarkerTicks();
        var fileTrial = TryReadTrialFile();

        if (fileTrial == null && markerTicks != null)
            return ExpiredTrialFromTicks(markerTicks.Value);

        if (fileTrial != null && !ValidateTrialIntegrity(fileTrial))
        {
            var ticks = markerTicks ?? fileTrial.FirstRunUtc.Ticks;
            PersistExpiredMarker(ticks);
            return ExpiredTrialFromTicks(ticks);
        }

        if (fileTrial != null)
        {
            var first = fileTrial.FirstRunUtc;
            if (markerTicks != null)
            {
                var markerTime = new DateTime(markerTicks.Value, DateTimeKind.Utc);
                if (markerTime < first) first = markerTime;
            }
            PersistTrial(first);
            WriteMarker(first.Ticks);
            return new TrialState { FirstRunUtc = first, ForceExpired = false };
        }

        var now = DateTime.UtcNow;
        PersistTrial(now);
        WriteMarker(now.Ticks);
        return new TrialState { FirstRunUtc = now, ForceExpired = false };
    }

    private static TrialState ExpiredTrialFromTicks(long ticks)
    {
        var first = new DateTime(ticks, DateTimeKind.Utc);
        if (first.AddDays(TrialDays) > DateTime.UtcNow)
            first = DateTime.UtcNow.AddDays(-(TrialDays + 1));
        PersistTrial(first);
        WriteMarker(first.Ticks);
        return new TrialState { FirstRunUtc = first, ForceExpired = true };
    }

    private static TrialRecord? TryReadTrialFile()
    {
        try
        {
            if (File.Exists(TrialPath))
                return ReadProtectedJson<TrialRecord>(TrialPath);
            if (File.Exists(TrialPathLegacy))
            {
                var legacy = JsonSerializer.Deserialize<TrialRecord>(File.ReadAllText(TrialPathLegacy));
                if (legacy != null && ValidateTrialIntegrity(legacy))
                {
                    PersistTrial(legacy.FirstRunUtc);
                    TryDelete(TrialPathLegacy);
                    return legacy;
                }
            }
        }
        catch { }
        return null;
    }

    private static LicenseRecord? ReadLicenseRecord()
    {
        var fromRegistry = TryReadLicenseFromRegistry();
        if (fromRegistry != null)
            return fromRegistry;

        if (File.Exists(LicensePath))
        {
            try
            {
                var fromFile = ReadProtectedJson<LicenseRecord>(LicensePath);
                if (fromFile != null && !string.IsNullOrEmpty(fromFile.Serial))
                {
                    PersistLicenseRecord(fromFile); // migrate AppData → HKCU
                    return fromFile;
                }
            }
            catch { /* fall through */ }
        }

        if (File.Exists(LicensePathLegacy))
        {
            try
            {
                var legacy = JsonSerializer.Deserialize<LicenseRecord>(File.ReadAllText(LicensePathLegacy));
                if (legacy != null && ValidateSerial(legacy.Serial))
                {
                    PersistLicenseRecord(legacy);
                    return legacy;
                }
            }
            catch { /* fall through */ }
        }

        return null;
    }

    private static void PersistLicenseRecord(LicenseRecord rec)
    {
        var json = JsonSerializer.Serialize(rec, new JsonSerializerOptions { WriteIndented = false });
        var protectedBytes = Protect(Encoding.UTF8.GetBytes(json));

        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(LicenseRegistryKeyPath, writable: true);
            key?.SetValue(LicenseRegistryValueName, protectedBytes, RegistryValueKind.Binary);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[License] Registry write failed: {ex.Message}");
            // Fall back to AppData so activation still sticks if HKCU is locked down.
            Directory.CreateDirectory(AppDataDir);
            File.WriteAllBytes(LicensePath, protectedBytes);
            return;
        }

        // Prefer registry; remove legacy AppData copies after a successful HKCU write.
        TryDelete(LicensePath);
        TryDelete(LicensePathLegacy);
    }

    private static LicenseRecord? TryReadLicenseFromRegistry()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(LicenseRegistryKeyPath, writable: false);
            if (key?.GetValue(LicenseRegistryValueName) is not byte[] protectedBytes || protectedBytes.Length == 0)
                return null;
            var json = Encoding.UTF8.GetString(Unprotect(protectedBytes));
            return JsonSerializer.Deserialize<LicenseRecord>(json);
        }
        catch
        {
            return null;
        }
    }

    private static void ClearPersistedLicense()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(LicenseRegistryKeyPath, writable: true);
            key?.DeleteValue(LicenseRegistryValueName, throwOnMissingValue: false);
        }
        catch { }

        TryDelete(LicensePath);
        TryDelete(LicensePathLegacy);
    }

    private static void PersistTrial(DateTime firstRunUtc)
    {
        var trial = new TrialRecord
        {
            FirstRunUtc = firstRunUtc,
            Integrity = SignTrial(firstRunUtc, LicenseSecret),
        };
        Directory.CreateDirectory(AppDataDir);
        WriteProtectedJson(TrialPath, trial);
        TryDelete(TrialPathLegacy);
    }

    private static void PersistExpiredMarker(long ticks) => WriteMarker(ticks);

    private static long? TryReadMarkerTicks()
    {
        try
        {
            if (!File.Exists(TrialMarkerPath)) return null;
            var bytes = Unprotect(File.ReadAllBytes(TrialMarkerPath));
            var text = Encoding.UTF8.GetString(bytes).Trim();
            if (long.TryParse(text, out var ticks) && ticks > 0) return ticks;
        }
        catch { }
        return null;
    }

    private static void WriteMarker(long ticks)
    {
        try
        {
            Directory.CreateDirectory(LocalDataDir);
            File.WriteAllBytes(TrialMarkerPath, Protect(Encoding.UTF8.GetBytes(ticks.ToString())));
        }
        catch { }
    }

    private static bool ValidateTrialIntegrity(TrialRecord trial)
    {
        if (trial.FirstRunUtc > DateTime.UtcNow.AddDays(1))
            return false;
        if (string.Equals(trial.Integrity, SignTrial(trial.FirstRunUtc, LicenseSecret), StringComparison.Ordinal))
            return true;
        var legacy = LegacyLicenseSecret;
        if (legacy != null &&
            string.Equals(trial.Integrity, SignTrial(trial.FirstRunUtc, legacy), StringComparison.Ordinal))
            return true;
        return false;
    }

    private static string SignTrial(DateTime firstRunUtc, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(firstRunUtc.Ticks.ToString()));
        return Convert.ToHexString(hash.AsSpan(0, 8));
    }

    private static bool TryParseSerial(string serial, out string payload, out string checksum)
    {
        payload = "";
        checksum = "";
        var parts = serial.Split('-');
        if (parts.Length != 4 || !string.Equals(parts[0], "BNDZ", StringComparison.OrdinalIgnoreCase))
            return false;
        for (var i = 1; i < 4; i++)
        {
            if (parts[i].Length != 4 || !parts[i].All(char.IsLetterOrDigit))
                return false;
        }
        payload = $"{parts[1]}-{parts[2]}";
        checksum = parts[3];
        return true;
    }

    private static string ComputeChecksum(string payload, string secret)
    {
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes(payload));
        const string alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        var sb = new StringBuilder(4);
        for (var i = 0; i < 4; i++)
            sb.Append(alphabet[hash[i] % alphabet.Length]);
        return sb.ToString();
    }

    private static void WriteProtectedJson<T>(string path, T value)
    {
        var json = JsonSerializer.Serialize(value, new JsonSerializerOptions { WriteIndented = false });
        File.WriteAllBytes(path, Protect(Encoding.UTF8.GetBytes(json)));
    }

    private static T? ReadProtectedJson<T>(string path)
    {
        var bytes = Unprotect(File.ReadAllBytes(path));
        var json = Encoding.UTF8.GetString(bytes);
        return JsonSerializer.Deserialize<T>(json);
    }

    private static byte[] Protect(byte[] data) =>
        ProtectedData.Protect(data, DpapiEntropy, DataProtectionScope.CurrentUser);

    private static byte[] Unprotect(byte[] data) =>
        ProtectedData.Unprotect(data, DpapiEntropy, DataProtectionScope.CurrentUser);

    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); }
        catch { }
    }

    private static string Base64UrlEncode(byte[] data) =>
        Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    private static byte[] Base64UrlDecode(string input)
    {
        var s = input.Replace('-', '+').Replace('_', '/');
        switch (s.Length % 4)
        {
            case 2: s += "=="; break;
            case 3: s += "="; break;
        }
        return Convert.FromBase64String(s);
    }
}
