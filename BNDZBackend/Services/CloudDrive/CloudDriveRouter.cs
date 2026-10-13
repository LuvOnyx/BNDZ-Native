using System.Text.Json;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Public router for cloud.bndz.org. A single Cloudflare Tunnel cannot steer each path
/// to a different machine: every connector on one tunnel is a replica of the same ingress.
/// Each drive keeps its own tunnel at the hidden origin d-&lt;slug&gt;.&lt;zone&gt;. This Worker,
/// bound to cloud.bndz.org/*, is the only public hostname and sends /&lt;slug&gt;/ to that origin.
/// </summary>
public static class CloudDriveRouter
{
    public const string ScriptName = "bndz-cloud-router";
    public const string KnownZoneId = "1ac81c686fa2d4e3f175cd90afed08cc";
    public const string KnownAccountId = "43aa82716ea9acc4c2e89fdd9843e182";

    public sealed class DriveRoute
    {
        public string Slug { get; init; } = "";
        public string Origin { get; init; } = "";
        public List<CloudDriveSlugRedirect> Redirects { get; init; } = new();
    }

    public static string Script(string? publicHost, IEnumerable<DriveRoute>? drives)
    {
        var host = CloudDriveHostname.NormalizeBase(publicHost);
        var map = new Dictionary<string, string>(StringComparer.Ordinal);
        var redirects = new Dictionary<string, object>(StringComparer.Ordinal);
        if (drives != null)
        {
            foreach (var drive in drives)
            {
                var slug = (drive.Slug ?? "").Trim().ToLowerInvariant();
                var origin = (drive.Origin ?? "").Trim();
                if (CloudDriveHostname.ValidateSlug(slug) != null) continue;
                if (!origin.StartsWith("https://", StringComparison.Ordinal) || origin.Contains(".fly.dev", StringComparison.OrdinalIgnoreCase))
                    continue;
                map[slug] = origin.TrimEnd('/');
                if (drive.Redirects == null) continue;
                foreach (var redirect in drive.Redirects)
                {
                    var from = (redirect.From ?? "").Trim().ToLowerInvariant();
                    if (CloudDriveHostname.ValidateSlug(from) != null) continue;
                    if (!CloudDriveHostname.RedirectActive(redirect.UntilUtc, DateTime.UtcNow)) continue;
                    if (!DateTime.TryParse(redirect.UntilUtc, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.RoundtripKind, out var until))
                        continue;
                    if (until.Kind == DateTimeKind.Unspecified)
                        until = DateTime.SpecifyKind(until, DateTimeKind.Utc);
                    var untilMs = new DateTimeOffset(until.ToUniversalTime()).ToUnixTimeMilliseconds();
                    redirects[from] = new { to = slug, until = untilMs };
                }
            }
        }

        var mapJson = JsonSerializer.Serialize(map);
        var redirectJson = JsonSerializer.Serialize(redirects);
        var hostJson = JsonSerializer.Serialize(host);
        var links = string.Join("", map.Keys.OrderBy(k => k, StringComparer.Ordinal).Select(slug =>
            "<li><a href=\"/" + slug + "/\">" + slug + "</a></li>"));
        var picker = "<!doctype html><meta charset=utf-8><title>BNDZ</title><h1>BNDZ drives</h1><ul>" + links + "</ul>";
        var pickerJson = JsonSerializer.Serialize(picker);

        return """
// One Cloudflare Tunnel cannot steer each path to a different machine: every connector on one tunnel is a replica of the same ingress.
// This Worker is the public router. Drive origins are hidden and are not links we show.
const HOST = __HOST__;
const DRIVES = __DRIVES__;
const REDIRECTS = __REDIRECTS__;
const PICKER = __PICKER__;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length === 0) {
      return new Response(PICKER, { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    if (parts[0] === 's') return share(request, url);
    const slug = parts[0];
    const redir = REDIRECTS[slug];
    if (redir && Date.now() < redir.until) {
      const dest = new URL(request.url);
      const rest = url.pathname.slice(slug.length + 1);
      dest.pathname = '/' + redir.to + (rest.startsWith('/') ? rest : (rest ? '/' + rest : '/'));
      if (!dest.pathname.endsWith('/') && rest.length === 0) dest.pathname += '/';
      return Response.redirect(dest.toString(), 301);
    }
    const origin = DRIVES[slug];
    if (!origin) {
      return new Response('That path is not a drive. Open https://' + HOST + '/', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    return proxy(request, url, origin);
  }
};

async function share(request, url) {
  const token = (url.pathname.split('/')[2] || '').slice(0, 80);
  const cache = caches.default;
  const key = new Request('https://' + HOST + '/s/' + token, { method: 'GET' });
  if (request.method === 'GET') {
    const hit = await cache.match(key);
    if (hit) return hit;
  }
  for (const origin of Object.values(DRIVES)) {
    const res = await proxy(request, url, origin);
    if (res.status === 404) continue;
    if (request.method === 'GET' && res.ok) {
      const copy = res.clone();
      await cache.put(key, copy);
    }
    return res;
  }
  return new Response('That share link is not on a drive.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}

async function proxy(request, url, origin) {
  const incoming = request.method === 'GET' || request.method === 'HEAD' ? request : request.clone();
  const target = new URL(url.pathname + url.search, origin);
  const headers = new Headers(incoming.headers);
  headers.set('X-Bndz-Route', '1');
  headers.set('X-Forwarded-Host', url.host);
  headers.set('X-Forwarded-Proto', 'https');
  headers.delete('host');
  const init = { method: incoming.method, headers, redirect: 'manual' };
  if (incoming.method !== 'GET' && incoming.method !== 'HEAD') init.body = incoming.body;
  return fetch(target, init);
}
""".Replace("__HOST__", hostJson, StringComparison.Ordinal)
   .Replace("__DRIVES__", mapJson, StringComparison.Ordinal)
   .Replace("__REDIRECTS__", redirectJson, StringComparison.Ordinal)
   .Replace("__PICKER__", pickerJson, StringComparison.Ordinal);
    }
}
