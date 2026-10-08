using System.Text;
using System.Text.RegularExpressions;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// The one public address for Cloud Drives. Self-hosters can store a different base
/// domain; every other hostname is derived from it. fly.dev and raw IPs are internal.
/// </summary>
public static class CloudDriveHostname
{
    public const string DefaultBaseDomain = "cloud.bndz.org";

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

    public static string DriveHost(string? baseDomain, string? slug)
    {
        var safe = (slug ?? "").Trim().Trim('.').ToLowerInvariant();
        if (safe.Length == 0) return "";
        return safe + "." + NormalizeBase(baseDomain);
    }

    public static string DriveUrl(string? baseDomain, string? slug)
    {
        var host = DriveHost(baseDomain, slug);
        return host.Length == 0 ? "" : "https://" + host + "/";
    }

    public static string ShareLink(string? baseDomain, string? slug, string? token)
    {
        var host = DriveHost(baseDomain, slug);
        var id = (token ?? "").Trim();
        if (host.Length == 0 || id.Length == 0 || id.Contains('/') || id.Contains(' ')) return "";
        return "https://" + host + "/s/" + id;
    }

    public static string Slug(string? name, string? id, IEnumerable<string?>? used)
    {
        var slug = Slugify(name);
        if (slug.Length < 2) slug = "drive";
        if (slug is "www" or "api" or "mail" or "cloud") slug += "-drive";
        var taken = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        if (used != null)
        {
            foreach (var item in used)
            {
                var s = (item ?? "").Trim();
                if (s.Length > 0) taken.Add(s);
            }
        }
        if (!taken.Contains(slug)) return slug;
        for (var n = 2; n < 1000; n++)
        {
            var next = slug + "-" + n;
            if (!taken.Contains(next)) return next;
        }
        var tail = Slugify(id);
        return slug + "-" + (tail.Length > 0 ? tail : "2");
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

    private static string Strip(string? raw)
    {
        var s = (raw ?? "").Trim();
        if (s.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) s = s[8..];
        else if (s.StartsWith("http://", StringComparison.OrdinalIgnoreCase)) s = s[7..];
        var slash = s.IndexOf('/');
        if (slash >= 0) s = s[..slash];
        return s.Trim().TrimEnd('.').ToLowerInvariant();
    }

    private static string Slugify(string? raw)
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
        if (slug.Length > 40) slug = slug[..40].Trim('-');
        return slug;
    }

    private static readonly Regex HostPattern = new(
        @"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex Ipv4 = new(
        @"\b(?:\d{1,3}\.){3}\d{1,3}\b",
        RegexOptions.Compiled);
}
