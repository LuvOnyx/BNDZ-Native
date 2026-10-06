using System.Net;
using DiskAccessLibrary.FileSystems.Abstractions;
using SMBLibrary;
using SMBLibrary.Adapters;
using SMBLibrary.Authentication.GSSAPI;
using SMBLibrary.Authentication.NTLM;
using SMBLibrary.Server;

namespace BNDZ.Services.LanShare;

/// <summary>
/// Opt-in SMB via LGPL SMBLibrary (see THIRD_PARTY_NOTICES/COPYPARTY-LAN-SHARE.md).
/// Direct TCP transport. Default Windows ports may need elevation — we prefer 3945.
/// </summary>
internal sealed class LanShareSmbHost : IDisposable
{
    private readonly string _root;
    private readonly string _shareName;
    private readonly IPAddress _bind;
    private readonly string _username;
    private readonly string _password;
    private readonly bool _allowWrite;
    private SMBServer? _server;

    public string? Note { get; private set; }

    public LanShareSmbHost(string rootFolder, string shareName, IPAddress bindAddress, string username, string? password, bool allowWrite)
    {
        _root = Path.GetFullPath(rootFolder);
        _shareName = Sanitize(shareName);
        _bind = bindAddress;
        _username = string.IsNullOrWhiteSpace(username) ? "bndz" : username.Trim();
        _password = password ?? "";
        _allowWrite = allowWrite;
    }

    public void Start()
    {
        IFileSystem fs = new LanShareDirectoryFileSystem(_root, _allowWrite);
        var store = new NTFileSystemAdapter(fs);
        var shares = new SMBShareCollection();
        shares.Add(new FileSystemShare(_shareName, store));

        GetUserPassword getPassword = user =>
            string.Equals(user, _username, StringComparison.OrdinalIgnoreCase) ? _password : null;
        var ntlm = new IndependentNTLMAuthenticationProvider(getPassword);
        var auth = new GSSProvider(ntlm);

        _server = new SMBServer(shares, auth);
        // SMBLibrary DirectTCP listens on 445 by design for DirectTCPTransport.
        // Binding a custom port is not exposed in 1.5.4 Start() — use 445 on LAN IP (may need admin).
        try
        {
            _server.Start(_bind, SMBTransportType.DirectTCPTransport, enableSMB1: false, enableSMB2: true, enableSMB3: true, connectionInactivityTimeout: null);
            Note = $"SMB2/3 on {_bind}:445 share \\\\{_bind}\\{_shareName} (SMB1 off; LGPL; may need elevation). User '{_username}'.";
        }
        catch (Exception ex)
        {
            Note = $"SMB failed (often needs admin for port 445): {ex.Message}";
            throw new InvalidOperationException(Note, ex);
        }
    }

    public void Dispose()
    {
        try { _server?.Stop(); } catch { /* */ }
        _server = null;
    }

    private static string Sanitize(string name)
    {
        var s = new string((name ?? "BNDZ").Where(ch => char.IsLetterOrDigit(ch) || ch is '_' or '-').ToArray());
        return string.IsNullOrWhiteSpace(s) ? "BNDZ" : (s.Length > 80 ? s[..80] : s);
    }
}
