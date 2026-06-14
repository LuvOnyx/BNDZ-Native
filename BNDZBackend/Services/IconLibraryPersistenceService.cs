using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BNDZ.Services
{
    public sealed class IconLibraryDto
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string? SourceFolder { get; set; }
        public List<IconEntryDto> Icons { get; set; } = new();
    }

    public sealed class IconEntryDto
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string IcoStr { get; set; } = "";
    }

    /// <summary>Persists icon libraries to AppData JSON (reliable vs registry size limits).</summary>
    public sealed class IconLibraryPersistenceService
    {
        private readonly string _filePath;

        public IconLibraryPersistenceService()
        {
            string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "BNDZ64");
            Directory.CreateDirectory(dir);
            _filePath = Path.Combine(dir, "icon_libraries.json");
        }

        public List<IconLibraryDto> Load()
        {
            try
            {
                if (!File.Exists(_filePath)) return new List<IconLibraryDto>();
                string json = File.ReadAllText(_filePath);
                var list = JsonSerializer.Deserialize<List<IconLibraryDto>>(json, JsonOptions());
                return list ?? new List<IconLibraryDto>();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[IconLibraryPersistence] Load failed: {ex.Message}");
                return new List<IconLibraryDto>();
            }
        }

        public void Save(IEnumerable<IconLibraryDto> libraries)
        {
            try
            {
                string json = JsonSerializer.Serialize(libraries, JsonOptions());
                File.WriteAllText(_filePath, json);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[IconLibraryPersistence] Save failed: {ex.Message}");
            }
        }

        private static JsonSerializerOptions JsonOptions() => new()
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = true,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        };
    }
}
