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
        if (ext is not (".jpg" or ".jpeg" or ".jfif" or ".tif" or ".tiff" or ".webp" or ".png" or ".heic" or ".heif"))
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
            if (loc != null && !loc.IsZero)
                SetIfEmpty(meta, "GPS", $"{loc.Latitude:0.#####}, {loc.Longitude:0.#####}");
        }
    }

    private static void SetIfEmpty(Dictionary<string, string> meta, string key, string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        if (meta.TryGetValue(key, out var existing) && !string.IsNullOrWhiteSpace(existing)) return;
        meta[key] = value.Trim();
    }
}
