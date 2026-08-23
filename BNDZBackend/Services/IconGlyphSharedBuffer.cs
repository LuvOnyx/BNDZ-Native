using System.Buffers.Binary;
using System.IO;
using System.Text;
using System.Text.Json;
using Microsoft.IO;
using Microsoft.Web.WebView2.Core;

namespace BNDZ.Services;

/// <summary>
/// Zero-copy SharedBuffer wire format for shell glyph maps (BNG1).
/// Replaces the large JSON envelope that base64-encodes icon PNGs inline.
///
/// Layout (little-endian), magic "BNG1":
///   u32 magic | u16 version | u32 count
///   repeated entry:
///     u16 keyLen  + utf8 key   (e.g. ".pdf", "__folder__")
///     u32 valLen  + utf8 base64-PNG value (no "data:" prefix)
/// </summary>
public static class IconGlyphSharedBuffer
{
    public const uint Magic = 0x31474E42;   // 'BNG1' LE
    public const ushort Version = 1;

    private static readonly RecyclableMemoryStreamManager StreamPool = new();

    /// <summary>
    /// Posts glyph map via SharedBuffer. Returns false if SharedBuffer is unavailable
    /// (caller should fall back to JSON).
    /// </summary>
    public static bool TryPost(
        CoreWebView2Environment environment,
        CoreWebView2 webView,
        string responseType,
        string? requestId,
        string folderPath,
        IReadOnlyDictionary<string, string> glyphs)
    {
        if (glyphs.Count == 0) return true; // nothing to post

        try
        {
            using var encoded = StreamPool.GetStream("bndz-glyph-map-post");
            EncodeTo(encoded, glyphs);
            var len = (int)encoded.Length;
            using var buffer = environment.CreateSharedBuffer((ulong)Math.Max(1, len));
            using (var stream = buffer.OpenStream())
            {
                encoded.Position = 0;
                encoded.CopyTo(stream);
                stream.Flush();
            }

            var metaObj = new Dictionary<string, object?>
            {
                ["type"] = responseType,
                ["id"] = requestId ?? "",
                ["format"] = "bng1",
                ["count"] = glyphs.Count,
                ["path"] = folderPath.Replace('\\', '/'),
            };
            var meta = JsonSerializer.Serialize(metaObj);
            webView.PostSharedBufferToScript(buffer, CoreWebView2SharedBufferAccess.ReadOnly, meta);
            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[IconGlyphSharedBuffer] Post failed: {ex.Message}");
            return false;
        }
    }

    public static byte[] Encode(IReadOnlyDictionary<string, string> glyphs)
    {
        using var ms = StreamPool.GetStream("bndz-glyph-map");
        EncodeTo(ms, glyphs);
        return ms.ToArray();
    }

    private static void EncodeTo(Stream ms, IReadOnlyDictionary<string, string> glyphs)
    {
        Span<byte> hdr = stackalloc byte[10];
        BinaryPrimitives.WriteUInt32LittleEndian(hdr, Magic);
        BinaryPrimitives.WriteUInt16LittleEndian(hdr[4..], Version);
        BinaryPrimitives.WriteUInt32LittleEndian(hdr[6..], (uint)glyphs.Count);
        ms.Write(hdr);

        Span<byte> lenBuf2 = stackalloc byte[2];
        Span<byte> lenBuf4 = stackalloc byte[4];

        foreach (var (key, val) in glyphs)
        {
            var keyBytes = Encoding.UTF8.GetBytes(key ?? "");
            var valBytes = Encoding.UTF8.GetBytes(val ?? "");

            BinaryPrimitives.WriteUInt16LittleEndian(lenBuf2, (ushort)Math.Min(keyBytes.Length, ushort.MaxValue));
            ms.Write(lenBuf2);
            if (keyBytes.Length > 0) ms.Write(keyBytes, 0, Math.Min(keyBytes.Length, ushort.MaxValue));

            BinaryPrimitives.WriteUInt32LittleEndian(lenBuf4, (uint)valBytes.Length);
            ms.Write(lenBuf4);
            if (valBytes.Length > 0) ms.Write(valBytes);
        }
    }
}
