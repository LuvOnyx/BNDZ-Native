using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;

namespace BNDZ.Services;

/// <summary>
/// Custom scheme for CAS icon/thumb PNG delivery.
/// Must NOT use http://bndz.local — SetVirtualHostNameToFolderMapping swallows those
/// requests and WebResourceRequested never serves the CAS bytes (ERR_FILE_NOT_FOUND flood).
/// </summary>
public static class BndzMediaScheme
{
    public const string CustomScheme = "bndz-media";
    public const string Authority = "cas";

    private static readonly Regex HexHashRegex = new(
        @"([a-fA-F0-9]{16,64})(?:\.png)?/?$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>bndz-media://cas/{sha256}.png</summary>
    public static string UrlForHash(string hash)
    {
        if (string.IsNullOrWhiteSpace(hash)) return "";
        hash = NormalizeHash(hash) ?? hash.Trim();
        if (hash.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            hash = hash[..^4];
        return $"{CustomScheme}://{Authority}/{hash.ToLowerInvariant()}.png";
    }

    public static bool IsMediaRequest(string? requestUri)
    {
        if (string.IsNullOrEmpty(requestUri)) return false;
        return requestUri.StartsWith(CustomScheme + ":", StringComparison.OrdinalIgnoreCase)
            // Legacy broken URLs under folder mapping — still try to serve if somehow requested.
            || requestUri.Contains("/assets/native-icon/", StringComparison.OrdinalIgnoreCase);
    }

    public static bool IsCasDeliveryUrl(string? value)
    {
        if (string.IsNullOrEmpty(value)) return false;
        return value.StartsWith(CustomScheme + ":", StringComparison.OrdinalIgnoreCase)
            || value.Contains("/assets/native-icon/", StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>Extract hex CAS hash from a request URI or delivery URL. Strips .png.</summary>
    public static string? ParseHash(string requestUri)
    {
        if (string.IsNullOrEmpty(requestUri)) return null;
        try
        {
            // Prefer Uri parsing — WebView2 normalizes custom-scheme URIs.
            if (Uri.TryCreate(requestUri, UriKind.Absolute, out var uri))
            {
                var candidate = uri.AbsolutePath;
                if (string.IsNullOrEmpty(candidate) || candidate == "/")
                    candidate = uri.LocalPath;
                // host may be empty for bndz-media:///cas/hash.png forms
                if (string.IsNullOrEmpty(uri.Host)
                    && candidate.StartsWith("/" + Authority + "/", StringComparison.OrdinalIgnoreCase))
                    candidate = candidate[(Authority.Length + 2)..];
                var fromUri = NormalizeHash(Path.GetFileName(candidate.TrimEnd('/')));
                if (!string.IsNullOrEmpty(fromUri)) return fromUri;
            }

            if (requestUri.StartsWith(CustomScheme + ":", StringComparison.OrdinalIgnoreCase))
            {
                // bndz-media://cas/{hash}.png (and ///cas/... variants)
                var withoutScheme = requestUri[(CustomScheme.Length + 1)..]; // after "bndz-media:"
                withoutScheme = withoutScheme.TrimStart('/');
                if (withoutScheme.StartsWith(Authority + "/", StringComparison.OrdinalIgnoreCase))
                    withoutScheme = withoutScheme[(Authority.Length + 1)..];
                withoutScheme = withoutScheme.TrimStart('/');
                var q = withoutScheme.IndexOfAny(['?', '#']);
                if (q >= 0) withoutScheme = withoutScheme[..q];
                var fromString = NormalizeHash(withoutScheme);
                if (!string.IsNullOrEmpty(fromString)) return fromString;
            }

            // Legacy: http://bndz.local/assets/native-icon/{hash}.png
            if (requestUri.Contains("/assets/native-icon/", StringComparison.OrdinalIgnoreCase)
                && Uri.TryCreate(requestUri, UriKind.Absolute, out var legacy))
            {
                return NormalizeHash(Uri.UnescapeDataString(Path.GetFileName(legacy.LocalPath.TrimEnd('/'))));
            }

            // Last resort: first long hex run anywhere in the string.
            var m = HexHashRegex.Match(requestUri);
            if (m.Success) return m.Groups[1].Value.ToLowerInvariant();
        }
        catch
        {
            return null;
        }
        return null;
    }

    /// <summary>Normalize a hash-or-filename to lowercase hex without .png. Null if invalid.</summary>
    public static string? NormalizeHash(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var s = raw.Trim();
        try { s = Uri.UnescapeDataString(s); } catch { /* keep raw */ }
        s = Path.GetFileName(s.TrimEnd('/', '\\'));
        if (s.EndsWith(".png", StringComparison.OrdinalIgnoreCase))
            s = s[..^4];
        if (s.EndsWith(".bin", StringComparison.OrdinalIgnoreCase))
            s = s[..^4];
        if (s.Length < 16 || s.Length > 64) return null;
        for (var i = 0; i < s.Length; i++)
        {
            var c = s[i];
            var hex = (c >= '0' && c <= '9')
                || (c >= 'a' && c <= 'f')
                || (c >= 'A' && c <= 'F');
            if (!hex) return null;
        }
        return s.ToLowerInvariant();
    }

    public static CoreWebView2CustomSchemeRegistration CreateRegistration()
    {
        var scheme = new CoreWebView2CustomSchemeRegistration(CustomScheme)
        {
            TreatAsSecure = true,
            HasAuthorityComponent = true,
        };
        scheme.AllowedOrigins.Add("http://bndz.local");
        scheme.AllowedOrigins.Add("https://bndz.local");
        return scheme;
    }

    public static void Serve(
        CoreWebView2Environment env,
        CoreWebView2WebResourceRequestedEventArgs e)
    {
        // CORS is mandatory for fetch()/createImageBitmap from http://bndz.local (cross-origin custom scheme).
        const string corsHeaders =
            "Access-Control-Allow-Origin: http://bndz.local\r\n" +
            "Access-Control-Allow-Methods: GET, OPTIONS\r\n" +
            "Access-Control-Allow-Headers: *\r\n";

        // Preflight for warmImageBitmaps fetch()
        if (string.Equals(e.Request.Method, "OPTIONS", StringComparison.OrdinalIgnoreCase))
        {
            e.Response = env.CreateWebResourceResponse(
                new MemoryStream(), 204, "No Content",
                corsHeaders + "Content-Length: 0");
            return;
        }

        var hash = ParseHash(e.Request.Uri);
        using var fileStream = BndzMediaDiskCache.Instance.OpenCasStreamByHash(hash ?? "");
        if (fileStream == null)
        {
            e.Response = env.CreateWebResourceResponse(
                new MemoryStream(), 404, "Not Found",
                corsHeaders + "Content-Type: text/plain\r\nContent-Length: 0");
            return;
        }

        // Copy to MemoryStream — safer than handing a live FileStream to WebView2 (dispose/lifetime crashes).
        var ms = new MemoryStream(capacity: (int)Math.Min(fileStream.Length, 8 * 1024 * 1024));
        fileStream.CopyTo(ms);
        var len = ms.Length;
        ms.Position = 0;
        e.Response = env.CreateWebResourceResponse(
            ms, 200, "OK",
            corsHeaders +
            "Content-Type: image/png\r\n" +
            $"Content-Length: {len}\r\n" +
            "Cache-Control: public, max-age=31536000, immutable");
    }
}
