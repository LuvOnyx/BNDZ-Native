using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
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
    private string? _lastClipHash;

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
            Thread.Sleep(800);
        }
    }

    private void CaptureIfChanged()
    {
        string? hash = null;

        if (WpfClipboard.ContainsFileDropList())
        {
            var files = WpfClipboard.GetFileDropList();
            if (files is { Count: > 0 })
                hash = "files:" + string.Join("|", files.Cast<string>().OrderBy(s => s, StringComparer.OrdinalIgnoreCase));
        }
        else if (WpfClipboard.ContainsImage())
        {
            var img = WpfClipboard.GetImage();
            if (img is not null)
                hash = $"image:{img.PixelWidth}x{img.PixelHeight}:{img.GetHashCode()}";
        }
        else if (WpfClipboard.ContainsText())
        {
            var text = WpfClipboard.GetText();
            if (!string.IsNullOrEmpty(text))
                hash = "text:" + (text.Length > 256 ? text[..256] : text).GetHashCode().ToString();
        }

        if (hash is null || hash == _lastClipHash) return;
        _lastClipHash = hash;

        CaptureClipboardCore();
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

    public List<InboundEntry> ListEntries()
    {
        var entries = new List<InboundEntry>();
        if (!Directory.Exists(_rootPath)) return entries;

        foreach (var dir in Directory.EnumerateDirectories(_rootPath))
        {
            var metaFile = System.IO.Path.Combine(dir, "meta.json");
            if (!File.Exists(metaFile)) continue;
            try
            {
                var json = File.ReadAllText(metaFile);
                var meta = JsonSerializer.Deserialize<Dictionary<string, object>>(json);
                if (meta is null) continue;

                long size = 0;
                foreach (var f in Directory.EnumerateFiles(dir))
                {
                    if (System.IO.Path.GetFileName(f) == "meta.json") continue;
                    try { size += new FileInfo(f).Length; } catch { }
                }

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
        }

        return entries.OrderByDescending(e => e.CreatedUtc).ToList();
    }

    public List<string> GetEntryPaths(string id)
    {
        var dir = System.IO.Path.Combine(_rootPath, id);
        if (!Directory.Exists(dir)) return new List<string>();
        return Directory.EnumerateFiles(dir)
            .Where(f => System.IO.Path.GetFileName(f) != "meta.json")
            .ToList();
    }

    public bool DeleteEntry(string id)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        var dir = System.IO.Path.Combine(_rootPath, id);
        if (!Directory.Exists(dir)) return false;

        if (!dir.StartsWith(_rootPath, StringComparison.OrdinalIgnoreCase))
            return false;

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

    private static string NewEntryId() =>
        $"{DateTime.UtcNow:yyyyMMdd-HHmmss}-{Guid.NewGuid().ToString("N")[..8]}";

    private string EnsureEntryDir(string id)
    {
        var dir = System.IO.Path.Combine(_rootPath, id);
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
