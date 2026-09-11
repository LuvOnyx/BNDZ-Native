using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace BNDZ.Services.Mesh;

public static class MeshCredentialVault
{
    public static byte[] Protect(string secret)
    {
        if (string.IsNullOrEmpty(secret)) return [];
        return ProtectedData.Protect(Encoding.UTF8.GetBytes(secret), null, DataProtectionScope.CurrentUser);
    }

    public static string? Unprotect(byte[]? data)
    {
        if (data == null || data.Length == 0) return null;
        try
        {
            return Encoding.UTF8.GetString(ProtectedData.Unprotect(data, null, DataProtectionScope.CurrentUser));
        }
        catch { return null; }
    }

    /// <summary>Import Host entries from ~/.ssh/config (OpenSSH format).</summary>
    public static List<MeshHostRecord> ImportSshConfig()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        var configPath = Path.Combine(home, ".ssh", "config");
        if (!File.Exists(configPath)) return [];

        var text = File.ReadAllText(configPath);
        var hosts = new List<MeshHostRecord>();
        MeshHostRecord? current = null;

        foreach (var rawLine in text.Split('\n'))
        {
            var line = rawLine.Trim();
            if (line.Length == 0 || line.StartsWith('#')) continue;
            var mHost = Regex.Match(line, @"^Host\s+(.+)$", RegexOptions.IgnoreCase);
            if (mHost.Success)
            {
                var name = mHost.Groups[1].Value.Trim();
                if (name.Contains('*') || name.Contains('?')) { current = null; continue; }
                current = new MeshHostRecord
                {
                    Id = SlugId(name),
                    Alias = name,
                    Provider = MeshProviderKind.Ssh,
                    AuthKind = MeshAuthKind.Agent,
                };
                hosts.Add(current);
                continue;
            }
            if (current == null) continue;
            if (TryValue(line, "HostName", out var hn)) current.Hostname = hn;
            else if (TryValue(line, "User", out var user)) current.Username = user;
            else if (TryValue(line, "Port", out var port) && int.TryParse(port, out var p)) current.Port = p;
            else if (TryValue(line, "IdentityFile", out var key))
            {
                current.KeyPath = ExpandHome(key, home);
                current.AuthKind = MeshAuthKind.PrivateKey;
            }
            else if (TryValue(line, "CertificateFile", out var cert))
            {
                current.CertificatePath = ExpandHome(cert, home);
            }
            else if (TryValue(line, "ProxyJump", out var jump))
            {
                current.ProxyJump = jump;
            }
            else if (TryValue(line, "HostKeyAlias", out _)) { /* ignore */ }
            else if (TryValue(line, "IdentitiesOnly", out _)) { /* ignore */ }
        }

        // Second pass: also accept lowercase "proxyjump" already handled via IgnoreCase
        return hosts.Where(h => !string.IsNullOrWhiteSpace(h.Hostname)).ToList();
    }

    private static string ExpandHome(string path, string home) =>
        path.Replace("~", home).Trim('"');

    private static bool TryValue(string line, string key, out string value)
    {
        value = "";
        var m = Regex.Match(line, $@"^{key}\s+(.+)$", RegexOptions.IgnoreCase);
        if (!m.Success) return false;
        value = m.Groups[1].Value.Trim().Trim('"');
        return true;
    }

    private static string SlugId(string name) =>
        Regex.Replace(name.ToLowerInvariant(), @"[^a-z0-9]+", "-").Trim('-');
}
