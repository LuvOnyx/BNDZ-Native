using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.Json;

namespace BNDZ.Services
{
    /// <summary>
    /// Persists workspace layout and panel visibility to %AppData%\BNDZ64\BNDZ.ini (XYplorer-compatible location).
    /// </summary>
    public sealed class IniSettingsService
    {
        private readonly string _iniPath;

        public IniSettingsService()
        {
            string appData = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BNDZ64");
            Directory.CreateDirectory(appData);
            _iniPath = Path.Combine(appData, "BNDZ.ini");
        }

        public string IniPath => _iniPath;

        public void MergeWorkspaceIntoJson(ref string json)
        {
            if (string.IsNullOrWhiteSpace(json) || json == "null") return;
            var ini = ReadWorkspaceSection();
            if (ini.Count == 0) return;

            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                if (root.ValueKind != JsonValueKind.Object) return;

                using var ms = new MemoryStream();
                using (var writer = new Utf8JsonWriter(ms, new JsonWriterOptions { Indented = true }))
                {
                    writer.WriteStartObject();
                    bool wroteOuter = false, wroteInner = false;

                    foreach (var prop in root.EnumerateObject())
                    {
                        if (prop.NameEquals("workspaceLayoutOuter") || prop.NameEquals("workspaceLayoutInner")
                            || prop.NameEquals("previewPanelOpen") || prop.NameEquals("bottomPanelOpen"))
                            continue;
                        prop.WriteTo(writer);
                    }

                    if (ini.TryGetValue("OuterSidebar", out var os) && double.TryParse(os, out var sidebar)
                        && ini.TryGetValue("OuterWorkspace", out var ow) && double.TryParse(ow, out var workspace)
                        && ini.TryGetValue("OuterPreview", out var op) && double.TryParse(op, out var preview))
                    {
                        if (preview < 28) preview = 40;
                        if (workspace < 30) workspace = 46;
                        writer.WritePropertyName("workspaceLayoutOuter");
                        writer.WriteStartObject();
                        writer.WriteNumber("sidebar", sidebar);
                        writer.WriteNumber("workspace", workspace);
                        writer.WriteNumber("preview", preview);
                        writer.WriteEndObject();
                        wroteOuter = true;
                    }

                    if (ini.TryGetValue("InnerMain", out var im) && double.TryParse(im, out var main)
                        && ini.TryGetValue("InnerBottom", out var ib) && double.TryParse(ib, out var bottom))
                    {
                        if (bottom < 28) bottom = 42;
                        if (main < 45) main = 58;
                        writer.WritePropertyName("workspaceLayoutInner");
                        writer.WriteStartObject();
                        writer.WriteNumber("main", main);
                        writer.WriteNumber("bottom", bottom);
                        writer.WriteEndObject();
                        wroteInner = true;
                    }

                    if (ini.TryGetValue("PreviewPanelOpen", out var ppo))
                    {
                        writer.WritePropertyName("previewPanelOpen");
                        writer.WriteBooleanValue(ppo == "1" || ppo.Equals("true", StringComparison.OrdinalIgnoreCase));
                    }
                    if (ini.TryGetValue("BottomPanelOpen", out var bpo))
                    {
                        writer.WritePropertyName("bottomPanelOpen");
                        writer.WriteBooleanValue(bpo == "1" || bpo.Equals("true", StringComparison.OrdinalIgnoreCase));
                    }

                    // Preserve existing JSON values when INI keys missing
                    if (!wroteOuter && root.TryGetProperty("workspaceLayoutOuter", out var existingOuter))
                    {
                        writer.WritePropertyName("workspaceLayoutOuter");
                        existingOuter.WriteTo(writer);
                    }
                    if (!wroteInner && root.TryGetProperty("workspaceLayoutInner", out var existingInner))
                    {
                        writer.WritePropertyName("workspaceLayoutInner");
                        existingInner.WriteTo(writer);
                    }
                    if (!ini.ContainsKey("PreviewPanelOpen") && root.TryGetProperty("previewPanelOpen", out var eppo))
                    {
                        writer.WritePropertyName("previewPanelOpen");
                        eppo.WriteTo(writer);
                    }
                    if (!ini.ContainsKey("BottomPanelOpen") && root.TryGetProperty("bottomPanelOpen", out var ebpo))
                    {
                        writer.WritePropertyName("bottomPanelOpen");
                        ebpo.WriteTo(writer);
                    }

                    writer.WriteEndObject();
                }

                json = Encoding.UTF8.GetString(ms.ToArray());
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[IniSettingsService] Merge failed: {ex.Message}");
            }
        }

        public void WriteWorkspaceFromJson(string json)
        {
            if (string.IsNullOrWhiteSpace(json)) return;
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;
                var values = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

                if (root.TryGetProperty("workspaceLayoutOuter", out var outer) && outer.ValueKind == JsonValueKind.Object)
                {
                    if (outer.TryGetProperty("sidebar", out var s)) values["OuterSidebar"] = s.GetDouble().ToString("0.##");
                    if (outer.TryGetProperty("workspace", out var w)) values["OuterWorkspace"] = w.GetDouble().ToString("0.##");
                    if (outer.TryGetProperty("preview", out var p)) values["OuterPreview"] = p.GetDouble().ToString("0.##");
                }
                if (root.TryGetProperty("workspaceLayoutInner", out var inner) && inner.ValueKind == JsonValueKind.Object)
                {
                    if (inner.TryGetProperty("main", out var m)) values["InnerMain"] = m.GetDouble().ToString("0.##");
                    if (inner.TryGetProperty("bottom", out var b)) values["InnerBottom"] = b.GetDouble().ToString("0.##");
                }
                if (root.TryGetProperty("previewPanelOpen", out var ppo))
                    values["PreviewPanelOpen"] = ppo.ValueKind == JsonValueKind.True ? "1" : "0";
                if (root.TryGetProperty("bottomPanelOpen", out var bpo))
                    values["BottomPanelOpen"] = bpo.ValueKind == JsonValueKind.True ? "1" : "0";

                if (values.Count > 0) WriteWorkspaceSection(values);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[IniSettingsService] Write failed: {ex.Message}");
            }
        }

        private Dictionary<string, string> ReadWorkspaceSection()
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (!File.Exists(_iniPath)) return result;

            bool inWorkspace = false;
            foreach (var rawLine in File.ReadAllLines(_iniPath))
            {
                var line = rawLine.Trim();
                if (line.StartsWith(";") || line.Length == 0) continue;
                if (line.StartsWith("[") && line.EndsWith("]"))
                {
                    inWorkspace = line.Equals("[Workspace]", StringComparison.OrdinalIgnoreCase);
                    continue;
                }
                if (!inWorkspace) continue;
                int eq = line.IndexOf('=');
                if (eq <= 0) continue;
                result[line.Substring(0, eq).Trim()] = line.Substring(eq + 1).Trim();
            }
            return result;
        }

        private void WriteWorkspaceSection(Dictionary<string, string> values)
        {
            var lines = new List<string>();
            if (File.Exists(_iniPath))
            {
                bool inWorkspace = false;
                foreach (var rawLine in File.ReadAllLines(_iniPath))
                {
                    var trimmed = rawLine.Trim();
                    if (trimmed.StartsWith("[") && trimmed.EndsWith("]"))
                    {
                        if (trimmed.Equals("[Workspace]", StringComparison.OrdinalIgnoreCase))
                        {
                            inWorkspace = true;
                            continue;
                        }
                        inWorkspace = false;
                    }
                    if (inWorkspace) continue;
                    lines.Add(rawLine);
                }
            }

            while (lines.Count > 0 && string.IsNullOrWhiteSpace(lines[^1]))
                lines.RemoveAt(lines.Count - 1);

            lines.Add("");
            lines.Add("[Workspace]");
            foreach (var kv in values)
                lines.Add($"{kv.Key}={kv.Value}");

            File.WriteAllLines(_iniPath, lines, Encoding.UTF8);
        }
    }
}
