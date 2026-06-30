using System;
using System.Net.Http;
using System.Reflection;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

public sealed record UpdateCheckResult(
    string CurrentVersion,
    string? LatestVersion,
    bool UpdateAvailable,
    string? ReleaseUrl,
    string? ReleaseNotes,
    string? Error);

/// <summary>Checks a release manifest or GitHub releases API for newer BNDZ builds.</summary>
public sealed class BndzUpdateService
{
    private static readonly HttpClient Http = new()
    {
        Timeout = TimeSpan.FromSeconds(12),
    };

    static BndzUpdateService()
    {
        Http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "BNDZ-Updater/1.0");
    }

    public static string GetCurrentVersion()
    {
        var ver = Assembly.GetExecutingAssembly().GetName().Version;
        if (ver == null) return "1.0.0";
        return ver.Revision > 0 ? ver.ToString(4) : ver.ToString(3);
    }

    public async Task<UpdateCheckResult> CheckAsync(string? manifestUrl = null, CancellationToken ct = default)
    {
        var current = GetCurrentVersion();
        if (string.IsNullOrWhiteSpace(manifestUrl))
        {
            return new UpdateCheckResult(current, null, false, null, null,
                "No update URL configured. Set updateCheckUrl in BNDZ settings.");
        }

        try
        {
            var json = await Http.GetStringAsync(manifestUrl.Trim(), ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            string? latest = null;
            string? url = null;
            string? notes = null;

            if (root.TryGetProperty("tag_name", out var tagEl))
            {
                latest = tagEl.GetString()?.TrimStart('v', 'V');
                if (root.TryGetProperty("html_url", out var htmlEl)) url = htmlEl.GetString();
                if (root.TryGetProperty("body", out var bodyEl)) notes = bodyEl.GetString();
            }
            else
            {
                if (root.TryGetProperty("version", out var verEl)) latest = verEl.GetString();
                if (root.TryGetProperty("url", out var urlEl)) url = urlEl.GetString();
                if (root.TryGetProperty("notes", out var notesEl)) notes = notesEl.GetString();
                if (root.TryGetProperty("releaseNotes", out var rnEl)) notes ??= rnEl.GetString();
            }

            if (string.IsNullOrWhiteSpace(latest))
                return new UpdateCheckResult(current, null, false, null, null, "Manifest did not include a version.");

            var available = CompareVersions(latest, current) > 0;
            return new UpdateCheckResult(current, latest, available, url, notes, null);
        }
        catch (Exception ex)
        {
            return new UpdateCheckResult(current, null, false, null, null, ex.Message);
        }
    }

    private static int CompareVersions(string a, string b)
    {
        static int[] Parts(string v)
        {
            var core = v.Split('-', '+')[0];
            var parts = core.Split('.');
            var nums = new int[4];
            for (var i = 0; i < Math.Min(parts.Length, 4); i++)
                int.TryParse(parts[i], out nums[i]);
            return nums;
        }

        var pa = Parts(a);
        var pb = Parts(b);
        for (var i = 0; i < 4; i++)
        {
            if (pa[i] != pb[i]) return pa[i].CompareTo(pb[i]);
        }
        return 0;
    }
}
