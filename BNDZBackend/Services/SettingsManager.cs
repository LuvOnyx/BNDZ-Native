using System;
using System.IO;

namespace BNDZ.Services
{
    public class SettingsManager
    {
        private readonly string _configFilePath;
        private readonly IniSettingsService _iniSettings = new();

        public SettingsManager()
        {
            try
            {
                string appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
                string bndzData = Path.Combine(appData, "BNDZ64");
                if (!Directory.Exists(bndzData))
                {
                    Directory.CreateDirectory(bndzData);
                }
                _configFilePath = Path.Combine(bndzData, "bndz_config.json");
            }
            catch
            {
                _configFilePath = "bndz_config.json"; // Fallback to current directory if permissions fail
            }
        }

        public void SaveSettings(string jsonConfig)
        {
            try
            {
                File.WriteAllText(_configFilePath, jsonConfig);
                _iniSettings.WriteWorkspaceFromJson(jsonConfig);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[SettingsManager] Failed to save settings: {ex.Message}");
            }
        }

        public string LoadSettings()
        {
            try
            {
                string json = null;
                if (File.Exists(_configFilePath))
                    json = File.ReadAllText(_configFilePath);

                if (!string.IsNullOrEmpty(json))
                {
                    _iniSettings.MergeWorkspaceIntoJson(ref json);
                    return json;
                }

                // No JSON yet — seed from INI workspace section only
                var iniOnly = "{}";
                _iniSettings.MergeWorkspaceIntoJson(ref iniOnly);
                if (iniOnly != "{}") return iniOnly;
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[SettingsManager] Failed to load settings: {ex.Message}");
            }
            return null;
        }
    }
}
