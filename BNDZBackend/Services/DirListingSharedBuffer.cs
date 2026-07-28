using System.Buffers.Binary;
using System.Text;
using System.Text.Json;
using Microsoft.IO;
using Microsoft.Web.WebView2.Core;

namespace BNDZ.Services;

/// <summary>
/// High-speed directory listing wire format for WebView2 SharedBuffer handoff.
/// Avoids JSON IPC entirely — host writes a compact binary blob into shared memory;
/// React decodes the ArrayBuffer in place.
///
/// Layout (little-endian), magic "BND1":
///   u32 magic | u16 version | u32 count
///   repeated entry:
///     u8 type (1=file, 2=directory)
///     u8 attrBits
///     i64 size | i64 modifiedUtcTicks | i64 createdUtcTicks
///     u16 nameLen | u16 pathLen | u16 extLen | u16 labelLen | u16 commentLen | u16 tagCount
///     utf8 name | path | extension | label | comment
///     tagCount × (u16 len + utf8)
/// </summary>
public static class DirListingSharedBuffer
{
    public const uint Magic = 0x31444E42; // 'BND1' LE
    public const ushort Version = 1;
    public const byte TypeFile = 1;
    public const byte TypeDirectory = 2;

    public const byte AttrHidden = 1 << 0;
    public const byte AttrSystem = 1 << 1;
    public const byte AttrReadOnly = 1 << 2;
    public const byte AttrArchive = 1 << 3;
    public const byte AttrCompressed = 1 << 4;
    public const byte AttrEncrypted = 1 << 5;
    public const byte AttrReparse = 1 << 6;
    public const byte AttrShellItem = 1 << 7;

    private static readonly RecyclableMemoryStreamManager StreamPool = new();

    public sealed class DirEntryDto
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string Type { get; set; } = "file";
        public string Path { get; set; } = "";
        public long Size { get; set; }
        public string Extension { get; set; } = "";
        public DateTimeOffset ModifiedUtc { get; set; }
        public DateTimeOffset CreatedUtc { get; set; }
        public byte AttrBits { get; set; }
        public string? Label { get; set; }
        public string? Comment { get; set; }
        public List<string>? Tags { get; set; }
        public bool IsShellItem { get; set; }
    }

    public static byte AttrBitsFrom(FileAttributes attributes)
    {
        byte bits = 0;
        if (attributes.HasFlag(FileAttributes.Hidden)) bits |= AttrHidden;
        if (attributes.HasFlag(FileAttributes.System)) bits |= AttrSystem;
        if (attributes.HasFlag(FileAttributes.ReadOnly)) bits |= AttrReadOnly;
        if (attributes.HasFlag(FileAttributes.Archive)) bits |= AttrArchive;
        if (attributes.HasFlag(FileAttributes.Compressed)) bits |= AttrCompressed;
        if (attributes.HasFlag(FileAttributes.Encrypted)) bits |= AttrEncrypted;
        if (attributes.HasFlag(FileAttributes.ReparsePoint)) bits |= AttrReparse;
        return bits;
    }

    public static string[] AttrNamesFrom(byte bits)
    {
        if (bits == 0) return Array.Empty<string>();
        var list = new List<string>(4);
        if ((bits & AttrHidden) != 0) list.Add("hidden");
        if ((bits & AttrSystem) != 0) list.Add("system");
        if ((bits & AttrReadOnly) != 0) list.Add("readonly");
        if ((bits & AttrArchive) != 0) list.Add("archive");
        if ((bits & AttrCompressed) != 0) list.Add("compressed");
        if ((bits & AttrEncrypted) != 0) list.Add("encrypted");
        if ((bits & AttrReparse) != 0) list.Add("reparse");
        return list.ToArray();
    }

    public static DirEntryDto FromFileSystemInfo(FileSystemInfo info, bool isDir)
    {
        var path = info.FullName.Replace('\\', '/');
        var name = info.Name;
        var ext = isDir ? "" : (info.Extension.StartsWith('.') ? info.Extension[1..] : info.Extension).ToLowerInvariant();
        return new DirEntryDto
        {
            Id = path,
            Name = name,
            Type = isDir ? "directory" : "file",
            Path = path,
            Size = isDir ? 0L : (info is FileInfo fi ? fi.Length : 0L),
            Extension = ext,
            ModifiedUtc = info.LastWriteTimeUtc,
            CreatedUtc = info.CreationTimeUtc,
            AttrBits = AttrBitsFrom(info.Attributes),
        };
    }

    public static DirEntryDto FromShellChild(ShellChildItem item)
    {
        var path = (item.Path ?? "").Replace('\\', '/');
        DateTimeOffset modified = DateTimeOffset.UtcNow;
        if (!string.IsNullOrEmpty(item.Modified) && DateTimeOffset.TryParse(item.Modified, out var parsed))
            modified = parsed.ToUniversalTime();
        return new DirEntryDto
        {
            Id = string.IsNullOrEmpty(item.Id) ? path : item.Id.Replace('\\', '/'),
            Name = item.Name ?? "",
            Type = item.Type ?? "file",
            Path = path,
            Size = item.Size,
            Extension = item.Extension ?? "",
            ModifiedUtc = modified,
            CreatedUtc = modified,
            IsShellItem = item.IsShellItem,
            AttrBits = item.IsShellItem ? AttrShellItem : (byte)0,
        };
    }

    public static DirEntryDto FromLegacyObject(object item)
    {
        if (item is DirEntryDto dto) return dto;
        if (item is ShellChildItem sci) return FromShellChild(sci);

        // Anonymous / dictionary-like via reflection-free JSON fallback only when needed.
        // Prefer typed paths above.
        var json = System.Text.Json.JsonSerializer.Serialize(item);
        using var doc = System.Text.Json.JsonDocument.Parse(json);
        var root = doc.RootElement;
        string GetStr(string a, string b = "")
        {
            if (root.TryGetProperty(a, out var e) && e.ValueKind == JsonValueKind.String) return e.GetString() ?? "";
            if (!string.IsNullOrEmpty(b) && root.TryGetProperty(b, out e) && e.ValueKind == JsonValueKind.String) return e.GetString() ?? "";
            return "";
        }
        long GetLong(string a)
        {
            if (!root.TryGetProperty(a, out var e)) return 0;
            if (e.ValueKind == JsonValueKind.Number && e.TryGetInt64(out var n)) return n;
            return 0;
        }
        var path = GetStr("path", "Path").Replace('\\', '/');
        var type = GetStr("type", "Type");
        if (string.IsNullOrEmpty(type)) type = "file";
        var modifiedRaw = GetStr("modified", "Modified");
        DateTimeOffset modified = DateTimeOffset.UtcNow;
        if (!string.IsNullOrEmpty(modifiedRaw) && DateTimeOffset.TryParse(modifiedRaw, out var m))
            modified = m.ToUniversalTime();
        var createdRaw = GetStr("created", "Created");
        DateTimeOffset created = modified;
        if (!string.IsNullOrEmpty(createdRaw) && DateTimeOffset.TryParse(createdRaw, out var c))
            created = c.ToUniversalTime();

        byte attrBits = 0;
        if (root.TryGetProperty("attributes", out var attrs) && attrs.ValueKind == JsonValueKind.Array)
        {
            foreach (var a in attrs.EnumerateArray())
            {
                var s = a.GetString()?.ToLowerInvariant();
                attrBits |= s switch
                {
                    "hidden" => AttrHidden,
                    "system" => AttrSystem,
                    "readonly" => AttrReadOnly,
                    "archive" => AttrArchive,
                    "compressed" => AttrCompressed,
                    "encrypted" => AttrEncrypted,
                    "reparse" => AttrReparse,
                    _ => (byte)0,
                };
            }
        }

        var isShell = root.TryGetProperty("isShellItem", out var sh) && sh.ValueKind == JsonValueKind.True
            || root.TryGetProperty("IsShellItem", out sh) && sh.ValueKind == JsonValueKind.True;
        if (isShell) attrBits |= AttrShellItem;

        return new DirEntryDto
        {
            Id = GetStr("id", "Id").Replace('\\', '/') is { Length: > 0 } id ? id : path,
            Name = GetStr("name", "Name"),
            Type = type,
            Path = path,
            Size = GetLong("size") != 0 ? GetLong("size") : GetLong("Size"),
            Extension = GetStr("extension", "Extension"),
            ModifiedUtc = modified,
            CreatedUtc = created,
            AttrBits = attrBits,
            IsShellItem = isShell,
        };
    }

    public static void EnrichWithTags(List<DirEntryDto> entries, BndzTagSidecarStore store)
    {
        foreach (var e in entries)
        {
            var lookup = !string.IsNullOrEmpty(e.Path) ? e.Path : e.Id;
            if (string.IsNullOrEmpty(lookup)) continue;
            var side = store.Get(lookup);
            if (side == null) continue;
            if (side.Tags.Count > 0) e.Tags = side.Tags.ToList();
            if (!string.IsNullOrWhiteSpace(side.Label)) e.Label = side.Label;
            if (!string.IsNullOrWhiteSpace(side.Comment)) e.Comment = side.Comment;
        }
    }

    /// <summary>
    /// Posts directory listing via SharedBuffer. Returns false if SharedBuffer is unavailable
    /// (caller should fall back to JSON).
    /// </summary>
    public static bool TryPost(
        CoreWebView2Environment environment,
        CoreWebView2 webView,
        string responseType,
        string? requestId,
        IReadOnlyList<DirEntryDto> entries,
        string? folderPath = null,
        bool partial = false)
    {
        try
        {
            using var encoded = StreamPool.GetStream("bndz-dir-listing-post");
            EncodeTo(encoded, entries);
            var len = (int)encoded.Length;
            using var buffer = environment.CreateSharedBuffer((ulong)Math.Max(1, len));
            using (var stream = buffer.OpenStream())
            {
                encoded.Position = 0;
                encoded.CopyTo(stream);
                stream.Flush();
            }

            // Tiny JSON envelope only — payload lives in shared memory.
            var metaObj = new Dictionary<string, object?>
            {
                ["type"] = responseType,
                ["id"] = requestId ?? "",
                ["format"] = "bnd1",
                ["count"] = entries.Count,
                ["partial"] = partial,
            };
            if (!string.IsNullOrEmpty(folderPath))
                metaObj["path"] = folderPath.Replace('\\', '/');
            var meta = JsonSerializer.Serialize(metaObj);
            webView.PostSharedBufferToScript(buffer, CoreWebView2SharedBufferAccess.ReadOnly, meta);
            return true;
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[DirListingSharedBuffer] Post failed: {ex.Message}");
            return false;
        }
    }

    public const int FirstPaintPageSize = 64;
    public const int StreamChunkSize = 160;

    public static byte[] Encode(IReadOnlyList<DirEntryDto> entries)
    {
        using var ms = StreamPool.GetStream("bndz-dir-listing");
        EncodeTo(ms, entries);
        return ms.ToArray();
    }

    private static void EncodeTo(Stream ms, IReadOnlyList<DirEntryDto> entries)
    {
        Span<byte> hdr = stackalloc byte[10];
        BinaryPrimitives.WriteUInt32LittleEndian(hdr, Magic);
        BinaryPrimitives.WriteUInt16LittleEndian(hdr[4..], Version);
        BinaryPrimitives.WriteUInt32LittleEndian(hdr[6..], (uint)entries.Count);
        ms.Write(hdr);

        Span<byte> fixedHdr = stackalloc byte[38];
        Span<byte> tagLenHdr = stackalloc byte[2];
        foreach (var e in entries)
        {
            var name = Encoding.UTF8.GetBytes(e.Name ?? "");
            var path = Encoding.UTF8.GetBytes(e.Path ?? "");
            var ext = Encoding.UTF8.GetBytes(e.Extension ?? "");
            var label = Encoding.UTF8.GetBytes(e.Label ?? "");
            var comment = Encoding.UTF8.GetBytes(e.Comment ?? "");
            var tags = e.Tags ?? (IReadOnlyList<string>)Array.Empty<string>();

            var attr = e.AttrBits;
            if (e.IsShellItem) attr |= AttrShellItem;

            fixedHdr[0] = e.Type == "directory" ? TypeDirectory : TypeFile;
            fixedHdr[1] = attr;
            BinaryPrimitives.WriteInt64LittleEndian(fixedHdr[2..], e.Size);
            BinaryPrimitives.WriteInt64LittleEndian(fixedHdr[10..], e.ModifiedUtc.UtcTicks);
            BinaryPrimitives.WriteInt64LittleEndian(fixedHdr[18..], e.CreatedUtc.UtcTicks);
            BinaryPrimitives.WriteUInt16LittleEndian(fixedHdr[26..], (ushort)Math.Min(name.Length, ushort.MaxValue));
            BinaryPrimitives.WriteUInt16LittleEndian(fixedHdr[28..], (ushort)Math.Min(path.Length, ushort.MaxValue));
            BinaryPrimitives.WriteUInt16LittleEndian(fixedHdr[30..], (ushort)Math.Min(ext.Length, ushort.MaxValue));
            BinaryPrimitives.WriteUInt16LittleEndian(fixedHdr[32..], (ushort)Math.Min(label.Length, ushort.MaxValue));
            BinaryPrimitives.WriteUInt16LittleEndian(fixedHdr[34..], (ushort)Math.Min(comment.Length, ushort.MaxValue));
            BinaryPrimitives.WriteUInt16LittleEndian(fixedHdr[36..], (ushort)Math.Min(tags.Count, ushort.MaxValue));
            ms.Write(fixedHdr);

            WriteUtf8(ms, name);
            WriteUtf8(ms, path);
            WriteUtf8(ms, ext);
            WriteUtf8(ms, label);
            WriteUtf8(ms, comment);
            foreach (var tag in tags)
            {
                var tb = Encoding.UTF8.GetBytes(tag ?? "");
                BinaryPrimitives.WriteUInt16LittleEndian(tagLenHdr, (ushort)Math.Min(tb.Length, ushort.MaxValue));
                ms.Write(tagLenHdr);
                WriteUtf8(ms, tb);
            }
        }
    }

    private static void WriteUtf8(Stream ms, byte[] bytes)
    {
        if (bytes.Length == 0) return;
        var len = Math.Min(bytes.Length, ushort.MaxValue);
        ms.Write(bytes, 0, len);
    }
}
