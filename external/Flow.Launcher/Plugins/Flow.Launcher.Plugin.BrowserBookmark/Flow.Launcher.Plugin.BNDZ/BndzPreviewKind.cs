using System;
using System.Collections.Generic;
using System.IO;

namespace Flow.Launcher.Plugin.BNDZ;

/// <summary>Lightweight preview-kind inference for launcher IPC (mirrors BNDZ FilePreviewMetaService).</summary>
internal static class BndzPreviewKind
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
    };

    private static readonly HashSet<string> ArchiveExtensions = new(StringComparer.OrdinalIgnoreCase)
    {
        ".zip", ".rar", ".7z", ".tar", ".gz", ".bz2", ".xz", ".tgz", ".tbz", ".cab", ".iso",
    };

    public static string Infer(string path)
    {
        if (Directory.Exists(path)) return "folder";
        if (!File.Exists(path)) return "unknown";

        var ext = Path.GetExtension(path);
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
}
