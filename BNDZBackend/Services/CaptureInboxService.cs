using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Media.Imaging;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using WpfClipboard = System.Windows.Clipboard;

namespace BNDZ.Services;

public sealed class CaptureInboxEntry
{
    public string Id { get; set; } = "";
    public string FileName { get; set; } = "";
    public string SuggestedName { get; set; } = "";
    public string OcrPreview { get; set; } = "";
    public long Size { get; set; }
    public string CapturedUtc { get; set; } = "";
    public string FullPath { get; set; } = "";
}

public sealed class CaptureInboxStatus
{
    public string CaptureFolder { get; set; } = "";
    public bool Watching { get; set; }
    public int CaptureCount { get; set; }
    public CaptureInboxEntry? LastCapture { get; set; }
}

public sealed class CaptureInboxService : IDisposable
{
    private static readonly Lazy<CaptureInboxService> Lazy = new(() => new CaptureInboxService());
    public static CaptureInboxService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions JsonOpts = new() { WriteIndented = true };
    private static readonly Regex InvalidFileChars = new($"[{Regex.Escape(new string(Path.GetInvalidFileNameChars()))}]", RegexOptions.Compiled);

    private readonly string _configPath;
    private readonly object _lock = new();
    private Thread? _watchThread;
    private volatile bool _watching;
    private volatile bool _disposed;
    private uint _lastClipSeq;
    private int _burstCount;
    private DateTime _burstWindowUtc = DateTime.MinValue;
    private const int MaxStoredCaptures = 48;
    private const int BurstMax = 6;
    private static readonly TimeSpan BurstWindow = TimeSpan.FromSeconds(12);
    private static readonly TimeSpan MinWatchCaptureInterval = TimeSpan.FromSeconds(2.5);
    private string _captureFolder;
    private string? _lastImageFingerprint;
    private DateTime _lastImageCaptureUtc = DateTime.MinValue;

    private CaptureInboxService()
    {
        var baseDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "CaptureInbox");
        Directory.CreateDirectory(baseDir);
        _configPath = Path.Combine(baseDir, "config.json");
        _captureFolder = Path.Combine(baseDir, "Captures");
        Directory.CreateDirectory(_captureFolder);
        LoadConfig();
    }

    public void Dispose()
    {
        _disposed = true;
        StopWatching();
    }

    public string GetCaptureFolder() => _captureFolder;

    public bool IsWatching => _watching;

    public CaptureInboxStatus GetStatus()
    {
        var entries = ListCaptures(1);
        return new CaptureInboxStatus
        {
            CaptureFolder = _captureFolder,
            Watching = _watching,
            CaptureCount = CountCaptures(),
            LastCapture = entries.FirstOrDefault(),
        };
    }

    public bool SetCaptureFolder(string folderPath)
    {
        if (string.IsNullOrWhiteSpace(folderPath)) return false;
        try
        {
            var full = Path.GetFullPath(folderPath.Trim());
            Directory.CreateDirectory(full);
            lock (_lock)
            {
                _captureFolder = full;
                SaveConfig();
            }
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[CaptureInbox] SetFolder: {ex.Message}");
            return false;
        }
    }

    public void StartWatching()
    {
        lock (_lock)
        {
            if (_watching) return;
            _watching = true;
            _watchThread = new Thread(WatchLoop)
            {
                Name = "BNDZ-CaptureInbox",
                IsBackground = true,
            };
            _watchThread.SetApartmentState(ApartmentState.STA);
            _watchThread.Start();
        }
    }

    public void StopWatching()
    {
        _watching = false;
    }

    public CaptureInboxEntry? CaptureFromClipboardNow()
    {
        CaptureInboxEntry? entry = null;
        if (Thread.CurrentThread.GetApartmentState() == ApartmentState.STA)
        {
            entry = CaptureClipboardCore(force: true);
        }
        else
        {
            var done = new ManualResetEventSlim(false);
            var t = new Thread(() =>
            {
                try { entry = CaptureClipboardCore(force: true); }
                catch (Exception ex) { Debug.WriteLine($"[CaptureInbox] Capture: {ex.Message}"); }
                finally { done.Set(); }
            });
            t.SetApartmentState(ApartmentState.STA);
            t.IsBackground = true;
            t.Start();
            done.Wait(TimeSpan.FromSeconds(15));
        }
        return entry;
    }

    public List<CaptureInboxEntry> ListCaptures(int limit = 50)
    {
        var entries = new List<CaptureInboxEntry>();
        if (!Directory.Exists(_captureFolder)) return entries;

        foreach (var metaFile in Directory.EnumerateFiles(_captureFolder, "*.capture.json"))
        {
            try
            {
                var json = File.ReadAllText(metaFile);
                var meta = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json);
                if (meta is null) continue;

                var id = meta.TryGetValue("id", out var idEl) ? idEl.GetString() ?? "" : Path.GetFileNameWithoutExtension(metaFile).Replace(".capture", "");
                var fileName = meta.TryGetValue("fileName", out var fnEl) ? fnEl.GetString() ?? "" : "";
                var fullPath = meta.TryGetValue("fullPath", out var fpEl) ? fpEl.GetString() ?? "" : Path.Combine(_captureFolder, fileName);
                long size = 0;
                if (File.Exists(fullPath))
                {
                    try { size = new FileInfo(fullPath).Length; } catch { }
                }

                entries.Add(new CaptureInboxEntry
                {
                    Id = id,
                    FileName = fileName,
                    SuggestedName = meta.TryGetValue("suggestedName", out var snEl) ? snEl.GetString() ?? "" : "",
                    OcrPreview = meta.TryGetValue("ocrPreview", out var ocrEl) ? ocrEl.GetString() ?? "" : "",
                    Size = size,
                    CapturedUtc = meta.TryGetValue("capturedUtc", out var cuEl) ? cuEl.GetString() ?? "" : "",
                    FullPath = fullPath,
                });
            }
            catch { }
        }

        return entries
            .OrderByDescending(e => e.CapturedUtc, StringComparer.Ordinal)
            .Take(Math.Max(1, limit))
            .ToList();
    }

    private int CountCaptures()
    {
        if (!Directory.Exists(_captureFolder)) return 0;
        return Directory.EnumerateFiles(_captureFolder, "*.capture.json").Count();
    }

    /// <summary>
    /// Keep newest N captures. If massively bloated, rename the folder away in O(1).
    /// </summary>
    public int CapStoredCaptures(int maxKeep = MaxStoredCaptures)
    {
        int removed = 0;
        if (!Directory.Exists(_captureFolder) || maxKeep < 1) return removed;

        int count = 0;
        try
        {
            foreach (var _ in Directory.EnumerateFiles(_captureFolder, "*.capture.json"))
            {
                count++;
                if (count > maxKeep * 3) break;
            }
        }
        catch { return removed; }

        if (count > maxKeep * 3)
        {
            try
            {
                var nuke = _captureFolder + ".nuke-" + Guid.NewGuid().ToString("N")[..8];
                Directory.Move(_captureFolder, nuke);
                Directory.CreateDirectory(_captureFolder);
                _ = Task.Run(() =>
                {
                    try { Directory.Delete(nuke, true); }
                    catch (Exception ex) { Debug.WriteLine($"[CaptureInbox] Nuke delete: {ex.Message}"); }
                });
                return Math.Max(0, count - maxKeep);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[CaptureInbox] Nuke rename failed: {ex.Message}");
            }
        }

        FileInfo[] metas;
        try { metas = new DirectoryInfo(_captureFolder).GetFiles("*.capture.json"); }
        catch { return removed; }

        Array.Sort(metas, (a, b) => b.LastWriteTimeUtc.CompareTo(a.LastWriteTimeUtc));
        for (var i = maxKeep; i < metas.Length; i++)
        {
            try
            {
                var json = File.ReadAllText(metas[i].FullName);
                var meta = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json);
                var png = meta is not null && meta.TryGetValue("fullPath", out var fpEl)
                    ? fpEl.GetString()
                    : null;
                if (!string.IsNullOrWhiteSpace(png) && File.Exists(png)
                    && png.StartsWith(_captureFolder, StringComparison.OrdinalIgnoreCase))
                {
                    try { File.Delete(png); } catch { }
                }
                metas[i].Delete();
                removed++;
            }
            catch { }
        }
        return removed;
    }

    private void WatchLoop()
    {
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
                Debug.WriteLine($"[CaptureInbox] Watch: {ex.Message}");
            }
            Thread.Sleep(2500);
        }
    }

    private void CaptureIfChanged()
    {
        var seq = NativeClipboard.GetSequenceNumber();
        if (seq == 0 || seq == _lastClipSeq) return;
        _lastClipSeq = seq;

        // Explorer / BNDZ file copy+cut puts CF_HDROP (often with a thumbnail DIB) — not a screenshot.
        if (ClipboardHasFilePaths()) return;

        if (!WpfClipboard.ContainsImage()) return;
        if (!AllowWatchCapture()) return;
        CaptureClipboardCore();
    }

    private static bool ClipboardHasFilePaths()
    {
        // Prefer Win32 CF_HDROP probe — ContainsFileDropList() can throw/false when clipboard is locked
        // while Explorer still has a file drop list (plus DIB thumbnail), which re-spam Capture Inbox.
        try
        {
            if (IsClipboardFormatAvailable(CF_HDROP))
                return true;
        }
        catch { /* fall through */ }
        try { return WpfClipboard.ContainsFileDropList(); }
        catch { return false; }
    }

    private const uint CF_HDROP = 15;

    [System.Runtime.InteropServices.DllImport("user32.dll")]
    [return: System.Runtime.InteropServices.MarshalAs(System.Runtime.InteropServices.UnmanagedType.Bool)]
    private static extern bool IsClipboardFormatAvailable(uint format);

    private static string BuildImageFingerprint(BitmapSource source)
        => $"{source.PixelWidth}x{source.PixelHeight}:{source.Format}:{source.DpiX:F0}";

    private bool ShouldSkipDuplicateImage(BitmapSource source)
    {
        var fp = BuildImageFingerprint(source);
        var now = DateTime.UtcNow;
        if (fp == _lastImageFingerprint && now - _lastImageCaptureUtc < MinWatchCaptureInterval)
            return true;
        _lastImageFingerprint = fp;
        _lastImageCaptureUtc = now;
        return false;
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
        Debug.WriteLine("[CaptureInbox] Burst cap hit — stopping watcher to protect disk I/O.");
        StopWatching();
        return false;
    }

    private CaptureInboxEntry? CaptureClipboardCore(bool force = false)
    {
        try
        {
            if (ClipboardHasFilePaths()) return null;
            if (!WpfClipboard.ContainsImage()) return null;
            var source = WpfClipboard.GetImage();
            if (source is null) return null;
            if (!force && ShouldSkipDuplicateImage(source)) return null;

            var ocrText = TryOcrSync(source);
            var suggested = BuildSuggestedName(ocrText);
            var stamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");
            var fileName = $"{suggested}_{stamp}.png";
            var fullPath = Path.Combine(_captureFolder, fileName);

            var encoder = new PngBitmapEncoder();
            encoder.Frames.Add(System.Windows.Media.Imaging.BitmapFrame.Create(source));
            using (var fs = File.Create(fullPath))
            {
                encoder.Save(fs);
            }

            var id = Guid.NewGuid().ToString("N")[..12];
            var entry = new CaptureInboxEntry
            {
                Id = id,
                FileName = fileName,
                SuggestedName = suggested,
                OcrPreview = TruncateOcr(ocrText),
                Size = new FileInfo(fullPath).Length,
                CapturedUtc = DateTime.UtcNow.ToString("o"),
                FullPath = fullPath,
            };

            var metaPath = Path.Combine(_captureFolder, $"{id}.capture.json");
            var meta = new Dictionary<string, object>
            {
                ["id"] = id,
                ["fileName"] = fileName,
                ["suggestedName"] = suggested,
                ["ocrPreview"] = entry.OcrPreview,
                ["capturedUtc"] = entry.CapturedUtc,
                ["fullPath"] = fullPath,
            };
            File.WriteAllText(metaPath, JsonSerializer.Serialize(meta, JsonOpts));
            try { CapStoredCaptures(MaxStoredCaptures); } catch { /* best effort */ }
            return entry;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[CaptureInbox] CaptureCore: {ex.Message}");
            return null;
        }
    }

    private static string? TryOcrSync(BitmapSource source)
    {
        try
        {
            return Task.Run(async () => await TryOcrAsync(source).ConfigureAwait(false))
                .GetAwaiter()
                .GetResult();
        }
        catch
        {
            return null;
        }
    }

    private static async Task<string?> TryOcrAsync(BitmapSource source)
    {
        try
        {
            var engine = OcrEngine.TryCreateFromUserProfileLanguages();
            if (engine is null) return null;

            var width = source.PixelWidth;
            var height = source.PixelHeight;
            if (width <= 0 || height <= 0) return null;

            var stride = width * 4;
            var pixels = new byte[height * stride];
            source.CopyPixels(pixels, stride, 0);

            using var bitmap = new SoftwareBitmap(BitmapPixelFormat.Bgra8, width, height, BitmapAlphaMode.Premultiplied);
            bitmap.CopyFromBuffer(pixels.AsBuffer());

            var result = await engine.RecognizeAsync(bitmap).AsTask().ConfigureAwait(false);
            var text = result?.Text?.Trim();
            return string.IsNullOrWhiteSpace(text) ? null : text;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[CaptureInbox] OCR: {ex.Message}");
            return null;
        }
    }

    private static string BuildSuggestedName(string? ocrText)
    {
        if (string.IsNullOrWhiteSpace(ocrText))
            return "capture";

        var firstLine = ocrText
            .Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.Trim())
            .FirstOrDefault(l => l.Length > 2) ?? "capture";

        var cleaned = InvalidFileChars.Replace(firstLine, " ");
        cleaned = Regex.Replace(cleaned, @"\s+", " ").Trim();
        if (cleaned.Length > 48) cleaned = cleaned[..48].Trim();
        if (string.IsNullOrWhiteSpace(cleaned)) cleaned = "capture";
        return cleaned;
    }

    private static string TruncateOcr(string? text)
    {
        if (string.IsNullOrWhiteSpace(text)) return "";
        var flat = text.ReplaceLineEndings(" ").Trim();
        return flat.Length > 120 ? flat[..120] + "…" : flat;
    }

    private void LoadConfig()
    {
        try
        {
            if (!File.Exists(_configPath)) return;
            var json = File.ReadAllText(_configPath);
            var cfg = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(json);
            if (cfg is null) return;
            if (cfg.TryGetValue("captureFolder", out var folderEl))
            {
                var folder = folderEl.GetString();
                if (!string.IsNullOrWhiteSpace(folder))
                {
                    Directory.CreateDirectory(folder);
                    _captureFolder = Path.GetFullPath(folder);
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[CaptureInbox] LoadConfig: {ex.Message}");
        }
    }

    private void SaveConfig()
    {
        try
        {
            var cfg = new Dictionary<string, string> { ["captureFolder"] = _captureFolder };
            File.WriteAllText(_configPath, JsonSerializer.Serialize(cfg, JsonOpts));
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[CaptureInbox] SaveConfig: {ex.Message}");
        }
    }
}
