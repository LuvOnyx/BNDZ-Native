using System;
using System.Diagnostics;
using System.IO;
using System.Text;

namespace BNDZ.Services;

/// <summary>Runs user PowerShell/cmd snippets for UDC and Custom Event Actions.</summary>
public static class BndzUserScriptRunner
{
    public static (bool ok, string output) Run(string shell, string script, string? workingDirectory = null)
    {
        if (string.IsNullOrWhiteSpace(script)) return (false, "Empty script");
        shell = (shell ?? "powershell").Trim().ToLowerInvariant();
        try
        {
            if (shell is "ps1" or "powershell" or "pwsh")
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = $"-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command \"{EscapePs(script)}\"",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    WorkingDirectory = string.IsNullOrWhiteSpace(workingDirectory) ? Environment.CurrentDirectory : workingDirectory!,
                };
                using var p = Process.Start(psi);
                if (p == null) return (false, "Failed to start PowerShell");
                var stdout = p.StandardOutput.ReadToEnd();
                var stderr = p.StandardError.ReadToEnd();
                p.WaitForExit(120000);
                var ok = p.ExitCode == 0;
                return (ok, ok ? stdout.Trim() : (stderr.Trim().Length > 0 ? stderr.Trim() : stdout.Trim()));
            }

            if (shell is "cmd" or "bat")
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = $"/C {script}",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true,
                    WorkingDirectory = string.IsNullOrWhiteSpace(workingDirectory) ? Environment.CurrentDirectory : workingDirectory!,
                };
                using var p = Process.Start(psi);
                if (p == null) return (false, "Failed to start cmd");
                var stdout = p.StandardOutput.ReadToEnd();
                var stderr = p.StandardError.ReadToEnd();
                p.WaitForExit(120000);
                var ok = p.ExitCode == 0;
                return (ok, ok ? stdout.Trim() : (stderr.Trim().Length > 0 ? stderr.Trim() : stdout.Trim()));
            }

            if (shell is "file" && File.Exists(script))
            {
                var ext = Path.GetExtension(script).ToLowerInvariant();
                if (ext == ".ps1")
                    return Run("powershell", $"& '{script.Replace("'", "''")}'", workingDirectory);
                if (ext is ".bat" or ".cmd")
                    return Run("cmd", $"\"{script}\"", workingDirectory);
            }

            return (false, $"Unsupported shell: {shell}");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
    }

    private static string EscapePs(string script) =>
        script.Replace("\"", "\\\"");
}
