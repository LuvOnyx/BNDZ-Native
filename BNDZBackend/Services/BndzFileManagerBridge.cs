using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;

namespace BNDZ.Services;

/// <summary>Optional bridge to an independently installed BNDZ File Manager (named pipe or process spawn).</summary>
public static class BndzFileManagerBridge
{
    public const string PipeName = "BNDZ.FileManager.IPC";
    private const int ConnectTimeoutMs = 600;
    private const int MaxAttempts = 4;
    private const int RetryDelayMs = 40;

    public static bool TryOpenPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return TryShowFileManager();
        if (TrySend(new { action = "open_path", path })) return true;
        return TrySpawnBndz($"--open-path \"{path.Replace("\"", "\\\"")}\"");
    }

    public static bool TryShowFileManager()
    {
        if (TrySend(new { action = "show" })) return true;
        return TrySpawnBndz("");
    }

    private static bool TrySend(object payload)
    {
        for (var attempt = 0; attempt < MaxAttempts; attempt++)
        {
            if (attempt > 0) Thread.Sleep(RetryDelayMs);
            if (TrySendOnce(payload)) return true;
        }
        return false;
    }

    private static bool TrySendOnce(object payload)
    {
        NamedPipeClientStream? client = null;
        try
        {
            client = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.None);
            client.Connect(ConnectTimeoutMs);
            var json = JsonSerializer.Serialize(payload);
            var bytes = Encoding.UTF8.GetBytes(json + "\n");
            client.Write(bytes, 0, bytes.Length);
            client.Flush();
            return true;
        }
        catch
        {
            return false;
        }
        finally
        {
            client?.Dispose();
        }
    }

    private static bool TrySpawnBndz(string args)
    {
        var exe = ResolveBndzExePath();
        if (string.IsNullOrWhiteSpace(exe)) return false;
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Arguments = args,
                WorkingDirectory = Path.GetDirectoryName(exe) ?? "",
                UseShellExecute = true,
            });
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string? ResolveBndzExePath()
    {
        var env = Environment.GetEnvironmentVariable("BNDZ_FM_EXE");
        if (!string.IsNullOrWhiteSpace(env) && File.Exists(env)) return env;

        var baseDir = AppDomain.CurrentDomain.BaseDirectory;
        var siblings = new[]
        {
            Path.Combine(baseDir, "BNDZ.exe"),
            Path.Combine(baseDir, "..", "BNDZ.exe"),
            Path.Combine(baseDir, "..", "..", "BNDZ.exe"),
        };
        foreach (var candidate in siblings)
        {
            try
            {
                var full = Path.GetFullPath(candidate);
                if (File.Exists(full)) return full;
            }
            catch { }
        }

        try
        {
            var localApp = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            var installed = Path.Combine(localApp, "Programs", "BNDZ", "BNDZ.exe");
            if (File.Exists(installed)) return installed;
        }
        catch { }

        return null;
    }
}
