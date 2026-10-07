using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using BNDZ.Services.Mesh;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// DPAPI via the existing mesh vault, plus log redaction.
/// Plaintext tokens and private keys must not reach logs, IPC traces, or UI DTOs.
/// </summary>
public static class CloudDriveSecrets
{
    private static readonly Regex JsonSecret = new(
        "(\"(?:flyToken|token|privateKey|apiToken|password|authorization|protectedPrivateKey)\"\\s*:\\s*\")(?:\\\\.|[^\"\\\\])*(\")",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex Bearer = new(
        @"Bearer\s+\S+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    private static readonly Regex FlyToken = new(
        @"\b(?:FlyV1\s+)?fm[0-9]_[A-Za-z0-9_\-\.]+",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static string ProtectToBase64(string secret)
    {
        if (string.IsNullOrEmpty(secret)) return "";
        return Convert.ToBase64String(MeshCredentialVault.Protect(secret));
    }

    public static string? UnprotectFromBase64(string? protectedBase64)
    {
        if (string.IsNullOrWhiteSpace(protectedBase64)) return null;
        try
        {
            var raw = Convert.FromBase64String(protectedBase64);
            return MeshCredentialVault.Unprotect(raw);
        }
        catch
        {
            return null;
        }
    }

    public static string Redact(string? text)
    {
        if (string.IsNullOrEmpty(text)) return text ?? "";
        var s = JsonSecret.Replace(text, "$1[redacted]$2");
        s = Bearer.Replace(s, "Bearer [redacted]");
        s = FlyToken.Replace(s, "[redacted]");
        return s;
    }
}

public sealed class CloudDriveKeyMaterial
{
    public required string KeyType { get; init; }
    public required string PublicKey { get; init; }
    public required string Fingerprint { get; init; }
    public required byte[] PrivateKey { get; init; }
}

/// <summary>Per-drive keypair. Prefers OpenSSH ed25519; RSA is the fallback when ssh-keygen is missing.</summary>
public static class CloudDriveKeys
{
    public static CloudDriveKeyMaterial Create()
    {
        var sshKeygen = FindSshKeygen();
        if (sshKeygen != null)
        {
            try
            {
                var made = TrySshKeygen(sshKeygen);
                if (made != null) return made;
            }
            catch
            {
                /* fall through to RSA */
            }
        }
        return CreateRsa();
    }

    private static CloudDriveKeyMaterial CreateRsa()
    {
        using var rsa = RSA.Create(3072);
        var pub = RsaPublicLine(rsa);
        var priv = rsa.ExportPkcs8PrivateKey();
        return new CloudDriveKeyMaterial
        {
            KeyType = "rsa",
            PublicKey = pub,
            Fingerprint = FingerprintFromPublicLine(pub),
            PrivateKey = priv,
        };
    }

    private static CloudDriveKeyMaterial? TrySshKeygen(string exe)
    {
        var dir = Path.Combine(Path.GetTempPath(), "bndz-cd-keys-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        var keyPath = Path.Combine(dir, "id_ed25519");
        try
        {
            var code = Run(exe, new[] { "-q", "-t", "ed25519", "-f", keyPath, "-N", "", "-C", "bndz-cloud-drive" }, 15000);
            var privPath = keyPath;
            var pubPath = keyPath + ".pub";
            if (code != 0 || !File.Exists(privPath) || !File.Exists(pubPath)) return null;
            var pub = File.ReadAllText(pubPath).Trim();
            var priv = File.ReadAllBytes(privPath);
            var fp = FingerprintFromPublicLine(pub);
            return new CloudDriveKeyMaterial
            {
                KeyType = "ed25519",
                PublicKey = pub,
                Fingerprint = fp,
                PrivateKey = priv,
            };
        }
        finally
        {
            try { Directory.Delete(dir, recursive: true); } catch { /* best effort */ }
        }
    }

    public static string FingerprintFromPublicLine(string line)
    {
        var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length < 2) return "";
        byte[] blob;
        try { blob = Convert.FromBase64String(parts[1]); }
        catch { return ""; }
        var hash = SHA256.HashData(blob);
        return "SHA256:" + Convert.ToBase64String(hash).TrimEnd('=');
    }

    private static string RsaPublicLine(RSA rsa)
    {
        var p = rsa.ExportParameters(false);
        var blob = Concat(SshString("ssh-rsa"), MpInt(p.Exponent!), MpInt(p.Modulus!));
        return "ssh-rsa " + Convert.ToBase64String(blob) + " bndz-cloud-drive";
    }

    private static byte[] SshString(string s) => SshString(Encoding.ASCII.GetBytes(s));

    private static byte[] SshString(byte[] data)
    {
        var len = new byte[4];
        var n = data.Length;
        len[0] = (byte)((n >> 24) & 0xff);
        len[1] = (byte)((n >> 16) & 0xff);
        len[2] = (byte)((n >> 8) & 0xff);
        len[3] = (byte)(n & 0xff);
        var buf = new byte[4 + data.Length];
        Buffer.BlockCopy(len, 0, buf, 0, 4);
        Buffer.BlockCopy(data, 0, buf, 4, data.Length);
        return buf;
    }

    private static byte[] MpInt(byte[] mag)
    {
        if (mag.Length > 0 && (mag[0] & 0x80) != 0)
        {
            var padded = new byte[mag.Length + 1];
            Buffer.BlockCopy(mag, 0, padded, 1, mag.Length);
            mag = padded;
        }
        return SshString(mag);
    }

    private static byte[] Concat(params byte[][] parts)
    {
        var len = 0;
        foreach (var p in parts) len += p.Length;
        var buf = new byte[len];
        var o = 0;
        foreach (var p in parts)
        {
            Buffer.BlockCopy(p, 0, buf, o, p.Length);
            o += p.Length;
        }
        return buf;
    }

    private static string? FindSshKeygen()
    {
        try
        {
            var win = Path.Combine(Environment.SystemDirectory, "OpenSSH", "ssh-keygen.exe");
            if (File.Exists(win)) return win;
        }
        catch { /* non-windows */ }

        var path = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(path)) return null;
        foreach (var dir in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            foreach (var name in new[] { "ssh-keygen.exe", "ssh-keygen" })
            {
                try
                {
                    var candidate = Path.Combine(dir.Trim(), name);
                    if (File.Exists(candidate)) return candidate;
                }
                catch { /* skip bad path entries */ }
            }
        }
        return null;
    }

    private static int Run(string file, string[] args, int timeoutMs)
    {
        var psi = new System.Diagnostics.ProcessStartInfo
        {
            FileName = file,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var proc = System.Diagnostics.Process.Start(psi);
        if (proc == null) return -1;
        if (!proc.WaitForExit(timeoutMs))
        {
            try { proc.Kill(entireProcessTree: true); } catch { /* best effort */ }
            return -1;
        }
        return proc.ExitCode;
    }
}
