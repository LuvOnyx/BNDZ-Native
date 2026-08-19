using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Media.Imaging;
using WpfClipboard = System.Windows.Clipboard;

namespace BNDZ.Services;

public sealed class InboundEntry
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Type { get; set; } = "";
    public long Size { get; set; }
    public string CreatedUtc { get; set; } = "";
    public string Path { get; set; } = "";
}

public sealed class InboundVolumeService : IDisposable
{
    private static readonly Lazy<InboundVolumeService> Lazy = new(() => new InboundVolumeService());
    public static InboundVolumeService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };

    private readonly string _rootPath;
    private readonly object _lock = new();
    private Thread? _watchThread;
    private volatile bool _watching;
    private volatile bool _disposed;
    private uint _lastClipSeq;
    private int _burstCount;
    private DateTime _burstWindowUtc = DateTime.MinValue;
    private const int MaxStoredEntries = 48;
    private const int BurstMax = 6;
    private static readonly TimeSpan BurstWindow = TimeSpan.FromSeconds(12);

    private InboundVolumeService()
    {
        _rootPath = System.IO.Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Inbound", "Clipboard");
        Directory.CreateDirectory(_rootPath);
    }

    public void Dispose()
    {
        _disposed = true;
        StopWatching();
    }

    public string GetInboundRootPath() => _rootPath;

    public bool IsWatching => _watching;

    public void StartWatching()
    {
        lock (_lock)
        {
            if (_watching) return;
            _watching = true;
            _watchThread = new Thread(WatchLoop)
            {
                Name = "BNDZ-ClipWatcher",
                IsBackground = true
            };
            _watchThread.SetApartmentState(ApartmentState.STA);
            _watchThread.Start();
        }
    }

    public void StopWatching()
    {
        _watching = false;
    }

    private void WatchLoop()
    {
        // Baseline the current clipboard so enabling Watch does not dump whatever
        // screenshot is already sitting there — only *new* copies are saved.
        try { _lastClipSeq = NativeClipboard.GetSequenceNumber(); }
        catch { _lastClipSeq = 0; }

        while (_watching && !_disposed)
        {
            try
            {
                CaptureIfChanged();
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[InboundClip] Watch error: {ex.Message}");
            }
            Thread.Sleep(1500);
        }
    }

    private void CaptureIfChanged()
    {
        var seq = NativeClipboard.GetSequenceNumber();
        if (seq == 0 || seq == _lastClipSeq) return;
        _lastClipSeq = seq;
        if (!AllowWatchCapture()) return;

        // Watch mode: files + images only. Text on every Ctrl+C would flood disk;
        // explicit Capture now still saves text via CaptureClipboardCore.
        try
        {
            if (WpfClipboard.ContainsFileDropList())
            {
                CaptureFileDropList();
                return;
            }
            if (WpfClipboard.ContainsImage())
            {
                CaptureImage();
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[InboundClip] Watch capture: {ex.Message}");
        }
    }

    private bool AllowWatchCapture()
    {
        var now = DateTime.UtcNow;
        if (now - _burstWindowUtc > BurstWindow)
        {
            _burstWindowUtc = now;
            _burstCount = 0;
        }
        _burstCount++;
        if (_burstCount <= BurstMax) return true;
        Debug.WriteLine("[InboundClip] Burst cap hit — stopping watcher to protect disk I/O.");
        StopWatching();
        return false;
    }

    public string? CaptureClipboardNow()
    {
        string? entryId = null;
        if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA)
        {
            entryId = CaptureClipboardCore();
        }
        else
        {
            var done = new ManualResetEventSlim(false);
            var t = new Thread(() =>
            {
                try { entryId = CaptureClipboardCore(); }
                catch (Exception ex) { Debug.WriteLine($"[InboundClip] Capture error: {ex.Message}"); }
                finally { done.Set(); }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.IsBackground = true;
            t.Start();
            done.Wait(TimeSpan.FromSeconds(10));
        }
        return entryId;
    }

    private string? CaptureClipboardCore()
    {
        try
        {
            if (WpfClipboard.ContainsFileDropList())
                return CaptureFileDropList();
            if (WpfClipboard.ContainsImage())
                return CaptureImage();
            if (WpfClipboard.ContainsText())
                return CaptureText();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[InboundClip] CaptureCore: {ex.Message}");
        }
        return null;
    }

    private string CaptureFileDropList()
    {
        var files = WpfClipboard.GetFileDropList();
        var id = NewEntryId();
        var dir = EnsureEntryDir(id);
        var captured = new List<string>();

        if (files is not null)
        {
            foreach (string? src in files)
            {
                if (string.IsNullOrEmpty(src)) continue;
                try
                {
                    var destName = System.IO.Path.GetFileName(src);
                    var dest = System.IO.Path.Combine(dir, destName);
                    if (File.Exists(src))
                    {
                        File.Copy(src, dest, true);
                        captured.Add(destName);
                    }
                    else if (Directory.Exists(src))
                    {
                        CopyDirectoryRecursive(src, dest);
                        captured.Add(destName);
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[InboundClip] FileCopy: {ex.Message}");
                }
            }
        }

        var name = captured.Count switch
        {
            0 => "Empty file drop",
            1 => captured[0],
            _ => $"{captured[0]} +{captured.Count - 1} more"
        };

        WriteMeta(dir, id, name, "files", captured);
        return id;
    }

    private string CaptureImage()
    {
        var id = NewEntryId();
        var dir = EnsureEntryDir(id);
        var imgPath = System.IO.Path.Combine(dir, "clipboard.png");

        var source = WpfClipboard.GetImage();
        if (source is not null)
        {
            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(BitmapFrame.Create(source));
            using var fs = File.Create(imgPath);
            encoder.Save(fs);
        }

        WriteMeta(dir, id, "Clipboard image", "image");
        return id;
    }

    private string CaptureText()
    {
        var id = NewEntryId();
        var dir = EnsureEntryDir(id);
        var text = WpfClipboard.GetText() ?? "";
        var txtPath = System.IO.Path.Combine(dir, "clipboard.txt");
        File.WriteAllText(txtPath, text);

        var preview = text.Length > 60 ? text[..60].ReplaceLineEndings(" ") + "…" : text.ReplaceLineEndings(" ");
        WriteMeta(dir, id, $"Text: {preview}", "text");
        return id;
    }

    public List<InboundEntry> ListEntries(int limit = 80)
    {
        var entries = new List<InboundEntry>();
        if (!Directory.Exists(_rootPath)) return entries;

        // Soft guard — if the inbox is bloated again, nuke before listing.
        int dirCount = 0;
        try
        {
            foreach (var _ in Directory.EnumerateDirectories(_rootPath))
            {
                dirCount++;
                if (dirCount > MaxStoredEntries * 3)
                {
                    try { CapStoredEntries(MaxStoredEntries); } catch { }
                    break;
                }
            }
        }
        catch { /* listing still attempted below */ }

        foreach (var dir in Directory.EnumerateDirectories(_rootPath))
        {
            var metaFile = System.IO.Path.Combine(dir, "meta.json");
            if (!File.Exists(metaFile)) continue;
            try
            {
                var json = File.ReadAllText(metaFile);
                var meta = JsonSerializer.Deserialize<Dictionary<string, object>>(json);
                if (meta is null) continue;

                // Listing must stay snappy — top-level files only (no nested walks).
                long size = 0;
                try
                {
                    foreach (var f in new DirectoryInfo(dir).EnumerateFiles())
                    {
                        if (f.Name.Equals("meta.json", StringComparison.OrdinalIgnoreCase)) continue;
                        size += f.Length;
                    }
                }
                catch { /* size stays 0 */ }

                entries.Add(new InboundEntry
                {
                    Id = meta.TryGetValue("id", out var idVal) ? idVal?.ToString() ?? "" : System.IO.Path.GetFileName(dir),
                    Name = meta.TryGetValue("name", out var nVal) ? nVal?.ToString() ?? "" : System.IO.Path.GetFileName(dir),
                    Type = meta.TryGetValue("type", out var tVal) ? tVal?.ToString() ?? "" : "unknown",
                    Size = size,
                    CreatedUtc = meta.TryGetValue("createdUtc", out var cVal) ? cVal?.ToString() ?? "" : "",
                    Path = dir
                });
            }
            catch { }

            // Bound work even before sort when the folder is large but under the nuke threshold.
            if (entries.Count >= Math.Max(limit * 4, MaxStoredEntries)) break;
        }

        return entries
            .OrderByDescending(e => e.CreatedUtc)
            .Take(Math.Max(1, limit))
            .ToList();
    }

    public List<string> GetEntryPaths(string id)
    {
        if (!TryResolveEntryDir(id, out var dir)) return new List<string>();
        return Directory.EnumerateFiles(dir)
            .Where(f => System.IO.Path.GetFileName(f) != "meta.json")
            .ToList();
    }

    public bool DeleteEntry(string id)
    {
        if (!TryResolveEntryDir(id, out var dir)) return false;

        try
        {
            Directory.Delete(dir, true);
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[InboundClip] Delete {id}: {ex.Message}");
            return false;
        }
    }

    public InboundCopyResult CopyToLibrary(string entryId, string destinationDir)
    {
        if (string.IsNullOrWhiteSpace(entryId))
            return new InboundCopyResult { Ok = false, Error = "Entry ID is required." };
        if (string.IsNullOrWhiteSpace(destinationDir))
            return new InboundCopyResult { Ok = false, Error = "Destination directory is required." };

        var destNorm = Path.GetFullPath(destinationDir);
        if (!Directory.Exists(destNorm))
            return new InboundCopyResult { Ok = false, Error = $"Destination does not exist: {destNorm}" };

        if (!TryResolveEntryDir(entryId, out var entryDir))
            return new InboundCopyResult { Ok = false, Error = "Entry not found — it may have been deleted." };

        var copied = new List<string>();
        var failed = new List<string>();

        foreach (var srcFile in Directory.EnumerateFiles(entryDir))
        {
            var name = System.IO.Path.GetFileName(srcFile);
            if (string.Equals(name, "meta.json", StringComparison.OrdinalIgnoreCase)) continue;

            try
            {
                var destPath = System.IO.Path.Combine(destNorm, name);
                if (File.Exists(destPath))
                {
                    var stem = System.IO.Path.GetFileNameWithoutExtension(name);
                    var ext = System.IO.Path.GetExtension(name);
                    var stamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
                    destPath = System.IO.Path.Combine(destNorm, $"{stem}_{stamp}{ext}");
                }
                File.Copy(srcFile, destPath, overwrite: false);
                copied.Add(name);
                FileLineageService.Instance.RecordEdge(srcFile, destPath, "inbound");
                _ = FileLineageService.Instance.RecordContentLineageOnCopyAsync(srcFile, destPath, "inbound");
            }
            catch (Exception ex)
            {
                failed.Add($"{name}: {ex.Message}");
            }
        }

        foreach (var srcDir in Directory.EnumerateDirectories(entryDir))
        {
            var dirName = System.IO.Path.GetFileName(srcDir);
            try
            {
                var destSubDir = System.IO.Path.Combine(destNorm, dirName);
                CopyDirectoryRecursive(srcDir, destSubDir);
                copied.Add(dirName);
            }
            catch (Exception ex)
            {
                failed.Add($"{dirName}: {ex.Message}");
            }
        }

        return new InboundCopyResult
        {
            Ok = failed.Count == 0,
            CopiedCount = copied.Count,
            FailedCount = failed.Count,
            CopiedNames = copied,
            Errors = failed,
            Error = failed.Count > 0 ? $"{failed.Count} item(s) failed to copy." : null,
        };
    }

    public int PurgeExpired(TimeSpan? ttl = null)
    {
        var maxAge = ttl ?? TimeSpan.FromHours(48);
        int purged = 0;
        if (!Directory.Exists(_rootPath)) return purged;

        foreach (var dir in Directory.EnumerateDirectories(_rootPath))
        {
            try
            {
                var metaFile = System.IO.Path.Combine(dir, "meta.json");
                DateTime created;
                if (File.Exists(metaFile))
                {
                    var json = File.ReadAllText(metaFile);
                    var meta = JsonSerializer.Deserialize<Dictionary<string, object>>(json);
                    if (meta is not null && meta.TryGetValue("createdUtc", out var cVal) &&
                        DateTime.TryParse(cVal?.ToString(), out var parsed))
                        created = parsed.ToUniversalTime();
                    else
                        created = Directory.GetCreationTimeUtc(dir);
                }
                else
                {
                    created = Directory.GetCreationTimeUtc(dir);
                }

                if (DateTime.UtcNow - created > maxAge)
                {
                    if (dir.StartsWith(_rootPath, StringComparison.OrdinalIgnoreCase))
                    {
                        Directory.Delete(dir, true);
                        purged++;
                    }
                }
            }
            catch { }
        }
        return purged;
    }

    /// <summary>
    /// Keep only the newest N inbound folders. If the folder is massively bloated
    /// (legacy GetHashCode watch bug wrote ~1 PNG/poll), rename the whole tree away
    /// in O(1) and delete in the background — never enumerate/delete 10k+ dirs on the
    /// hot path (that freezes the machine / WebView).
    /// </summary>
    public int CapStoredEntries(int maxKeep = MaxStoredEntries)
    {
        int removed = 0;
        if (!Directory.Exists(_rootPath) || maxKeep < 1) return removed;

        int count = 0;
        try
        {
            foreach (var _ in Directory.EnumerateDirectories(_rootPath))
            {
                count++;
                // Early-out once we know this is spam-level bloat.
                if (count > maxKeep * 3) break;
            }
        }
        catch { return removed; }

        if (count > maxKeep * 3)
        {
            try
            {
                var nuke = _rootPath + ".nuke-" + Guid.NewGuid().ToString("N")[..8];
                Directory.Move(_rootPath, nuke);
                Directory.CreateDirectory(_rootPath);
                _ = Task.Run(() =>
                {
                    try { Directory.Delete(nuke, true); }
                    catch (Exception ex) { Debug.WriteLine($"[InboundClip] Nuke delete: {ex.Message}"); }
                });
                return Math.Max(0, count - maxKeep);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[InboundClip] Nuke rename failed: {ex.Message}");
            }
        }

        DirectoryInfo[] dirs;
        try { dirs = new DirectoryInfo(_rootPath).GetDirectories(); }
        catch { return removed; }

        Array.Sort(dirs, (a, b) => b.CreationTimeUtc.CompareTo(a.CreationTimeUtc));
        for (var i = maxKeep; i < dirs.Length; i++)
        {
            try
            {
                if (!dirs[i].FullName.StartsWith(Path.GetFullPath(_rootPath), StringComparison.OrdinalIgnoreCase)) continue;
                dirs[i].Delete(true);
                removed++;
            }
            catch { }
        }
        return removed;
    }

    private static string NewEntryId() =>
        $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid().ToString("N")[..8]}";

    /// <summary>
    /// Resolve an inbound entry folder under _rootPath. Rejects traversal ids (.., separators, rooted paths).
    /// </summary>
    private bool TryResolveEntryDir(string? id, out string fullDir)
    {
        fullDir = "";
        if (string.IsNullOrWhiteSpace(id)) return false;
        // Entry ids are stamped tokens only — never accept path separators or relative segments.
        if (id.IndexOfAny(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) >= 0) return false;
        if (id.Contains("..", StringComparison.Ordinal)) return false;
        if (id.Trim() != id) return false;

        string candidate;
        try
        {
            candidate = Path.GetFullPath(Path.Combine(_rootPath, id));
        }
        catch
        {
            return false;
        }

        var rootFull = Path.GetFullPath(_rootPath);
        if (!rootFull.EndsWith(Path.DirectorySeparatorChar) && !rootFull.EndsWith(Path.AltDirectorySeparatorChar))
            rootFull += Path.DirectorySeparatorChar;

        if (!candidate.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase)
            && !string.Equals(candidate.TrimEnd('\\', '/'), rootFull.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase))
            return false;

        if (!Directory.Exists(candidate)) return false;
        fullDir = candidate;
        return true;
    }

    private string EnsureEntryDir(string id)
    {
        if (string.IsNullOrWhiteSpace(id)
            || id.IndexOfAny(['/', '\\', ':', '*', '?', '"', '<', '>', '|']) >= 0
            || id.Contains("..", StringComparison.Ordinal))
            throw new ArgumentException("Invalid inbound entry id.", nameof(id));

        var dir = Path.GetFullPath(Path.Combine(_rootPath, id));
        var rootFull = Path.GetFullPath(_rootPath);
        if (!rootFull.EndsWith(Path.DirectorySeparatorChar))
            rootFull += Path.DirectorySeparatorChar;
        if (!dir.StartsWith(rootFull, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Inbound entry escaped root.");

        Directory.CreateDirectory(dir);
        return dir;
    }

    private static void WriteMeta(string dir, string id, string name, string type, List<string>? fileNames = null)
    {
        var meta = new Dictionary<string, object?>
        {
            ["id"] = id,
            ["name"] = name,
            ["type"] = type,
            ["createdUtc"] = DateTime.UtcNow.ToString("o"),
            ["files"] = fileNames
        };
        File.WriteAllText(
            System.IO.Path.Combine(dir, "meta.json"),
            JsonSerializer.Serialize(meta, JsonOpts));
    }

    private static void CopyDirectoryRecursive(string source, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (var file in Directory.EnumerateFiles(source))
        {
            try { File.Copy(file, System.IO.Path.Combine(dest, System.IO.Path.GetFileName(file)), true); }
            catch { }
        }
        foreach (var sub in Directory.EnumerateDirectories(source))
        {
            CopyDirectoryRecursive(sub, System.IO.Path.Combine(dest, System.IO.Path.GetFileName(sub)));
        }
    }
}

public sealed class InboundCopyResult
{
    public bool Ok { get; set; }
    public int CopiedCount { get; set; }
    public int FailedCount { get; set; }
    public List<string> CopiedNames { get; set; } = new();
    public List<string> Errors { get; set; } = new();
    public string? Error { get; set; }
}
