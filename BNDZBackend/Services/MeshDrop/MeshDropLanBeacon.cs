using System.Collections.Concurrent;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;

namespace BNDZ.Services.MeshDrop;

/// <summary>LAN offer HTTP endpoint + UDP discovery beacons (Zeroconf package is browse-only).</summary>
public sealed class MeshDropLanBeacon : IDisposable
{
    private const int DefaultPort = 0;
    private const int UdpPort = 47654;

    private readonly HttpListener _http = new();
    private readonly CancellationTokenSource _cts = new();
    private Task? _httpTask;
    private Task? _beaconTask;
    private UdpClient? _udp;
    private string _meshCode = "";
    private string _sessionId = "";
    private string _label = "";

    public int HttpPort { get; private set; }
    public string? LocalAddress { get; private set; }

    public static string? GetPrimaryLanAddress()
    {
        foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up) continue;
            if (ni.NetworkInterfaceType is System.Net.NetworkInformation.NetworkInterfaceType.Loopback
                or System.Net.NetworkInformation.NetworkInterfaceType.Tunnel) continue;
            foreach (var addr in ni.GetIPProperties().UnicastAddresses)
            {
                if (addr.Address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(addr.Address))
                    return addr.Address.ToString();
            }
        }
        return null;
    }

    public void Start(string sessionId, string meshCode, string label)
    {
        Stop();
        _sessionId = sessionId;
        _meshCode = meshCode;
        _label = label;
        LocalAddress = GetPrimaryLanAddress() ?? "127.0.0.1";

        HttpPort = FindFreeTcpPort();
        _http.Prefixes.Clear();
        _http.Prefixes.Add($"http://127.0.0.1:{HttpPort}/");
        if (LocalAddress != "127.0.0.1")
            _http.Prefixes.Add($"http://{LocalAddress}:{HttpPort}/");
        _http.Start();
        _httpTask = Task.Run(() => HttpLoopAsync(_cts.Token));

        try
        {
            _udp = new UdpClient { EnableBroadcast = true };
            _beaconTask = Task.Run(() => BeaconLoopAsync(_cts.Token));
        }
        catch { /* UDP optional */ }
    }

    public void Stop()
    {
        _cts.Cancel();
        try { _http.Stop(); } catch { /* */ }
        _udp?.Close();
        _udp = null;
    }

    public void Dispose()
    {
        Stop();
        _cts.Dispose();
    }

    private async Task HttpLoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            HttpListenerContext? ctx = null;
            try
            {
                ctx = await _http.GetContextAsync().WaitAsync(ct).ConfigureAwait(false);
            }
            catch (OperationCanceledException) { break; }
            catch { continue; }

            try
            {
                var path = ctx.Request.Url?.AbsolutePath?.TrimEnd('/') ?? "";
                byte[] body;
                string contentType;
                if (path.EndsWith("/meshdrop/offer", StringComparison.OrdinalIgnoreCase)
                    || path.EndsWith("/offer", StringComparison.OrdinalIgnoreCase))
                {
                    var json = JsonSerializer.Serialize(new
                    {
                        sessionId = _sessionId,
                        meshCode = _meshCode,
                        label = _label,
                        host = Environment.MachineName,
                    });
                    body = Encoding.UTF8.GetBytes(json);
                    contentType = "application/json";
                }
                else
                {
                    body = Encoding.UTF8.GetBytes("BNDZ Mesh Drop");
                    contentType = "text/plain";
                }

                ctx.Response.Headers.Add("Access-Control-Allow-Origin", "*");
                ctx.Response.ContentType = contentType;
                ctx.Response.ContentLength64 = body.Length;
                await ctx.Response.OutputStream.WriteAsync(body, ct).ConfigureAwait(false);
                ctx.Response.Close();
            }
            catch
            {
                try { ctx?.Response.Abort(); } catch { /* */ }
            }
        }
    }

    private async Task BeaconLoopAsync(CancellationToken ct)
    {
        if (_udp == null) return;
        var payload = JsonSerializer.Serialize(new
        {
            type = "BNDZ_MESHDROP_PONG",
            sessionId = _sessionId,
            host = Environment.MachineName,
            label = _label,
            address = LocalAddress,
            port = HttpPort,
        });
        var bytes = Encoding.UTF8.GetBytes(payload);
        var broadcast = new IPEndPoint(IPAddress.Broadcast, UdpPort);

        while (!ct.IsCancellationRequested)
        {
            try { _udp.Send(bytes, bytes.Length, broadcast); }
            catch { /* ignore */ }
            try { await Task.Delay(1500, ct).ConfigureAwait(false); }
            catch (OperationCanceledException) { break; }
        }
    }

    public static async Task<IReadOnlyList<MeshDropLanPeer>> DiscoverAsync(TimeSpan timeout, CancellationToken ct = default)
    {
        var results = new ConcurrentDictionary<string, MeshDropLanPeer>();
        using var udp = new UdpClient { EnableBroadcast = true };
        udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
        try { udp.Client.Bind(new IPEndPoint(IPAddress.Any, UdpPort)); }
        catch { /* port in use — still try resolve path */ }

        var ping = Encoding.UTF8.GetBytes("{\"type\":\"BNDZ_MESHDROP_PING\"}");
        try
        {
            udp.Send(ping, ping.Length, new IPEndPoint(IPAddress.Broadcast, UdpPort));
        }
        catch { /* */ }

        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
        {
            try
            {
                var receiveTask = udp.ReceiveAsync();
                var delayTask = Task.Delay(350, ct);
                var finished = await Task.WhenAny(receiveTask, delayTask).ConfigureAwait(false);
                if (finished != receiveTask) continue;
                var receive = receiveTask.Result;
                var text = Encoding.UTF8.GetString(receive.Buffer);
                using var doc = JsonDocument.Parse(text);
                var root = doc.RootElement;
                if (root.TryGetProperty("type", out var t) && t.GetString() != "BNDZ_MESHDROP_PONG") continue;
                var addr = root.TryGetProperty("address", out var aEl) ? aEl.GetString() ?? receive.RemoteEndPoint.Address.ToString() : receive.RemoteEndPoint.Address.ToString();
                var port = root.TryGetProperty("port", out var pEl) ? pEl.GetInt32() : 0;
                var name = root.TryGetProperty("host", out var hEl) ? hEl.GetString() ?? "BNDZ Peer" : "BNDZ Peer";
                var sessionId = root.TryGetProperty("sessionId", out var sEl) ? sEl.GetString() : null;
                var key = $"{addr}:{port}";
                results[key] = new MeshDropLanPeer
                {
                    DisplayName = name,
                    HostName = name,
                    Address = addr,
                    Port = port,
                    SessionHint = sessionId,
                };
            }
            catch (OperationCanceledException) { break; }
            catch { /* malformed */ }
        }

        // Zeroconf browse fallback (other BNDZ versions may publish mDNS)
        try
        {
            var hosts = await Zeroconf.ZeroconfResolver.ResolveAsync("_bndz-meshdrop._tcp.local.", TimeSpan.FromSeconds(2)).ConfigureAwait(false);
            foreach (var host in hosts)
            {
                var addr = host.IPAddress;
                if (string.IsNullOrEmpty(addr)) continue;
                var port = host.Services.Values.FirstOrDefault()?.Port ?? 0;
                var name = host.DisplayName?.Replace("._bndz-meshdrop._tcp.local.", "") ?? host.DisplayName ?? "BNDZ Peer";
                var key = $"{addr}:{port}";
                results.TryAdd(key, new MeshDropLanPeer
                {
                    DisplayName = name,
                    HostName = name,
                    Address = addr,
                    Port = port,
                });
            }
        }
        catch { /* optional */ }

        return results.Values.ToList();
    }

    public static async Task<string?> FetchOfferMeshCodeAsync(string address, int port, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(address) || port <= 0) return null;
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        var url = $"http://{address}:{port}/meshdrop/offer";
        try
        {
            var json = await http.GetStringAsync(url, ct).ConfigureAwait(false);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("meshCode", out var codeEl))
                return codeEl.GetString();
        }
        catch { /* */ }
        return null;
    }

    private static int FindFreeTcpPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, DefaultPort);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }
}
