using System;
using System.Diagnostics;

namespace BNDZ.Services;

/// <summary>Safe Windows shell / app launching for BNDZ quick actions.</summary>
public static class BndzShellExecute
{
    public static bool TryLaunchQuick(string commandId)
    {
        if (!commandId.StartsWith("quick-", StringComparison.Ordinal)) return false;
        var key = commandId["quick-".Length..];
        try
        {
            switch (key)
            {
                case "control-panel":
                    return Start("control.exe");
                case "settings":
                    return StartShell("ms-settings:");
                case "task-manager":
                    return Start("taskmgr.exe");
                case "device-manager":
                    return Start("devmgmt.msc");
                case "notepad":
                    return Start("notepad.exe");
                case "calculator":
                    return Start("calc.exe");
                case "paint":
                    return Start("mspaint.exe");
                case "cmd":
                    return Start("cmd.exe");
                case "powershell":
                    return Start("powershell.exe");
                case "explorer":
                    return Start("explorer.exe");
                default:
                    return false;
            }
        }
        catch
        {
            return false;
        }
    }

    public static bool TryLaunchShellCommand(string? command)
    {
        if (string.IsNullOrWhiteSpace(command)) return false;
        command = command.Replace("\0", string.Empty).Trim();

        if (command.StartsWith("shell:", StringComparison.OrdinalIgnoreCase)
            || command.StartsWith("ms-settings:", StringComparison.OrdinalIgnoreCase))
            return StartShell(command);

        if (command.StartsWith("explorer ", StringComparison.OrdinalIgnoreCase))
            return Start("explorer.exe", command[8..].TrimStart());

        if (command.StartsWith("explorer.exe ", StringComparison.OrdinalIgnoreCase))
            return Start("explorer.exe", command[12..].TrimStart());

        if (command.Contains(' '))
        {
            var splitAt = command.IndexOf(' ');
            var file = command[..splitAt];
            var args = command[(splitAt + 1)..];
            if (args.StartsWith("shell:", StringComparison.OrdinalIgnoreCase)
                || args.StartsWith("ms-settings:", StringComparison.OrdinalIgnoreCase))
                return Start("explorer.exe", args);
            return Start(file, args);
        }

        return Start(command);
    }

    private static bool StartShell(string target) => Start("explorer.exe", target);

    private static bool Start(string fileName, string? arguments = null)
    {
        var psi = new ProcessStartInfo
        {
            FileName = fileName,
            UseShellExecute = true,
        };
        if (!string.IsNullOrWhiteSpace(arguments))
            psi.Arguments = arguments;
        Process.Start(psi);
        return true;
    }
}
