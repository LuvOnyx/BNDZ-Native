using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Windows.Forms;

namespace Flow.Launcher.Plugin.BNDZ
{
    /// <summary>Windows port of SuperCmd clipboard-manager.ts (text history, disk persistence).</summary>
    internal sealed class BndzClipboardStore : IDisposable
    {
        private const int MaxItems = 500;
        private const int PollMs = 1000;
        private readonly string _storePath;
        private readonly System.Threading.Timer _timer;
        private string _lastText = string.Empty;
        private readonly List<ClipboardEntry> _items = new();
        private readonly object _lock = new();

        public BndzClipboardStore(string userDataDir)
        {
            var dir = Path.Combine(userDataDir, "BNDZ");
            Directory.CreateDirectory(dir);
            _storePath = Path.Combine(dir, "clipboard-history.json");
            Load();
            _timer = new System.Threading.Timer(PollClipboard, null, PollMs, PollMs);
        }

        public IReadOnlyList<ClipboardEntry> Search(string query)
        {
            lock (_lock)
            {
                var q = (query ?? string.Empty).Trim();
                IEnumerable<ClipboardEntry> src = _items;
                if (!string.IsNullOrEmpty(q))
                    src = _items.Where(i => i.Preview.Contains(q, StringComparison.OrdinalIgnoreCase)
                        || i.Content.Contains(q, StringComparison.OrdinalIgnoreCase));
                return src.Take(40).ToList();
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
                if (!Clipboard.ContainsText()) return;
                var text = Clipboard.GetText(TextDataFormat.UnicodeText);
                if (string.IsNullOrWhiteSpace(text) || text == _lastText) return;
                if (text.Length > 100_000) return;
                _lastText = text;
                Add(text);
            }
            catch { }
        }

        private void Add(string text)
        {
            lock (_lock)
            {
                _items.RemoveAll(i => i.Content == text);
                _items.Insert(0, new ClipboardEntry
                {
                    Id = Guid.NewGuid().ToString("N"),
                    Content = text,
                    Preview = text.Length > 120 ? text.Substring(0, 117) + "…" : text,
                    Timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
                });
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
        public string Content { get; set; } = "";
        public string Preview { get; set; } = "";
        public long Timestamp { get; set; }
    }
}
