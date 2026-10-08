using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Publishes &lt;slug&gt;.&lt;base&gt; on the bndz.org zone: a Cloudflare Tunnel ingress
/// plus a proxied CNAME. With no API token this is a dry run and does not call the network.
/// Token scopes: Zone DNS Edit, Zone Read, and Account Cloudflare Tunnel Edit.
/// </summary>
public static class CloudDriveCloudflare
{
    public const string RequiredScopes = "Zone DNS Edit, Zone Read, and Account Cloudflare Tunnel Edit on the bndz.org zone.";
    public const string IngressService = "http://127.0.0.1:8080";

    public sealed class Plan
    {
        public string Mode { get; init; } = "dry-run";
        public string Hostname { get; init; } = "";
        public string ZoneName { get; init; } = "";
        public string TunnelName { get; init; } = "";
        public string IngressService { get; init; } = CloudDriveCloudflare.IngressService;
        public string Message { get; init; } = "";
        public string? ConnectorToken { get; init; }
        public string? TunnelId { get; init; }
    }

    public static Plan Describe(string? baseDomain, string? slug, bool tokenConfigured)
    {
        var host = CloudDriveHostname.DriveHost(baseDomain, slug);
        var zone = CloudDriveHostname.ZoneName(baseDomain);
        var tunnel = "bndz-" + (slug ?? "").Trim().ToLowerInvariant();
        if (!tokenConfigured)
        {
            return new Plan
            {
                Mode = "dry-run",
                Hostname = host,
                ZoneName = zone,
                TunnelName = tunnel,
                Message = "Address reserved as https://" + host + "/. Save a Cloudflare API token to publish the tunnel route and DNS record. " + RequiredScopes,
            };
        }
        return new Plan
        {
            Mode = "live",
            Hostname = host,
            ZoneName = zone,
            TunnelName = tunnel,
            Message = "Publishing https://" + host + "/ on Cloudflare.",
        };
    }

    public static async Task<Plan> PublishAsync(string? apiToken, string? baseDomain, string? slug, HttpMessageHandler? handler, CancellationToken ct)
    {
        var plan = Describe(baseDomain, slug, !string.IsNullOrWhiteSpace(apiToken));
        if (plan.Mode != "live" || string.IsNullOrWhiteSpace(apiToken))
            return plan;
        if (plan.Hostname.Length == 0)
            return new Plan { Mode = "dry-run", Message = "The drive needs a name before it can have an address." };

        try
        {
            using var client = handler == null ? new HttpClient() : new HttpClient(handler, disposeHandler: false);
            client.Timeout = TimeSpan.FromSeconds(30);
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", apiToken.Trim());
            client.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));

            var zone = await GetZoneAsync(client, plan.ZoneName, ct).ConfigureAwait(false);
            var tunnel = await EnsureTunnelAsync(client, zone.AccountId, plan.TunnelName, ct).ConfigureAwait(false);
            await PutIngressAsync(client, zone.AccountId, tunnel.Id, plan.Hostname, ct).ConfigureAwait(false);
            await EnsureDnsAsync(client, zone.Id, plan.Hostname, tunnel.Id, ct).ConfigureAwait(false);
            return new Plan
            {
                Mode = "published",
                Hostname = plan.Hostname,
                ZoneName = plan.ZoneName,
                TunnelName = plan.TunnelName,
                TunnelId = tunnel.Id,
                ConnectorToken = tunnel.Token,
                Message = "Published https://" + plan.Hostname + "/. The tunnel runs inside the drive and the DNS record is on " + plan.ZoneName + ".",
            };
        }
        catch (Exception ex)
        {
            return new Plan
            {
                Mode = "dry-run",
                Hostname = plan.Hostname,
                ZoneName = plan.ZoneName,
                TunnelName = plan.TunnelName,
                Message = "The address is reserved, and Cloudflare did not publish it yet. " + Redact(ex.Message),
            };
        }
    }

    private static async Task<(string Id, string AccountId)> GetZoneAsync(HttpClient client, string zoneName, CancellationToken ct)
    {
        using var doc = await SendAsync(client, HttpMethod.Get, "https://api.cloudflare.com/client/v4/zones?name=" + Uri.EscapeDataString(zoneName), null, ct).ConfigureAwait(false);
        var result = doc.RootElement.GetProperty("result");
        if (result.GetArrayLength() == 0)
            throw new InvalidOperationException("Cloudflare has no zone named " + zoneName + ".");
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
