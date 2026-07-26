using System.Diagnostics;
using System.Globalization;
using System.IO;

namespace BNDZ.Services;

/// <summary>Trims audio via staged ffmpeg — zero user PATH setup.</summary>
public static class BndzAudioTrimService
{
    public static async Task<(bool Ok, string? Path, string? Error)> TrimAsync(string sourcePath, double startSec, double endSec, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(sourcePath) || !File.Exists(sourcePath))
            return (false, null, "Source file not found.");

        if (!double.IsFinite(startSec) || !double.IsFinite(endSec) || endSec <= startSec)
            return (false, null, "Invalid trim range.");

        var ready = await BndzFfmpegBootstrap.EnsureAsync(ct).ConfigureAwait(false);
        if (!ready.ok)
            return (false, null, ready.error ?? "Could not prepare ffmpeg.");

        var ffmpeg = BndzFfmpegBootstrap.GetFfmpegPath();
        if (ffmpeg == null)
            return (false, null, "ffmpeg not available after bootstrap.");

        var dir = Path.GetDirectoryName(sourcePath) ?? "";
        var baseName = Path.GetFileNameWithoutExtension(sourcePath);
        var ext = Path.GetExtension(sourcePath);
        var outPath = Path.Combine(dir, $"{baseName}_trim_{DateTime.Now:yyyyMMdd_HHmmss}{ext}");
        var start = startSec.ToString("0.###", CultureInfo.InvariantCulture);
        var end = endSec.ToString("0.###", CultureInfo.InvariantCulture);
        var args = $"-y -hide_banner -loglevel error -ss {start} -to {end} -i \"{sourcePath}\" -c copy \"{outPath}\"";

        try
        {
            using var proc = Process.Start(new ProcessStartInfo
            {
                FileName = ffmpeg,
                Arguments = args,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true,
            });
            if (proc == null)
                return (false, null, "Failed to start ffmpeg.");

            var err = await proc.StandardError.ReadToEndAsync(ct).ConfigureAwait(false);
            await proc.WaitForExitAsync(ct).ConfigureAwait(false);
            if (proc.ExitCode != 0 || !File.Exists(outPath))
                return (false, null, string.IsNullOrWhiteSpace(err) ? "ffmpeg trim failed." : err.Trim());

            return (true, outPath, null);
        }
        catch (Exception ex)
        {
            return (false, null, ex.Message);
        }
    }

    public static Task<(bool ok, string? error)> EnsureFfmpegAsync(CancellationToken ct = default)
        => BndzFfmpegBootstrap.EnsureAsync(ct);
}
