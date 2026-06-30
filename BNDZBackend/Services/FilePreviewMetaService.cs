using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;

namespace BNDZ.Services;

public static class FilePreviewMetaService
{
    private static readonly HashSet<string> TextExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".txt", ".md", ".markdown", ".json", ".xml", ".csv", ".yaml", ".yml", ".ini", ".cfg", ".conf",
        ".log", ".rtf", ".toml",
    };

    private static readonly HashSet<string> CodeExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".js", ".ts", ".tsx", ".jsx", ".cs", ".cpp", ".c", ".h", ".hpp", ".java", ".py", ".rb", ".go",
        ".rs", ".php", ".sql", ".sh", ".bat", ".ps1", ".css", ".scss", ".less", ".html", ".htm", ".vue",
        ".swift", ".kt", ".lua", ".r", ".m", ".mm", ".dart", ".fs", ".vb", ".asm", ".s", ".pl", ".pm",
    };

    private static readonly HashSet<string> ArchiveExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".tgz", ".tbz", ".cab", ".iso",
    };

    private static readonly HashSet<string> ColorExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".folcolor", ".desktop.ini",
    };

    public sealed class PreviewMetaDto
    {
        public string path { get; set; } = "";
        public string kind { get; set; } = "unknown";
        public string name { get; set; } = "";
        public string extension { get; set; } = "";
        public long size { get; set; }
        public string sizeLabel { get; set; } = "";
        public string modified { get; set; } = "";
        public string created { get; set; } = "";
        public string contentType { get; set; } = "";
        public int? width { get; set; }
        public int? height { get; set; }
        public int? archiveEntryCount { get; set; }
        public int? folderItemCount { get; set; }
        public Dictionary<string, string> fields { get; set; } = new();
    }

    public static PreviewMetaDto Build(string? path)
    {
        var meta = new PreviewMetaDto { path = path ?? "" };
        if (string.IsNullOrWhiteSpace(path)) return meta;

        try
        {
            path = Path.GetFullPath(path);
            meta.path = path;
            meta.name = Path.GetFileName(path);
            meta.extension = Path.GetExtension(path);
            meta.kind = InferKind(path);
            meta.contentType = LocalStreamService.GetContentType(path);

            if (Directory.Exists(path))
            {
                var di = new DirectoryInfo(path);
                meta.size = 0;
                meta.sizeLabel = "—";
                meta.modified = di.LastWriteTime.ToString("g");
                meta.created = di.CreationTime.ToString("g");
                try { meta.folderItemCount = di.EnumerateFileSystemInfos().Take(10000).Count(); } catch { }
                meta.fields["Location"] = di.Parent?.FullName ?? "";
                meta.fields["Items"] = meta.folderItemCount?.ToString() ?? "—";
                return meta;
            }

            if (!File.Exists(path)) return meta;

            var fi = new FileInfo(path);
            meta.size = fi.Length;
            meta.sizeLabel = FormatSize(fi.Length);
            meta.modified = fi.LastWriteTime.ToString("g");
            meta.created = fi.CreationTime.ToString("g");
            meta.fields["Location"] = fi.DirectoryName ?? "";
            meta.fields["Content type"] = meta.contentType;
            meta.fields["Size"] = meta.sizeLabel;

            if (meta.kind == "archive" && meta.extension.Equals(".zip", StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    using var zip = ZipFile.OpenRead(path);
                    meta.archiveEntryCount = zip.Entries.Count;
                    meta.fields["Entries"] = meta.archiveEntryCount.ToString() ?? "0";
                }
                catch { }
            }

            if (meta.kind == "image")
            {
                TryReadImageDimensions(path, meta);
            }
        }
        catch { }

        return meta;
    }

    public static string InferKind(string path)
    {
        if (Directory.Exists(path)) return "folder";
        if (!File.Exists(path)) return "unknown";

        var ext = Path.GetExtension(path);
        if (ColorExtensions.Contains(ext)) return "color";
        if (ArchiveExtensions.Contains(ext)) return "archive";
        if (ext.Equals(".pdf", StringComparison.OrdinalIgnoreCase)) return "pdf";
        if (IsImageExt(ext)) return "image";
        if (IsVideoExt(ext)) return "video";
        if (IsAudioExt(ext)) return "audio";
        if (CodeExtensions.Contains(ext)) return "code";
        if (TextExtensions.Contains(ext)) return "text";
        if (ext.Equals(".exe", StringComparison.OrdinalIgnoreCase) || ext.Equals(".lnk", StringComparison.OrdinalIgnoreCase))
            return "app";
        return "unknown";
    }

    private static bool IsImageExt(string ext) => ext.ToLowerInvariant() switch
    {
        ".jpg" or ".jpeg" or ".png" or ".gif" or ".bmp" or ".webp" or ".ico" or ".tif" or ".tiff"
            or ".avif" or ".heic" or ".heif" or ".svg" => true,
        _ => false,
    };

    private static bool IsVideoExt(string ext) => ext.ToLowerInvariant() switch
    {
        ".mp4" or ".mkv" or ".avi" or ".mov" or ".webm" or ".wmv" or ".m4v" or ".mpg" or ".mpeg" => true,
        _ => false,
    };

    private static bool IsAudioExt(string ext) => ext.ToLowerInvariant() switch
    {
        ".mp3" or ".wav" or ".ogg" or ".flac" or ".m4a" or ".aac" or ".wma" or ".opus" => true,
        _ => false,
    };

    private static string FormatSize(long bytes)
    {
        string[] units = { "B", "KB", "MB", "GB", "TB" };
        double size = bytes;
        int unit = 0;
        while (size >= 1024 && unit < units.Length - 1)
        {
            size /= 1024;
            unit++;
        }
        return unit == 0 ? $"{bytes} B" : $"{size:0.##} {units[unit]}";
    }

    private static void TryReadImageDimensions(string path, PreviewMetaDto meta)
    {
        try
        {
            using var fs = File.OpenRead(path);
            if (!TryReadImageSize(fs, out var w, out var h)) return;
            meta.width = w;
            meta.height = h;
            meta.fields["Dimensions"] = $"{w} × {h}";
        }
        catch { }
    }

    // Minimal PNG/JPEG/GIF dimension reader — avoids System.Drawing dependency
    private static bool TryReadImageSize(Stream stream, out int width, out int height)
    {
        width = height = 0;
        Span<byte> header = stackalloc byte[24];
        if (stream.Read(header) < 10) return false;

        // PNG
        if (header[0] == 0x89 && header[1] == 0x50 && header[2] == 0x4E && header[3] == 0x47)
        {
            width = (header[16] << 24) | (header[17] << 16) | (header[18] << 8) | header[19];
            height = (header[20] << 24) | (header[21] << 16) | (header[22] << 8) | header[23];
            return width > 0 && height > 0;
        }

        // GIF
        if (header[0] == 0x47 && header[1] == 0x49 && header[2] == 0x46)
        {
            width = header[6] | (header[7] << 8);
            height = header[8] | (header[9] << 8);
            return width > 0 && height > 0;
        }

        // JPEG — scan for SOF marker
        if (header[0] == 0xFF && header[1] == 0xD8)
        {
            stream.Position = 2;
            var buf = new byte[2];
            while (stream.Read(buf, 0, 2) == 2)
            {
                if (buf[0] != 0xFF) break;
                byte marker = buf[1];
                if (marker is 0xC0 or 0xC1 or 0xC2 or 0xC3 or 0xC5 or 0xC6 or 0xC7 or 0xC9 or 0xCA or 0xCB or 0xCD or 0xCE or 0xCF)
                {
                    var segment = new byte[7];
                    if (stream.Read(segment, 0, 7) < 7) return false;
                    height = (segment[3] << 8) | segment[4];
                    width = (segment[5] << 8) | segment[6];
                    return width > 0 && height > 0;
                }
                if (marker == 0xD9) break;
                if (stream.Read(buf, 0, 2) != 2) break;
                int len = (buf[0] << 8) | buf[1];
                if (len < 2) break;
                stream.Seek(len - 2, SeekOrigin.Current);
            }
        }

        return false;
    }
}
