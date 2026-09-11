using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace BNDZ.Services;

public sealed class ZkVaultSession
{
    public string VaultId { get; set; } = "";
    public string SourcePath { get; set; } = "";
    public string MountPath { get; set; } = "";
    public string Mode { get; set; } = "files";
    public DateTime UnlockedUtc { get; set; }
    public bool IsLocked { get; set; }
}

public sealed class ZkVaultStatus
{
    public List<ZkVaultSession> Sessions { get; set; } = new();
    public int VaultCount { get; set; }
}

/// <summary>Folder encrypt-at-rest; unlock mounts decrypted copies to a temp session folder.</summary>
public sealed class ZkVaultService
{
    private static readonly Lazy<ZkVaultService> Lazy = new(() => new ZkVaultService());
    public static ZkVaultService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private const string VaultMarker = ".bndzvault";
    private const string EncryptedExt = ".bndzvault";

    private readonly string _vaultMetaDir;
    private readonly string _sessionRoot;
    private readonly Dictionary<string, ZkVaultSession> _sessions = new(StringComparer.OrdinalIgnoreCase);
    private readonly Dictionary<string, byte[]> _sessionKeys = new(StringComparer.OrdinalIgnoreCase);

    private ZkVaultService()
    {
        var local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ");
        _vaultMetaDir = Path.Combine(local, "Vaults");
        _sessionRoot = Path.Combine(Path.GetTempPath(), "BNDZ-VaultSessions");
        Directory.CreateDirectory(_vaultMetaDir);
        Directory.CreateDirectory(_sessionRoot);
    }

    public ZkVaultStatus GetStatus()
    {
        var vaultCount = Directory.Exists(_vaultMetaDir)
            ? Directory.EnumerateFiles(_vaultMetaDir, "*.json").Count()
            : 0;
        return new ZkVaultStatus
        {
            VaultCount = vaultCount,
            Sessions = _sessions.Values.Where(s => !s.IsLocked).ToList(),
        };
    }

    public string CreateVault(string folderWinPath, string password, string mode = "files")
    {
        var folder = Path.GetFullPath(folderWinPath);
        if (!Directory.Exists(folder)) throw new DirectoryNotFoundException(folder);
        if (string.IsNullOrWhiteSpace(password)) throw new ArgumentException("Password required");

        var vaultId = Guid.NewGuid().ToString("N");
        var key = DeriveKey(password);
        var meta = new
        {
            vaultId,
            sourcePath = folder,
            mode,
            createdUtc = DateTime.UtcNow,
        };
        File.WriteAllText(Path.Combine(_vaultMetaDir, $"{vaultId}.json"), JsonSerializer.Serialize(meta, Json));

        var marker = Path.Combine(folder, VaultMarker);
        File.WriteAllText(marker, JsonSerializer.Serialize(new { vaultId, mode }, Json));

        if (string.Equals(mode, "container", StringComparison.OrdinalIgnoreCase))
        {
            EncryptTree(folder, key, deleteOriginals: false);
        }
        else
        {
            EncryptTree(folder, key, deleteOriginals: true);
        }

        return vaultId;
    }

    public ZkVaultSession UnlockVault(string vaultPathOrFolder, string password)
    {
        var folder = ResolveVaultFolder(vaultPathOrFolder);
        if (string.IsNullOrEmpty(folder) || !Directory.Exists(folder))
            throw new DirectoryNotFoundException("Vault folder not found");

        var vaultId = ReadVaultId(folder) ?? Guid.NewGuid().ToString("N");
        var key = DeriveKey(password);
        var mount = Path.Combine(_sessionRoot, vaultId);
        if (Directory.Exists(mount))
        {
            try { Directory.Delete(mount, true); } catch { /* recreate */ }
        }
        Directory.CreateDirectory(mount);

        DecryptTreeToMount(folder, mount, key);

        var session = new ZkVaultSession
        {
            VaultId = vaultId,
            SourcePath = folder,
            MountPath = mount,
            Mode = ReadVaultMode(folder),
            UnlockedUtc = DateTime.UtcNow,
            IsLocked = false,
        };
        _sessions[vaultId] = session;
        _sessionKeys[vaultId] = key;
        return session;
    }

    public bool LockVault(string vaultId)
    {
        if (!_sessions.TryGetValue(vaultId, out var session)) return false;
        session.IsLocked = true;
        _sessionKeys.Remove(vaultId);
        _sessions.Remove(vaultId);
        try
        {
            if (Directory.Exists(session.MountPath))
                SecureDeleteTree(session.MountPath);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ZkVault] Lock cleanup failed: {ex.Message}");
        }
        return true;
    }

    /// <summary>Overwrite file contents then delete — avoid leaving plaintext vault sessions in %TEMP%.</summary>
    private static void SecureDeleteTree(string root)
    {
        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            try
            {
                var len = new FileInfo(file).Length;
                if (len > 0 && len < 64 * 1024 * 1024)
                {
                    using var fs = new FileStream(file, FileMode.Open, FileAccess.Write, FileShare.None);
                    var buf = new byte[Math.Min(len, 1024 * 1024)];
                    Array.Clear(buf, 0, buf.Length);
                    long remaining = len;
                    while (remaining > 0)
                    {
                        var n = (int)Math.Min(buf.Length, remaining);
                        fs.Write(buf, 0, n);
                        remaining -= n;
                    }
                    fs.Flush(true);
                }
            }
            catch { /* best effort */ }
            try { File.Delete(file); } catch { /* ignore */ }
        }
        try { Directory.Delete(root, true); } catch { /* ignore */ }
    }

    public ZkVaultSession? GetSession(string vaultId) =>
        _sessions.TryGetValue(vaultId, out var s) && !s.IsLocked ? s : null;

    private void EncryptTree(string root, byte[] key, bool deleteOriginals)
    {
        foreach (var file in Directory.EnumerateFiles(root, "*", SearchOption.AllDirectories))
        {
            if (file.EndsWith(EncryptedExt, StringComparison.OrdinalIgnoreCase)
                || file.EndsWith(VaultMarker, StringComparison.OrdinalIgnoreCase))
                continue;

            var encPath = file + EncryptedExt;
            EncryptFile(file, encPath, key);
            if (deleteOriginals)
            {
                try { File.Delete(file); } catch { /* best effort */ }
            }
        }
    }

    private void DecryptTreeToMount(string vaultRoot, string mountRoot, byte[] key)
    {
        foreach (var enc in Directory.EnumerateFiles(vaultRoot, "*" + EncryptedExt, SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(vaultRoot, enc);
            var outRel = rel.EndsWith(EncryptedExt, StringComparison.OrdinalIgnoreCase)
                ? rel[..^EncryptedExt.Length]
                : rel;
            var dest = Path.Combine(mountRoot, outRel);
            var destDir = Path.GetDirectoryName(dest);
            if (!string.IsNullOrEmpty(destDir)) Directory.CreateDirectory(destDir);
            DecryptFile(enc, dest, key);
        }

        // Also copy non-encrypted files that remain in container mode
        foreach (var plain in Directory.EnumerateFiles(vaultRoot, "*", SearchOption.AllDirectories))
        {
            if (plain.EndsWith(EncryptedExt, StringComparison.OrdinalIgnoreCase)
                || plain.EndsWith(VaultMarker, StringComparison.OrdinalIgnoreCase))
                continue;
            var rel = Path.GetRelativePath(vaultRoot, plain);
            var dest = Path.Combine(mountRoot, rel);
            var destDir = Path.GetDirectoryName(dest);
            if (!string.IsNullOrEmpty(destDir)) Directory.CreateDirectory(destDir);
            if (!File.Exists(dest)) File.Copy(plain, dest, overwrite: false);
        }
    }

    private static void EncryptFile(string src, string dest, byte[] key)
    {
        using var aes = Aes.Create();
        aes.Key = key;
        aes.GenerateIV();
        using var fsOut = File.Create(dest);
        fsOut.Write(aes.IV, 0, aes.IV.Length);
        using var encryptor = aes.CreateEncryptor(aes.Key, aes.IV);
        using var cs = new CryptoStream(fsOut, encryptor, CryptoStreamMode.Write);
        using var fsIn = File.OpenRead(src);
        fsIn.CopyTo(cs);
    }

    private static void DecryptFile(string src, string dest, byte[] key)
    {
        using var fsIn = File.OpenRead(src);
        var iv = new byte[16];
        if (fsIn.Read(iv, 0, iv.Length) != iv.Length)
            throw new InvalidDataException("Invalid vault file");
        using var aes = Aes.Create();
        aes.Key = key;
        aes.IV = iv;
        using var decryptor = aes.CreateDecryptor(aes.Key, aes.IV);
        using var cs = new CryptoStream(fsIn, decryptor, CryptoStreamMode.Read);
        using var fsOut = File.Create(dest);
        cs.CopyTo(fsOut);
    }

    private static byte[] DeriveKey(string password)
    {
        var salt = Encoding.UTF8.GetBytes("BNDZ-ZkVault-v1");
        return Rfc2898DeriveBytes.Pbkdf2(password, salt, 32, HashAlgorithmName.SHA256, 100_000);
    }

    private static string? ResolveVaultFolder(string path)
    {
        var full = Path.GetFullPath(path);
        if (Directory.Exists(full)) return full;
        if (File.Exists(full)) return Path.GetDirectoryName(full);
        return null;
    }

    private static string? ReadVaultId(string folder)
    {
        var marker = Path.Combine(folder, VaultMarker);
        if (!File.Exists(marker)) return null;
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(marker));
            return doc.RootElement.TryGetProperty("vaultId", out var id) ? id.GetString() : null;
        }
        catch
        {
            return null;
        }
    }

    private static string ReadVaultMode(string folder)
    {
        var marker = Path.Combine(folder, VaultMarker);
        if (!File.Exists(marker)) return "files";
        try
        {
            using var doc = JsonDocument.Parse(File.ReadAllText(marker));
            return doc.RootElement.TryGetProperty("mode", out var m) ? m.GetString() ?? "files" : "files";
        }
        catch
        {
            return "files";
        }
    }
}
