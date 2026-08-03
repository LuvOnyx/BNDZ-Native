using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using SkiaSharp;

namespace BNDZ.Services;

public sealed class TranscodeJobDto
{
    public string Id { get; set; } = "";
    public string SourcePath { get; set; } = "";
    public string DestPath { get; set; } = "";
    public string Format { get; set; } = "jpeg";
    public int Quality { get; set; } = 90;
    public string Status { get; set; } = "queued";
    public int Progress { get; set; }
    public string? Error { get; set; }
    public long SourceBytes { get; set; }
    public long DestBytes { get; set; }
}

public sealed class TranscodeRackStatus
{
    public int Queued { get; set; }
    public int Running { get; set; }
    public int Completed { get; set; }
    public int Failed { get; set; }
    public int OverallProgress { get; set; }
    public List<TranscodeJobDto> Jobs { get; set; } = new();
}

public sealed class TranscodeRackService
{
    private static readonly Lazy<TranscodeRackService> Lazy = new(() => new TranscodeRackService());
    public static TranscodeRackService Instance => Lazy.Value;

    private readonly ConcurrentDictionary<string, TranscodeJobDto> _jobs = new();
    private readonly ConcurrentQueue<string> _queue = new();
    private readonly object _workerGate = new();
    private int _workerRunning;
    private int _totalEnqueued;
    private int _totalFinished;

    private TranscodeRackService() { }

    public IReadOnlyList<string> Enqueue(IEnumerable<string> paths, string format, int quality, string? destFolder)
    {
        var fmt = NormalizeFormat(format);
        var q = Math.Clamp(quality, 1, 100);
        var ids = new List<string>();

        foreach (var raw in paths)
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            var src = Path.GetFullPath(raw);
            if (!File.Exists(src) || !SkiaThumbnailService.IsLikelyImage(src)) continue;

            var id = Guid.NewGuid().ToString("N");
            var destDir = string.IsNullOrWhiteSpace(destFolder)
                ? Path.GetDirectoryName(src) ?? ""
                : Path.GetFullPath(destFolder);
            Directory.CreateDirectory(destDir);

            var stem = Path.GetFileNameWithoutExtension(src);
            var ext = fmt switch
            {
                "png" => ".png",
                "webp" => ".webp",
                _ => ".jpg",
            };
            var dest = Path.Combine(destDir, $"{stem}_transcoded{ext}");

            var job = new TranscodeJobDto
            {
                Id = id,
                SourcePath = src,
                DestPath = dest,
                Format = fmt,
                Quality = q,
                Status = "queued",
                Progress = 0,
                SourceBytes = new FileInfo(src).Length,
            };
            _jobs[id] = job;
            _queue.Enqueue(id);
            ids.Add(id);
            Interlocked.Increment(ref _totalEnqueued);
        }

        EnsureWorker();
        return ids;
    }

    public TranscodeRackStatus GetStatus()
    {
        var jobs = _jobs.Values.OrderBy(j => j.Status == "running" ? 0 : j.Status == "queued" ? 1 : 2)
            .ThenBy(j => j.Id).ToList();
        var queued = jobs.Count(j => j.Status == "queued");
        var running = jobs.Count(j => j.Status == "running");
        var completed = jobs.Count(j => j.Status == "completed");
        var failed = jobs.Count(j => j.Status == "failed");

        int overall = 0;
        if (_totalEnqueued > 0)
        {
            var done = completed + failed;
            var runningProg = jobs.Where(j => j.Status == "running").Select(j => j.Progress).DefaultIfEmpty(0).Average();
            overall = (int)Math.Round((done * 100.0 + runningProg) / _totalEnqueued);
        }

        return new TranscodeRackStatus
        {
            Queued = queued,
            Running = running,
            Completed = completed,
            Failed = failed,
            OverallProgress = Math.Clamp(overall, 0, 100),
            Jobs = jobs,
        };
    }

    public void ClearCompleted()
    {
        foreach (var kv in _jobs)
        {
            if (kv.Value.Status is "completed" or "failed")
                _jobs.TryRemove(kv.Key, out _);
        }
    }

    private void EnsureWorker()
    {
        lock (_workerGate)
        {
            if (_workerRunning > 0) return;
            Interlocked.Increment(ref _workerRunning);
            _ = Task.Run(WorkerLoop);
        }
    }

    private async Task WorkerLoop()
    {
        try
        {
            while (_queue.TryDequeue(out var id))
            {
                if (!_jobs.TryGetValue(id, out var job)) continue;
                job.Status = "running";
                job.Progress = 5;
                try
                {
                    await Task.Run(() => TranscodeFile(job)).ConfigureAwait(false);
                    job.Status = "completed";
                    job.Progress = 100;
                    if (File.Exists(job.DestPath))
                        job.DestBytes = new FileInfo(job.DestPath).Length;
                }
                catch (Exception ex)
                {
                    job.Status = "failed";
                    job.Error = ex.Message;
                    job.Progress = 0;
                    Debug.WriteLine($"[TranscodeRack] {job.SourcePath}: {ex.Message}");
                }
                Interlocked.Increment(ref _totalFinished);
            }
        }
        finally
        {
            Interlocked.Decrement(ref _workerRunning);
            if (!_queue.IsEmpty)
                EnsureWorker();
        }
    }

    private static string NormalizeFormat(string format)
    {
        var f = (format ?? "jpeg").Trim().ToLowerInvariant();
        if (f == "jpg") return "jpeg";
        if (f is "jpeg" or "png" or "webp") return f;
        return "jpeg";
    }

    private static void TranscodeFile(TranscodeJobDto job)
    {
        job.Progress = 15;
        using var input = File.OpenRead(job.SourcePath);
        using var codec = SKCodec.Create(input);
        using var bitmap = codec != null ? SKBitmap.Decode(codec) : SKBitmap.Decode(job.SourcePath);
        if (bitmap == null || bitmap.Width <= 0 || bitmap.Height <= 0)
            throw new InvalidOperationException("Could not decode image.");

        job.Progress = 40;
        using var oriented = codec != null
            ? ApplyEncodedOrigin(bitmap, codec.EncodedOrigin)
            : null;
        var src = oriented ?? bitmap;

        var format = job.Format switch
        {
            "png" => SKEncodedImageFormat.Png,
            "webp" => SKEncodedImageFormat.Webp,
            _ => SKEncodedImageFormat.Jpeg,
        };
        var quality = job.Format == "png" ? 100 : job.Quality;

        job.Progress = 70;
        using var image = SKImage.FromBitmap(src);
        using var data = image.Encode(format, quality);
        if (data == null)
            throw new InvalidOperationException("Encode failed.");

        job.Progress = 90;
        using var outStream = File.Create(job.DestPath);
        data.SaveTo(outStream);
    }

    private static SKBitmap? ApplyEncodedOrigin(SKBitmap bitmap, SKEncodedOrigin origin)
    {
        if (origin == SKEncodedOrigin.TopLeft) return null;
        var info = bitmap.Info;
        using var surface = SKSurface.Create(info);
        if (surface == null) return null;
        var canvas = surface.Canvas;
        canvas.Clear(SKColors.Transparent);
        switch (origin)
        {
            case SKEncodedOrigin.BottomRight:
                canvas.RotateDegrees(180, info.Width / 2f, info.Height / 2f);
                break;
            case SKEncodedOrigin.RightTop:
                canvas.RotateDegrees(90, info.Width / 2f, info.Height / 2f);
                break;
            case SKEncodedOrigin.LeftBottom:
                canvas.RotateDegrees(270, info.Width / 2f, info.Height / 2f);
                break;
            case SKEncodedOrigin.RightBottom:
                canvas.Scale(-1, 1, info.Width / 2f, info.Height / 2f);
                break;
            case SKEncodedOrigin.LeftTop:
                canvas.Scale(1, -1, info.Width / 2f, info.Height / 2f);
                break;
            case SKEncodedOrigin.TopRight:
                canvas.RotateDegrees(180, info.Width / 2f, info.Height / 2f);
                canvas.Scale(-1, 1, info.Width / 2f, info.Height / 2f);
                break;
            case SKEncodedOrigin.BottomLeft:
                canvas.RotateDegrees(180, info.Width / 2f, info.Height / 2f);
                canvas.Scale(1, -1, info.Width / 2f, info.Height / 2f);
                break;
            default:
                return null;
        }
        canvas.DrawBitmap(bitmap, 0, 0);
        return SKBitmap.FromImage(surface.Snapshot());
    }
}
