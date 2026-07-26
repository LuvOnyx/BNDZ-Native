using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Net.Http;

namespace BNDZ.Services;

/// <summary>
/// Stages ffmpeg under %LocalAppData%/BNDZ/Tools/ffmpeg on first audio trim — no user PATH setup.
/// </summary>
public static class BndzFfmpegBootstrap
{
    private static readonly SemaphoreSlim Lock = new(1, 1);
    private static string? _toolsDir;
    private static bool _ready;

    private static string ToolsDir => _toolsDir ??= Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "BNDZ", "Tools", "ffmpeg");

    public static async Task<(bool ok, string? error)> EnsureAsync(CancellationToken ct = default)
    {
        if (_ready && File.Exists(Path.Combine(ToolsDir, "ffmpeg.exe")))
            return (true, null);

        await Lock.WaitAsync(ct).ConfigureAwait(false);
        try
        {
            var ffmpeg = Path.Combine(ToolsDir, "ffmpeg.exe");
            if (File.Exists(ffmpeg))
            {
                _ready = true;
                return (true, null);
            }

            Directory.CreateDirectory(ToolsDir);

            var bundled = Path.Combine(AppContext.BaseDirectory, "Assets", "Tools", "ffmpeg", "ffmpeg.exe");
            if (File.Exists(bundled))
            {
                CopyTree(Path.GetDirectoryName(bundled)!, ToolsDir);
                _ready = File.Exists(ffmpeg);
                return _ready ? (true, null) : (false, "Bundled ffmpeg copy failed.");
            }

            var pathHit = FindOnPath("ffmpeg.exe");
            if (pathHit != null)
            {
                var srcDir = Path.GetDirectoryName(pathHit)!;
                CopyTree(srcDir, ToolsDir);
                _ready = File.Exists(ffmpeg);
                return _ready ? (true, null) : (false, "PATH ffmpeg copy failed.");
            }

            await DownloadEssentialsBuildAsync(ToolsDir, ct).ConfigureAwait(false);
            _ready = File.Exists(ffmpeg);
            return _ready
                ? (true, null)
                : (false, "ffmpeg download failed. Check network and disk space under %LocalAppData%\\BNDZ\\Tools.");
        }
        catch (Exception ex)
        {
            return (false, ex.Message);
        }
        finally
        {
            Lock.Release();
        }
    }

    public static string? GetFfmpegPath()
    {
        var p = Path.Combine(ToolsDir, "ffmpeg.exe");
        return File.Exists(p) ? p : null;
    }

    private static async Task DownloadEssentialsBuildAsync(string destDir, CancellationToken ct)
    {
        // BtbN static win64 build — extracted once, cached locally.
        const string url = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip";
        var zipPath = Path.Combine(Path.GetTempPath(), "BNDZ", "ffmpeg-download.zip");
        Directory.CreateDirectory(Path.GetDirectoryName(zipPath)!);

        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
        await using (var fs = File.Create(zipPath))
        {
            await using var stream = await http.GetStreamAsync(url, ct).ConfigureAwait(false);
            await stream.CopyToAsync(fs, ct).ConfigureAwait(false);
        }

        var extractRoot = Path.Combine(Path.GetTempPath(), "BNDZ", "ffmpeg-extract", Guid.NewGuid().ToString("N"));
        ZipFile.ExtractToDirectory(zipPath, extractRoot, overwriteFiles: true);

        var binDir = Directory.EnumerateDirectories(extractRoot, "bin", SearchOption.AllDirectories).FirstOrDefault()
            ?? throw new InvalidOperationException("ffmpeg archive missing bin folder.");

        CopyTree(binDir, destDir);

        try { File.Delete(zipPath); } catch { }
        try { Directory.Delete(extractRoot, recursive: true); } catch { }
    }

    private static void CopyTree(string source, string dest)
    {
        foreach (var file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            var rel = Path.GetRelativePath(source, file);
            var target = Path.Combine(dest, rel);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(file, target, overwrite: true);
        }
    }

    private static string? FindOnPath(string fileName)
    {
        var pathEnv = Environment.GetEnvironmentVariable("PATH");
        if (string.IsNullOrEmpty(pathEnv)) return null;
        foreach (var dir in pathEnv.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            try
            {
                var full = Path.Combine(dir.Trim(), fileName);
                if (File.Exists(full)) return full;
            }
            catch { /* skip */ }
        }
        return null;
    }
}
