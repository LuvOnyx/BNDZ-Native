using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// One public hostname. A drive is a path on it: https://cloud.bndz.org/&lt;slug&gt;/.
/// Share links are https://cloud.bndz.org/s/&lt;token&gt; and do not include the slug.
/// The hidden route origin d-&lt;slug&gt;.&lt;zone&gt; is how the Worker reaches that drive's tunnel.
/// It is not a link we show.
/// </summary>
public static class CloudDriveHostname
{
    public const string DefaultBaseDomain = "cloud.bndz.org";
    public const int MaxSlugLength = 61;
    public const int RedirectGraceDays = 30;

    public static readonly string[] Reserved = { "s", "api", "admin", "login", "static", "assets", "www" };

    public static string NormalizeBase(string? raw)
    {
        var host = Strip(raw);
        if (host.Length == 0) return DefaultBaseDomain;
        if (!IsPublicHost(host)) return DefaultBaseDomain;
        return host;
    }

    public static string LandingUrl(string? baseDomain) => "https://" + NormalizeBase(baseDomain) + "/";

    public static string ZoneName(string? baseDomain)
    {
        var host = NormalizeBase(baseDomain);
        var parts = host.Split('.');
        if (parts.Length <= 2) return host;
        return string.Join('.', parts.Skip(1));
    }

    /// <summary>The only hostname people open.</summary>
    public static string PublicHost(string? baseDomain) => NormalizeBase(baseDomain);

    public static string DriveUrl(string? baseDomain, string? slug)
    {
        var safe = (slug ?? "").Trim().ToLowerInvariant();
        if (ValidateSlug(safe) != null) return "";
        return "https://" + NormalizeBase(baseDomain) + "/" + safe + "/";
    }

    /// <summary>Share links resolve by token at the site root. The slug is not part of the URL.</summary>
    public static string ShareLink(string? baseDomain, string? slug, string? token)
    {
        var id = (token ?? "").Trim();
        if (id.Length == 0 || id.Contains('/') || id.Contains(' ')) return "";
        return "https://" + NormalizeBase(baseDomain) + "/s/" + id;
    }

    /// <summary>Hidden Cloudflare name for this drive's own tunnel. Not shown in the UI.</summary>
    public static string OriginHost(string? baseDomain, string? slug)
    {
        var safe = (slug ?? "").Trim().ToLowerInvariant();
        if (ValidateSlug(safe) != null) return "";
        return "d-" + safe + "." + ZoneName(baseDomain);
    }

    public static string DnsLabel(string? slug)
    {
        var safe = (slug ?? "").Trim().ToLowerInvariant();
        if (ValidateSlug(safe) != null) return "";
        return "d-" + safe;
    }

    public static string? ValidateSlug(string? raw)
    {
        var s = raw ?? "";
        if (s.Trim().Length == 0) return "Enter a path name.";
        if (s != s.Trim() || s != s.ToLowerInvariant() || !SlugChars.IsMatch(s))
            return "Use lowercase letters, numbers, and hyphens.";
        if (s.StartsWith('-') || s.EndsWith('-'))
            return "The path cannot start or end with a hyphen.";
        if (s.Length > MaxSlugLength)
            return "The path cannot be longer than 61 characters.";
        if (Reserved.Contains(s))
            return "That path is reserved.";
        return null;
    }

    public static string Slugify(string? raw)
    {
        var sb = new StringBuilder();
        var dash = false;
        foreach (var c in (raw ?? "").Trim().ToLowerInvariant())
        {
            if (c is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                sb.Append(c);
                dash = false;
            }
            else if (!dash && sb.Length > 0)
            {
                sb.Append('-');
                dash = true;
            }
        }
        var slug = sb.ToString().Trim('-');
        if (slug.Length > MaxSlugLength) slug = slug[..MaxSlugLength].Trim('-');
        return slug;
    }

    public static string Slug(string? name, string? id, IEnumerable<string?>? used)
    {
        var slug = Slugify(name);
        if (slug.Length == 0) slug = "drive";
        if (Reserved.Contains(slug)) slug = Fit(slug + "-drive");
        if (ValidateSlug(slug) != null) slug = "drive";
        var taken = new HashSet<string>(StringComparer.Ordinal);
        if (used != null)
        {
            foreach (var item in used)
            {
                var s = (item ?? "").Trim().ToLowerInvariant();
                if (s.Length > 0) taken.Add(s);
            }
        }
        if (!taken.Contains(slug)) return slug;
        for (var n = 2; n < 1000; n++)
        {
            var next = Fit(slug + "-" + n);
            if (!taken.Contains(next) && ValidateSlug(next) == null) return next;
        }
        var tail = Slugify(id);
        return Fit(slug + "-" + (tail.Length > 0 ? tail : "2"));
    }

    /// <summary>null means this path can be claimed. Own current path and own active redirects can be reclaimed.</summary>
    public static string? Availability(string? slug, IEnumerable<SlugClaim>? claims, string? exceptDriveId, DateTime utcNow)
    {
        var err = ValidateSlug(slug);
        if (err != null) return err;
        var want = slug!.Trim().ToLowerInvariant();
        if (claims == null) return null;
        foreach (var claim in claims)
        {
            var mine = !string.IsNullOrEmpty(exceptDriveId)
                && string.Equals(claim.DriveId, exceptDriveId, StringComparison.Ordinal);
            if (string.Equals((claim.Slug ?? "").Trim().ToLowerInvariant(), want, StringComparison.Ordinal))
            {
                if (mine) return null;
                return "That path is already taken.";
            }
            if (claim.Redirects == null) continue;
            foreach (var redirect in claim.Redirects)
            {
                if (!string.Equals((redirect.From ?? "").Trim().ToLowerInvariant(), want, StringComparison.Ordinal)) continue;
                if (!RedirectActive(redirect.UntilUtc, utcNow)) continue;
                if (mine) return null;
                return "That path is already taken.";
            }
        }
        return null;
    }

    public static IEnumerable<string> Occupied(IEnumerable<SlugClaim>? claims, DateTime utcNow, string? exceptDriveId)
    {
        if (claims == null) yield break;
        foreach (var claim in claims)
        {
            if (!string.IsNullOrEmpty(exceptDriveId)
                && string.Equals(claim.DriveId, exceptDriveId, StringComparison.Ordinal))
                continue;
            var current = (claim.Slug ?? "").Trim().ToLowerInvariant();
            if (current.Length > 0) yield return current;
            if (claim.Redirects == null) continue;
            foreach (var redirect in claim.Redirects)
            {
                if (!RedirectActive(redirect.UntilUtc, utcNow)) continue;
                var from = (redirect.From ?? "").Trim().ToLowerInvariant();
                if (from.Length > 0) yield return from;
            }
        }
    }

    /// <summary>Moves current to next and keeps the old path as a 301 until the grace period ends.</summary>
    public static string? Rename(string? current, List<CloudDriveSlugRedirect> redirects, string? next, DateTime utcNow, out string updated)
    {
        updated = (current ?? "").Trim().ToLowerInvariant();
        var err = ValidateSlug(next);
        if (err != null) return err;
        var dest = next!.Trim().ToLowerInvariant();
        var now = utcNow.Kind == DateTimeKind.Utc ? utcNow : utcNow.ToUniversalTime();
        redirects.RemoveAll(r =>
            string.Equals((r.From ?? "").Trim().ToLowerInvariant(), dest, StringComparison.Ordinal)
            || !RedirectActive(r.UntilUtc, now));
        if (string.Equals(dest, updated, StringComparison.Ordinal))
            return null;
        if (ValidateSlug(updated) == null)
        {
            redirects.Add(new CloudDriveSlugRedirect
            {
                From = updated,
                UntilUtc = now.AddDays(RedirectGraceDays).ToString("o"),
            });
        }
        updated = dest;
        return null;
    }

    public static bool RedirectActive(string? untilUtc, DateTime utcNow)
    {
        if (string.IsNullOrWhiteSpace(untilUtc)) return false;
        if (!DateTime.TryParse(untilUtc, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var until)
            && !DateTime.TryParse(untilUtc, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out until))
            return false;
        if (until.Kind == DateTimeKind.Unspecified)
            until = DateTime.SpecifyKind(until, DateTimeKind.Utc);
        var now = utcNow.Kind == DateTimeKind.Utc ? utcNow : utcNow.ToUniversalTime();
        return until.ToUniversalTime() > now;
    }

    public static string FormatRedirects(string? current, IEnumerable<CloudDriveSlugRedirect>? redirects, DateTime utcNow)
    {
        var dest = (current ?? "").Trim().ToLowerInvariant();
        if (ValidateSlug(dest) != null || redirects == null) return "";
        var parts = new List<string>();
        foreach (var redirect in redirects)
        {
            if (!RedirectActive(redirect.UntilUtc, utcNow)) continue;
            var from = (redirect.From ?? "").Trim().ToLowerInvariant();
            if (ValidateSlug(from) != null || string.Equals(from, dest, StringComparison.Ordinal)) continue;
            parts.Add(from + ":" + dest);
        }
        return string.Join(",", parts);
    }

    public static bool IsPublicHost(string? host)
    {
        var s = Strip(host);
        if (s.Length == 0 || s.Length > 253 || !s.Contains('.')) return false;
        if (s is "localhost" or "127.0.0.1" or "::1") return false;
        if (s.EndsWith(".fly.dev", StringComparison.Ordinal)) return false;
        if (Ipv4.IsMatch(s)) return false;
        return HostPattern.IsMatch(s);
    }

    public static bool ContainsInternalOrigin(string? text)
    {
        if (string.IsNullOrEmpty(text)) return false;
        if (text.Contains(".fly.dev", StringComparison.OrdinalIgnoreCase)) return true;
        return Ipv4.IsMatch(text);
    }

    private static string Fit(string slug)
    {
        if (slug.Length > MaxSlugLength) slug = slug[..MaxSlugLength].Trim('-');
        return slug;
    }

    private static string Strip(string? raw)
    {
        var s = (raw ?? "").Trim();
        if (s.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) s = s[8..];
        else if (s.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) s = s[7..];
        var slash = s.IndexOf('/');
        if (slash >= 0) s = s[..slash];
        return s.Trim().TrimEnd('.').ToLowerInvariant();
    }

    private static readonly Regex SlugChars = new(@"^[a-z0-9-]+$", RegexOptions.Compiled);

    private static readonly Regex HostPattern = new(
        @"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex Ipv4 = new(
        @"\b(?:\d{1,3}\.){3}\d{1,3}\b",
        RegexOptions.Compiled);
}

/// <summary>An old path that still answers with 301 until UntilUtc.</summary>
public sealed class CloudDriveSlugRedirect
{
    public string From { get; set; } = "";
    public string UntilUtc { get; set; } = "";
}

public sealed class SlugClaim
{
    public string DriveId { get; set; } = "";
    public string Slug { get; set; } = "";
    public IReadOnlyList<CloudDriveSlugRedirect>? Redirects { get; set; }
}
