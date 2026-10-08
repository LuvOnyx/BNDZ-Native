using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Publishes one drive tunnel at the hidden origin d-&lt;slug&gt;.&lt;zone&gt;, then uploads the
/// Worker that serves every path on the single public host. cloud itself is a proxied
/// placeholder so the Worker route runs. It is not a CNAME to one drive tunnel: that
/// would only reach one machine. With no API token this is a dry run.
/// Token scopes: Zone DNS Edit, Zone Read, Account Cloudflare Tunnel Edit, Workers Scripts Edit.
/// </summary>
public static class CloudDriveCloudflare
{
    public const string RequiredScopes = "Zone DNS Edit, Zone Read, Account Cloudflare Tunnel Edit, and Workers Scripts Edit on the bndz.org zone.";
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
            : "Address reserved as " + url + ". A Worker on " + host + " sends this path to its own tunnel. Save a Cloudflare API token to publish it. " + RequiredScopes;
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
            await EnsureProxiedPlaceholderAsync(client, zone.Id, plan.Hostname, ct).ConfigureAwait(false);
            await PutWorkerAsync(client, zone.AccountId, plan.WorkerScript, ct).ConfigureAwait(false);
            await EnsureWorkerRouteAsync(client, zone.Id, plan.WorkerRoute, ct).ConfigureAwait(false);
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
                Message = "Published " + plan.PublicUrl + ". The Worker on " + plan.Hostname + " sends that path to this drive. The tunnel runs inside the drive.",
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

    private static async Task EnsureDnsAsync(HttpClient client, string zoneId, string hostname, string tunnelId, CancellationToken ct)
    {
        var target = tunnelId + ".cfargotunnel.com";
        var listUrl = "https://api.cloudflare.com/client/v4/zones/" + zoneId + "/dns_records?type=CNAME&name=" + Uri.EscapeDataString(hostname);
        using var doc = await SendAsync(client, HttpMethod.Get, listUrl, null, ct).ConfigureAwait(false);
        foreach (var item in doc.RootElement.GetProperty("result").EnumerateArray())
        {
            var id = item.GetProperty("id").GetString() ?? "";
            var content = item.TryGetProperty("content", out var c) ? c.GetString() : "";
            if (id.Length == 0) continue;
            if (string.Equals(content, target, StringComparison.OrdinalIgnoreCase)) return;
            var update = JsonSerializer.Serialize(new { type = "CNAME", name = hostname, content = target, proxied = true, ttl = 1 });
            using var _ = await SendAsync(client, HttpMethod.Put, "https://api.cloudflare.com/client/v4/zones/" + zoneId + "/dns_records/" + id, update, ct).ConfigureAwait(false);
            return;
        }
        var create = JsonSerializer.Serialize(new { type = "CNAME", name = hostname, content = target, proxied = true, ttl = 1 });
        using var __ = await SendAsync(client, HttpMethod.Post, "https://api.cloudflare.com/client/v4/zones/" + zoneId + "/dns_records", create, ct).ConfigureAwait(false);
    }

    /// <summary>
    /// The public name must be proxied so the Worker route runs. A CNAME to one
    /// tunnel would only reach that one machine, so a missing record becomes a
    /// proxied placeholder. An existing proxied record is left alone.
    /// </summary>
    private static async Task EnsureProxiedPlaceholderAsync(HttpClient client, string zoneId, string hostname, CancellationToken ct)
    {
        var listUrl = "https://api.cloudflare.com/client/v4/zones/" + zoneId + "/dns_records?name=" + Uri.EscapeDataString(hostname);
        using var doc = await SendAsync(client, HttpMethod.Get, listUrl, null, ct).ConfigureAwait(false);
        foreach (var item in doc.RootElement.GetProperty("result").EnumerateArray())
        {
            var proxied = item.TryGetProperty("proxied", out var flag) && flag.ValueKind == JsonValueKind.True;
            if (proxied) return;
        }
        if (doc.RootElement.GetProperty("result").GetArrayLength() > 0) return;
        var create = JsonSerializer.Serialize(new { type = "A", name = hostname, content = "192.0.2.1", proxied = true, ttl = 1 });
        using var _ = await SendAsync(client, HttpMethod.Post, "https://api.cloudflare.com/client/v4/zones/" + zoneId + "/dns_records", create, ct).ConfigureAwait(false);
    }

    private static async Task PutWorkerAsync(HttpClient client, string accountId, string script, CancellationToken ct)
    {
        var boundary = "bndzworker" + Guid.NewGuid().ToString("N");
        var metadata = "{\"main_module\":\"worker.js\",\"compatibility_date\":\"2024-01-01\"}";
        var body = new StringBuilder();
        body.Append("--").Append(boundary).Append("\r\n");
        body.Append("Content-Disposition: form-data; name=\"metadata\"; filename=\"metadata.json\"\r\n");
        body.Append("Content-Type: application/json\r\n\r\n");
        body.Append(metadata).Append("\r\n");
        body.Append("--").Append(boundary).Append("\r\n");
        body.Append("Content-Disposition: form-data; name=\"worker.js\"; filename=\"worker.js\"\r\n");
        body.Append("Content-Type: application/javascript+module\r\n\r\n");
        body.Append(script).Append("\r\n");
        body.Append("--").Append(boundary).Append("--\r\n");
        using var req = new HttpRequestMessage(HttpMethod.Put, "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/workers/scripts/" + CloudDriveRouter.ScriptName);
        req.Content = new StringContent(body.ToString(), Encoding.UTF8, "multipart/form-data");
        req.Content.Headers.ContentType = new MediaTypeHeaderValue("multipart/form-data");
        req.Content.Headers.ContentType.Parameters.Add(new System.Net.Http.Headers.NameValueHeaderValue("boundary", boundary));
        using var res = await client.SendAsync(req, ct).ConfigureAwait(false);
        var text = await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException("Cloudflare did not accept the router.");
        if (text.Contains("\"success\":false", StringComparison.Ordinal) || text.Contains("\"success\": false", StringComparison.Ordinal))
            throw new InvalidOperationException("Cloudflare did not accept the router.");
    }

    private static async Task EnsureWorkerRouteAsync(HttpClient client, string zoneId, string pattern, CancellationToken ct)
    {
        var listUrl = "https://api.cloudflare.com/client/v4/zones/" + zoneId + "/workers/routes";
        using var doc = await SendAsync(client, HttpMethod.Get, listUrl, null, ct).ConfigureAwait(false);
        if (doc.RootElement.TryGetProperty("result", out var result) && result.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in result.EnumerateArray())
            {
                var existing = item.TryGetProperty("pattern", out var p) ? p.GetString() : "";
                if (string.Equals(existing, pattern, StringComparison.OrdinalIgnoreCase)) return;
            }
        }
        var create = JsonSerializer.Serialize(new { pattern, script = CloudDriveRouter.ScriptName });
        using var _ = await SendAsync(client, HttpMethod.Post, listUrl, create, ct).ConfigureAwait(false);
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
