using System;
using System.Text.Json;

namespace BNDZ.Services;

/// <summary>Runtime file-operation preferences parsed from the WebView settings JSON.</summary>
public sealed class FileOperationPreferences
{
    public static FileOperationPreferences Current { get; private set; } = new();

    /// <summary>bndz = managed engine with in-app progress; native = Windows shell (SHFileOperation / Explorer UI).</summary>
    public string Engine { get; set; } = "bndz";

    public bool QueueOperations { get; set; } = true;
    public bool BackgroundProcessing { get; set; } = true;
    public bool LogActions { get; set; } = true;
    public bool SingleStepUndo { get; set; } = false;
    /// <summary>When using native engine, show Explorer progress dialogs (false = silent shell ops).</summary>
    public bool NativeShowProgress { get; set; } = true;
    public bool PersistTransferQueue { get; set; } = true;
    public int MaxActionLogEntries { get; set; } = 256;
    public UndoPromptMode UndoPrompt { get; set; } = UndoPromptMode.IfOlderThan10Minutes;

    public enum UndoPromptMode
    {
        Never,
        Always,
        IfOlderThan10Minutes,
    }

    public static bool UseNativeEngine =>
        string.Equals(Current.Engine, "native", StringComparison.OrdinalIgnoreCase)
        || string.Equals(Current.Engine, "windows", StringComparison.OrdinalIgnoreCase);

    public static void ApplyFromJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var p = new FileOperationPreferences
            {
                Engine = ReadEngine(root),
                QueueOperations = ReadBool(root, "queueFileOperations", true),
                BackgroundProcessing = ReadBool(root, "enableBackgroundProcessing", true),
                LogActions = ReadBool(root, "logActionsAndEnableUndoRedo", true),
                SingleStepUndo = ReadSingleStepUndo(root),
                NativeShowProgress = ReadBool(root, "nativeShellShowProgress", true),
                PersistTransferQueue = ReadBool(root, "persistTransferQueue", true),
                MaxActionLogEntries = ReadInt(root, "allowedNumberOfEntriesInTheActionLog", 256),
                UndoPrompt = ReadUndoPrompt(root),
            };
            Current = p;
        }
        catch
        {
            // Keep last-known-good preferences on parse failure.
        }
    }

    private static string ReadEngine(JsonElement root)
    {
        if (root.TryGetProperty("fileOperationEngine", out var engineProp))
        {
            var v = engineProp.GetString()?.Trim().ToLowerInvariant();
            if (v is "native" or "windows" or "shell") return "native";
            if (v is "bndz" or "managed" or "internal") return "bndz";
        }

        if (root.TryGetProperty("selectCopyHandler", out var handlerProp))
        {
            var h = handlerProp.GetString() ?? "";
            if (h.Contains("Windows", StringComparison.OrdinalIgnoreCase)
                || h.Contains("Default", StringComparison.OrdinalIgnoreCase))
                return "native";
            if (h.Contains("BNDZ", StringComparison.OrdinalIgnoreCase))
                return "bndz";
        }

        return "bndz";
    }

    private static bool ReadSingleStepUndo(JsonElement root)
    {
        if (!root.TryGetProperty("allowOnlySingleStepUndoRedo", out var prop)) return false;
        return prop.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => (prop.GetString() ?? "").Contains("single step", StringComparison.OrdinalIgnoreCase),
            _ => false,
        };
    }

    private static UndoPromptMode ReadUndoPrompt(JsonElement root)
    {
        if (!root.TryGetProperty("promptBeforeUndoRedo", out var prop)) return UndoPromptMode.IfOlderThan10Minutes;
        return prop.ValueKind switch
        {
            JsonValueKind.True => UndoPromptMode.Always,
            JsonValueKind.False => UndoPromptMode.Never,
            JsonValueKind.String => (prop.GetString() ?? "") switch
            {
                var s when s.Equals("Always", StringComparison.OrdinalIgnoreCase) => UndoPromptMode.Always,
                var s when s.Equals("Never", StringComparison.OrdinalIgnoreCase) => UndoPromptMode.Never,
                _ => UndoPromptMode.IfOlderThan10Minutes,
            },
            _ => UndoPromptMode.IfOlderThan10Minutes,
        };
    }

    private static int ReadInt(JsonElement root, string name, int defaultValue)
    {
        if (!root.TryGetProperty(name, out var prop)) return defaultValue;
        if (prop.ValueKind == JsonValueKind.Number && prop.TryGetInt32(out var n)) return Math.Clamp(n, 16, 4096);
        if (prop.ValueKind == JsonValueKind.String && int.TryParse(prop.GetString(), out var parsed)) return Math.Clamp(parsed, 16, 4096);
        if (prop.ValueKind == JsonValueKind.True) return defaultValue;
        return defaultValue;
    }

    private static bool ReadBool(JsonElement root, string name, bool defaultValue)
    {
        if (!root.TryGetProperty(name, out var prop)) return defaultValue;
        return prop.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => bool.TryParse(prop.GetString(), out var b) ? b : defaultValue,
            _ => defaultValue,
        };
    }
}
