using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BNDZ.Services.MeshDrop;

/// <summary>Zero-server pairing codes — compress SDP + session metadata into copy-paste Mesh Codes.</summary>
public static class MeshDropSignaling
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    public sealed class OfferPayload
    {
        public string V { get; set; } = "1";
        public string SessionId { get; set; } = "";
        public string HostName { get; set; } = "";
        public string Sdp { get; set; } = "";
        public string Fingerprint { get; set; } = "";
        public string HostKeyFingerprint { get; set; } = "";
        public string OneTimeToken { get; set; } = "";
        public long ExpiresUtc { get; set; }
        public int FileCount { get; set; }
        public long TotalBytes { get; set; }
        public string Label { get; set; } = "";
    }

    public sealed class AnswerPayload
    {
        public string V { get; set; } = "1";
        public string SessionId { get; set; } = "";
        public string ReceiverName { get; set; } = "";
        public string Sdp { get; set; } = "";
        public string Fingerprint { get; set; } = "";
        public string OneTimeToken { get; set; } = "";
    }

    public static string EncodeOffer(OfferPayload payload)
    {
        var json = JsonSerializer.Serialize(payload, JsonOpts);
        return Encode(json);
    }

    public static string EncodeAnswer(AnswerPayload payload)
    {
        var json = JsonSerializer.Serialize(payload, JsonOpts);
        return Encode(json);
    }

    public static OfferPayload? DecodeOffer(string code)
    {
        var json = Decode(code);
        if (json == null) return null;
        try { return JsonSerializer.Deserialize<OfferPayload>(json, JsonOpts); }
        catch { return null; }
    }

    public static AnswerPayload? DecodeAnswer(string code)
    {
        var json = Decode(code);
        if (json == null) return null;
        try { return JsonSerializer.Deserialize<AnswerPayload>(json, JsonOpts); }
        catch { return null; }
    }

    public static string ComputeFingerprint(string sdp)
    {
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(sdp));
        return Convert.ToHexString(hash)[..16].ToLowerInvariant();
    }

    private static string Encode(string json)
    {
        var raw = Encoding.UTF8.GetBytes(json);
        using var ms = new MemoryStream();
        using (var gz = new GZipStream(ms, CompressionLevel.SmallestSize, leaveOpen: true))
            gz.Write(raw, 0, raw.Length);
        return "BNDZMD:" + Convert.ToBase64String(ms.ToArray())
            .TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    private static string? Decode(string code)
    {
        if (string.IsNullOrWhiteSpace(code)) return null;
        code = code.Trim();
        if (code.StartsWith("BNDZMD:", StringComparison.OrdinalIgnoreCase))
            code = code[7..];
        code = code.Replace('-', '+').Replace('_', '/');
        switch (code.Length % 4)
        {
            case 2: code += "=="; break;
            case 3: code += "="; break;
        }
        try
        {
            var compressed = Convert.FromBase64String(code);
            using var input = new MemoryStream(compressed);
            using var gz = new GZipStream(input, CompressionMode.Decompress);
            using var output = new MemoryStream();
            gz.CopyTo(output);
            return Encoding.UTF8.GetString(output.ToArray());
        }
        catch { return null; }
    }
}
