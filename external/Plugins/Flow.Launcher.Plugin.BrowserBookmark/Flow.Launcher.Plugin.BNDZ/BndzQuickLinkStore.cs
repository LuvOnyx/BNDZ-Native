using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Flow.Launcher.Plugin.BNDZ
{
    internal sealed class BndzQuickLinkStore
    {
        private readonly string _path;
        private List<QuickLinkEntry> _items = new();

        public BndzQuickLinkStore(string userDataDir)
        {
            var dir = Path.Combine(userDataDir, "BNDZ");
            Directory.CreateDirectory(dir);
            _path = Path.Combine(dir, "quicklinks.json");
            Load();
            EnsureSamples();
        }

        public IReadOnlyList<QuickLinkEntry> Search(string query)
        {
            var q = (query ?? "").Trim();
            IEnumerable<QuickLinkEntry> src = _items.OrderByDescending(l => l.UpdatedAt);
            if (string.IsNullOrEmpty(q)) return src.Take(40).ToList();
            return src.Where(l =>
                l.Name.Contains(q, StringComparison.OrdinalIgnoreCase)
                || l.UrlTemplate.Contains(q, StringComparison.OrdinalIgnoreCase)).Take(40).ToList();
        }

        public void Open(string id, string? query = null)
        {
            var url = ResolveUrl(id, query);
            if (string.IsNullOrWhiteSpace(url)) return;
            try
            {
                Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
            }
            catch { }
        }

        private string? ResolveUrl(string id, string? query)
        {
            var link = _items.FirstOrDefault(i => i.Id == id);
            if (link == null) return null;
            var url = link.UrlTemplate;
            if (!string.IsNullOrEmpty(query))
                url = Regex.Replace(url, @"\{query\}", Uri.EscapeDataString(query), RegexOptions.IgnoreCase);
            return url;
        }

        private void EnsureSamples()
        {
            if (_items.Count > 0) return;
            Upsert(null, "Google Search", "https://www.google.com/search?q={query}");
            Upsert(null, "GitHub", "https://github.com/search?q={query}&type=repositories");
        }

        private QuickLinkEntry? Upsert(string? id, string name, string urlTemplate)
        {
            name = name.Trim();
            urlTemplate = urlTemplate.Trim();
            if (string.IsNullOrEmpty(name) || string.IsNullOrEmpty(urlTemplate)) return null;
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var entry = new QuickLinkEntry
            {
                Id = Guid.NewGuid().ToString("N"),
                Name = name,
                UrlTemplate = urlTemplate,
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
                var list = JsonSerializer.Deserialize<List<QuickLinkEntry>>(File.ReadAllText(_path));
                if (list != null) _items = list;
            }
            catch { }
        }

        private void Save()
        {
            File.WriteAllText(_path, JsonSerializer.Serialize(_items, new JsonSerializerOptions { WriteIndented = true }));
        }
    }

    internal sealed class QuickLinkEntry
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string UrlTemplate { get; set; } = "";
        public long CreatedAt { get; set; }
        public long UpdatedAt { get; set; }
    }
}
