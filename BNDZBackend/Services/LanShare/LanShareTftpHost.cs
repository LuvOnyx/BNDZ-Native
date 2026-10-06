using System.Net;
using System.Net.Sockets;
using System.Text;

namespace BNDZ.Services.LanShare;

/// <summary>Minimal read-only TFTP (RRQ only). Own BNDZ code — no third-party TFTP lib.</summary>
internal sealed class LanShareTftpHost : IDisposable
{
    private readonly string _root;
    private readonly IPAddress _bind;
    private readonly int _port;
    private UdpClient? _udp;
    private CancellationTokenSource? _cts;
    private Task? _loop;

    public LanShareTftpHost(string rootFolder, IPAddress bindAddress, int port)
    {
        _root = Path.GetFullPath(rootFolder);
        _bind = bindAddress;
        _port = port;
    }

    public void Start()
    {
        _cts = new CancellationTokenSource();
        _udp = new UdpClient(new IPEndPoint(_bind, _port));
        _loop = Task.Run(() => LoopAsync(_cts.Token));
    }

    public void Dispose()
    {
        try { _cts?.Cancel(); } catch { /* */ }
        try { _udp?.Close(); } catch { /* */ }
        _udp = null;
        _cts?.Dispose();
    }

    private async Task LoopAsync(CancellationToken ct)
    {
        if (_udp == null) return;
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var result = await _udp.ReceiveAsync(ct).ConfigureAwait(false);
                _ = Task.Run(() => HandleAsync(result.Buffer, result.RemoteEndPoint), ct);
            }
            catch (OperationCanceledException) { break; }
            catch { /* keep listening */ }
        }
    }

    private async Task HandleAsync(byte[] req, IPEndPoint remote)
    {
        if (req.Length < 4 || req[0] != 0 || req[1] != 1) // RRQ only
        {
            await SendErrorAsync(remote, 4, "Only RRQ supported").ConfigureAwait(false);
            return;
        }

        var filename = ReadNetascii(req, 2, out var modeStart);
        var mode = ReadNetascii(req, modeStart, out _).ToLowerInvariant();
        if (mode is not ("octet" or "netascii" or "binary" or "mail"))
        {
            await SendErrorAsync(remote, 0, "Unsupported mode").ConfigureAwait(false);
            return;
        }

        if (filename.Contains("..", StringComparison.Ordinal) || Path.IsPathRooted(filename))
        {
            await SendErrorAsync(remote, 2, "Access violation").ConfigureAwait(false);
            return;
        }

        var mapped = Path.GetFullPath(Path.Combine(_root, filename.Replace('/', Path.DirectorySeparatorChar)));
        var rootPrefix = _root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        if (!mapped.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase) &&
            !string.Equals(mapped, _root, StringComparison.OrdinalIgnoreCase))
        {
            await SendErrorAsync(remote, 2, "Access violation").ConfigureAwait(false);
            return;
        }
        if (!File.Exists(mapped))
        {
            await SendErrorAsync(remote, 1, "File not found").ConfigureAwait(false);
            return;
        }

        await using var fs = new FileStream(mapped, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
        using var xfer = new UdpClient(new IPEndPoint(_bind, 0));
        xfer.Connect(remote);
        ushort block = 1;
        var buf = new byte[516];
        while (true)
        {
            var read = await fs.ReadAsync(buf.AsMemory(4, 512)).ConfigureAwait(false);
            buf[0] = 0; buf[1] = 3; // DATA
            buf[2] = (byte)(block >> 8); buf[3] = (byte)(block & 0xff);
            await xfer.SendAsync(buf.AsMemory(0, 4 + read)).ConfigureAwait(false);
            // Wait ACK (simple, one retry)
            for (var attempt = 0; attempt < 3; attempt++)
            {
                using var ackCts = new CancellationTokenSource(TimeSpan.FromSeconds(3));
                try
                {
                    var ack = await xfer.ReceiveAsync(ackCts.Token).ConfigureAwait(false);
                    if (ack.Buffer.Length >= 4 && ack.Buffer[1] == 4)
                    {
                        var ackBlock = (ushort)((ack.Buffer[2] << 8) | ack.Buffer[3]);
                        if (ackBlock == block) break;
                    }
                }
                catch
                {
                    await xfer.SendAsync(buf.AsMemory(0, 4 + read)).ConfigureAwait(false);
                }
            }
            if (read < 512) break;
            block++;
        }
    }

    private async Task SendErrorAsync(IPEndPoint remote, ushort code, string msg)
    {
        if (_udp == null) return;
        var msgBytes = Encoding.ASCII.GetBytes(msg);
        var pkt = new byte[5 + msgBytes.Length];
        pkt[0] = 0; pkt[1] = 5;
        pkt[2] = (byte)(code >> 8); pkt[3] = (byte)(code & 0xff);
        Buffer.BlockCopy(msgBytes, 0, pkt, 4, msgBytes.Length);
        pkt[^1] = 0;
        await _udp.SendAsync(pkt, remote).ConfigureAwait(false);
    }

    private static string ReadNetascii(byte[] buf, int start, out int next)
    {
        var end = start;
        while (end < buf.Length && buf[end] != 0) end++;
        next = Math.Min(end + 1, buf.Length);
        return Encoding.ASCII.GetString(buf, start, end - start);
    }
}
