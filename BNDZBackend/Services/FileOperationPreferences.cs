using System;
using System.Collections.Generic;
using System.Text.Json;

namespace BNDZ.Services;

/// <summary>Runtime file-operation preferences parsed from the WebView settings JSON.</summary>
public sealed class FileOperationPreferences
{
    public static FileOperationPreferences Current { get; private set; } = new();

    /// <summary>bndz | native | teracopy</summary>
    public string Engine { get; set; } = "bndz";
    public string CopyHandler { get; set; } = "bndz";

    public bool QueueOperations { get; set; } = true;
    public bool BackgroundProcessing { get; set; } = true;
    public bool LogActions { get; set; } = true;
    public bool SingleStepUndo { get; set; } = false;
    public bool NativeShowProgress { get; set; } = true;
    public bool PersistTransferQueue { get; set; } = true;
    public bool RememberActionLogBetweenSessions { get; set; } = false;
    public bool PersistActionLogOnExit { get; set; } = false;
    public int MaxActionLogEntries { get; set; } = 256;
    public int MaxItemsPerLoggedAction { get; set; }
    public string DateFormatInActionLabels { get; set; } = "age";
    public UndoPromptMode UndoPrompt { get; set; } = UndoPromptMode.IfOlderThan10Minutes;

    public bool UseCustomCopy { get; set; }
    public bool ForAllCopyOperations { get; set; }
    public bool ForAllMoveOperations { get; set; }
    public bool ForCrossVolumeMovesOnly { get; set; }
    public bool NoProgressDialogOnDuplications { get; set; }
    public bool NoProgressDialogOnIntraVolumeMoves { get; set; }
    public bool CheckSpaceBeforeCopy { get; set; }
    public bool DefaultRepeatOnCollision { get; set; }

    public bool SuppressDeleteConfirmation { get; set; }
    public bool PreservePermissionsOnMove { get; set; }
    public bool ProgressDialogModeless { get; set; }
    public string RecreateSourceFolderStructure { get; set; } = "Ask";
    public bool CopyTagsOnCopyOperations { get; set; }
    public bool CopyTagsOnBackupAndSync { get; set; }
    public bool SetArchiveAttributeOnFolderRename { get; set; }

    public enum UndoPromptMode
    {
        Never,
        Always,
        IfOlderThan10Minutes,
    }

    public static bool UseNativeEngine =>
        string.Equals(ResolveOperationEngine("copy", new List<string>(), ""), "native", StringComparison.OrdinalIgnoreCase);

    public static string ResolveOperationEngine(string action, IReadOnlyList<string> sources, string target)
    {
        var p = Current;
        if (p.CopyHandler == "teracopy" && action is "copy" or "move")
            return "teracopy";

        if (string.Equals(p.Engine, "native", StringComparison.OrdinalIgnoreCase)
            || string.Equals(p.Engine, "windows", StringComparison.OrdinalIgnoreCase))
            return "native";

        if (p.UseCustomCopy)
        {
            if (action == "copy" && p.ForAllCopyOperations) return "bndz";
            if (action == "move" && p.ForAllMoveOperations)
            {
                if (p.ForCrossVolumeMovesOnly && !FileOperationPathPlanner.IsCrossVolume(sources, target))
                    return p.NoProgressDialogOnIntraVolumeMoves ? "native" : "bndz";
                return "bndz";
            }
        }

        return "bndz";
    }

    public bool ShouldShowNativeProgress(string action, IReadOnlyList<string> sources, string target)
    {
        if (ProgressDialogModeless) return false;
        if (!NativeShowProgress) return false;
        if (UseCustomCopy && action == "copy" && ForAllCopyOperations && NoProgressDialogOnDuplications)
            return false;
        if (UseCustomCopy && action == "move" && ForAllMoveOperations && NoProgressDialogOnIntraVolumeMoves
            && !FileOperationPathPlanner.IsCrossVolume(sources, target))
            return false;
        return true;
    }

    public static void ApplyFromJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return;
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var copyHandler = ReadCopyHandler(root);
            var p = new FileOperationPreferences
            {
                Engine = ReadEngine(root, copyHandler),
                CopyHandler = copyHandler,
                QueueOperations = ReadBool(root, "queueFileOperations", true),
                BackgroundProcessing = ReadBool(root, "enableBackgroundProcessing", true),
                LogActions = ReadBool(root, "logActionsAndEnableUndoRedo", true),
                SingleStepUndo = ReadSingleStepUndo(root),
                NativeShowProgress = ReadBool(root, "nativeShellShowProgress", true),
                PersistTransferQueue = ReadBool(root, "persistTransferQueue", true),
                RememberActionLogBetweenSessions = ReadBool(root, "rememberTheLoggedActionsBetweenSessions", false),
                PersistActionLogOnExit = ReadBool(root, "evenOnExitWithoutSaving", false),
                MaxActionLogEntries = ReadInt(root, "allowedNumberOfEntriesInTheActionLog", 256, 16, 4096),
                MaxItemsPerLoggedAction = ReadInt(root, "allowedNumberOfItemsPerLoggedAction", 0, 0, 100_000),
                DateFormatInActionLabels = ReadDateFormat(root),
                UndoPrompt = ReadUndoPrompt(root),
                UseCustomCopy = ReadBool(root, "useCustomCopy", false),
                ForAllCopyOperations = ReadBool(root, "forAllCopyOperations", false),
                ForAllMoveOperations = ReadBool(root, "forAllMoveOperations", false),
                ForCrossVolumeMovesOnly = ReadBool(root, "forCrossVolumeMovesOnly", false),
                NoProgressDialogOnDuplications = ReadBool(root, "noProgressDialogOnDuplications", false),
                NoProgressDialogOnIntraVolumeMoves = ReadBool(root, "noProgressDialogOnIntraVolumeMoves", false),
                CheckSpaceBeforeCopy = ReadBool(root, "checkBeforehandWhetherThereIsEnoughSpace", false),
                DefaultRepeatOnCollision = ReadBool(root, "defaultToRepeatActionOnCollisions", false),
                SuppressDeleteConfirmation = ReadBool(root, "suppressDeleteConfirmationDialog", false),
                PreservePermissionsOnMove = ReadBool(root, "preservePermissionsOnMoveOperation", false),
                ProgressDialogModeless = ReadBool(root, "fileOperationProgressDialogModeless", false),
                RecreateSourceFolderStructure = ReadString(root, "recreateSourceFolderStructure", "Ask"),
                CopyTagsOnCopyOperations = ReadBool(root, "copyTagsOnCopyOperations", false),
                CopyTagsOnBackupAndSync = ReadBool(root, "copyTagsOnBackupAndSyncOperations", false),
                SetArchiveAttributeOnFolderRename = ReadBool(root, "setArchiveAttributeOnFolderRename", false),
            };
            Current = p;
        }
        catch
        {
            // Keep last-known-good preferences on parse failure.
        }
    }

    private static string ReadCopyHandler(JsonElement root)
    {
        if (!root.TryGetProperty("selectCopyHandler", out var prop)) return "bndz";
        var h = prop.GetString() ?? "";
        if (h.Contains("TeraCopy", StringComparison.OrdinalIgnoreCase)) return "teracopy";
        if (h.Contains("Windows", StringComparison.OrdinalIgnoreCase) || h.Contains("Default", StringComparison.OrdinalIgnoreCase))
            return "native";
        return "bndz";
    }

    private static string ReadEngine(JsonElement root, string copyHandler)
    {
        if (copyHandler == "teracopy") return "teracopy";

        if (root.TryGetProperty("fileOperationEngine", out var engineProp))
        {
            var v = engineProp.GetString()?.Trim().ToLowerInvariant();
            if (v is "native" or "windows" or "shell") return "native";
            if (v is "bndz" or "managed" or "internal") return "bndz";
        }

        return copyHandler == "native" ? "native" : "bndz";
    }

    private static string ReadDateFormat(JsonElement root)
    {
        var raw = ReadString(root, "dateFormatInActionLabels", "Age of action (how long ago)");
        if (raw.Contains("Absolute", StringComparison.OrdinalIgnoreCase)) return "absolute";
        if (raw.Contains("Relative to today", StringComparison.OrdinalIgnoreCase)) return "relative_today";
        return "age";
    }

    private static string ReadString(JsonElement root, string name, string defaultValue)
    {
        if (!root.TryGetProperty(name, out var prop)) return defaultValue;
        return prop.GetString() ?? defaultValue;
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

    private static int ReadInt(JsonElement root, string name, int defaultValue, int min, int max)
    {
        if (!root.TryGetProperty(name, out var prop)) return defaultValue;
        if (prop.ValueKind == JsonValueKind.Number && prop.TryGetInt32(out var n)) return Math.Clamp(n, min, max);
        if (prop.ValueKind == JsonValueKind.String && int.TryParse(prop.GetString(), out var parsed)) return Math.Clamp(parsed, min, max);
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
