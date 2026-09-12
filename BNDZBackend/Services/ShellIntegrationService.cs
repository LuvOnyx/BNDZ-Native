using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Win32;

namespace BNDZ.Services;

public sealed class ShellIntegrationResult
{
    public bool Success { get; init; }
    public string Message { get; init; } = "";
    public bool NeedsElevation { get; init; }
}

public sealed class DefaultFileManagerStatus
{
    public bool Active { get; init; }
    public bool DirectoryOpen { get; init; }
    public bool DriveOpen { get; init; }
    public bool FolderOpen { get; init; }
}

public class ShellIntegrationService
{
    private const string ProgId = "BNDZ.FileManager";
    private const int ShcneAssocChanged = 0x08000000;
    private const uint ShcnfIdList = 0x0000;

    private const string MissingSentinel = "__BNDZ_MISSING__";

    /// <summary>
    /// Native WinUI host close. When null, classic WPF uses Application.Current.Shutdown.
    /// </summary>
    public Action? ExitHost { get; set; }

    private static readonly (string ShellKey, string[] Verbs)[] DefaultFmShellClasses =
    [
        (@"Software\Classes\Directory\shell", new[] { "open", "opennewwindow" }),
        (@"Software\Classes\Folder\shell", new[] { "open", "opennewwindow" }),
        (@"Software\Classes\Drive\shell", new[] { "open", "opennewwindow" }),
        (@"Software\Classes\LibraryFolder\shell", new[] { "open" }),
    ];

    private static string BackupFilePath => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "BNDZ64",
        "default-fm-backup.json");

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(int wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

    public bool IsElevated()
    {
        try
        {
            using var identity = WindowsIdentity.GetCurrent();
            var principal = new WindowsPrincipal(identity);
            return principal.IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch
        {
            return false;
        }
    }

    public DefaultFileManagerStatus GetDefaultFileManagerStatus()
    {
        var exe = Process.GetCurrentProcess().MainModule?.FileName ?? "";
        var directoryOpen = CommandPointsToBndz(@"Software\Classes\Directory\shell\open\command", exe);
        var folderOpen = CommandPointsToBndz(@"Software\Classes\Folder\shell\open\command", exe);
        var driveOpen = CommandPointsToBndz(@"Software\Classes\Drive\shell\open\command", exe);
        return new DefaultFileManagerStatus
        {
            DirectoryOpen = directoryOpen,
            FolderOpen = folderOpen,
            DriveOpen = driveOpen,
            Active = directoryOpen && driveOpen,
        };
    }

    private static bool CommandPointsToBndz(string commandKeyPath, string exe)
    {
        var command = ReadRegistryValue(commandKeyPath, "");
        if (string.IsNullOrWhiteSpace(command) || string.IsNullOrWhiteSpace(exe)) return false;
        return command.Contains("BNDZ", StringComparison.OrdinalIgnoreCase)
               || command.Contains(exe, StringComparison.OrdinalIgnoreCase)
               || command.Contains(ProgId, StringComparison.OrdinalIgnoreCase);
    }

    public void ExecuteFile(string path, string verb = "open")
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = path,
                Verb = verb,
                UseShellExecute = true
            });
        }
        catch { }
    }

    public void LaunchSystemTool(string tool, string workingDir = "")
    {
        var startInfo = new ProcessStartInfo { UseShellExecute = true };
        switch (tool)
        {
            case "launch-cmd":
            case "cmd":
                startInfo.FileName = "cmd.exe";
                if (!string.IsNullOrEmpty(workingDir)) startInfo.WorkingDirectory = workingDir;
                break;
            case "launch-ps":
            case "ps":
                startInfo.FileName = "powershell.exe";
                if (!string.IsNullOrEmpty(workingDir)) startInfo.WorkingDirectory = workingDir;
                break;
            case "launch-taskmgr":
            case "taskmgr":
                startInfo.FileName = "taskmgr.exe";
                break;
            case "launch-regedit":
            case "regedit":
                startInfo.FileName = "regedit.exe";
                break;
            case "map_network_drive":
                startInfo.FileName = "explorer.exe";
                startInfo.Arguments = "shell:::{871C5380-42A0-1069-A2EA-08002B30309D}";
                break;
            case "share":
                // Nearby Sharing / Bluetooth share settings — not Map Network Drive.
                startInfo.FileName = "ms-settings:crossdevice";
                startInfo.UseShellExecute = true;
                break;
            case "burn_disc":
                startInfo.FileName = "isoburn.exe";
                break;
            case "launch-control_panel":
            case "control_panel":
                startInfo.FileName = "control.exe";
                break;
            case "launch-settings":
            case "settings_app":
                startInfo.FileName = "ms-settings:";
                break;
            case "launch-device_manager":
            case "device_manager":
                startInfo.FileName = "devmgmt.msc";
                break;
            case "launch-services":
            case "services":
                startInfo.FileName = "services.msc";
                break;
            case "launch-event_viewer":
            case "event_viewer":
                startInfo.FileName = "eventvwr.msc";
                break;
            case "launch-disk_mgmt":
            case "disk_mgmt":
                startInfo.FileName = "diskmgmt.msc";
                break;
            case "launch-computer_mgmt":
            case "computer_mgmt":
                startInfo.FileName = "compmgmt.msc";
                break;
            case "launch-sysdm":
            case "sysdm_cpl":
                startInfo.FileName = "sysdm.cpl";
                break;
            case "launch-notepad":
            case "notepad":
                startInfo.FileName = "notepad.exe";
                break;
            case "launch-calc":
            case "calc":
                startInfo.FileName = "calc.exe";
                break;
            case "launch-paint":
            case "paint":
                startInfo.FileName = "mspaint.exe";
                break;
            case "launch-snipping_tool":
            case "snipping_tool":
                startInfo.FileName = "snippingtool.exe";
                break;
            case "launch-explorer":
            case "explorer":
                startInfo.FileName = "explorer.exe";
                if (!string.IsNullOrEmpty(workingDir)) startInfo.Arguments = workingDir;
                break;
            case "launch-network_connections":
            case "network_connections":
                startInfo.FileName = "ncpa.cpl";
                break;
            case "launch-printers":
            case "printers":
                startInfo.FileName = "control.exe";
                startInfo.Arguments = "printers";
                break;
            case "launch-appwiz":
            case "programs_features":
                startInfo.FileName = "appwiz.cpl";
                break;
            case "launch-firewall":
            case "firewall":
                startInfo.FileName = "firewall.cpl";
                break;
            case "launch-power_options":
            case "power_options":
                startInfo.FileName = "powercfg.cpl";
                break;
            case "launch-user_accounts":
            case "user_accounts":
                startInfo.FileName = "netplwiz.exe";
                break;
            case "launch-msinfo":
            case "msinfo":
                startInfo.FileName = "msinfo32.exe";
                break;
            case "launch-dxdiag":
            case "dxdiag":
                startInfo.FileName = "dxdiag.exe";
                break;
            case "launch-magnifier":
            case "magnifier":
                startInfo.FileName = "magnify.exe";
                break;
            case "launch-osk":
            case "osk":
                startInfo.FileName = "osk.exe";
                break;
            case "extract":
                if (!string.IsNullOrEmpty(workingDir))
                {
                    string p = workingDir;
                    if (p.StartsWith("/")) p = p[1..];
                    p = p.Replace('/', '\\');
                    if (File.Exists(p))
                    {
                        startInfo.FileName = p;
                        startInfo.Verb = "extract";
                    }
                }
                break;
            default:
                return;
        }
        try { Process.Start(startInfo); } catch { }
    }

    public void RenameItem(string sourcePath, string newName)
    {
        try
        {
            var directory = Path.GetDirectoryName(sourcePath);
            if (string.IsNullOrEmpty(directory)) return;
            var destination = Path.Combine(directory, newName);
            if (File.Exists(sourcePath)) File.Move(sourcePath, destination);
            else if (Directory.Exists(sourcePath)) Directory.Move(sourcePath, destination);
        }
        catch { }
    }

    public ShellIntegrationResult SetAsDefaultFileManager(bool enable)
    {
        try
        {
            var exe = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exe))
                return Fail("Could not resolve BNDZ executable path.");

            if (enable)
                return EnableDefaultFileManager(exe);

            return DisableDefaultFileManager();
        }
        catch (UnauthorizedAccessException)
        {
            return new ShellIntegrationResult
            {
                Success = false,
                Message = "Access denied while updating registry. Administrator approval may be required.",
                NeedsElevation = true
            };
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    private ShellIntegrationResult EnableDefaultFileManager(string exe)
    {
        BackupDefaultFmRegistry();
        RegisterProgId(exe);

        var openCommand = $"\"{exe}\" --open-path \"%1\"";
        foreach (var (shellKey, verbs) in DefaultFmShellClasses)
        {
            using (var shell = Registry.CurrentUser.CreateSubKey(shellKey))
                shell?.SetValue("", "open");

            foreach (var verb in verbs)
            {
                var openKeyPath = $@"{shellKey}\{verb}";
                var commandKeyPath = $@"{openKeyPath}\command";

                using (var commandKey = Registry.CurrentUser.CreateSubKey(commandKeyPath))
                    commandKey?.SetValue("", openCommand);

                using (var openKey = Registry.CurrentUser.CreateSubKey(openKeyPath))
                {
                    try { openKey?.DeleteValue("DelegateExecute", false); } catch { }
                    try { openKey?.DeleteValue("DropTarget", false); } catch { }
                    openKey?.SetValue("DelegateExecute", "", RegistryValueKind.String);
                }
            }
        }

        NotifyShellAssociationChanged();
        return new ShellIntegrationResult
        {
            Success = true,
            Message = "BNDZ is now the default file manager for this user. Double-click folders and drives to open in BNDZ."
        };
    }

    private ShellIntegrationResult DisableDefaultFileManager()
    {
        RestoreDefaultFmRegistry();
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree($@"Software\Classes\{ProgId}", false);
        }
        catch { }

        NotifyShellAssociationChanged();
        return new ShellIntegrationResult
        {
            Success = true,
            Message = "Windows Explorer is restored as the default file manager."
        };
    }

    private static void RegisterProgId(string exe)
    {
        using var progKey = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{ProgId}");
        progKey?.SetValue("", "BNDZ File Manager");

        using var iconKey = progKey?.CreateSubKey("DefaultIcon");
        iconKey?.SetValue("", $"\"{exe}\",0");

        using var openKey = progKey?.CreateSubKey(@"shell\open\command");
        openKey?.SetValue("", $"\"{exe}\" --open-path \"%1\"");
    }

    private static void BackupDefaultFmRegistry()
    {
        var backup = LoadBackup();
        var changed = false;

        foreach (var (shellKey, verbs) in DefaultFmShellClasses)
        {
            if (EnsureBackupEntry(backup, shellKey, "")) changed = true;
            foreach (var verb in verbs)
            {
                var openKeyPath = $@"{shellKey}\{verb}";
                var commandKeyPath = $@"{openKeyPath}\command";
                if (EnsureBackupEntry(backup, commandKeyPath, "")) changed = true;
                if (EnsureBackupEntry(backup, openKeyPath, "DelegateExecute")) changed = true;
                if (EnsureBackupEntry(backup, openKeyPath, "DropTarget")) changed = true;
            }
        }

        if (changed)
            SaveBackup(backup);
    }

    private static bool EnsureBackupEntry(Dictionary<string, string?> backup, string keyPath, string valueName)
    {
        var id = BackupId(keyPath, valueName);
        if (backup.ContainsKey(id)) return false;
        backup[id] = ReadRegistryValue(keyPath, valueName) ?? MissingSentinel;
        return true;
    }

    private static string BackupId(string keyPath, string valueName) =>
        string.IsNullOrEmpty(valueName) ? keyPath : $"{keyPath}::{valueName}";

    private static void RestoreDefaultFmRegistry()
    {
        var backup = LoadBackup();
        if (backup.Count == 0)
        {
            RemoveDefaultFmOverrides();
            return;
        }

        foreach (var entry in backup)
        {
            var separator = entry.Key.IndexOf("::", StringComparison.Ordinal);
            var keyPath = separator >= 0 ? entry.Key[..separator] : entry.Key;
            var valueName = separator >= 0 ? entry.Key[(separator + 2)..] : "";
            var prior = entry.Value;

            if (prior == MissingSentinel)
            {
                DeleteRegistryValue(keyPath, valueName);
                continue;
            }

            using var key = Registry.CurrentUser.CreateSubKey(keyPath);
            key?.SetValue(valueName, prior ?? "");
        }

        try
        {
            if (File.Exists(BackupFilePath))
                File.Delete(BackupFilePath);
        }
        catch { }
    }

    private static void RemoveDefaultFmOverrides()
    {
        foreach (var (shellKey, verbs) in DefaultFmShellClasses)
        {
            foreach (var verb in verbs)
            {
                try { Registry.CurrentUser.DeleteSubKeyTree($@"{shellKey}\{verb}", false); } catch { }
            }

            try
            {
                using var shellRegKey = Registry.CurrentUser.OpenSubKey(shellKey, true);
                if (shellRegKey is null) continue;
                if (shellRegKey.GetSubKeyNames().Length == 0 && shellRegKey.ValueCount == 0)
                    Registry.CurrentUser.DeleteSubKeyTree(shellKey, false);
            }
            catch { }
        }
    }

    private static string? ReadRegistryValue(string keyPath, string valueName)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(keyPath, false);
            if (key is null) return null;
            return key.GetValue(valueName) as string;
        }
        catch
        {
            return null;
        }
    }

    private static void DeleteRegistryValue(string keyPath, string valueName)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(keyPath, true);
            if (key is null)
            {
                try { Registry.CurrentUser.DeleteSubKeyTree(keyPath, false); } catch { }
                return;
            }

            if (string.IsNullOrEmpty(valueName))
            {
                try { Registry.CurrentUser.DeleteSubKeyTree(keyPath, false); } catch { }
                return;
            }

            key.DeleteValue(valueName, false);
            if (key.GetValueNames().Length == 0 && key.GetSubKeyNames().Length == 0)
            {
                var parent = keyPath[..keyPath.LastIndexOf('\\')];
                try { Registry.CurrentUser.DeleteSubKeyTree(keyPath, false); } catch { }
                try
                {
                    using var parentKey = Registry.CurrentUser.OpenSubKey(parent, true);
                    if (parentKey is not null && parentKey.GetSubKeyNames().Length == 0 && parentKey.ValueCount == 0)
                        Registry.CurrentUser.DeleteSubKeyTree(parent, false);
                }
                catch { }
            }
        }
        catch { }
    }

    private static Dictionary<string, string?> LoadBackup()
    {
        try
        {
            if (!File.Exists(BackupFilePath)) return new Dictionary<string, string?>();
            var json = File.ReadAllText(BackupFilePath);
            return JsonSerializer.Deserialize<Dictionary<string, string?>>(json)
                   ?? new Dictionary<string, string?>();
        }
        catch
        {
            return new Dictionary<string, string?>();
        }
    }

    private static void SaveBackup(Dictionary<string, string?> backup)
    {
        try
        {
            var dir = Path.GetDirectoryName(BackupFilePath);
            if (!string.IsNullOrEmpty(dir))
                Directory.CreateDirectory(dir);
            var json = JsonSerializer.Serialize(backup);
            File.WriteAllText(BackupFilePath, json);
        }
        catch { }
    }

    private static void NotifyShellAssociationChanged()
    {
        try
        {
            SHChangeNotify(ShcneAssocChanged, ShcnfIdList, IntPtr.Zero, IntPtr.Zero);
        }
        catch { }
    }

    /// <summary>
    /// Always register HKCU "Open with BNDZ" on Directory/Folder/Drive/Background —
    /// so Explorer can hand paths to BNDZ without making BNDZ the full default FM.
    /// </summary>
    public void EnsureOpenInBndzVerb()
    {
        try
        {
            var exe = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exe)) return;

            const string fileRoot = @"Software\Classes\*\shell\BNDZOpen";
            const string dirRoot = @"Software\Classes\Directory\shell\BNDZOpen";
            const string folderRoot = @"Software\Classes\Folder\shell\BNDZOpen";
            const string bgRoot = @"Software\Classes\Directory\Background\shell\BNDZOpen";
            const string driveRoot = @"Software\Classes\Drive\shell\BNDZOpen";

            WriteBndzOpenMenu(Registry.CurrentUser, fileRoot, exe, "Open with BNDZ", "%1");
            WriteBndzOpenMenu(Registry.CurrentUser, dirRoot, exe, "Open with BNDZ", "%1");
            WriteBndzOpenMenu(Registry.CurrentUser, folderRoot, exe, "Open with BNDZ", "%1");
            WriteBndzOpenMenu(Registry.CurrentUser, bgRoot, exe, "Open with BNDZ", "%V");
            WriteBndzOpenMenu(Registry.CurrentUser, driveRoot, exe, "Open with BNDZ", "%1");
            NotifyShellAssociationChanged();
        }
        catch { }
    }

    /// <summary>
    /// Add or remove the "Open with BNDZ" shell context menu verb.
    /// When <paramref name="allUsers"/> is true and the process is elevated, writes to HKLM
    /// (machine-wide) and removes any conflicting HKCU entries. When not elevated and
    /// allUsers is requested, returns NeedsElevation so the caller can relaunch as admin.
    /// </summary>
    public ShellIntegrationResult SetInContextMenu(bool enable, bool allUsers = false)
    {
        try
        {
            var exe = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exe))
                return Fail("Could not resolve BNDZ executable path.");

            // All-users scope requires elevation; fail early so the caller can prompt.
            if (allUsers && !IsElevated())
            {
                return new ShellIntegrationResult
                {
                    Success = false,
                    Message = "Writing BNDZ to the All Users shell context menu requires administrator rights.",
                    NeedsElevation = true
                };
            }

            // Choose hive and class root prefix based on scope.
            var hive = (allUsers && IsElevated()) ? Registry.LocalMachine : Registry.CurrentUser;
            var classPrefix = (allUsers && IsElevated()) ? @"SOFTWARE\Classes" : @"Software\Classes";

            const string fileSuffix = @"\*\shell\BNDZOpen";
            const string dirSuffix = @"\Directory\shell\BNDZOpen";
            const string bgSuffix = @"\Directory\Background\shell\BNDZOpen";
            const string driveSuffix = @"\Drive\shell\BNDZOpen";

            var suffixes = new[] { fileSuffix, dirSuffix, bgSuffix, driveSuffix };
            var pathTokens = new[] { "%1", "%1", "%V", "%1" };

            if (enable)
            {
                // When writing All-Users (HKLM), remove HKCU shadow entries first so they
                // don't mask the machine-wide registration.
                if (allUsers && IsElevated())
                {
                    foreach (var s in suffixes)
                        try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes" + s, false); } catch { }
                }

                for (int i = 0; i < suffixes.Length; i++)
                    WriteBndzOpenMenu(hive, classPrefix + suffixes[i], exe, "Open with BNDZ", pathTokens[i]);
            }
            else
            {
                // Remove from both hives so a scope change cleans up properly.
                foreach (var cleanHive in new[] { Registry.CurrentUser, Registry.LocalMachine })
                {
                    string prefix = (cleanHive == Registry.LocalMachine) ? @"SOFTWARE\Classes" : @"Software\Classes";
                    foreach (var s in suffixes)
                        try { cleanHive.DeleteSubKeyTree(prefix + s, false); } catch { }
                }
            }

            // Remove legacy HKCR stubs from old builds.
            try { Registry.ClassesRoot.DeleteSubKeyTree(@"*\shell\BNDZOpen", false); } catch { }
            try { Registry.ClassesRoot.DeleteSubKeyTree(@"Directory\shell\BNDZOpen", false); } catch { }

            NotifyShellAssociationChanged();
            return new ShellIntegrationResult
            {
                Success = true,
                Message = enable
                    ? $"BNDZ was added to the Windows shell context menu ({(allUsers && IsElevated() ? "all users" : "current user")})."
                    : "BNDZ was removed from the Windows shell context menu."
            };
        }
        catch (UnauthorizedAccessException)
        {
            return new ShellIntegrationResult
            {
                Success = false,
                Message = allUsers
                    ? "Writing to HKLM for All Users scope requires administrator rights. Restart BNDZ as administrator."
                    : "Access denied while updating context menu registry.",
                NeedsElevation = true
            };
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    /// <summary>
    /// Show or hide the Icons shell context submenu by toggling the LegacyDisable
    /// value on each registered HKCU IconStudio key.
    /// </summary>
    public ShellIntegrationResult SetIconStudioShellMenu(bool enable)
    {
        try
        {
            string[] roots =
            [
                @"Software\Classes\Folder\shell\IconStudio",
                @"Software\Classes\Directory\shell\IconStudio",
                @"Software\Classes\Directory\Background\shell\IconStudio",
                @"Software\Classes\*\shell\IconStudio",
            ];

            foreach (var root in roots)
            {
                try
                {
                    using var key = Registry.CurrentUser.OpenSubKey(root, writable: true);
                    if (key == null) continue;
                    if (enable)
                        key.DeleteValue("LegacyDisable", throwOnMissingValue: false);
                    else
                        key.SetValue("LegacyDisable", "", RegistryValueKind.String);
                }
                catch { /* Ignore per-key failures; best effort */ }
            }

            NotifyShellAssociationChanged();
            return new ShellIntegrationResult
            {
                Success = true,
                Message = enable ? "Icons shell menu shown." : "Icons shell menu hidden."
            };
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    /// <summary>
    /// Load persisted config JSON and synchronously apply all shell integration toggles.
    /// Called on <c>--apply-shell</c> elevated startup so registry writes use admin rights
    /// before the WebView / fingerprint system initialises.
    /// </summary>
    public string ApplySettingsFromConfig(string json)
    {
        var errors = new System.Text.StringBuilder();
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            bool GetBool(string key, string fallback = "")
            {
                if (root.TryGetProperty(key, out var v) && v.ValueKind == JsonValueKind.True) return true;
                if (!string.IsNullOrEmpty(fallback) &&
                    root.TryGetProperty(fallback, out var v2) && v2.ValueKind == JsonValueKind.True) return true;
                return false;
            }

            bool inContextMenu = GetBool("inContextMenu", "bndzInShellContextMenu");
            bool isDefaultFm   = GetBool("isDefaultFileManager", "bndzIsDefaultFileManager");
            bool win11         = GetBool("overrideWin11MoreOptions");
            // enableIconContextSubmenu defaults to true when absent
            bool iconStudio = !(root.TryGetProperty("enableIconContextSubmenu", out var icsEl)
                                && icsEl.ValueKind == JsonValueKind.False);

            bool allUsers = false;
            if (root.TryGetProperty("shellIntegrationScope", out var scopeEl)
                && scopeEl.ValueKind == JsonValueKind.String)
            {
                allUsers = (scopeEl.GetString() ?? "").IndexOf("All users", StringComparison.OrdinalIgnoreCase) >= 0;
            }

            var ctx = SetInContextMenu(inContextMenu, allUsers);
            if (!ctx.Success) errors.AppendLine($"ContextMenu: {ctx.Message}");

            var fm = SetAsDefaultFileManager(isDefaultFm);
            if (!fm.Success) errors.AppendLine($"DefaultFM: {fm.Message}");

            var w11 = SetWin11MoreOptions(win11);
            if (!w11.Success) errors.AppendLine($"Win11MoreOptions: {w11.Message}");

            var icon = SetIconStudioShellMenu(iconStudio);
            if (!icon.Success) errors.AppendLine($"IconStudio: {icon.Message}");
        }
        catch (Exception ex)
        {
            errors.AppendLine($"ApplySettingsFromConfig error: {ex.Message}");
        }
        return errors.ToString();
    }

    private static void WriteBndzOpenMenu(RegistryKey hive, string rootPath, string exe, string label, string pathToken)
    {
        using var key = hive.CreateSubKey(rootPath);
        key?.SetValue("MUIVerb", label);
        key?.SetValue("Icon", $"\"{exe}\",0");
        using var cmd = key?.CreateSubKey("command");
        cmd?.SetValue("", $"\"{exe}\" --open-path \"{pathToken}\"");
    }

    public ShellIntegrationResult SetWin11MoreOptions(bool enable)
    {
        try
        {
            if (enable)
            {
                using var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32");
                key?.SetValue("", "");
            }
            else
            {
                try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}", false); } catch { }
            }

            return new ShellIntegrationResult
            {
                Success = true,
                Message = enable
                    ? "Windows 11 classic context menu enabled."
                    : "Windows 11 classic context menu disabled."
            };
        }
        catch (UnauthorizedAccessException)
        {
            return new ShellIntegrationResult
            {
                Success = false,
                Message = "Access denied while updating registry.",
                NeedsElevation = true
            };
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    public ShellIntegrationResult RelaunchAsAdministrator(string? extraArgs = null)
    {
        try
        {
            var exe = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exe))
                return Fail("Could not resolve BNDZ executable path.");

            var args = string.IsNullOrWhiteSpace(extraArgs)
                ? Environment.CommandLine.Contains(" --")
                    ? string.Join(" ", Environment.GetCommandLineArgs().Skip(1).Select(QuoteArg))
                    : ""
                : extraArgs.Trim();

            Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Arguments = args,
                Verb = "runas",
                UseShellExecute = true
            });

            try
            {
                if (ExitHost != null)
                    ExitHost();
                else
                    System.Windows.Application.Current?.Dispatcher.BeginInvoke(
                        () => System.Windows.Application.Current?.Shutdown());
            }
            catch
            {
                Environment.Exit(0);
            }
            return new ShellIntegrationResult { Success = true, Message = "Restarting with administrator rights." };
        }
        catch (System.ComponentModel.Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            return new ShellIntegrationResult
            {
                Success = false,
                Message = "Administrator approval was cancelled."
            };
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    private static string QuoteArg(string arg)
    {
        if (string.IsNullOrEmpty(arg)) return "\"\"";
        if (arg.Contains(' ') || arg.Contains('"'))
            return "\"" + arg.Replace("\"", "\\\"") + "\"";
        return arg;
    }

    private static ShellIntegrationResult Fail(string message) =>
        new() { Success = false, Message = message };
}
