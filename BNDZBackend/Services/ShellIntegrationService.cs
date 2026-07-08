using System.Diagnostics;
using System.IO;
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

public class ShellIntegrationService
{
    private const string ProgId = "BNDZ.FileManager";
    private const int ShcneAssocChanged = 0x08000000;
    private const uint ShcnfIdList = 0x0000;

    private static readonly string[] DefaultFmOpenCommandKeys =
    [
        @"Software\Classes\Directory\shell\open\command",
        @"Software\Classes\Folder\shell\open\command",
        @"Software\Classes\Drive\shell\open\command",
        @"Software\Classes\LibraryFolder\shell\open\command",
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
                startInfo.FileName = "rundll32.exe";
                startInfo.Arguments = "shell32.dll,SHHelpShortcuts_RunDLL Connect";
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
        foreach (var keyPath in DefaultFmOpenCommandKeys)
        {
            using var key = Registry.CurrentUser.CreateSubKey(keyPath);
            key?.SetValue("", openCommand);
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

        foreach (var keyPath in DefaultFmOpenCommandKeys)
        {
            if (backup.ContainsKey(keyPath)) continue;
            backup[keyPath] = ReadRegistryDefault(keyPath);
            changed = true;
        }

        if (changed)
            SaveBackup(backup);
    }

    private static void RestoreDefaultFmRegistry()
    {
        var backup = LoadBackup();
        if (backup.Count == 0)
        {
            foreach (var keyPath in DefaultFmOpenCommandKeys)
                DeleteOpenCommandKey(keyPath);
            return;
        }

        foreach (var keyPath in DefaultFmOpenCommandKeys)
        {
            if (!backup.TryGetValue(keyPath, out var prior))
            {
                DeleteOpenCommandKey(keyPath);
                continue;
            }

            if (prior is null)
            {
                DeleteOpenCommandKey(keyPath);
                continue;
            }

            using var key = Registry.CurrentUser.CreateSubKey(keyPath);
            key?.SetValue("", prior);
        }

        try
        {
            if (File.Exists(BackupFilePath))
                File.Delete(BackupFilePath);
        }
        catch { }
    }

    private static string? ReadRegistryDefault(string keyPath)
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(keyPath, false);
            return key?.GetValue("") as string;
        }
        catch
        {
            return null;
        }
    }

    private static void DeleteOpenCommandKey(string keyPath)
    {
        try
        {
            var parentPath = keyPath[..keyPath.LastIndexOf('\\')];
            Registry.CurrentUser.DeleteSubKeyTree(parentPath + @"\open", false);
        }
        catch { }

        try
        {
            var shellPath = keyPath[..keyPath.LastIndexOf(@"\open\command")];
            using var shellKey = Registry.CurrentUser.OpenSubKey(shellPath, true);
            if (shellKey is null) return;
            var subNames = shellKey.GetSubKeyNames();
            if (subNames.Length == 0)
                Registry.CurrentUser.DeleteSubKeyTree(shellPath, false);
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

    public ShellIntegrationResult SetInContextMenu(bool enable)
    {
        try
        {
            var exe = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exe))
                return Fail("Could not resolve BNDZ executable path.");

            const string fileRoot = @"Software\Classes\*\shell\BNDZOpen";
            const string dirRoot = @"Software\Classes\Directory\shell\BNDZOpen";
            const string bgRoot = @"Software\Classes\Directory\Background\shell\BNDZOpen";
            const string driveRoot = @"Software\Classes\Drive\shell\BNDZOpen";
            const string legacyFile = @"*\shell\BNDZOpen";
            const string legacyDir = @"Directory\shell\BNDZOpen";

            if (enable)
            {
                WriteBndzOpenMenu(Registry.CurrentUser, fileRoot, exe, "Open with BNDZ", "%1");
                WriteBndzOpenMenu(Registry.CurrentUser, dirRoot, exe, "Open with BNDZ", "%1");
                WriteBndzOpenMenu(Registry.CurrentUser, bgRoot, exe, "Open with BNDZ", "%V");
                WriteBndzOpenMenu(Registry.CurrentUser, driveRoot, exe, "Open with BNDZ", "%1");
            }
            else
            {
                foreach (var root in new[] { fileRoot, dirRoot, bgRoot, driveRoot })
                {
                    try { Registry.CurrentUser.DeleteSubKeyTree(root, false); } catch { }
                }
            }

            try { Registry.ClassesRoot.DeleteSubKeyTree(legacyFile, false); } catch { }
            try { Registry.ClassesRoot.DeleteSubKeyTree(legacyDir, false); } catch { }

            NotifyShellAssociationChanged();
            return new ShellIntegrationResult
            {
                Success = true,
                Message = enable
                    ? "BNDZ was added to the Windows shell context menu."
                    : "BNDZ was removed from the Windows shell context menu."
            };
        }
        catch (UnauthorizedAccessException)
        {
            return new ShellIntegrationResult
            {
                Success = false,
                Message = "Access denied while updating context menu registry.",
                NeedsElevation = true
            };
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
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

    public ShellIntegrationResult RelaunchAsAdministrator()
    {
        try
        {
            var exe = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exe))
                return Fail("Could not resolve BNDZ executable path.");

            Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Verb = "runas",
                UseShellExecute = true
            });

            System.Windows.Application.Current.Shutdown();
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

    private static ShellIntegrationResult Fail(string message) =>
        new() { Success = false, Message = message };
}
