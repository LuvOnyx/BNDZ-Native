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

    /// <summary>bndz-media://cas/{sha256}.png</summary>
    public static string UrlForHash(string hash)
    {
        if (string.IsNullOrWhiteSpace(hash)) return "";
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

    public static string? ParseHash(string requestUri)
    {
        if (string.IsNullOrEmpty(requestUri)) return null;
        try
        {
            if (requestUri.StartsWith(CustomScheme + ":", StringComparison.OrdinalIgnoreCase))
            {
                // bndz-media://cas/{hash}.png
                var withoutScheme = requestUri[(CustomScheme.Length + 1)..]; // after "bndz-media:"
                if (withoutScheme.StartsWith("//", StringComparison.Ordinal))
                    withoutScheme = withoutScheme[2..];
                if (withoutScheme.StartsWith(Authority + "/", StringComparison.OrdinalIgnoreCase))
                    withoutScheme = withoutScheme[(Authority.Length + 1)..];
                withoutScheme = withoutScheme.TrimStart('/');
                var q = withoutScheme.IndexOfAny(['?', '#']);
                if (q >= 0) withoutScheme = withoutScheme[..q];
                return Uri.UnescapeDataString(Path.GetFileName(withoutScheme));
            }

            // Legacy: http://bndz.local/assets/native-icon/{hash}.png
            if (requestUri.Contains("/assets/native-icon/", StringComparison.OrdinalIgnoreCase))
            {
                var path = new Uri(requestUri).LocalPath;
                return Uri.UnescapeDataString(Path.GetFileName(path));
            }
        }
        catch
        {
            return null;
        }
        return null;
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
        var hash = ParseHash(e.Request.Uri);
        var stream = BndzMediaDiskCache.Instance.OpenCasStreamByHash(hash ?? "");
        if (stream == null)
        {
            e.Response = env.CreateWebResourceResponse(
                new MemoryStream(), 404, "Not Found", "Content-Type: text/plain");
            return;
        }
        e.Response = env.CreateWebResourceResponse(
            stream, 200, "OK",
            "Content-Type: image/png\r\nCache-Control: public, max-age=31536000, immutable");
    }
}
