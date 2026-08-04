using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace BNDZ.Services;

/// <summary>
/// Reads Windows Mark-of-the-Web (Zone.Identifier) ADS — HostUrl / ReferrerUrl —
/// so preview lineage can show where a download came from without prior BNDZ ops.
/// </summary>
public static class MotwLineageReader
{
    private const int MaxAdsBytes = 16_384;

    public static LineageEdge? TryReadDownloadOrigin(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath)) return null;

        try
        {
            var adsPath = filePath + ":Zone.Identifier";
            if (!File.Exists(adsPath)) return null;

            string text;
            using (var fs = new FileStream(adsPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            {
                if (fs.Length <= 0 || fs.Length > MaxAdsBytes) return null;
                using var reader = new StreamReader(fs, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
                text = reader.ReadToEnd();
            }

            if (string.IsNullOrWhiteSpace(text)) return null;

            string? hostUrl = null;
            string? referrerUrl = null;
            string? zoneId = null;
            foreach (var rawLine in text.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
            {
                var line = rawLine.Trim();
                if (line.StartsWith('[') || line.Length == 0) continue;
                var eq = line.IndexOf('=');
                if (eq <= 0) continue;
                var key = line[..eq].Trim();
                var val = line[(eq + 1)..].Trim();
                if (key.Equals("HostUrl", StringComparison.OrdinalIgnoreCase)) hostUrl = val;
                else if (key.Equals("ReferrerUrl", StringComparison.OrdinalIgnoreCase)) referrerUrl = val;
                else if (key.Equals("ZoneId", StringComparison.OrdinalIgnoreCase)) zoneId = val;
            }

            if (string.IsNullOrWhiteSpace(hostUrl) && string.IsNullOrWhiteSpace(referrerUrl))
            {
                // Still useful: ZoneId=3 means internet download even without URL
                if (zoneId != "3" && zoneId != "4") return null;
                hostUrl = "Internet download (Mark of the Web)";
            }

            var from = !string.IsNullOrWhiteSpace(hostUrl) ? hostUrl! : referrerUrl!;
            var meta = System.Text.Json.JsonSerializer.Serialize(new
            {
                hostUrl,
                referrerUrl,
                zoneId,
                source = "Zone.Identifier",
            });

            return new LineageEdge
            {
                Id = "motw:" + Convert.ToHexString(
                    System.Security.Cryptography.SHA256.HashData(Encoding.UTF8.GetBytes(filePath.ToLowerInvariant())))[..16],
                FromPath = from,
                ToPath = filePath,
                Op = "download_origin",
                Actor = "windows-motw",
                Utc = File.GetCreationTimeUtc(filePath).ToString("o"),
                MetaJson = meta,
            };
        }
        catch
        {
            return null;
        }
    }
}
