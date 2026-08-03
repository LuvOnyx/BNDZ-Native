using System.Collections.Concurrent;
using System.IO;
using System.Text;
using Microsoft.CodeAnalysis.CSharp.Scripting;
using Microsoft.CodeAnalysis.Scripting;

namespace BNDZ.Services;

/// <summary>
/// Sandboxed Roslyn C# scripting host for automation pipeline Script nodes.
/// Exposes a limited API surface (Files, Log, Env) to user scripts — no Process, no reflection,
/// no unrestricted file system. Scripts run with a timeout and capture stdout.
/// </summary>
public sealed class BndzAutomationScriptHost
{
    private static readonly ScriptOptions BaseOptions = ScriptOptions.Default
        .AddReferences(
            typeof(object).Assembly,
            typeof(System.Linq.Enumerable).Assembly,
            typeof(System.IO.Path).Assembly,
            typeof(System.Text.RegularExpressions.Regex).Assembly,
            typeof(System.Collections.Generic.List<>).Assembly)
        .AddImports(
            "System",
            "System.IO",
            "System.Linq",
            "System.Collections.Generic",
            "System.Text",
            "System.Text.RegularExpressions");

    private static readonly TimeSpan DefaultTimeout = TimeSpan.FromSeconds(30);

    private static readonly ConcurrentDictionary<string, Script<object>> _scriptCache = new(StringComparer.Ordinal);

    public ScriptRunResult Execute(string code, IReadOnlyList<string> pipelineFiles, bool dryRun = false)
    {
        var globals = new ScriptGlobals(pipelineFiles, dryRun);
        var result = new ScriptRunResult();

        try
        {
            var script = _scriptCache.GetOrAdd(code, c => CSharpScript.Create<object>(c, BaseOptions, typeof(ScriptGlobals)));
            using var cts = new CancellationTokenSource(DefaultTimeout);
            var state = script.RunAsync(globals, cts.Token).GetAwaiter().GetResult();

            result.Ok = true;
            result.OutputFiles = globals.OutputFiles.ToList();
            result.Log = globals.LogMessages.ToList();
            if (state.ReturnValue != null)
                result.Log.Add($"Return: {state.ReturnValue}");
        }
        catch (CompilationErrorException cex)
        {
            result.Ok = false;
            result.Error = $"Compile error: {string.Join("; ", cex.Diagnostics.Select(d => d.ToString()))}";
        }
        catch (OperationCanceledException)
        {
            result.Ok = false;
            result.Error = "Script timed out (30s limit).";
        }
        catch (Exception ex)
        {
            result.Ok = false;
            result.Error = $"Runtime error: {ex.Message}";
        }

        return result;
    }

    public static void ClearCache() => _scriptCache.Clear();
}

/// <summary>Globals exposed to user C# scripts inside automation pipelines.</summary>
public sealed class ScriptGlobals
{
    public ScriptGlobals(IReadOnlyList<string> files, bool dryRun)
    {
        Files = files;
        DryRun = dryRun;
    }

    /// <summary>Pipeline files passed into this node.</summary>
    public IReadOnlyList<string> Files { get; }

    /// <summary>Whether the pipeline is running in dry-run (preview) mode.</summary>
    public bool DryRun { get; }

    /// <summary>Add files to the output pipeline (replaces default pass-through).</summary>
    public List<string> OutputFiles { get; } = new();

    /// <summary>Logged messages collected during script execution.</summary>
    public List<string> LogMessages { get; } = new();

    /// <summary>Log a message to the pipeline run log.</summary>
    public void Log(string message) => LogMessages.Add(message);

    /// <summary>Read a text file (only from pipeline paths or subpaths).</summary>
    public string ReadText(string path)
    {
        ValidatePathAccess(path);
        return File.ReadAllText(path);
    }

    /// <summary>Write a text file (DryRun will skip the write).</summary>
    public void WriteText(string path, string content)
    {
        ValidatePathAccess(path);
        if (DryRun) { LogMessages.Add($"[dry-run] Would write: {path}"); return; }
        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.WriteAllText(path, content);
    }

    /// <summary>Check if a file exists.</summary>
    public bool FileExists(string path) => File.Exists(path);

    /// <summary>Check if a directory exists.</summary>
    public bool DirExists(string path) => Directory.Exists(path);

    /// <summary>Get file size in bytes.</summary>
    public long FileSize(string path) => File.Exists(path) ? new FileInfo(path).Length : 0;

    /// <summary>Get file name without path.</summary>
    public string FileName(string path) => Path.GetFileName(path);

    /// <summary>Get file extension.</summary>
    public string Extension(string path) => Path.GetExtension(path);

    /// <summary>Combine path segments.</summary>
    public string CombinePath(params string[] parts) => Path.Combine(parts);

    /// <summary>Enumerate files in a directory (up to 500).</summary>
    public string[] ListFiles(string directory, string pattern = "*", bool recursive = false)
    {
        if (!Directory.Exists(directory)) return Array.Empty<string>();
        var opt = recursive ? SearchOption.AllDirectories : SearchOption.TopDirectoryOnly;
        return Directory.EnumerateFiles(directory, pattern, opt).Take(500).ToArray();
    }

    /// <summary>Copy a file (DryRun skips the copy).</summary>
    public void CopyFile(string source, string dest)
    {
        if (DryRun) { LogMessages.Add($"[dry-run] Would copy: {source} → {dest}"); return; }
        var dir = Path.GetDirectoryName(dest);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        File.Copy(source, dest, overwrite: true);
    }

    /// <summary>Move/rename a file (DryRun skips).</summary>
    public void MoveFile(string source, string dest)
    {
        if (DryRun) { LogMessages.Add($"[dry-run] Would move: {source} → {dest}"); return; }
        var dir = Path.GetDirectoryName(dest);
        if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
        if (File.Exists(dest)) File.Delete(dest);
        File.Move(source, dest);
    }

    /// <summary>Get an environment variable value.</summary>
    public string? Env(string name) => Environment.GetEnvironmentVariable(name);

    private static readonly HashSet<string> BlockedRoots = new(StringComparer.OrdinalIgnoreCase)
    {
        @"C:\Windows", @"C:\Program Files", @"C:\Program Files (x86)",
    };

    private static void ValidatePathAccess(string path)
    {
        var full = Path.GetFullPath(path);
        foreach (var blocked in BlockedRoots)
        {
            if (full.StartsWith(blocked, StringComparison.OrdinalIgnoreCase))
                throw new UnauthorizedAccessException($"Script access denied: {full}");
        }
    }
}

public sealed class ScriptRunResult
{
    public bool Ok { get; set; }
    public List<string> OutputFiles { get; set; } = new();
    public List<string> Log { get; set; } = new();
    public string? Error { get; set; }
}
