using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Microsoft.Win32;

namespace BNDZ.Services;

/// <summary>Routes copy/move operations to third-party handlers (TeraCopy).</summary>
public sealed class ExternalCopyHandlerService
{
    private string? _teraCopyPath;

    public bool IsTeraCopyInstalled => !string.IsNullOrEmpty(ResolveTeraCopyPath());

    public string? ResolveTeraCopyPath()
    {
        if (!string.IsNullOrEmpty(_teraCopyPath) && File.Exists(_teraCopyPath))
            return _teraCopyPath;

        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "TeraCopy", "TeraCopy.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "TeraCopy", "TeraCopy.exe"),
        };

        foreach (var path in candidates)
        {
            if (File.Exists(path))
            {
                _teraCopyPath = path;
                return path;
            }
        }

        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Code Sector\TeraCopy");
            var installPath = key?.GetValue("InstallPath") as string;
            if (!string.IsNullOrEmpty(installPath))
            {
                var exe = Path.Combine(installPath.TrimEnd('\\'), "TeraCopy.exe");
                if (File.Exists(exe))
                {
                    _teraCopyPath = exe;
                    return exe;
                }
            }
        }
        catch { /* registry optional */ }

        return null;
    }

    public ExternalCopyResult Execute(
        string action,
        IReadOnlyList<string> sources,
        string target,
        bool move)
    {
        var exe = ResolveTeraCopyPath();
        if (string.IsNullOrEmpty(exe))
            return ExternalCopyResult.NotAvailable("TeraCopy is not installed.");

        sources = sources.Where(s => !string.IsNullOrWhiteSpace(s)).Select(Normalize).ToList();
        target = Normalize(target);
        if (sources.Count == 0 || string.IsNullOrEmpty(target))
            return ExternalCopyResult.Failure("Invalid source or target paths.");

        var verb = move ? "move" : "copy";
        var args = new List<string> { verb };
        args.AddRange(sources.Select(s => $"\"{s}\""));
        args.Add($"\"{target}\"");
        args.Add("/Close");

        try
        {
            using var proc = Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                Arguments = string.Join(" ", args),
                UseShellExecute = false,
                CreateNoWindow = true,
            });

            if (proc == null)
                return ExternalCopyResult.Failure("Could not start TeraCopy.");

            proc.WaitForExit(3_600_000);
            if (proc.ExitCode != 0)
                return ExternalCopyResult.Failure($"TeraCopy exited with code {proc.ExitCode}.");

            return ExternalCopyResult.Success(verb);
        }
        catch (Exception ex)
        {
            return ExternalCopyResult.Failure(ex.Message);
        }
    }

    private static string Normalize(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        path = path.Replace('/', '\\').Trim();
        while (path.Contains("\\\\")) path = path.Replace("\\\\", "\\");
        return path;
    }

    public sealed class ExternalCopyResult
    {
        public bool Ok { get; init; }
        public bool NotInstalled { get; init; }
        public string? Handler { get; init; }
        public string? Error { get; init; }

        public static ExternalCopyResult Success(string handler) => new() { Ok = true, Handler = handler };
        public static ExternalCopyResult Failure(string error) => new() { Ok = false, Error = error };
        public static ExternalCopyResult NotAvailable(string error) => new() { Ok = false, NotInstalled = true, Error = error };
    }
}
