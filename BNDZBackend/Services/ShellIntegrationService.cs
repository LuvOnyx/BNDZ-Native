using System.Diagnostics;
using System.IO;
using System.Windows;
using Microsoft.Win32;

namespace BNDZ.Services;

public class ShellIntegrationService
{
    private const string ProgId = "BNDZ.FileManager";

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

    public void SetAsDefaultFileManager(bool enable)
    {
        try
        {
            var exe = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exe)) return;

            if (enable)
            {
                using var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Directory\shell\open\command");
                key?.SetValue("", $"\"{exe}\" \"%1\"");
                using var folderKey = Registry.CurrentUser.CreateSubKey(@"Software\Classes\Folder\shell\open\command");
                folderKey?.SetValue("", $"\"{exe}\" \"%1\"");
            }
            else
            {
                try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\Directory\shell\open\command", false); } catch { }
                try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\Folder\shell\open\command", false); } catch { }
            }
        }
        catch { }
    }

    public void SetInContextMenu(bool enable)
    {
        try
        {
            var exe = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exe)) return;

            if (enable)
            {
                using var key = Registry.ClassesRoot.CreateSubKey(@"*\shell\BNDZOpen");
                key?.SetValue("MUIVerb", "Open with BNDZ");
                using var cmd = key?.CreateSubKey("command");
                cmd?.SetValue("", $"\"{exe}\" \"%1\"");

                using var dirKey = Registry.ClassesRoot.CreateSubKey(@"Directory\shell\BNDZOpen");
                dirKey?.SetValue("MUIVerb", "Open with BNDZ");
                using var dirCmd = dirKey?.CreateSubKey("command");
                dirCmd?.SetValue("", $"\"{exe}\" \"%1\"");
            }
            else
            {
                try { Registry.ClassesRoot.DeleteSubKeyTree(@"*\shell\BNDZOpen", false); } catch { }
                try { Registry.ClassesRoot.DeleteSubKeyTree(@"Directory\shell\BNDZOpen", false); } catch { }
            }
        }
        catch { }
    }

    public void SetWin11MoreOptions(bool enable)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(@"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32");
            if (enable)
                key?.SetValue("", "");
            else
                try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}", false); } catch { }
        }
        catch { }
    }

    public void RelaunchAsAdministrator()
    {
        try
        {
            var exe = Process.GetCurrentProcess().MainModule?.FileName;
            if (string.IsNullOrEmpty(exe)) return;
            Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Verb = "runas",
                UseShellExecute = true
            });
            System.Windows.Application.Current.Shutdown();
        }
        catch { }
    }
}
