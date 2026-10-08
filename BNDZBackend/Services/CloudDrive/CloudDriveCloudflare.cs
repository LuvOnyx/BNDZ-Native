using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Publishes one drive tunnel at the hidden origin d-&lt;slug&gt;.bndz.org and upserts the
/// KV map the public router reads. The Worker on cloud.bndz.org is deployed by
/// cloud/router/deploy.sh. This class does not upload a script and does not write
/// DNS for the apex, www, or cloud. With no API token this is a dry run.
/// </summary>
public static class CloudDriveCloudflare
{
    public const string RouteNamespaceTitle = "bndz-cloud-routes";
    public const string WebsiteAddress = "15.204.218.94";
    public const string RequiredScopes = "Zone DNS Edit, Zone Read, Account Cloudflare Tunnel Edit, Workers Scripts Edit, Workers KV Storage Edit, and Workers Routes on the bndz.org zone. Deploy the public router with cloud/router/deploy.sh.";
    public const string IngressService = "http://127.0.0.1:8080";

    public sealed class Plan
    {
        public string Mode { get; init; } = "dry-run";
        public string Hostname { get; init; } = "";
        public string PublicUrl { get; init; } = "";
        public string OriginHost { get; init; } = "";
        public string DnsName { get; init; } = "";
        public string WorkerRoute { get; init; } = "";
        public string ZoneName { get; init; } = "";
        public string TunnelName { get; init; } = "";
        public string IngressService { get; init; } = CloudDriveCloudflare.IngressService;
        public string Message { get; init; } = "";
        public string? ConnectorToken { get; init; }
        public string? TunnelId { get; init; }
        public string WorkerScript { get; init; } = "";
    }

    public static Plan Describe(string? baseDomain, string? slug, bool tokenConfigured)
    {
        var safe = (slug ?? "").Trim().ToLowerInvariant();
        var host = CloudDriveHostname.PublicHost(baseDomain);
        var url = CloudDriveHostname.DriveUrl(baseDomain, safe);
        var origin = CloudDriveHostname.OriginHost(baseDomain, safe);
        var dns = CloudDriveHostname.DnsLabel(safe);
        var zone = CloudDriveHostname.ZoneName(baseDomain);
        var tunnel = "bndz-" + safe;
        var route = host + "/*";
        var reserved = url.Length == 0
            ? "The drive needs a path name before it can have an address."
            : "Address reserved as " + url + ". Run cloud/router/deploy.sh once, then save a Cloudflare API token to publish this drive's tunnel. " + RequiredScopes;
        return new Plan
        {
            Mode = tokenConfigured && url.Length > 0 ? "live" : "dry-run",
            Hostname = host,
            PublicUrl = url,
            OriginHost = origin,
            DnsName = dns,
            WorkerRoute = route,
            ZoneName = zone,
            TunnelName = tunnel,
            Message = tokenConfigured && url.Length > 0 ? "Publishing " + url + " on Cloudflare." : reserved,
        };
    }

    public static Task<Plan> PublishAsync(string? apiToken, string? baseDomain, string? slug, HttpMessageHandler? handler, CancellationToken ct)
        => PublishAsync(apiToken, baseDomain, slug, handler, ct, null);

    public static async Task<Plan> PublishAsync(string? apiToken, string? baseDomain, string? slug, HttpMessageHandler? handler, CancellationToken ct, IReadOnlyList<CloudDriveRouter.DriveRoute>? map)
    {
        var plan = Describe(baseDomain, slug, !string.IsNullOrWhiteSpace(apiToken));
        var routes = RoutesFor(baseDomain, slug, map);
        plan = WithScript(plan, CloudDriveRouter.Script(plan.Hostname, routes));
        if (plan.Mode != "live" || string.IsNullOrWhiteSpace(apiToken))
            return plan;
        if (plan.PublicUrl.Length == 0 || plan.OriginHost.Length == 0)
            return WithScript(new Plan { Mode = "dry-run", Message = "The drive needs a path name before it can have an address." }, plan.WorkerScript);

        try
        {
            using var client = handler == null ? new HttpClient() : new HttpClient(handler, disposeHandler: false);
            client.Timeout = TimeSpan.FromSeconds(30);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiToken.Trim());
            client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            var zone = await GetZoneAsync(client, plan.ZoneName, ct).ConfigureAwait(false);
            var tunnel = await EnsureTunnelAsync(client, zone.AccountId, plan.TunnelName, ct).ConfigureAwait(false);
            await PutIngressAsync(client, zone.AccountId, tunnel.Id, plan.OriginHost, ct).ConfigureAwait(false);
            await EnsureDnsAsync(client, zone.Id, plan.OriginHost, tunnel.Id, ct).ConfigureAwait(false);
            var routesReady = await UpsertRouteMapAsync(client, zone.AccountId, baseDomain, routes, ct).ConfigureAwait(false);
            var message = routesReady
                ? "Published " + plan.PublicUrl + ". The hidden origin is " + plan.OriginHost + ". The public router reads " + RouteNamespaceTitle + "."
                : "Published the hidden origin " + plan.OriginHost + ". The public router is not installed yet. Run cloud/router/deploy.sh, then publish this drive again.";
            return WithScript(new Plan
            {
                Mode = "published",
                Hostname = plan.Hostname,
                PublicUrl = plan.PublicUrl,
                OriginHost = plan.OriginHost,
                DnsName = plan.DnsName,
                WorkerRoute = plan.WorkerRoute,
                ZoneName = plan.ZoneName,
                TunnelName = plan.TunnelName,
                TunnelId = tunnel.Id,
                ConnectorToken = tunnel.Token,
                Message = message,
            }, plan.WorkerScript);
        }
        catch (Exception ex)
        {
            return WithScript(new Plan
            {
                Mode = "dry-run",
                Hostname = plan.Hostname,
                PublicUrl = plan.PublicUrl,
                OriginHost = plan.OriginHost,
                DnsName = plan.DnsName,
                WorkerRoute = plan.WorkerRoute,
                ZoneName = plan.ZoneName,
                TunnelName = plan.TunnelName,
                Message = "The address is reserved, and Cloudflare did not publish it yet. " + Redact(ex.Message),
            }, plan.WorkerScript);
        }
    }

    private static Plan WithScript(Plan plan, string script) => new()
    {
        Mode = plan.Mode,
        Hostname = plan.Hostname,
        PublicUrl = plan.PublicUrl,
        OriginHost = plan.OriginHost,
        DnsName = plan.DnsName,
        WorkerRoute = plan.WorkerRoute,
        ZoneName = plan.ZoneName,
        TunnelName = plan.TunnelName,
        IngressService = plan.IngressService,
        Message = plan.Message,
        ConnectorToken = plan.ConnectorToken,
        TunnelId = plan.TunnelId,
        WorkerScript = script,
    };

    private static List<CloudDriveRouter.DriveRoute> RoutesFor(string? baseDomain, string? slug, IReadOnlyList<CloudDriveRouter.DriveRoute>? map)
    {
        var routes = new List<CloudDriveRouter.DriveRoute>();
        if (map != null)
        {
            foreach (var route in map)
            {
                if (CloudDriveHostname.ValidateSlug(route.Slug) != null) continue;
                routes.Add(route);
            }
        }
        var focus = (slug ?? "").Trim().ToLowerInvariant();
        if (CloudDriveHostname.ValidateSlug(focus) == null && routes.All(r => !string.Equals(r.Slug, focus, StringComparison.Ordinal)))
        {
            routes.Add(new CloudDriveRouter.DriveRoute
            {
                Slug = focus,
                Origin = "https://" + CloudDriveHostname.OriginHost(baseDomain, focus),
            });
        }
        return routes;
    }

    private static async Task<(string Id, string AccountId)> GetZoneAsync(HttpClient client, string zoneName, CancellationToken ct)
    {
        using var doc = await SendAsync(client, HttpMethod.Get, "https://api.cloudflare.com/client/v4/zones?name=" + Uri.EscapeDataString(zoneName), null, ct).ConfigureAwait(false);
        var result = doc.RootElement.GetProperty("result");
        if (result.GetArrayLength() == 0)
        {
            if (string.Equals(zoneName, "bndz.org", StringComparison.Ordinal))
                return (CloudDriveRouter.KnownZoneId, CloudDriveRouter.KnownAccountId);
            throw new InvalidOperationException("Cloudflare has no zone named " + zoneName + ".");
        }
        var zone = result[0];
        var id = zone.GetProperty("id").GetString() ?? "";
        var account = zone.GetProperty("account").GetProperty("id").GetString() ?? "";
        if (id.Length == 0 || account.Length == 0)
            throw new InvalidOperationException("Cloudflare did not return a zone id.");
        return (id, account);
    }

    private static async Task<(string Id, string? Token)> EnsureTunnelAsync(HttpClient client, string accountId, string name, CancellationToken ct)
    {
        var listUrl = "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/cfd_tunnel?is_deleted=false&name=" + Uri.EscapeDataString(name);
        using (var doc = await SendAsync(client, HttpMethod.Get, listUrl, null, ct).ConfigureAwait(false))
        {
            foreach (var item in doc.RootElement.GetProperty("result").EnumerateArray())
            {
                var existing = item.GetProperty("id").GetString() ?? "";
                if (existing.Length > 0)
                    return (existing, null);
            }
        }
        var body = JsonSerializer.Serialize(new { name, config_src = "cloudflare" });
        using var created = await SendAsync(client, HttpMethod.Post, "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/cfd_tunnel", body, ct).ConfigureAwait(false);
        var result = created.RootElement.GetProperty("result");
        var id = result.GetProperty("id").GetString() ?? "";
        var token = result.TryGetProperty("token", out var tok) ? tok.GetString() : null;
        if (id.Length == 0)
            throw new InvalidOperationException("Cloudflare did not return a tunnel id.");
        return (id, token);
    }

    private static async Task PutIngressAsync(HttpClient client, string accountId, string tunnelId, string hostname, CancellationToken ct)
    {
        var body = JsonSerializer.Serialize(new
        {
            config = new
            {
                ingress = new object[]
                {
                    new { hostname, service = IngressService },
                    new { service = "http_status:404" },
                },
            },
        });
        using var _ = await SendAsync(
            client,
            HttpMethod.Put,
            "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/cfd_tunnel/" + tunnelId + "/configurations",
            body,
            ct).ConfigureAwait(false);
    }

    /// <summary>
    /// C# publish may write only d-&lt;slug&gt;.bndz.org. cloud.bndz.org belongs to deploy.sh.
    /// The apex, www, and the live website address are refused.
    /// </summary>
    public static void RejectDnsChange(string? name, string? content = null)
    {
        var host = (name ?? "").Trim().TrimEnd('.').ToLowerInvariant();
        if (host is "" or "bndz.org" or "www.bndz.org" or "www" or "@")
            throw new InvalidOperationException("Refusing to change the live website DNS for " + (host.Length == 0 ? "(empty)" : host) + ".");
        if (string.Equals((content ?? "").Trim(), WebsiteAddress, StringComparison.Ordinal))
            throw new InvalidOperationException("Refusing to change a record that points at the live website.");
        if (host == "cloud.bndz.org")
            throw new InvalidOperationException("Refusing to change cloud.bndz.org. cloud/router/deploy.sh owns that name.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(host, @"^d-[a-z0-9](?:[a-z0-9-]{0,59}[a-z0-9])?\.bndz\.org$"))
            throw new InvalidOperationException("Refusing DNS name " + host + ".");
    }

    private static async Task EnsureDnsAsync(HttpClient client, string zoneId, string hostname, string tunnelId, CancellationToken ct)
    {
        RejectDnsChange(hostname);
        var target = tunnelId + ".cfargotunnel.com";
        var listUrl = "https://api.cloudflare.com/client/v4/zones/" + zoneId + "/dns_records?type=CNAME&name=" + Uri.EscapeDataString(hostname);
        using var doc = await SendAsync(client, HttpMethod.Get, listUrl, null, ct).ConfigureAwait(false);
        foreach (var item in doc.RootElement.GetProperty("result").EnumerateArray())
        {
            var id = item.GetProperty("id").GetString() ?? "";
            var content = item.TryGetProperty("content", out var c) ? c.GetString() : "";
            if (id.Length == 0) continue;
            RejectDnsChange(hostname, content);
            if (string.Equals(content, target, StringComparison.OrdinalIgnoreCase)) return;
            var update = JsonSerializer.Serialize(new { type = "CNAME", name = hostname, content = target, proxied = true, ttl = 1 });
            using var _ = await SendAsync(client, HttpMethod.Put, "https://api.cloudflare.com/client/v4/zones/" + zoneId + "/dns_records/" + id, update, ct).ConfigureAwait(false);
            return;
        }
        var create = JsonSerializer.Serialize(new { type = "CNAME", name = hostname, content = target, proxied = true, ttl = 1 });
        using var __ = await SendAsync(client, HttpMethod.Post, "https://api.cloudflare.com/client/v4/zones/" + zoneId + "/dns_records", create, ct).ConfigureAwait(false);
    }

    private static async Task<bool> UpsertRouteMapAsync(HttpClient client, string accountId, string? baseDomain, IReadOnlyList<CloudDriveRouter.DriveRoute> routes, CancellationToken ct)
    {
        var ns = await FindRouteNamespaceAsync(client, accountId, ct).ConfigureAwait(false);
        if (ns == null) return false;
        var slugs = new List<string>();
        var raw = await GetKvRawAsync(client, accountId, ns, "drives", ct).ConfigureAwait(false);
        if (!string.IsNullOrWhiteSpace(raw))
        {
            using var existing = JsonDocument.Parse(raw);
            if (existing.RootElement.ValueKind == JsonValueKind.Array)
            {
                foreach (var item in existing.RootElement.EnumerateArray())
                {
                    var name = item.GetString() ?? "";
                    if (CloudDriveHostname.ValidateSlug(name) == null && !slugs.Contains(name))
                        slugs.Add(name);
                }
            }
        }
        foreach (var route in routes)
        {
            var slug = (route.Slug ?? "").Trim().ToLowerInvariant();
            if (CloudDriveHostname.ValidateSlug(slug) != null) continue;
            var originHost = CloudDriveHostname.OriginHost(baseDomain, slug);
            RejectDnsChange(originHost);
            var origin = "https://" + originHost;
            await PutKvRawAsync(client, accountId, ns, "drive:" + slug, "{\"origin\":" + JsonSerializer.Serialize(origin) + "}", ct).ConfigureAwait(false);
            if (!slugs.Contains(slug)) slugs.Add(slug);
            if (route.Redirects == null) continue;
            foreach (var redirect in route.Redirects)
            {
                var from = (redirect.From ?? "").Trim().ToLowerInvariant();
                if (CloudDriveHostname.ValidateSlug(from) != null) continue;
                if (!DateTime.TryParse(redirect.UntilUtc, null, System.Globalization.DateTimeStyles.RoundtripKind, out var until)) continue;
                if (until.ToUniversalTime() <= DateTime.UtcNow) continue;
                var ms = new DateTimeOffset(DateTime.SpecifyKind(until, until.Kind == DateTimeKind.Unspecified ? DateTimeKind.Utc : until.Kind)).ToUnixTimeMilliseconds();
                await PutKvRawAsync(client, accountId, ns, "redirect:" + from, "{\"to\":" + JsonSerializer.Serialize(slug) + ",\"until\":" + ms.ToString(System.Globalization.CultureInfo.InvariantCulture) + "}", ct).ConfigureAwait(false);
            }
        }
        await PutKvRawAsync(client, accountId, ns, "drives", JsonSerializer.Serialize(slugs), ct).ConfigureAwait(false);
        return true;
    }

    private static async Task<string?> FindRouteNamespaceAsync(HttpClient client, string accountId, CancellationToken ct)
    {
        for (var page = 1; page <= 5; page++)
        {
            var url = "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/storage/kv/namespaces?per_page=50&page=" + page.ToString(System.Globalization.CultureInfo.InvariantCulture);
            using var doc = await SendAsync(client, HttpMethod.Get, url, null, ct).ConfigureAwait(false);
            if (!doc.RootElement.TryGetProperty("result", out var result) || result.ValueKind != JsonValueKind.Array)
                return null;
            var count = result.GetArrayLength();
            foreach (var item in result.EnumerateArray())
            {
                var title = item.TryGetProperty("title", out var t) ? t.GetString() : "";
                if (!string.Equals(title, RouteNamespaceTitle, StringComparison.Ordinal)) continue;
                var id = item.TryGetProperty("id", out var i) ? i.GetString() : "";
                if (!string.IsNullOrWhiteSpace(id)) return id;
            }
            if (count < 50) return null;
        }
        return null;
    }

    private static async Task<string?> GetKvRawAsync(HttpClient client, string accountId, string namespaceId, string key, CancellationToken ct)
    {
        var url = "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/storage/kv/namespaces/" + namespaceId + "/values/" + Uri.EscapeDataString(key);
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        using var res = await client.SendAsync(req, ct).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if ((int)res.StatusCode == 404) return null;
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException("Cloudflare returned HTTP " + (int)res.StatusCode + ".");
        return text;
    }

    private static async Task PutKvRawAsync(HttpClient client, string accountId, string namespaceId, string key, string value, CancellationToken ct)
    {
        var url = "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/storage/kv/namespaces/" + namespaceId + "/values/" + Uri.EscapeDataString(key);
        using var req = new HttpRequestMessage(HttpMethod.Put, url);
        req.Content = new StringContent(value, Encoding.UTF8, "text/plain");
        using var res = await client.SendAsync(req, ct).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode || text.Contains("\"success\":false", StringComparison.Ordinal) || text.Contains("\"success\": false", StringComparison.Ordinal))
            throw new InvalidOperationException("Cloudflare did not store the drive route.");
    }

    private static async Task<JsonDocument> SendAsync(HttpClient client, HttpMethod method, string url, string? json, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, url);
        if (json != null)
            req.Content = new StringContent(json, Encoding.UTF8, "application/json");
        using var res = await client.SendAsync(req, ct).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        JsonDocument doc;
        try { doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(text) ? "{}" : text); }
        catch
        {
            throw new InvalidOperationException("Cloudflare returned a response that was not JSON.");
        }
        if (doc.RootElement.TryGetProperty("success", out var ok) && ok.ValueKind == JsonValueKind.False)
        {
            var message = "Cloudflare rejected the request.";
            if (doc.RootElement.TryGetProperty("errors", out var errors) && errors.ValueKind == JsonValueKind.Array && errors.GetArrayLength() > 0)
            {
                var first = errors[0];
                if (first.TryGetProperty("message", out var m) && m.GetString() is { Length: > 0 } textMessage)
                    message = textMessage;
            }
            doc.Dispose();
            throw new InvalidOperationException(message);
        }
        if (!res.IsSuccessStatusCode)
        {
            doc.Dispose();
            throw new InvalidOperationException("Cloudflare returned HTTP " + (int)res.StatusCode + ".");
        }
        return doc;
    }

    private static string Redact(string? text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        var s = System.Text.RegularExpressions.Regex.Replace(text, @"Bearer\s+\S+", "Bearer [redacted]", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        s = System.Text.RegularExpressions.Regex.Replace(s, @"\beyJ[A-Za-z0-9_\-]{16,}(?:\.[A-Za-z0-9_\-]+){1,2}", "[redacted]");
        return s.Length > 240 ? s[..240] : s;
    }
}
