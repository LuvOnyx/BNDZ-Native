using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Text;
using FxSsh.Services;

namespace BNDZ.Services.LanShare;

/// <summary>
/// Minimal SFTP v3 subsystem rooted at a folder. MIT-safe BNDZ code (not FxSsh.Sftp — that lives on FxSsh dev, not NuGet 1.4).
/// Supports INIT/VERSION, REALPATH, STAT/LSTAT/FSTAT, OPENDIR/READDIR, OPEN/READ/WRITE/CLOSE, MKDIR/RMDIR/REMOVE/RENAME when allowWrite.
/// </summary>
internal sealed class LanShareSftpSubsystem : IDisposable
{
    private const byte FxpInit = 1;
    private const byte FxpVersion = 2;
    private const byte FxpOpen = 3;
    private const byte FxpClose = 4;
    private const byte FxpRead = 5;
    private const byte FxpWrite = 6;
    private const byte FxpLstat = 7;
    private const byte FxpFstat = 8;
    private const byte FxpOpendir = 11;
    private const byte FxpReaddir = 12;
    private const byte FxpRemove = 13;
    private const byte FxpMkdir = 14;
    private const byte FxpRmdir = 15;
    private const byte FxpRealpath = 16;
    private const byte FxpStat = 17;
    private const byte FxpRename = 18;
    private const byte FxpStatus = 101;
    private const byte FxpHandle = 102;
    private const byte FxpData = 103;
    private const byte FxpName = 104;
    private const byte FxpAttrs = 105;

    private const uint FxOk = 0;
    private const uint FxEof = 1;
    private const uint FxNoSuchFile = 2;
    private const uint FxPermissionDenied = 3;
    private const uint FxFailure = 4;
    private const uint FxOpUnsupported = 8;

    private const uint AttrSize = 0x00000001;
    private const uint AttrPermissions = 0x00000004;
    private const uint AttrAcmodtime = 0x00000008;

    private readonly string _root;
    private readonly bool _allowWrite;
    private readonly ConcurrentDictionary<string, object> _handles = new(StringComparer.Ordinal);
    private Channel? _channel;
    private readonly MemoryStream _rx = new();
    private int _handleSeq;

    public LanShareSftpSubsystem(string root, bool allowWrite)
    {
        _root = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        _allowWrite = allowWrite;
    }

    public void Attach(Channel channel)
    {
        _channel = channel;
        channel.DataReceived += OnData;
        channel.CloseReceived += (_, _) => Dispose();
    }

    public void Dispose()
    {
        foreach (var kv in _handles)
        {
            try
            {
                if (kv.Value is FileStream fs) fs.Dispose();
                else if (kv.Value is DirectoryCursor dc) { /* */ }
            }
            catch { /* */ }
        }
        _handles.Clear();
        try { _rx.Dispose(); } catch { /* */ }
    }

    private void OnData(object? sender, ReadOnlyMemory<byte> data)
    {
        lock (_rx)
        {
            _rx.Write(data.Span);
            while (TryReadPacket(out var packet))
                HandlePacket(packet);
        }
    }

    private bool TryReadPacket(out byte[] packet)
    {
        packet = Array.Empty<byte>();
        if (_rx.Length < 4) return false;
        var buf = _rx.GetBuffer();
        var len = BinaryPrimitives.ReadUInt32BigEndian(buf.AsSpan(0, 4));
        if (len is 0 or > 4_000_000) { _rx.SetLength(0); return false; }
        if (_rx.Length < 4 + len) return false;
        packet = new byte[len];
        Buffer.BlockCopy(buf, 4, packet, 0, (int)len);
        var remain = (int)(_rx.Length - (4 + len));
        if (remain > 0)
        {
            var rest = new byte[remain];
            Buffer.BlockCopy(buf, (int)(4 + len), rest, 0, remain);
            _rx.SetLength(0);
            _rx.Write(rest);
        }
        else _rx.SetLength(0);
        return true;
    }

    private void HandlePacket(byte[] packet)
    {
        if (packet.Length < 1) return;
        var type = packet[0];
        var off = 1;
        try
        {
            switch (type)
            {
                case FxpInit:
                    Send(BuildVersion());
                    break;
                case FxpRealpath:
                case FxpStat:
                case FxpLstat:
                {
                    var id = ReadU32(packet, ref off);
                    var path = ReadString(packet, ref off);
                    if (!TryMap(path, out var mapped, out var err))
                    { Send(BuildStatus(id, err)); break; }
                    if (type == FxpRealpath)
                    {
                        var virt = ToVirtual(mapped);
                        Send(BuildName(id, virt, AttrsFor(mapped)));
                    }
                    else
                    {
                        if (!Exists(mapped)) { Send(BuildStatus(id, FxNoSuchFile)); break; }
                        Send(BuildAttrs(id, AttrsFor(mapped)));
                    }
                    break;
                }
                case FxpOpendir:
                {
                    var id = ReadU32(packet, ref off);
                    var path = ReadString(packet, ref off);
                    if (!TryMap(path, out var mapped, out var err)) { Send(BuildStatus(id, err)); break; }
                    if (!Directory.Exists(mapped)) { Send(BuildStatus(id, FxNoSuchFile)); break; }
                    var h = NextHandle();
                    var names = Directory.EnumerateFileSystemEntries(mapped).ToList();
                    _handles[h] = new DirectoryCursor(names);
                    Send(BuildHandle(id, h));
                    break;
                }
                case FxpReaddir:
                {
                    var id = ReadU32(packet, ref off);
                    var h = ReadString(packet, ref off);
                    if (!_handles.TryGetValue(h, out var obj) || obj is not DirectoryCursor cur)
                    { Send(BuildStatus(id, FxFailure)); break; }
                    if (cur.Index >= cur.Names.Count) { Send(BuildStatus(id, FxEof)); break; }
                    var batch = new List<(string name, FileAttrs attrs)>();
                    while (cur.Index < cur.Names.Count && batch.Count < 64)
                    {
                        var full = cur.Names[cur.Index++];
                        var name = Path.GetFileName(full) ?? full;
                        batch.Add((name, AttrsFor(full)));
                    }
                    Send(BuildNameMulti(id, batch));
                    break;
                }
                case FxpOpen:
                {
                    var id = ReadU32(packet, ref off);
                    var path = ReadString(packet, ref off);
                    var pflags = ReadU32(packet, ref off);
                    // skip attrs
                    if (!TryMap(path, out var mapped, out var err)) { Send(BuildStatus(id, err)); break; }
                    var write = (pflags & (0x00000002 | 0x00000008 | 0x00000010)) != 0; // WRITE|CREAT|TRUNC
                    if (write && !_allowWrite) { Send(BuildStatus(id, FxPermissionDenied)); break; }
                    try
                    {
                        FileMode mode = FileMode.Open;
                        if ((pflags & 0x08) != 0) mode = FileMode.OpenOrCreate;
                        if ((pflags & 0x10) != 0) mode = FileMode.Create;
                        if ((pflags & 0x20) != 0) mode = FileMode.Append;
                        var access = write ? FileAccess.ReadWrite : FileAccess.Read;
                        if ((pflags & 0x01) != 0 && !write) access = FileAccess.Read;
                        var fs = new FileStream(mapped, mode, access, FileShare.Read);
                        var h = NextHandle();
                        _handles[h] = fs;
                        Send(BuildHandle(id, h));
                    }
                    catch { Send(BuildStatus(id, FxFailure)); }
                    break;
                }
                case FxpRead:
                {
                    var id = ReadU32(packet, ref off);
                    var h = ReadString(packet, ref off);
                    var offset = ReadU64(packet, ref off);
                    var len = ReadU32(packet, ref off);
                    if (!_handles.TryGetValue(h, out var obj) || obj is not FileStream fs)
                    { Send(BuildStatus(id, FxFailure)); break; }
                    fs.Position = (long)offset;
                    var take = (int)Math.Min(len, 64 * 1024);
                    var buf = new byte[take];
                    var n = fs.Read(buf, 0, take);
                    if (n <= 0) Send(BuildStatus(id, FxEof));
                    else Send(BuildData(id, buf.AsSpan(0, n).ToArray()));
                    break;
                }
                case FxpWrite:
                {
                    var id = ReadU32(packet, ref off);
                    var h = ReadString(packet, ref off);
                    var offset = ReadU64(packet, ref off);
                    var data = ReadStringBytes(packet, ref off);
                    if (!_allowWrite) { Send(BuildStatus(id, FxPermissionDenied)); break; }
                    if (!_handles.TryGetValue(h, out var obj) || obj is not FileStream fs)
                    { Send(BuildStatus(id, FxFailure)); break; }
                    fs.Position = (long)offset;
                    fs.Write(data);
                    Send(BuildStatus(id, FxOk));
                    break;
                }
                case FxpClose:
                {
                    var id = ReadU32(packet, ref off);
                    var h = ReadString(packet, ref off);
                    if (_handles.TryRemove(h, out var obj) && obj is FileStream fs) fs.Dispose();
                    Send(BuildStatus(id, FxOk));
                    break;
                }
                case FxpFstat:
                {
                    var id = ReadU32(packet, ref off);
                    var h = ReadString(packet, ref off);
                    if (!_handles.TryGetValue(h, out var obj) || obj is not FileStream fs)
                    { Send(BuildStatus(id, FxFailure)); break; }
                    Send(BuildAttrs(id, AttrsFor(fs.Name)));
                    break;
                }
                case FxpRemove:
                case FxpRmdir:
                {
                    var id = ReadU32(packet, ref off);
                    var path = ReadString(packet, ref off);
                    if (!_allowWrite) { Send(BuildStatus(id, FxPermissionDenied)); break; }
                    if (!TryMap(path, out var mapped, out var err)) { Send(BuildStatus(id, err)); break; }
                    try
                    {
                        if (type == FxpRemove) File.Delete(mapped);
                        else Directory.Delete(mapped, recursive: false);
                        Send(BuildStatus(id, FxOk));
                    }
                    catch { Send(BuildStatus(id, FxFailure)); }
                    break;
                }
                case FxpMkdir:
                {
                    var id = ReadU32(packet, ref off);
                    var path = ReadString(packet, ref off);
                    if (!_allowWrite) { Send(BuildStatus(id, FxPermissionDenied)); break; }
                    if (!TryMap(path, out var mapped, out var err)) { Send(BuildStatus(id, err)); break; }
                    try { Directory.CreateDirectory(mapped); Send(BuildStatus(id, FxOk)); }
                    catch { Send(BuildStatus(id, FxFailure)); }
                    break;
                }
                case FxpRename:
                {
                    var id = ReadU32(packet, ref off);
                    var oldPath = ReadString(packet, ref off);
                    var newPath = ReadString(packet, ref off);
                    if (!_allowWrite) { Send(BuildStatus(id, FxPermissionDenied)); break; }
                    if (!TryMap(oldPath, out var a, out var err) || !TryMap(newPath, out var b, out err))
                    { Send(BuildStatus(id, err)); break; }
                    try
                    {
                        if (File.Exists(a)) File.Move(a, b);
                        else if (Directory.Exists(a)) Directory.Move(a, b);
                        else { Send(BuildStatus(id, FxNoSuchFile)); break; }
                        Send(BuildStatus(id, FxOk));
                    }
                    catch { Send(BuildStatus(id, FxFailure)); }
                    break;
                }
                default:
                {
                    // Unknown: try to reply STATUS with id if present
                    if (packet.Length >= 5)
                    {
                        off = 1;
                        var id = ReadU32(packet, ref off);
                        Send(BuildStatus(id, FxOpUnsupported));
                    }
                    break;
                }
            }
        }
        catch
        {
            // best-effort; drop bad packet
        }
    }

    private string NextHandle() => $"h{Interlocked.Increment(ref _handleSeq)}";

    private bool TryMap(string virt, out string mapped, out uint err)
    {
        mapped = _root;
        err = FxOk;
        var rel = (virt ?? "/").Replace('\\', '/');
        if (rel.StartsWith("//", StringComparison.Ordinal)) rel = rel[1..];
        rel = rel.TrimStart('/');
        if (rel.Contains("..", StringComparison.Ordinal)) { err = FxPermissionDenied; return false; }
        mapped = Path.GetFullPath(Path.Combine(_root, rel.Replace('/', Path.DirectorySeparatorChar)));
        if (!mapped.StartsWith(_root, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(mapped.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, _root, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(mapped, _root.TrimEnd(Path.DirectorySeparatorChar), StringComparison.OrdinalIgnoreCase))
        {
            err = FxPermissionDenied;
            return false;
        }
        return true;
    }

    private string ToVirtual(string mapped)
    {
        var full = Path.GetFullPath(mapped);
        if (full.StartsWith(_root, StringComparison.OrdinalIgnoreCase))
        {
            var rel = full[_root.Length..].Replace('\\', '/');
            return "/" + rel.TrimStart('/');
        }
        return "/";
    }

    private static bool Exists(string path) => File.Exists(path) || Directory.Exists(path);

    private static FileAttrs AttrsFor(string path)
    {
        if (Directory.Exists(path))
        {
            var di = new DirectoryInfo(path);
            return new FileAttrs
            {
                Flags = AttrPermissions | AttrAcmodtime,
                Permissions = 0x4000 | 0x1FF, // dir + 0777
                Atime = (uint)new DateTimeOffset(di.LastAccessTimeUtc).ToUnixTimeSeconds(),
                Mtime = (uint)new DateTimeOffset(di.LastWriteTimeUtc).ToUnixTimeSeconds(),
            };
        }
        var fi = new FileInfo(path);
        return new FileAttrs
        {
            Flags = AttrSize | AttrPermissions | AttrAcmodtime,
            Size = (ulong)Math.Max(0, fi.Length),
            Permissions = 0x8000 | 0x1FF,
            Atime = (uint)new DateTimeOffset(fi.LastAccessTimeUtc).ToUnixTimeSeconds(),
            Mtime = (uint)new DateTimeOffset(fi.LastWriteTimeUtc).ToUnixTimeSeconds(),
        };
    }

    private void Send(byte[] body)
    {
        if (_channel is null) return;
        var packet = new byte[4 + body.Length];
        BinaryPrimitives.WriteUInt32BigEndian(packet.AsSpan(0, 4), (uint)body.Length);
        Buffer.BlockCopy(body, 0, packet, 4, body.Length);
        try { _channel.SendData(packet); } catch { /* */ }
    }

    private static byte[] BuildVersion()
    {
        using var ms = new MemoryStream();
        ms.WriteByte(FxpVersion);
        WriteU32(ms, 3);
        return ms.ToArray();
    }

    private static byte[] BuildStatus(uint id, uint code)
    {
        using var ms = new MemoryStream();
        ms.WriteByte(FxpStatus);
        WriteU32(ms, id);
        WriteU32(ms, code);
        WriteString(ms, "");
        WriteString(ms, "");
        return ms.ToArray();
    }

    private static byte[] BuildHandle(uint id, string handle)
    {
        using var ms = new MemoryStream();
        ms.WriteByte(FxpHandle);
        WriteU32(ms, id);
        WriteString(ms, handle);
        return ms.ToArray();
    }

    private static byte[] BuildData(uint id, byte[] data)
    {
        using var ms = new MemoryStream();
        ms.WriteByte(FxpData);
        WriteU32(ms, id);
        WriteBytes(ms, data);
        return ms.ToArray();
    }

    private static byte[] BuildAttrs(uint id, FileAttrs attrs)
    {
        using var ms = new MemoryStream();
        ms.WriteByte(FxpAttrs);
        WriteU32(ms, id);
        WriteAttrs(ms, attrs);
        return ms.ToArray();
    }

    private static byte[] BuildName(uint id, string name, FileAttrs attrs)
    {
        return BuildNameMulti(id, new List<(string, FileAttrs)> { (name, attrs) });
    }

    private static byte[] BuildNameMulti(uint id, List<(string name, FileAttrs attrs)> entries)
    {
        using var ms = new MemoryStream();
        ms.WriteByte(FxpName);
        WriteU32(ms, id);
        WriteU32(ms, (uint)entries.Count);
        foreach (var (name, attrs) in entries)
        {
            WriteString(ms, name);
            WriteString(ms, name); // longname
            WriteAttrs(ms, attrs);
        }
        return ms.ToArray();
    }

    private static void WriteAttrs(Stream ms, FileAttrs a)
    {
        WriteU32(ms, a.Flags);
        if ((a.Flags & AttrSize) != 0) WriteU64(ms, a.Size);
        if ((a.Flags & AttrPermissions) != 0) WriteU32(ms, a.Permissions);
        if ((a.Flags & AttrAcmodtime) != 0)
        {
            WriteU32(ms, a.Atime);
            WriteU32(ms, a.Mtime);
        }
    }

    private static uint ReadU32(byte[] buf, ref int off)
    {
        var v = BinaryPrimitives.ReadUInt32BigEndian(buf.AsSpan(off, 4));
        off += 4;
        return v;
    }

    private static ulong ReadU64(byte[] buf, ref int off)
    {
        var v = BinaryPrimitives.ReadUInt64BigEndian(buf.AsSpan(off, 8));
        off += 8;
        return v;
    }

    private static string ReadString(byte[] buf, ref int off)
    {
        var b = ReadStringBytes(buf, ref off);
        return Encoding.UTF8.GetString(b);
    }

    private static byte[] ReadStringBytes(byte[] buf, ref int off)
    {
        var len = (int)ReadU32(buf, ref off);
        var slice = buf.AsSpan(off, len).ToArray();
        off += len;
        return slice;
    }

    private static void WriteU32(Stream s, uint v)
    {
        Span<byte> b = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(b, v);
        s.Write(b);
    }

    private static void WriteU64(Stream s, ulong v)
    {
        Span<byte> b = stackalloc byte[8];
        BinaryPrimitives.WriteUInt64BigEndian(b, v);
        s.Write(b);
    }

    private static void WriteString(Stream s, string v)
    {
        var bytes = Encoding.UTF8.GetBytes(v ?? "");
        WriteBytes(s, bytes);
    }

    private static void WriteBytes(Stream s, byte[] bytes)
    {
        WriteU32(s, (uint)bytes.Length);
        s.Write(bytes);
    }

    private sealed class DirectoryCursor(List<string> names)
    {
        public List<string> Names { get; } = names;
        public int Index;
    }

    private struct FileAttrs
    {
        public uint Flags;
        public ulong Size;
        public uint Permissions;
        public uint Atime;
        public uint Mtime;
    }
}
