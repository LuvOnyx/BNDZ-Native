using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;

namespace Flow.Launcher.Plugin.BNDZ
{
    internal sealed class BndzSnippetStore
    {
        private readonly string _path;
        private List<SnippetEntry> _items = new();

        public BndzSnippetStore(string userDataDir)
        {
            var dir = Path.Combine(userDataDir, "BNDZ");
            Directory.CreateDirectory(dir);
            _path = Path.Combine(dir, "snippets.json");
            Load();
            EnsureSamples();
        }

        public IReadOnlyList<SnippetEntry> Search(string query)
        {
            var q = (query ?? "").Trim();
            IEnumerable<SnippetEntry> src = _items.OrderByDescending(s => s.Pinned).ThenByDescending(s => s.UpdatedAt);
            if (string.IsNullOrEmpty(q)) return src.Take(40).ToList();
            return src.Where(s =>
                s.Name.Contains(q, StringComparison.OrdinalIgnoreCase)
                || s.Content.Contains(q, StringComparison.OrdinalIgnoreCase)
                || (s.Keyword?.Contains(q, StringComparison.OrdinalIgnoreCase) ?? false)).Take(40).ToList();
        }

        public string? RenderContent(string id)
        {
            var s = _items.FirstOrDefault(i => i.Id == id);
            if (s == null) return null;
            var text = s.Content;
            text = text.Replace("{clipboard}", GetClipboardSafe(), StringComparison.OrdinalIgnoreCase);
            text = text.Replace("{date}", DateTime.Now.ToString("yyyy-MM-dd"), StringComparison.OrdinalIgnoreCase);
            text = text.Replace("{time}", DateTime.Now.ToString("HH:mm"), StringComparison.OrdinalIgnoreCase);
            return text;
        }

        public void PasteSnippet(string id)
        {
            var text = RenderContent(id);
            if (!string.IsNullOrEmpty(text))
                Clipboard.SetText(text);
        }

        private static string GetClipboardSafe()
        {
            try { return Clipboard.ContainsText() ? Clipboard.GetText() : ""; }
            catch { return ""; }
        }

        private void EnsureSamples()
        {
            if (_items.Count > 0) return;
            Upsert(null, "Email signature", "—\nSent from BNDZ", "sig");
            Upsert(null, "Current date", "Today is {date}", "date");
        }

        private SnippetEntry? Upsert(string? id, string name, string content, string? keyword)
        {
            name = name.Trim();
            content = content.Trim();
            if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(content)) return null;
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var entry = new SnippetEntry
            {
                Id = Guid.NewGuid().ToString("N"),
                Name = name,
                Content = content,
                Keyword = keyword?.Trim(),
                CreatedAt = now,
                UpdatedAt = now,
            };
            _items.Add(entry);
            Save();
            return entry;
        }

        private void Load()
        {
            if (!File.Exists(_path)) return;
            try
            {
                var list = JsonSerializer.Deserialize<List<SnippetEntry>>(File.ReadAllText(_path));
                if (list != null) _items = list;
            }
            catch { }
        }

        private void Save()
        {
            File.WriteAllText(_path, JsonSerializer.Serialize(_items, new JsonSerializerOptions { WriteIndented = true }));
        }
    }

    internal sealed class SnippetEntry
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string Content { get; set; } = "";
        public string? Keyword { get; set; }
        public bool Pinned { get; set; }
        public long CreatedAt { get; set; }
        public long UpdatedAt { get; set; }
    }
}
