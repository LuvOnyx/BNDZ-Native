using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BNDZ.Services.MeshDrop;

/// <summary>
/// Ephemeral Mesh Drop session credentials — X25519-style ECDH key material
/// wrapped with DPAPI (CurrentUser). One-time tokens bind offer ↔ answer.
/// </summary>
public static class MeshDropCredentialVault
{
    private static readonly object Gate = new();
    private static readonly Dictionary<string, SessionCredential> Sessions = new(StringComparer.Ordinal);

    public sealed class SessionCredential
    {
        public string SessionId { get; init; } = "";
        public string PublicKeyB64 { get; init; } = "";
        public string Fingerprint { get; init; } = "";
        public string OneTimeToken { get; init; } = "";
        public byte[] ProtectedPrivateKey { get; init; } = [];
        public long ExpiresUtc { get; init; }
        public bool TokenConsumed { get; set; }
    }

    public static SessionCredential CreateEphemeral(string sessionId, TimeSpan? ttl = null)
    {
        using var ecdh = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
        var pub = ecdh.PublicKey.ExportSubjectPublicKeyInfo();
        var priv = ecdh.ExportPkcs8PrivateKey();
        var fingerprint = Convert.ToHexString(SHA256.HashData(pub))[..16].ToLowerInvariant();
        var tokenBytes = RandomNumberGenerator.GetBytes(24);
        var token = Convert.ToBase64String(tokenBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');

        var cred = new SessionCredential
        {
            SessionId = sessionId,
            PublicKeyB64 = Convert.ToBase64String(pub),
            Fingerprint = fingerprint,
            OneTimeToken = token,
            ProtectedPrivateKey = ProtectedData.Protect(priv, Encoding.UTF8.GetBytes(sessionId), DataProtectionScope.CurrentUser),
            ExpiresUtc = DateTimeOffset.UtcNow.Add(ttl ?? TimeSpan.FromHours(2)).ToUnixTimeSeconds(),
        };

        lock (Gate)
        {
            PurgeExpired();
            Sessions[sessionId] = cred;
        }
        return cred;
    }

    public static SessionCredential? Get(string sessionId)
    {
        lock (Gate)
        {
            PurgeExpired();
            return Sessions.TryGetValue(sessionId, out var c) ? c : null;
        }
    }

    /// <summary>Validate and consume a one-time token. Returns false if missing, expired, or already used.</summary>
    public static bool TryConsumeToken(string sessionId, string? token)
    {
        if (string.IsNullOrWhiteSpace(token)) return false;
        lock (Gate)
        {
            PurgeExpired();
            if (!Sessions.TryGetValue(sessionId, out var cred)) return false;
            if (cred.TokenConsumed) return false;
            if (!string.Equals(cred.OneTimeToken, token.Trim(), StringComparison.Ordinal)) return false;
            cred.TokenConsumed = true;
            return true;
        }
    }

    public static byte[]? UnprotectPrivateKey(string sessionId)
    {
        lock (Gate)
        {
            if (!Sessions.TryGetValue(sessionId, out var cred)) return null;
            try
            {
                return ProtectedData.Unprotect(cred.ProtectedPrivateKey, Encoding.UTF8.GetBytes(sessionId), DataProtectionScope.CurrentUser);
            }
            catch
            {
                return null;
            }
        }
    }

    public static void Forget(string sessionId)
    {
        lock (Gate) Sessions.Remove(sessionId);
    }

    public static string ExportPublicBundle(SessionCredential cred)
        => JsonSerializer.Serialize(new
        {
            sessionId = cred.SessionId,
            fingerprint = cred.Fingerprint,
            publicKey = cred.PublicKeyB64,
            token = cred.OneTimeToken,
            expiresUtc = cred.ExpiresUtc,
        });

    private static void PurgeExpired()
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        foreach (var id in Sessions.Where(kv => kv.Value.ExpiresUtc < now).Select(kv => kv.Key).ToList())
            Sessions.Remove(id);
    }
}
