using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.Json.Serialization;

namespace BNDZ.Services.Mesh.Incus;

/// <summary>
/// Native C# Incus REST client — mirrors external/incus/client patterns
/// (query / queryOperation / CreateInstance / GetInstanceState / Wait) without shipping Go.
/// </summary>
public sealed class IncusApiClient : IAsyncDisposable
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        PropertyNameCaseInsensitive = true,
    };

    private readonly HttpClient _http;
    private readonly string _baseUrl;
    private readonly string? _project;
    private readonly X509Certificate2 _clientCert;
    private bool _disposed;

    private IncusApiClient(HttpClient http, string baseUrl, string? project, X509Certificate2 clientCert)
    {
        _http = http;
        _baseUrl = baseUrl.TrimEnd('/');
        _project = string.IsNullOrWhiteSpace(project) ? null : project;
        _clientCert = clientCert;
    }

    public string ClientCertificatePem => ExportCertificatePem(_clientCert);
    public string ClientFingerprint => Sha256Fingerprint(_clientCert);

    public static async Task<(IncusApiClient Client, IncusServerInfo Info)> ConnectAsync(
        IncusEndpointRecord endpoint,
        string clientCertPath,
        string clientKeyPath,
        CancellationToken ct = default)
    {
        EnsureClientIdentity(clientCertPath, clientKeyPath, out var cert);
        string? capturedFp = null;
        var handler = CreateHandler(cert, endpoint.ServerFingerprint, endpoint.AllowInsecureTls, fp => capturedFp = fp);
        var http = new HttpClient(handler) { Timeout = TimeSpan.FromMinutes(10) };
        var client = new IncusApiClient(http, endpoint.ApiUrl, endpoint.Project, cert);

        var trustToken = endpoint.TrustTokenPlain
            ?? MeshCredentialVault.Unprotect(endpoint.ProtectedTrustToken);
        if (!string.IsNullOrWhiteSpace(trustToken))
        {
            try
            {
                await client.RegisterTrustAsync(trustToken!, ct).ConfigureAwait(false);
            }
            catch (IncusApiException ex) when (ex.StatusCode is 403 or 409)
            {
                // Already trusted or token consumed — continue and probe /1.0
            }
        }

        var info = await client.GetServerAsync(ct).ConfigureAwait(false);
        info.Fingerprint ??= capturedFp ?? endpoint.ServerFingerprint;
        return (client, info);
    }

    public async Task<IncusServerInfo> GetServerAsync(CancellationToken ct = default)
    {
        var meta = await QueryAsync(HttpMethod.Get, "/1.0", null, ct).ConfigureAwait(false);
        var info = new IncusServerInfo
        {
            ApiVersion = meta?["api_version"]?.GetValue<string>() ?? "1.0",
            Auth = meta?["auth"]?.GetValue<string>(),
            EnvironmentServerName = meta?["environment"]?["server_name"]?.GetValue<string>(),
        };
        info.Trusted = string.Equals(info.Auth, "trusted", StringComparison.OrdinalIgnoreCase);
        return info;
    }

    public async Task RegisterTrustAsync(string trustToken, CancellationToken ct = default)
    {
        var body = new JsonObject
        {
            ["type"] = "client",
            ["name"] = "bndz-mesh",
            ["certificate"] = Convert.ToBase64String(_clientCert.Export(X509ContentType.Cert)),
            ["trust_token"] = trustToken,
        };
        await QueryAsync(HttpMethod.Post, "/1.0/certificates", body, ct).ConfigureAwait(false);
    }

    public async Task CreateInstanceAsync(
        string name,
        string imageAlias,
        string imageServer,
        string instanceType,
        bool ephemeral,
        bool start,
        string? cloudInitUserData = null,
        CancellationToken ct = default)
    {
        var body = new JsonObject
        {
            ["name"] = name,
            ["type"] = string.IsNullOrWhiteSpace(instanceType) ? "container" : instanceType,
            ["ephemeral"] = ephemeral,
            ["start"] = start,
            ["source"] = new JsonObject
            {
                ["type"] = "image",
                ["alias"] = imageAlias,
                ["server"] = imageServer,
                ["protocol"] = "simplestreams",
            },
        };
        if (!string.IsNullOrWhiteSpace(cloudInitUserData))
        {
            // Newer images: cloud-init.*; older: user.* — set both so Mesh SSH keys land on first boot.
            body["config"] = new JsonObject
            {
                ["cloud-init.user-data"] = cloudInitUserData,
                ["user.user-data"] = cloudInitUserData,
            };
        }
        var path = WithProject("/1.0/instances");
        var (type, operation, metadata) = await QueryRawAsync(HttpMethod.Post, path, body, ct).ConfigureAwait(false);
        if (string.Equals(type, "async", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrEmpty(operation))
            await WaitOperationAsync(operation!, ct).ConfigureAwait(false);
        else if (metadata?["err"]?.GetValue<string>() is { Length: > 0 } err)
            throw new IncusApiException(err);
    }

    /// <summary>List image aliases on the Incus server (local + remotes when available).</summary>
    public async Task<IReadOnlyList<IncusImageAlias>> ListImageAliasesAsync(CancellationToken ct = default)
    {
        var path = WithProject("/1.0/images/aliases?recursion=1");
        var meta = await QueryAsync(HttpMethod.Get, path, null, ct).ConfigureAwait(false);
        var list = new List<IncusImageAlias>();
        if (meta is JsonArray arr)
        {
            foreach (var node in arr)
            {
                if (node is not JsonObject obj) continue;
                var name = obj["name"]?.GetValue<string>();
                if (string.IsNullOrWhiteSpace(name)) continue;
                list.Add(new IncusImageAlias
                {
                    Name = name!,
                    Description = obj["description"]?.GetValue<string>(),
                    Target = obj["target"]?.GetValue<string>(),
                    Type = obj["type"]?.GetValue<string>(),
                });
            }
        }
        return list.OrderBy(a => a.Name, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public async Task UpdateInstanceStateAsync(string name, string action, bool force = false, int timeout = 30, CancellationToken ct = default)
    {
        var body = new JsonObject
        {
            ["action"] = action,
            ["timeout"] = timeout,
            ["force"] = force,
            ["stateful"] = false,
        };
        var path = WithProject($"/1.0/instances/{Uri.EscapeDataString(name)}/state");
        var (type, operation, _) = await QueryRawAsync(HttpMethod.Put, path, body, ct).ConfigureAwait(false);
        if (string.Equals(type, "async", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrEmpty(operation))
            await WaitOperationAsync(operation!, ct).ConfigureAwait(false);
    }

    public async Task DeleteInstanceAsync(string name, bool force = true, CancellationToken ct = default)
    {
        var path = WithProject($"/1.0/instances/{Uri.EscapeDataString(name)}?force={(force ? "true" : "false")}");
        var (type, operation, _) = await QueryRawAsync(HttpMethod.Delete, path, null, ct).ConfigureAwait(false);
        if (string.Equals(type, "async", StringComparison.OrdinalIgnoreCase) && !string.IsNullOrEmpty(operation))
            await WaitOperationAsync(operation!, ct).ConfigureAwait(false);
    }

    public async Task<JsonObject?> GetInstanceStateAsync(string name, CancellationToken ct = default)
    {
        var path = WithProject($"/1.0/instances/{Uri.EscapeDataString(name)}/state");
        var meta = await QueryAsync(HttpMethod.Get, path, null, ct).ConfigureAwait(false);
        return meta as JsonObject;
    }

    public async Task<(string? Ipv4, string? Ipv6, string Status)> GetPrimaryAddressesAsync(string name, CancellationToken ct = default)
    {
        var state = await GetInstanceStateAsync(name, ct).ConfigureAwait(false);
        var status = state?["status"]?.GetValue<string>() ?? "Unknown";
        string? ipv4 = null;
        string? ipv6 = null;
        if (state?["network"] is JsonObject nets)
        {
            foreach (var (_, ifaceNode) in nets)
            {
                if (ifaceNode is not JsonObject iface) continue;
                if (iface["addresses"] is not JsonArray addrs) continue;
                foreach (var addrNode in addrs)
                {
                    if (addrNode is not JsonObject addr) continue;
                    var family = addr["family"]?.GetValue<string>();
                    var scope = addr["scope"]?.GetValue<string>();
                    var address = addr["address"]?.GetValue<string>();
                    if (string.IsNullOrWhiteSpace(address)) continue;
                    if (!string.Equals(scope, "global", StringComparison.OrdinalIgnoreCase)
                        && !string.Equals(scope, "universe", StringComparison.OrdinalIgnoreCase))
                        continue;
                    if (ipv4 == null && string.Equals(family, "inet", StringComparison.OrdinalIgnoreCase))
                        ipv4 = address;
                    if (ipv6 == null && string.Equals(family, "inet6", StringComparison.OrdinalIgnoreCase))
                        ipv6 = address;
                }
            }
        }
        return (ipv4, ipv6, status);
    }

    public async Task WaitOperationAsync(string operationPathOrId, CancellationToken ct = default)
    {
        var path = operationPathOrId.StartsWith('/')
            ? operationPathOrId
            : $"/1.0/operations/{operationPathOrId}";
        if (!path.EndsWith("/wait", StringComparison.OrdinalIgnoreCase))
            path = path.TrimEnd('/') + "/wait";

        using var req = new HttpRequestMessage(HttpMethod.Get, _baseUrl + path);
        using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
        var text = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        var root = ParseResponse(text, (int)resp.StatusCode);
        if (string.Equals(root.type, "error", StringComparison.OrdinalIgnoreCase))
            throw new IncusApiException(root.error ?? "Incus operation failed", root.errorCode);
        var err = root.metadata?["err"]?.GetValue<string>();
        if (!string.IsNullOrWhiteSpace(err))
            throw new IncusApiException(err);
        var code = root.metadata?["status_code"]?.GetValue<int>() ?? 0;
        if (code >= 400)
            throw new IncusApiException($"Operation failed ({code})", code);
    }

    private async Task<JsonNode?> QueryAsync(HttpMethod method, string path, JsonNode? body, CancellationToken ct)
    {
        var (type, _, metadata) = await QueryRawAsync(method, path, body, ct).ConfigureAwait(false);
        if (string.Equals(type, "error", StringComparison.OrdinalIgnoreCase))
            throw new IncusApiException("Incus API error");
        return metadata;
    }

    private async Task<(string type, string? operation, JsonNode? metadata)> QueryRawAsync(
        HttpMethod method, string path, JsonNode? body, CancellationToken ct)
    {
        using var req = new HttpRequestMessage(method, _baseUrl + path);
        if (body != null)
            req.Content = new StringContent(body.ToJsonString(JsonOpts), Encoding.UTF8, "application/json");
        req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        using var resp = await _http.SendAsync(req, ct).ConfigureAwait(false);
        var text = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        var root = ParseResponse(text, (int)resp.StatusCode);
        if (string.Equals(root.type, "error", StringComparison.OrdinalIgnoreCase))
            throw new IncusApiException(root.error ?? $"HTTP {(int)resp.StatusCode}", root.errorCode > 0 ? root.errorCode : (int)resp.StatusCode);
        return (root.type, root.operation, root.metadata);
    }

    private string WithProject(string path)
    {
        if (string.IsNullOrWhiteSpace(_project) || string.Equals(_project, "default", StringComparison.OrdinalIgnoreCase))
            return path;
        var sep = path.Contains('?') ? "&" : "?";
        return $"{path}{sep}project={Uri.EscapeDataString(_project)}";
    }

    private static IncusResponse ParseResponse(string text, int httpStatus)
    {
        if (string.IsNullOrWhiteSpace(text))
            throw new IncusApiException($"Empty Incus response (HTTP {httpStatus})", httpStatus);
        try
        {
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;
            var type = root.TryGetProperty("type", out var t) ? t.GetString() ?? "" : "";
            var operation = root.TryGetProperty("operation", out var op) ? op.GetString() : null;
            var error = root.TryGetProperty("error", out var er) ? er.GetString() : null;
            var errorCode = root.TryGetProperty("error_code", out var ec) && ec.ValueKind == JsonValueKind.Number ? ec.GetInt32() : 0;
            JsonNode? metadata = null;
            if (root.TryGetProperty("metadata", out var meta) && meta.ValueKind is not JsonValueKind.Null and not JsonValueKind.Undefined)
                metadata = JsonNode.Parse(meta.GetRawText());
            return new IncusResponse(type, operation, error, errorCode, metadata);
        }
        catch (JsonException ex)
        {
            throw new IncusApiException($"Invalid Incus JSON (HTTP {httpStatus}): {ex.Message}", httpStatus);
        }
    }

    private static HttpClientHandler CreateHandler(
        X509Certificate2 clientCert,
        string? serverFingerprint,
        bool allowInsecure,
        Action<string>? onServerFingerprint = null)
    {
        var expected = NormalizeFingerprint(serverFingerprint);
        var handler = new HttpClientHandler
        {
            ClientCertificateOptions = ClientCertificateOption.Manual,
            CheckCertificateRevocationList = false,
        };
        handler.ClientCertificates.Add(clientCert);
        handler.ServerCertificateCustomValidationCallback = (_, cert, _, errors) =>
        {
            if (cert == null) return false;
            var fp = Sha256Fingerprint(cert);
            onServerFingerprint?.Invoke(fp);
            if (errors == SslPolicyErrors.None) return true;
            if (!string.IsNullOrEmpty(expected)
                && string.Equals(fp, expected, StringComparison.OrdinalIgnoreCase))
                return true;
            return allowInsecure;
        };
        return handler;
    }

    public static void EnsureClientIdentity(string certPath, string keyPath, out X509Certificate2 cert)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(certPath)!);
        if (File.Exists(certPath) && File.Exists(keyPath))
        {
            using var pemCert = X509Certificate2.CreateFromPemFile(certPath, keyPath);
            var pfx = pemCert.Export(X509ContentType.Pfx, "");
            cert = new X509Certificate2(pfx, "", X509KeyStorageFlags.Exportable | X509KeyStorageFlags.UserKeySet);
            return;
        }

        using var ecdsa = ECDsa.Create(ECCurve.NamedCurves.nistP384);
        var req = new CertificateRequest("CN=bndz-incus-client", ecdsa, HashAlgorithmName.SHA384);
        using var created = req.CreateSelfSigned(DateTimeOffset.UtcNow.AddDays(-1), DateTimeOffset.UtcNow.AddYears(10));
        var certPem = new string(PemEncoding.Write("CERTIFICATE", created.RawData));
        var keyPem = ecdsa.ExportPkcs8PrivateKeyPem();
        File.WriteAllText(certPath, certPem + "\n");
        File.WriteAllText(keyPath, keyPem + "\n");
        var pfxBytes = created.Export(X509ContentType.Pfx, "");
        cert = new X509Certificate2(pfxBytes, "", X509KeyStorageFlags.Exportable | X509KeyStorageFlags.UserKeySet);
    }

    private static string ExportCertificatePem(X509Certificate2 cert) =>
        new string(PemEncoding.Write("CERTIFICATE", cert.RawData)) + "\n";

    private static string Sha256Fingerprint(X509Certificate2 cert) =>
        Convert.ToHexString(SHA256.HashData(cert.RawData)).ToLowerInvariant();

    private static string Sha256Fingerprint(X509Certificate cert) =>
        Convert.ToHexString(SHA256.HashData(cert.GetRawCertData())).ToLowerInvariant();

    private static string? NormalizeFingerprint(string? fp)
    {
        if (string.IsNullOrWhiteSpace(fp)) return null;
        return fp.Replace(":", "", StringComparison.Ordinal)
            .Replace(" ", "", StringComparison.Ordinal)
            .ToLowerInvariant();
    }

    public ValueTask DisposeAsync()
    {
        if (_disposed) return ValueTask.CompletedTask;
        _disposed = true;
        _http.Dispose();
        _clientCert.Dispose();
        return ValueTask.CompletedTask;
    }

    private sealed record IncusResponse(string type, string? operation, string? error, int errorCode, JsonNode? metadata);
}

public sealed class IncusApiException : Exception
{
    public int StatusCode { get; }
    public IncusApiException(string message, int statusCode = 0) : base(message) => StatusCode = statusCode;
}
