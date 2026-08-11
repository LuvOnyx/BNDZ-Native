using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;

namespace Flow.Launcher.Plugin.BNDZ
{
    /// <summary>Clipboard history — text, images, and file paths (SuperCmd/Raycast parity).</summary>
    internal sealed class BndzClipboardStore : IDisposable
    {
        private const int MaxItems = 500;
        private const int PollMs = 1000;
        private readonly string _storePath;
        private readonly string _imageDir;
        private readonly System.Threading.Timer _timer;
        private string _lastFingerprint = string.Empty;
        private readonly List<ClipboardEntry> _items = new();
        private readonly object _lock = new();

        public BndzClipboardStore(string userDataDir)
        {
            var dir = Path.Combine(userDataDir, "BNDZ");
            Directory.CreateDirectory(dir);
            _imageDir = Path.Combine(dir, "clipboard-images");
            Directory.CreateDirectory(_imageDir);
            _storePath = Path.Combine(dir, "clipboard-history.json");
            Load();
            _timer = new System.Threading.Timer(PollClipboard, null, PollMs, PollMs);
        }

        public IReadOnlyList<ClipboardEntry> GetAll() =>
            _items.OrderByDescending(i => i.Pinned).ThenByDescending(i => i.Timestamp).ToList();

        public IReadOnlyList<ClipboardEntry> Search(string query)
        {
            lock (_lock)
            {
                var q = (query ?? string.Empty).Trim();
                IEnumerable<ClipboardEntry> src = _items.OrderByDescending(i => i.Pinned).ThenByDescending(i => i.Timestamp);
                if (!string.IsNullOrEmpty(q))
                    src = src.Where(i =>
                        i.Preview.Contains(q, StringComparison.OrdinalIgnoreCase)
                        || i.Content.Contains(q, StringComparison.OrdinalIgnoreCase)
                        || i.FilePaths.Any(p => p.Contains(q, StringComparison.OrdinalIgnoreCase)));
                return src.Take(80).ToList();
            }
        }

        public bool CopyToClipboard(string id)
        {
            lock (_lock)
            {
                var item = _items.FirstOrDefault(i => i.Id == id);
                if (item == null) return false;
                try
                {
                    if (item.Kind == "files" && item.FilePaths.Count > 0)
                    {
                        var col = new System.Collections.Specialized.StringCollection();
                        foreach (var p in item.FilePaths) col.Add(p);
                        Clipboard.SetFileDropList(col);
                        return true;
                    }
                    if (item.Kind == "image" && !string.IsNullOrEmpty(item.ImagePath) && File.Exists(item.ImagePath))
                    {
                        using var img = Image.FromFile(item.ImagePath);
                        Clipboard.SetImage(img);
                        return true;
                    }
                    Clipboard.SetText(item.Content);
                    return true;
                }
                catch { return false; }
            }
        }

        private void PollClipboard(object? _)
        {
            try
            {
                if (Clipboard.ContainsFileDropList())
                {
                    var files = Clipboard.GetFileDropList();
                    if (files == null || files.Count == 0) return;
                    var paths = files.Cast<string>().Where(File.Exists).ToList();
                    if (paths.Count == 0) return;
                    var fp = "files:" + string.Join("|", paths);
                    if (fp == _lastFingerprint) return;
                    _lastFingerprint = fp;
                    AddFiles(paths);
                    return;
                }

                if (Clipboard.ContainsImage())
                {
                    var img = Clipboard.GetImage();
                    if (img == null) return;
                    var fp = $"image:{img.Width}x{img.Height}";
                    if (fp == _lastFingerprint) return;
                    _lastFingerprint = fp;
                    AddImage(img);
                    return;
                }

                if (!Clipboard.ContainsText()) return;
                var text = Clipboard.GetText(TextDataFormat.UnicodeText);
                if (string.IsNullOrWhiteSpace(text) || text == _lastFingerprint) return;
                if (text.Length > 100_000) return;
                _lastFingerprint = text;
                AddText(text);
            }
            catch { }
        }

        private void AddText(string text) =>
            Insert(new ClipboardEntry
            {
                Id = Guid.NewGuid().ToString("N"),
                Kind = "text",
                Content = text,
                Preview = text.Length > 120 ? text.Substring(0, 117) + "…" : text,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            });

        private void AddFiles(List<string> paths)
        {
            var preview = paths.Count == 1
                ? Path.GetFileName(paths[0])
                : $"{paths.Count} files";
            Insert(new ClipboardEntry
            {
                Id = Guid.NewGuid().ToString("N"),
                Kind = "files",
                Content = string.Join("\n", paths),
                Preview = $"📁 {preview}",
                FilePaths = paths,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            });
        }

        private void AddImage(Image img)
        {
            var id = Guid.NewGuid().ToString("N");
            var path = Path.Combine(_imageDir, $"{id}.png");
            try { img.Save(path, System.Drawing.Imaging.ImageFormat.Png); }
            catch { return; }
            Insert(new ClipboardEntry
            {
                Id = id,
                Kind = "image",
                Content = path,
                Preview = $"🖼 Image {img.Width}×{img.Height}",
                ImagePath = path,
                Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            });
        }

        private void Insert(ClipboardEntry entry)
        {
            lock (_lock)
            {
                _items.RemoveAll(i => i.Content == entry.Content && i.Kind == entry.Kind);
                _items.Insert(0, entry);
                if (_items.Count > MaxItems)
                    _items.RemoveRange(MaxItems, _items.Count - MaxItems);
                Save();
            }
        }

        private void Load()
        {
            if (!File.Exists(_storePath)) return;
            try
            {
                var list = JsonSerializer.Deserialize<List<ClipboardEntry>>(File.ReadAllText(_storePath));
                if (list != null)
                {
                    lock (_lock) _items.AddRange(list.OrderByDescending(i => i.Timestamp).Take(MaxItems));
                }
            }
            catch { }
        }

        private void Save()
        {
            try
            {
                var json = JsonSerializer.Serialize(_items, new JsonSerializerOptions { WriteIndented = true });
                File.WriteAllText(_storePath, json);
            }
            catch { }
        }

        public void Dispose() => _timer.Dispose();
    }

    internal sealed class ClipboardEntry
    {
        public string Id { get; set; } = "";
        public string Kind { get; set; } = "text";
        public string Content { get; set; } = "";
        public string Preview { get; set; } = "";
        public List<string> FilePaths { get; set; } = [];
        public string? ImagePath { get; set; }
        public bool Pinned { get; set; }
        public long Timestamp { get; set; }
    }
}
