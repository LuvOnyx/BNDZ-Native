using System.Diagnostics;
using System.IO;
using System.Windows;

namespace BNDZ.NativeShell.Host;

/// <summary>
/// Trampoline: launches the full BNDZ product with --native-shell so every
/// plugin/workspace feature is available for side-by-side compare with classic.
/// </summary>
public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var bndz = ResolveBndzExecutable();
        if (bndz is null)
        {
            MessageBox.Show(
                "Could not find BNDZ.exe.\n\nBuild the main app first:\n" +
                "  npm run build\n" +
                "  dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true\n\n" +
                "Then run scripts\\\\run-native-shell.cmd or this host again.",
                "BNDZ Native Shell",
                MessageBoxButton.OK,
                MessageBoxImage.Warning);
            Shutdown(1);
            return;
        }

        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = bndz,
                Arguments = "--native-shell --skip-elevation",
                UseShellExecute = true,
                WorkingDirectory = Path.GetDirectoryName(bndz) ?? Environment.CurrentDirectory,
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Failed to launch BNDZ Native Shell:\n{ex.Message}", "BNDZ Native Shell",
                MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown(1);
            return;
        }

        Shutdown(0);
    }

    private static string? ResolveBndzExecutable()
    {
        var baseDir = AppContext.BaseDirectory;
        var candidates = new[]
        {
            Path.GetFullPath(Path.Combine(baseDir, "BNDZ.exe")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "BNDZBackend", "bin", "Debug", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
            Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "BNDZBackend", "bin", "Release", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
            Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "BNDZBackend", "bin", "Debug", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
            Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "BNDZ.exe")),
        };
        foreach (var path in candidates)
        {
            if (File.Exists(path)) return path;
        }
        return null;
    }
}
