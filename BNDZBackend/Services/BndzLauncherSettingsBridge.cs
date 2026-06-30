using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace BNDZ.Services;

/// <summary>Syncs BNDZ file-manager settings with the bundled Flow-based launcher (no Flow source edits).</summary>
public sealed class BndzLauncherSettingsBridge
{
    public const string SyncThemeName = "BndzSync";

    private static readonly Dictionary<string, string> ThemeMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["Dark"] = "BndzLauncher",
        ["DarkMica"] = "BndzLauncher",
        ["Light"] = "Win11Light",
        ["LightMica"] = "BlurWhite",
        ["LightRoundedFlat"] = "SlimLight",
        ["MinimalWhite"] = "BlurWhite",
        ["Nord"] = "Nord Darker",
        ["Nordic Frost"] = "Nord Darker",
        ["macOS Sonoma"] = "Midnight",
        ["macOS Light"] = "Win11Light",
        ["Slate Workstation"] = "BndzLauncher",
        ["Studio Obsidian"] = "BndzLauncher",
        ["Monokai Minimal"] = "BndzLauncher",
        ["Aurora Violet"] = "BndzLauncher",
        ["Emerald Night"] = "BndzLauncher",
        ["Sunset Ember"] = "BndzLauncher",
        ["Graphite Pro"] = "BndzLauncher",
        ["Ocean Deep"] = "BndzLauncher",
        ["Nortorn"] = "BndzLauncher",
        ["Neumorphic"] = "SlimLight",
    };

    public static bool IsLauncherEnabled(string? bndzJson)
    {
        if (string.IsNullOrWhiteSpace(bndzJson)) return true;
        try
        {
            using var doc = JsonDocument.Parse(bndzJson);
            if (doc.RootElement.TryGetProperty("launcherEnabled", out var el))
                return el.ValueKind != JsonValueKind.False;
        }
        catch { }
        return true;
    }

    public static bool ShouldExitLauncherWithBndz(string? bndzJson)
    {
        if (string.IsNullOrWhiteSpace(bndzJson)) return true;
        try
        {
            using var doc = JsonDocument.Parse(bndzJson);
            if (doc.RootElement.TryGetProperty("launcherExitWithBndz", out var el))
                return el.ValueKind != JsonValueKind.False;
        }
        catch { }
        return true;
    }

    public LauncherSyncPlan SyncFromBndzJson(string? bndzJson)
    {
        var plan = new LauncherSyncPlan { Enabled = IsLauncherEnabled(bndzJson) };
        if (!plan.Enabled) return plan;

        var launcherDir = BndzFlowLauncherService.Instance.LauncherDirectory;
        EnsurePortableDataFolder(launcherDir);
        var dataDir = Path.Combine(launcherDir, "UserData");
        var settingsDir = Path.Combine(dataDir, "Settings");
        var themesDir = Path.Combine(dataDir, "Themes");
        Directory.CreateDirectory(settingsDir);
        Directory.CreateDirectory(themesDir);

        string hotkey = "Alt + Space";
        bool syncTheme = true;
        bool hideTray = true;
        string bndzTheme = "Dark";
        bool applyColors = false;
        string bg = "#0D0B0E";
        string surface = "#2b292e";
        string accent = "#007acc";
        string text = "#ffffff";

        if (!string.IsNullOrWhiteSpace(bndzJson))
        {
            try
            {
                using var doc = JsonDocument.Parse(bndzJson);
                var root = doc.RootElement;
                hotkey = GetString(root, "launcherHotkey", hotkey);
                syncTheme = GetBool(root, "launcherSyncTheme", true);
                hideTray = GetBool(root, "launcherHideTrayIcon", true);
                bndzTheme = GetString(root, "theme", bndzTheme);
                applyColors = GetBool(root, "applyColors", false);
                bg = GetString(root, "bgMain", GetString(root, "colorConfig2", bg));
                surface = GetString(root, "bgSurface", GetString(root, "colorConfig7", surface));
                accent = GetString(root, "accent", GetString(root, "colorConfig15", accent));
                text = GetString(root, "textMain", GetString(root, "colorConfig1", text));
            }
            catch { }
        }

        string flowTheme = syncTheme && applyColors
            ? SyncThemeName
            : ResolveFlowThemeName(bndzTheme);

        if (syncTheme && applyColors)
            WriteBndzSyncTheme(themesDir, bg, surface, accent, text);

        var settingsPath = Path.Combine(settingsDir, "Settings.json");
        var settings = LoadOrCreateFlowSettings(settingsPath);
        settings["Hotkey"] = hotkey;
        settings["HideNotifyIcon"] = hideTray;
        settings["StartFlowLauncherOnSystemStartup"] = false;
        settings["UseLogonTaskForStartup"] = false;
        settings["Theme"] = syncTheme && applyColors ? SyncThemeName : "BndzLauncher";
        settings["HideOnStartup"] = true;
        settings["ColorScheme"] = IsLightTheme(bg, text) ? "Light" : "Dark";

        File.WriteAllText(settingsPath, settings.ToJsonString(new JsonSerializerOptions { WriteIndented = true }));

        plan.Hotkey = hotkey;
        plan.FlowTheme = flowTheme;
        plan.RequiresRestart = true;
        return plan;
    }

    private static void EnsurePortableDataFolder(string launcherDir)
    {
        var userData = Path.Combine(launcherDir, "UserData");
        if (!Directory.Exists(userData))
            Directory.CreateDirectory(userData);
    }

    private static JsonObject LoadOrCreateFlowSettings(string path)
    {
        if (File.Exists(path))
        {
            try
            {
                return JsonNode.Parse(File.ReadAllText(path))?.AsObject() ?? new JsonObject();
            }
            catch { }
        }
        return new JsonObject();
    }

    private static string ResolveFlowThemeName(string bndzTheme) =>
        ThemeMap.TryGetValue(bndzTheme, out var mapped) ? mapped : "BndzLauncher";

    private static void WriteBndzSyncTheme(string themesDir, string bg, string surface, string accent, string text)
    {
        var muted = BlendHex(text, surface, 0.55);
        var selectedBg = BlendHex(accent, surface, 0.35);
        var path = Path.Combine(themesDir, $"{SyncThemeName}.xaml");
        var xaml = $@"<?xml version=""1.0"" encoding=""UTF-8"" ?>
<!--
    Name: BNDZ Sync
    IsDark: True
    HasBlur: False
-->
<ResourceDictionary xmlns=""http://schemas.microsoft.com/winfx/2006/xaml/presentation"" xmlns:x=""http://schemas.microsoft.com/winfx/2006/xaml"">
    <ResourceDictionary.MergedDictionaries>
        <ResourceDictionary Source=""pack://application:,,,/Themes/Base.xaml"" />
    </ResourceDictionary.MergedDictionaries>
    <Thickness x:Key=""ResultMargin"">0 0 0 8</Thickness>
    <Style x:Key=""ItemGlyph"" BasedOn=""{{StaticResource BaseGlyphStyle}}"" TargetType=""{{x:Type TextBlock}}"">
        <Setter Property=""Foreground"" Value=""{text}"" />
    </Style>
    <Style x:Key=""QueryBoxStyle"" BasedOn=""{{StaticResource BaseQueryBoxStyle}}"" TargetType=""{{x:Type TextBox}}"">
        <Setter Property=""Foreground"" Value=""{text}"" />
        <Setter Property=""CaretBrush"" Value=""{accent}"" />
        <Setter Property=""FontSize"" Value=""28"" />
    </Style>
    <Style x:Key=""QuerySuggestionBoxStyle"" BasedOn=""{{StaticResource BaseQuerySuggestionBoxStyle}}"" TargetType=""{{x:Type TextBox}}"">
        <Setter Property=""Foreground"" Value=""{muted}"" />
        <Setter Property=""FontSize"" Value=""28"" />
    </Style>
    <Style x:Key=""WindowBorderStyle"" BasedOn=""{{StaticResource BaseWindowBorderStyle}}"" TargetType=""{{x:Type Border}}"">
        <Setter Property=""Background"" Value=""{bg}"" />
        <Setter Property=""BorderBrush"" Value=""{surface}"" />
        <Setter Property=""BorderThickness"" Value=""1"" />
        <Setter Property=""CornerRadius"" Value=""8"" />
    </Style>
    <Style x:Key=""WindowStyle"" BasedOn=""{{StaticResource BaseWindowStyle}}"" TargetType=""{{x:Type Window}}"" />
    <Style x:Key=""PendingLineStyle"" BasedOn=""{{StaticResource BasePendingLineStyle}}"" TargetType=""{{x:Type Line}}"">
        <Setter Property=""Stroke"" Value=""{accent}"" />
    </Style>
    <Style x:Key=""ItemTitleStyle"" BasedOn=""{{StaticResource BaseItemTitleStyle}}"" TargetType=""{{x:Type TextBlock}}"">
        <Setter Property=""Foreground"" Value=""{text}"" />
    </Style>
    <Style x:Key=""ItemSubTitleStyle"" BasedOn=""{{StaticResource BaseItemSubTitleStyle}}"" TargetType=""{{x:Type TextBlock}}"">
        <Setter Property=""Foreground"" Value=""{muted}"" />
    </Style>
    <Style x:Key=""ItemTitleSelectedStyle"" BasedOn=""{{StaticResource BaseItemTitleSelectedStyle}}"" TargetType=""{{x:Type TextBlock}}"">
        <Setter Property=""Foreground"" Value=""{text}"" />
    </Style>
    <Style x:Key=""ItemSubTitleSelectedStyle"" BasedOn=""{{StaticResource BaseItemSubTitleSelectedStyle}}"" TargetType=""{{x:Type TextBlock}}"">
        <Setter Property=""Foreground"" Value=""{muted}"" />
    </Style>
    <SolidColorBrush x:Key=""ItemSelectedBackgroundColor"">{selectedBg}</SolidColorBrush>
    <Style x:Key=""SearchIconStyle"" BasedOn=""{{StaticResource BaseSearchIconStyle}}"" TargetType=""{{x:Type Path}}"">
        <Setter Property=""Fill"" Value=""{muted}"" />
    </Style>
</ResourceDictionary>
";
        File.WriteAllText(path, xaml);
    }

    private static string GetString(JsonElement root, string name, string fallback) =>
        root.TryGetProperty(name, out var el) && el.ValueKind == JsonValueKind.String
            ? el.GetString() ?? fallback
            : fallback;

    private static bool GetBool(JsonElement root, string name, bool fallback)
    {
        if (!root.TryGetProperty(name, out var el)) return fallback;
        return el.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => fallback,
        };
    }

    private static bool IsLightTheme(string bg, string text)
    {
        if (text.Contains("000", StringComparison.OrdinalIgnoreCase) && !bg.Contains("fff", StringComparison.OrdinalIgnoreCase))
            return true;
        return false;
    }

    private static string BlendHex(string a, string b, double t)
    {
        static int Parse(string hex, int offset)
        {
            hex = hex.TrimStart('#');
            if (hex.Length < 6) return 0;
            return Convert.ToInt32(hex.Substring(offset, 2), 16);
        }
        var ar = Parse(a, 0); var ag = Parse(a, 2); var ab = Parse(a, 4);
        var br = Parse(b, 0); var bg = Parse(b, 2); var bb = Parse(b, 4);
        int r = (int)(ar + (br - ar) * t);
        int g = (int)(ag + (bg - ag) * t);
        int bl = (int)(ab + (bb - ab) * t);
        return $"#{r:X2}{g:X2}{bl:X2}";
    }
}

public sealed class LauncherSyncPlan
{
    public bool Enabled { get; set; } = true;
    public bool RequiresRestart { get; set; }
    public string Hotkey { get; set; } = "Alt + Space";
    public string FlowTheme { get; set; } = "BndzLauncher";
}
