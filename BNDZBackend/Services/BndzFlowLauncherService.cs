using System;
using System.Diagnostics;
using System.IO;

namespace BNDZ.Services;

/// <summary>Starts and toggles the rebranded Flow Launcher build (BNDZ.Launcher.exe).</summary>
public sealed class BndzFlowLauncherService
{
    private static readonly Lazy<BndzFlowLauncherService> _instance = new(() => new BndzFlowLauncherService());
    public static BndzFlowLauncherService Instance => _instance.Value;

    private BndzFlowLauncherService() { }

    public string LauncherDirectory
    {
        get
        {
            var baseDir = AppDomain.CurrentDomain.BaseDirectory;
            var candidates = new[]
            {
                Path.Combine(baseDir, "BNDZLauncher"),
                Path.Combine(baseDir, "Assets", "BNDZLauncher"),
            };
            foreach (var dir in candidates)
            {
                if (Directory.Exists(dir) &&
                    (File.Exists(Path.Combine(dir, "BNDZ.Launcher.exe"))
                     || File.Exists(Path.Combine(dir, "Flow.Launcher.exe"))))
                    return dir;
            }
            return candidates[0];
        }
    }

    public string LauncherExePath
    {
        get
        {
            var branded = Path.Combine(LauncherDirectory, "BNDZ.Launcher.exe");
            if (File.Exists(branded)) return branded;
            return Path.Combine(LauncherDirectory, "Flow.Launcher.exe");
        }
    }

    public bool IsInstalled => File.Exists(LauncherExePath);

    /// <summary>Start launcher process if not running (first instance stays in tray).</summary>
    public void EnsureRunning()
    {
        if (!IsInstalled) return;
        try
        {
            if (IsProcessRunning("BNDZ.Launcher") || IsProcessRunning("Flow.Launcher")) return;
            StartLauncherProcess();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzFlowLauncherService] EnsureRunning: {ex.Message}");
        }
    }

    public bool IsRunning =>
        IsProcessRunning("BNDZ.Launcher") || IsProcessRunning("Flow.Launcher");

    /// <summary>Show launcher UI — second process instance signals the running app to open.</summary>
    public void Show()
    {
        if (!IsInstalled)
        {
            Debug.WriteLine("[BndzFlowLauncherService] BNDZ.Launcher.exe not found in BNDZLauncher folder.");
            return;
        }
        try
        {
            if (!IsRunning) EnsureRunning();
            else StartLauncherProcess();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzFlowLauncherService] Show: {ex.Message}");
        }
    }

    public void Stop()
    {
        KillProcesses("BNDZ.Launcher");
        KillProcesses("Flow.Launcher");
    }

    public void Restart()
    {
        Stop();
        System.Threading.Thread.Sleep(400);
        StartLauncherProcess();
    }

    public void ApplyConfigAndEnsureRunning(string? bndzJson)
    {
        var bridge = new BndzLauncherSettingsBridge();
        var plan = bridge.SyncFromBndzJson(bndzJson);
        if (!plan.Enabled)
        {
            Stop();
            return;
        }
        if (!IsInstalled) return;
        if (IsRunning)
        {
            if (plan.RequiresRestart) Restart();
            return;
        }
        StartLauncherProcess();
    }

    private void StartLauncherProcess()
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = LauncherExePath,
            WorkingDirectory = LauncherDirectory,
            UseShellExecute = true,
        });
    }

    private static bool IsProcessRunning(string processName)
    {
        try
        {
            return Process.GetProcessesByName(processName).Length > 0;
        }
        catch
        {
            return false;
        }
    }

    private static void KillProcesses(string processName)
    {
        try
        {
            foreach (var proc in Process.GetProcessesByName(processName))
            {
                try
                {
                    if (!proc.HasExited) proc.Kill(entireProcessTree: true);
                }
                catch { }
                finally { proc.Dispose(); }
            }
        }
        catch { }
    }
}
