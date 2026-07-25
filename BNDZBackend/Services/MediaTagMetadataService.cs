using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using MetadataExtractor;
using MetadataExtractor.Formats.Exif;
using TagLib;
using TagFile = TagLib.File;

namespace BNDZ.Services;

/// <summary>
/// Deep media metadata via TagLib# + MetadataExtractor — supplements Windows Property System.
/// </summary>
public static class MediaTagMetadataService
{
    private static readonly HashSet<string> TagLibExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".mp3", ".flac", ".m4a", ".aac", ".ogg", ".wav", ".wma", ".opus", ".aiff", ".ape",
        ".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v", ".wmv",
        ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp",
    };

    public static void Enrich(Dictionary<string, string> meta, string filePath)
    {
        if (meta == null || string.IsNullOrWhiteSpace(filePath) || !System.IO.File.Exists(filePath))
            return;

        try
        {
            EnrichTagLib(meta, filePath);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[TagLib] {ex.Message}");
        }

        try
        {
            EnrichExif(meta, filePath);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Exif] {ex.Message}");
        }
    }

    private static void EnrichTagLib(Dictionary<string, string> meta, string filePath)
    {
        if (!TagLibExts.Contains(Path.GetExtension(filePath)))
            return;

        using var file = TagFile.Create(filePath);
        var tag = file.Tag;
        SetIfEmpty(meta, "Title", tag.Title);
        SetIfEmpty(meta, "Album", tag.Album);
        if (tag.Performers is { Length: > 0 })
            SetIfEmpty(meta, "Artists", string.Join(", ", tag.Performers));
        if (tag.AlbumArtists is { Length: > 0 })
            SetIfEmpty(meta, "Album Artists", string.Join(", ", tag.AlbumArtists));
        if (tag.Genres is { Length: > 0 })
            SetIfEmpty(meta, "Genre", string.Join(", ", tag.Genres));
        if (tag.Year > 0)
            SetIfEmpty(meta, "Year", tag.Year.ToString());
        if (tag.Track > 0)
            SetIfEmpty(meta, "Track", tag.Track.ToString());
        SetIfEmpty(meta, "Comment", tag.Comment);

        if (file.Properties != null)
        {
            if (file.Properties.Duration > TimeSpan.Zero && !meta.ContainsKey("Duration"))
                meta["Duration"] = file.Properties.Duration.ToString(@"hh\:mm\:ss");
            if (file.Properties.AudioBitrate > 0 && !meta.ContainsKey("Audio Bitrate"))
                meta["Audio Bitrate"] = $"{file.Properties.AudioBitrate} kbps";
            if (file.Properties.AudioSampleRate > 0 && !meta.ContainsKey("Sample Rate"))
                meta["Sample Rate"] = $"{file.Properties.AudioSampleRate} Hz";
            if (file.Properties.AudioChannels > 0 && !meta.ContainsKey("Channels"))
                meta["Channels"] = file.Properties.AudioChannels.ToString();
            if (file.Properties.PhotoWidth > 0 && file.Properties.PhotoHeight > 0 && !meta.ContainsKey("Dimensions"))
                meta["Dimensions"] = $"{file.Properties.PhotoWidth} × {file.Properties.PhotoHeight}";
            if (file.Properties.VideoWidth > 0 && file.Properties.VideoHeight > 0 && !meta.ContainsKey("Dimensions"))
                meta["Dimensions"] = $"{file.Properties.VideoWidth} × {file.Properties.VideoHeight}";
            var desc = file.Properties.Description;
            if (!string.IsNullOrWhiteSpace(desc))
                SetIfEmpty(meta, "Media Format", desc);
        }
    }

    private static void EnrichExif(Dictionary<string, string> meta, string filePath)
    {
        var ext = Path.GetExtension(filePath);
        // MetadataExtractor 2.9+: images, camera RAW, HEIF/AVIF, and common containers.
        if (ext is not (
            ".jpg" or ".jpeg" or ".jfif" or ".tif" or ".tiff" or ".webp" or ".png"
            or ".heic" or ".heif" or ".avif" or ".gif" or ".bmp" or ".ico" or ".psd"
            or ".cr2" or ".cr3" or ".nef" or ".arw" or ".dng" or ".orf" or ".rw2" or ".raf"
            or ".mp4" or ".mov" or ".avi"))
            return;

        var directories = ImageMetadataReader.ReadMetadata(filePath);
        var ifd0 = directories.OfType<ExifIfd0Directory>().FirstOrDefault();
        var sub = directories.OfType<ExifSubIfdDirectory>().FirstOrDefault();
        var gps = directories.OfType<GpsDirectory>().FirstOrDefault();

        if (ifd0 != null)
        {
            if (ifd0.TryGetDateTime(ExifDirectoryBase.TagDateTime, out var taken))
                SetIfEmpty(meta, "Date Taken", taken.ToString("g"));
            SetIfEmpty(meta, "Camera Model", ifd0.GetDescription(ExifDirectoryBase.TagModel));
            SetIfEmpty(meta, "Camera Make", ifd0.GetDescription(ExifDirectoryBase.TagMake));
            SetIfEmpty(meta, "Software", ifd0.GetDescription(ExifDirectoryBase.TagSoftware));
            SetIfEmpty(meta, "Artist", ifd0.GetDescription(ExifDirectoryBase.TagArtist));
            SetIfEmpty(meta, "Copyright", ifd0.GetDescription(ExifDirectoryBase.TagCopyright));
        }

        if (sub != null)
        {
            SetIfEmpty(meta, "F-Stop", sub.GetDescription(ExifDirectoryBase.TagFNumber));
            SetIfEmpty(meta, "Exposure Time", sub.GetDescription(ExifDirectoryBase.TagExposureTime));
            SetIfEmpty(meta, "Focal Length", sub.GetDescription(ExifDirectoryBase.TagFocalLength));
            SetIfEmpty(meta, "ISO Speed", sub.GetDescription(ExifDirectoryBase.TagIsoEquivalent));
            SetIfEmpty(meta, "Lens Model", sub.GetDescription(ExifDirectoryBase.TagLensModel));
        }

        if (gps != null)
        {
            var loc = gps.GetGeoLocation();
            if (loc is { } geo)
            {
                var text = geo.ToString();
                if (!string.IsNullOrWhiteSpace(text) && !text.Equals("0° 0'", StringComparison.Ordinal))
                    SetIfEmpty(meta, "GPS", text);
            }
        }

        // IPTC / XMP captions when Property System left them empty.
        try
        {
            foreach (var dir in directories)
            {
                var typeName = dir.GetType().Name;
                if (typeName.Contains("Iptc", StringComparison.OrdinalIgnoreCase)
                    || typeName.Contains("Xmp", StringComparison.OrdinalIgnoreCase))
                {
                    foreach (var tag in dir.Tags)
                    {
                        if (string.IsNullOrWhiteSpace(tag.Description)) continue;
                        var name = tag.Name ?? "";
                        if (name.Contains("Caption", StringComparison.OrdinalIgnoreCase)
                            || name.Contains("Description", StringComparison.OrdinalIgnoreCase)
                            || name.Contains("Title", StringComparison.OrdinalIgnoreCase)
                            || name.Contains("Keywords", StringComparison.OrdinalIgnoreCase)
                            || name.Contains("Subject", StringComparison.OrdinalIgnoreCase))
                        {
                            SetIfEmpty(meta, name, tag.Description);
                        }
                    }
                }
            }
        }
        catch { /* best-effort */ }
    }

    private static void SetIfEmpty(Dictionary<string, string> meta, string key, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        if (meta.TryGetValue(key, out var existing) && !string.IsNullOrWhiteSpace(existing)) return;
        meta[key] = value.Trim();
    }

    /// <summary>Write editable TagLib fields (title/album/artists/genre/comment/year/track).</summary>
    public static (bool Ok, string? Error) TryWriteTags(string filePath, Dictionary<string, string?> fields)
    {
        if (string.IsNullOrWhiteSpace(filePath) || !System.IO.File.Exists(filePath))
            return (false, "File not found.");
        if (fields == null || fields.Count == 0)
            return (false, "No fields to write.");

        var ext = Path.GetExtension(filePath);
        if (!TagLibExts.Contains(ext))
            return (false, "Format does not support TagLib write.");

        try
        {
            using var file = TagFile.Create(filePath);
            var tag = file.Tag;
            if (fields.TryGetValue("Title", out var title)) tag.Title = string.IsNullOrWhiteSpace(title) ? null : title.Trim();
            if (fields.TryGetValue("Album", out var album)) tag.Album = string.IsNullOrWhiteSpace(album) ? null : album.Trim();
            if (fields.TryGetValue("Comment", out var comment)) tag.Comment = string.IsNullOrWhiteSpace(comment) ? null : comment.Trim();
            if (fields.TryGetValue("Genre", out var genre))
                tag.Genres = string.IsNullOrWhiteSpace(genre) ? [] : genre.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (fields.TryGetValue("Artists", out var artists) || fields.TryGetValue("Artist", out artists))
                tag.Performers = string.IsNullOrWhiteSpace(artists) ? [] : artists.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (fields.TryGetValue("Year", out var yearStr) && uint.TryParse(yearStr, out var year))
                tag.Year = year;
            if (fields.TryGetValue("Track", out var trackStr) && uint.TryParse(trackStr, out var track))
                tag.Track = track;
            file.Save();
            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }
}
