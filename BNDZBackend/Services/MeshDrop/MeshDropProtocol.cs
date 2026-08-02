using System.Buffers.Binary;
using System.IO.Hashing;
using System.Text;
using System.Text.Json;

namespace BNDZ.Services.MeshDrop;

/// <summary>Chunked file transfer frames over a WebRTC data channel.</summary>
public static class MeshDropProtocol
{
    public const int ChunkSize = 256 * 1024;
    public const string ManifestType = "manifest";
    public const string ChunkType = "chunk";
    public const string CompleteType = "complete";
    public const string AckType = "ack";

    public static byte[] BuildManifestFrame(MeshDropManifest manifest)
    {
        var json = JsonSerializer.Serialize(manifest, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });
        return BuildFrame(ManifestType, Encoding.UTF8.GetBytes(json));
    }

    public static byte[] BuildChunkFrame(string relativePath, int chunkIndex, ReadOnlySpan<byte> data)
    {
        var pathBytes = Encoding.UTF8.GetBytes(relativePath);
        var payload = new byte[4 + pathBytes.Length + 4 + data.Length];
        BinaryPrimitives.WriteInt32LittleEndian(payload.AsSpan(0, 4), pathBytes.Length);
        pathBytes.CopyTo(payload, 4);
        BinaryPrimitives.WriteInt32LittleEndian(payload.AsSpan(4 + pathBytes.Length, 4), chunkIndex);
        data.CopyTo(payload.AsSpan(4 + pathBytes.Length + 4, data.Length));
        return BuildFrame(ChunkType, payload);
    }

    public static byte[] BuildCompleteFrame()
        => BuildFrame(CompleteType, Array.Empty<byte>());

    public static byte[] BuildAckFrame(string relativePath, bool ok)
    {
        var pathBytes = Encoding.UTF8.GetBytes(relativePath);
        var payload = new byte[pathBytes.Length + 1];
        pathBytes.CopyTo(payload.AsSpan());
        payload[^1] = (byte)(ok ? 1 : 0);
        return BuildFrame(AckType, payload);
    }

    public static bool TryParseFrame(ReadOnlySpan<byte> buffer, out string type, out byte[] payload, out int consumed)
    {
        type = "";
        payload = Array.Empty<byte>();
        consumed = 0;
        if (buffer.Length < 8) return false;

        var typeLen = BinaryPrimitives.ReadInt32LittleEndian(buffer);
        if (typeLen < 0 || typeLen > 64 || buffer.Length < 8 + typeLen) return false;
        type = Encoding.UTF8.GetString(buffer.Slice(4, typeLen));

        var payloadLen = BinaryPrimitives.ReadInt32LittleEndian(buffer.Slice(4 + typeLen));
        if (payloadLen < 0 || buffer.Length < 8 + typeLen + payloadLen) return false;

        payload = buffer.Slice(8 + typeLen, payloadLen).ToArray();
        consumed = 8 + typeLen + payloadLen;
        return true;
    }

    public static string ComputeSha256(string filePath)
    {
        using var sha = System.Security.Cryptography.SHA256.Create();
        using var fs = File.OpenRead(filePath);
        var hash = sha.ComputeHash(fs);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public static string ComputeSha256Bytes(ReadOnlySpan<byte> data)
    {
        var hash = System.Security.Cryptography.SHA256.HashData(data);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    private static byte[] BuildFrame(string type, ReadOnlySpan<byte> payload)
    {
        var typeBytes = Encoding.UTF8.GetBytes(type);
        var frame = new byte[8 + typeBytes.Length + payload.Length];
        BinaryPrimitives.WriteInt32LittleEndian(frame.AsSpan(0, 4), typeBytes.Length);
        typeBytes.CopyTo(frame.AsSpan(4));
        BinaryPrimitives.WriteInt32LittleEndian(frame.AsSpan(4 + typeBytes.Length, 4), payload.Length);
        payload.CopyTo(frame.AsSpan(8 + typeBytes.Length));
        return frame;
    }
}
