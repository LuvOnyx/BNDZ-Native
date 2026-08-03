using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Windows.Security.Credentials.UI;

namespace BNDZ.Services;

/// <summary>
/// Windows Hello / passphrase gate for sensitive folders. Session unlock cache lasts until app exit.
/// </summary>
public sealed class HelloGateService
{
    private static readonly Lazy<HelloGateService> Lazy = new(() => new HelloGateService());
    public static HelloGateService Instance => Lazy.Value;

    private readonly string _storePath;
    private readonly object _gate = new();
    private readonly HashSet<string> _sessionUnlocked = new(StringComparer.OrdinalIgnoreCase);
    private List<HelloGateEntry> _entries = new();

    public HelloGateService()
    {
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ");
        Directory.CreateDirectory(dir);
        _storePath = Path.Combine(dir, "hello-gates.json");
        Load();
    }

    public sealed class HelloGateEntry
    {
        public string Path { get; set; } = "";
        public string? PassphraseHash { get; set; }
        public string AddedUtc { get; set; } = DateTime.UtcNow.ToString("O");
    }

    public IReadOnlyList<HelloGateEntry> ListGates()
    {
        lock (_gate) return _entries.ToList();
    }

    public void AddGate(string winPath, string? passphrase = null)
    {
        var norm = Normalize(winPath);
        lock (_gate)
        {
            _entries.RemoveAll(e => string.Equals(e.Path, norm, StringComparison.OrdinalIgnoreCase));
            _entries.Add(new HelloGateEntry
            {
                Path = norm,
                PassphraseHash = string.IsNullOrWhiteSpace(passphrase) ? null : HashPassphrase(passphrase),
                AddedUtc = DateTime.UtcNow.ToString("O"),
            });
            SaveLocked();
        }
    }

    public bool RemoveGate(string winPath)
    {
        var norm = Normalize(winPath);
        lock (_gate)
        {
            var removed = _entries.RemoveAll(e => string.Equals(e.Path, norm, StringComparison.OrdinalIgnoreCase)) > 0;
            if (removed) SaveLocked();
            _sessionUnlocked.Remove(norm);
            return removed;
        }
    }

    public bool IsBlocked(string? winPath)
    {
        if (string.IsNullOrWhiteSpace(winPath)) return false;
        var norm = Normalize(winPath);
        lock (_gate)
        {
            var gate = FindMatchingGate(norm);
            if (gate == null) return false;
            return !_sessionUnlocked.Contains(gate.Path);
        }
    }

    public string? GetBlockingGatePath(string? winPath)
    {
        if (string.IsNullOrWhiteSpace(winPath)) return null;
        var norm = Normalize(winPath);
        lock (_gate)
        {
            var gate = FindMatchingGate(norm);
            if (gate == null) return null;
            return _sessionUnlocked.Contains(gate.Path) ? null : gate.Path;
        }
    }

    public async Task<(bool ok, string? error, string method)> UnlockAsync(string winPath, string? passphrase = null)
    {
        var norm = Normalize(winPath);
        HelloGateEntry? entry;
        lock (_gate)
        {
            entry = FindMatchingGate(norm);
            if (entry == null)
                return (true, null, "none");
            if (_sessionUnlocked.Contains(entry.Path))
                return (true, null, "session");
        }

        try
        {
            var consent = await UserConsentVerifier.RequestVerificationAsync(
                $"Unlock protected folder:\n{entry.Path}");
            if (consent == UserConsentVerificationResult.Verified)
            {
                lock (_gate) _sessionUnlocked.Add(entry.Path);
                return (true, null, "hello");
            }
            if (consent == UserConsentVerificationResult.Canceled)
                return (false, "Unlock cancelled.", "cancelled");
        }
        catch
        {
            /* Hello unavailable — fall through to passphrase */
        }

        if (!string.IsNullOrEmpty(entry.PassphraseHash))
        {
            if (string.IsNullOrWhiteSpace(passphrase))
                return (false, "Passphrase required.", "passphrase");
            if (!VerifyPassphrase(passphrase, entry.PassphraseHash))
                return (false, "Incorrect passphrase.", "passphrase");
            lock (_gate) _sessionUnlocked.Add(entry.Path);
            return (true, null, "passphrase");
        }

        return (false, "Windows Hello unavailable and no backup passphrase was set for this folder.", "unavailable");
    }

    public void ClearSessionUnlocks()
    {
        lock (_gate) _sessionUnlocked.Clear();
    }

    private HelloGateEntry? FindMatchingGate(string normPath)
    {
        HelloGateEntry? best = null;
        var bestLen = -1;
        foreach (var e in _entries)
        {
            if (normPath.Equals(e.Path, StringComparison.OrdinalIgnoreCase)
                || normPath.StartsWith(e.Path + "\\", StringComparison.OrdinalIgnoreCase))
            {
                if (e.Path.Length > bestLen)
                {
                    best = e;
                    bestLen = e.Path.Length;
                }
            }
        }
        return best;
    }

    private void Load()
    {
        try
        {
            if (!File.Exists(_storePath)) return;
            var json = File.ReadAllText(_storePath);
            var list = JsonSerializer.Deserialize<List<HelloGateEntry>>(json);
            if (list != null) _entries = list;
        }
        catch { _entries = new(); }
    }

    private void SaveLocked()
    {
        try
        {
            var json = JsonSerializer.Serialize(_entries, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(_storePath, json);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[HelloGate] Save failed: {ex.Message}");
        }
    }

    private static string Normalize(string p)
    {
        try { return Path.GetFullPath(p).TrimEnd('\\'); }
        catch { return p.Replace('/', '\\').TrimEnd('\\'); }
    }

    private static string HashPassphrase(string passphrase)
    {
        var salt = Encoding.UTF8.GetBytes("BNDZ-HelloGate-v1");
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(passphrase).Concat(salt).ToArray());
        return Convert.ToBase64String(hash);
    }

    private static bool VerifyPassphrase(string passphrase, string storedHash)
        => string.Equals(HashPassphrase(passphrase), storedHash, StringComparison.Ordinal);
}
