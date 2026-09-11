using System.Diagnostics;
using System.Globalization;
using System.Text.Json.Serialization;
using NAudio.Wave;
using NAudio.Wave.SampleProviders;

namespace BNDZ.Services.Music;

/// <summary>
/// Producer tools: BPM + musical key from selected audio.
/// Primary decode path is in-process NAudio; ffmpeg remains a fallback for exotic codecs / encode.
/// </summary>
public static class MusicAnalysisService
{
    private const int SampleRate = 22050;
    private const int MaxAnalyzeSeconds = 90;

    private static readonly string[] PitchClasses =
        ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

    // Krumhansl-Kessler key profiles (major / minor), rotated per tonic.
    private static readonly double[] MajorProfile =
        [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
    private static readonly double[] MinorProfile =
        [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

    public static async Task<MusicAnalysisResult> AnalyzeAsync(string path, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            return MusicAnalysisResult.Fail("Audio file not found.");

        float[] mono;
        try
        {
            // Prefer in-process NAudio decode — no ffmpeg.exe for analysis.
            mono = await DecodeMonoNAudioAsync(path, ct).ConfigureAwait(false);
        }
        catch (Exception naudioEx)
        {
            System.Diagnostics.Debug.WriteLine($"[MusicAnalysis] NAudio decode: {naudioEx.Message}");
            try
            {
                var ready = await BndzFfmpegBootstrap.EnsureAsync(ct).ConfigureAwait(false);
                if (!ready.ok)
                    return MusicAnalysisResult.Fail(naudioEx.Message);

                var ffmpeg = BndzFfmpegBootstrap.GetFfmpegPath();
                if (ffmpeg == null)
                    return MusicAnalysisResult.Fail(naudioEx.Message);

                mono = await DecodeMonoAsync(ffmpeg, path, ct).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                return MusicAnalysisResult.Fail(ex.Message);
            }
        }

        if (mono.Length < SampleRate)
            return MusicAnalysisResult.Fail("Clip too short to analyze.");

        var bpm = EstimateBpm(mono, SampleRate);
        var (key, mode, confidence) = EstimateKey(mono, SampleRate);
        var durationSec = mono.Length / (double)SampleRate;
        var peakDb = EstimatePeakDb(mono);

        string? title = null;
        string? artist = null;
        try
        {
            using var file = TagLib.File.Create(path);
            title = string.IsNullOrWhiteSpace(file.Tag.Title) ? null : file.Tag.Title.Trim();
            artist = file.Tag.FirstPerformer;
            if (string.IsNullOrWhiteSpace(artist) && file.Tag.Performers?.Length > 0)
                artist = file.Tag.Performers[0];
        }
        catch
        {
            /* TagLib optional */
        }

        return new MusicAnalysisResult
        {
            Ok = true,
            Path = path,
            Bpm = Math.Round(bpm, 1),
            Key = key,
            Mode = mode,
            KeyConfidence = Math.Round(confidence, 3),
            DurationSec = Math.Round(durationSec, 2),
            PeakDb = Math.Round(peakDb, 1),
            Title = title,
            Artist = artist,
            Camelot = ToCamelot(key, mode),
            SuggestedHalfTime = Math.Round(bpm / 2.0, 1),
            SuggestedDoubleTime = Math.Round(bpm * 2.0, 1),
        };
    }

    public static async Task<IReadOnlyList<MusicAnalysisResult>> AnalyzeManyAsync(
        IReadOnlyList<string> paths,
        bool writeTags = false,
        CancellationToken ct = default)
    {
        var results = new List<MusicAnalysisResult>();
        foreach (var path in (paths ?? Array.Empty<string>()).Where(p => !string.IsNullOrWhiteSpace(p)).Take(40))
        {
            ct.ThrowIfCancellationRequested();
            var r = await AnalyzeAsync(path, ct).ConfigureAwait(false);
            if (r.Ok && writeTags)
                r.TagsWritten = TryWriteProducerTags(path, r);
            results.Add(r);
        }
        return results;
    }

    /// <summary>Write TagLib BPM + comment, and return BNDZ sidecar tag keys for the host to merge.</summary>
    public static string[] BuildSidecarTagKeys(MusicAnalysisResult r)
    {
        if (!r.Ok || r.Bpm <= 0 || string.IsNullOrWhiteSpace(r.Key)) return Array.Empty<string>();
        var modeShort = string.Equals(r.Mode, "minor", StringComparison.OrdinalIgnoreCase) ? "m" : "";
        var list = new List<string>
        {
            $"bpm:{Math.Round(r.Bpm)}",
            $"key:{r.Key}{modeShort}",
        };
        if (!string.IsNullOrWhiteSpace(r.Camelot))
            list.Add($"camelot:{r.Camelot}");
        return list.ToArray();
    }

    private static bool TryWriteProducerTags(string path, MusicAnalysisResult r)
    {
        try
        {
            using var file = TagLib.File.Create(path);
            file.Tag.BeatsPerMinute = (uint)Math.Clamp(Math.Round(r.Bpm), 1, 999);
            var keyLabel = $"{r.Key} {(r.Mode == "minor" ? "min" : "maj")}".Trim();
            var stamp = $"BNDZ {keyLabel}" + (string.IsNullOrWhiteSpace(r.Camelot) ? "" : $" · Camelot {r.Camelot}");
            var existing = file.Tag.Comment ?? "";
            if (!existing.Contains("BNDZ ", StringComparison.Ordinal))
                file.Tag.Comment = string.IsNullOrWhiteSpace(existing) ? stamp : $"{existing}\n{stamp}";
            file.Save();
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static Task<float[]> DecodeMonoNAudioAsync(string path, CancellationToken ct)
    {
        return Task.Run(() =>
        {
            ct.ThrowIfCancellationRequested();
            using var reader = new AudioFileReader(path);
            ISampleProvider sample = reader;
            if (reader.WaveFormat.Channels > 1)
                sample = new StereoToMonoSampleProvider(reader) { LeftVolume = 0.5f, RightVolume = 0.5f };
            if (reader.WaveFormat.SampleRate != SampleRate)
                sample = new WdlResamplingSampleProvider(sample, SampleRate);

            var maxSamples = SampleRate * MaxAnalyzeSeconds;
            var buffer = new float[Math.Min(SampleRate, 8192)];
            var list = new List<float>(Math.Min(maxSamples, SampleRate * 30));
            int read;
            while ((read = sample.Read(buffer, 0, buffer.Length)) > 0)
            {
                ct.ThrowIfCancellationRequested();
                for (var i = 0; i < read; i++)
                    list.Add(buffer[i]);
                if (list.Count >= maxSamples)
                    break;
            }
            if (list.Count < 4)
                throw new InvalidOperationException("No PCM decoded from audio (NAudio).");
            return list.ToArray();
        }, ct);
    }

    private static async Task<float[]> DecodeMonoAsync(string ffmpeg, string path, CancellationToken ct)
    {
        var args =
            $"-hide_banner -loglevel error -t {MaxAnalyzeSeconds} -i \"{path}\" " +
            $"-ac 1 -ar {SampleRate} -f f32le -acodec pcm_f32le pipe:1";

        using var proc = Process.Start(new ProcessStartInfo
        {
            FileName = ffmpeg,
            Arguments = args,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        }) ?? throw new InvalidOperationException("Failed to start ffmpeg.");

        await using var ms = new MemoryStream();
        var copyTask = proc.StandardOutput.BaseStream.CopyToAsync(ms, ct);
        var errTask = proc.StandardError.ReadToEndAsync(ct);
        await copyTask.ConfigureAwait(false);
        var err = await errTask.ConfigureAwait(false);
        await proc.WaitForExitAsync(ct).ConfigureAwait(false);
        if (proc.ExitCode != 0)
            throw new InvalidOperationException(string.IsNullOrWhiteSpace(err) ? "ffmpeg decode failed." : err.Trim());

        var bytes = ms.ToArray();
        if (bytes.Length < 4)
            throw new InvalidOperationException("No PCM decoded from audio.");

        var samples = new float[bytes.Length / 4];
        Buffer.BlockCopy(bytes, 0, samples, 0, samples.Length * 4);
        return samples;
    }

    private static double EstimateBpm(float[] mono, int sr)
    {
        // Onset strength via spectral flux on short frames
        const int hop = 512;
        const int win = 1024;
        var frames = Math.Max(0, (mono.Length - win) / hop);
        if (frames < 32) return 120;

        var flux = new double[frames];
        var prevMag = new double[win / 2];
        var window = new double[win];
        for (var i = 0; i < win; i++)
            window[i] = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (win - 1));

        for (var f = 0; f < frames; f++)
        {
            var offset = f * hop;
            double energy = 0;
            for (var i = 0; i < win; i++)
            {
                var s = mono[offset + i] * window[i];
                energy += s * s;
            }
            var mag = Math.Sqrt(energy / win);
            var delta = Math.Max(0, mag - prevMag[0]);
            flux[f] = delta;
            prevMag[0] = mag;
        }

        // Smooth
        for (var i = 1; i < flux.Length - 1; i++)
            flux[i] = (flux[i - 1] + flux[i] + flux[i + 1]) / 3.0;

        var minBpm = 70.0;
        var maxBpm = 180.0;
        var minLag = (int)Math.Round(60.0 / maxBpm * sr / hop);
        var maxLag = (int)Math.Round(60.0 / minBpm * sr / hop);
        minLag = Math.Max(2, minLag);
        maxLag = Math.Min(flux.Length / 2, Math.Max(minLag + 2, maxLag));

        double bestScore = -1;
        var bestLag = minLag;
        for (var lag = minLag; lag <= maxLag; lag++)
        {
            double corr = 0;
            double norm = 0;
            var n = flux.Length - lag;
            for (var i = 0; i < n; i++)
            {
                corr += flux[i] * flux[i + lag];
                norm += flux[i] * flux[i];
            }
            if (norm < 1e-12) continue;
            var score = corr / norm;
            // Mild preference for common dance tempos
            var bpm = 60.0 * sr / (hop * lag);
            if (bpm is >= 115 and <= 135) score *= 1.06;
            if (score > bestScore)
            {
                bestScore = score;
                bestLag = lag;
            }
        }

        var estimated = 60.0 * sr / (hop * bestLag);
        // Fold into 70–180
        while (estimated < minBpm) estimated *= 2;
        while (estimated > maxBpm) estimated /= 2;
        return estimated;
    }

    private static (string key, string mode, double confidence) EstimateKey(float[] mono, int sr)
    {
        // Simple chromagram from band energies around pitch-class frequencies
        var chroma = new double[12];
        const int hop = 2048;
        const int win = 4096;
        var frames = Math.Max(1, (mono.Length - win) / hop);
        var window = new double[win];
        for (var i = 0; i < win; i++)
            window[i] = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / (win - 1));

        // Analyze middle section for more tonal center
        var startFrame = frames / 5;
        var endFrame = Math.Min(frames, startFrame + Math.Max(8, frames * 3 / 5));
        for (var f = startFrame; f < endFrame; f++)
        {
            var offset = f * hop;
            // Goertzel-ish energy at pitch-class fundamentals around A4=440
            for (var pc = 0; pc < 12; pc++)
            {
                // MIDI note 57 = A3 … use several octaves
                double sum = 0;
                for (var oct = 2; oct <= 5; oct++)
                {
                    var midi = 12 * oct + pc; // C of octave
                    var freq = 440.0 * Math.Pow(2, (midi - 69) / 12.0);
                    if (freq >= sr / 2.0 - 20) continue;
                    sum += GoertzelPower(mono, offset, win, window, freq, sr);
                }
                chroma[pc] += sum;
            }
        }

        var chromaSum = chroma.Sum();
        if (chromaSum > 1e-12)
        {
            for (var i = 0; i < 12; i++) chroma[i] /= chromaSum;
        }

        double best = double.NegativeInfinity;
        var bestPc = 0;
        var bestMinor = false;
        for (var tonic = 0; tonic < 12; tonic++)
        {
            var maj = CorrelateRotated(chroma, MajorProfile, tonic);
            var min = CorrelateRotated(chroma, MinorProfile, tonic);
            if (maj > best)
            {
                best = maj;
                bestPc = tonic;
                bestMinor = false;
            }
            if (min > best)
            {
                best = min;
                bestPc = tonic;
                bestMinor = true;
            }
        }

        // Softmax-ish confidence vs runner-up
        var scores = new List<double>(24);
        for (var tonic = 0; tonic < 12; tonic++)
        {
            scores.Add(CorrelateRotated(chroma, MajorProfile, tonic));
            scores.Add(CorrelateRotated(chroma, MinorProfile, tonic));
        }
        scores.Sort();
        var second = scores[^2];
        var conf = Math.Clamp((best - second) * 4.0 + 0.45, 0.15, 0.98);

        return (PitchClasses[bestPc], bestMinor ? "minor" : "major", conf);
    }

    private static double CorrelateRotated(double[] chroma, double[] profile, int tonic)
    {
        double sum = 0, a2 = 0, b2 = 0;
        for (var i = 0; i < 12; i++)
        {
            var a = chroma[i];
            var b = profile[(i - tonic + 12) % 12];
            sum += a * b;
            a2 += a * a;
            b2 += b * b;
        }
        var denom = Math.Sqrt(a2 * b2);
        return denom < 1e-12 ? 0 : sum / denom;
    }

    private static double GoertzelPower(float[] mono, int offset, int win, double[] window, double freq, int sr)
    {
        var k = (int)Math.Round(freq * win / sr);
        var w = 2 * Math.PI * k / win;
        var cosine = Math.Cos(w);
        var coeff = 2 * cosine;
        double s0 = 0, s1 = 0, s2 = 0;
        var end = Math.Min(mono.Length, offset + win);
        for (var i = offset; i < end; i++)
        {
            var sample = mono[i] * window[i - offset];
            s0 = sample + coeff * s1 - s2;
            s2 = s1;
            s1 = s0;
        }
        var real = s1 - s2 * cosine;
        var imag = s2 * Math.Sin(w);
        return real * real + imag * imag;
    }

    private static double EstimatePeakDb(float[] mono)
    {
        float peak = 0;
        for (var i = 0; i < mono.Length; i++)
        {
            var a = Math.Abs(mono[i]);
            if (a > peak) peak = a;
        }
        if (peak < 1e-8f) return -96;
        return 20 * Math.Log10(peak);
    }

    private static string ToCamelot(string key, string mode)
    {
        // Camelot Wheel mapping
        var major = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["B"] = "1B", ["F#"] = "2B", ["Db"] = "3B", ["C#"] = "3B", ["Ab"] = "4B", ["G#"] = "4B",
            ["Eb"] = "5B", ["D#"] = "5B", ["Bb"] = "6B", ["A#"] = "6B", ["F"] = "7B", ["C"] = "8B",
            ["G"] = "9B", ["D"] = "10B", ["A"] = "11B", ["E"] = "12B",
        };
        var minor = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["Ab"] = "1A", ["G#"] = "1A", ["Eb"] = "2A", ["D#"] = "2A", ["Bb"] = "3A", ["A#"] = "3A",
            ["F"] = "4A", ["C"] = "5A", ["G"] = "6A", ["D"] = "7A", ["A"] = "8A", ["E"] = "9A",
            ["B"] = "10A", ["F#"] = "11A", ["Db"] = "12A", ["C#"] = "12A",
        };
        var map = mode.Equals("minor", StringComparison.OrdinalIgnoreCase) ? minor : major;
        return map.TryGetValue(key, out var c) ? c : $"{key} {(mode == "minor" ? "m" : "")}".Trim();
    }
}

public sealed class MusicAnalysisResult
{
    [JsonPropertyName("ok")]
    public bool Ok { get; set; }

    [JsonPropertyName("path")]
    public string? Path { get; set; }

    [JsonPropertyName("bpm")]
    public double Bpm { get; set; }

    [JsonPropertyName("key")]
    public string? Key { get; set; }

    [JsonPropertyName("mode")]
    public string? Mode { get; set; }

    [JsonPropertyName("keyConfidence")]
    public double KeyConfidence { get; set; }

    [JsonPropertyName("durationSec")]
    public double DurationSec { get; set; }

    [JsonPropertyName("peakDb")]
    public double PeakDb { get; set; }

    [JsonPropertyName("title")]
    public string? Title { get; set; }

    [JsonPropertyName("artist")]
    public string? Artist { get; set; }

    [JsonPropertyName("camelot")]
    public string? Camelot { get; set; }

    [JsonPropertyName("suggestedHalfTime")]
    public double SuggestedHalfTime { get; set; }

    [JsonPropertyName("suggestedDoubleTime")]
    public double SuggestedDoubleTime { get; set; }

    [JsonPropertyName("error")]
    public string? Error { get; set; }

    [JsonPropertyName("tagsWritten")]
    public bool TagsWritten { get; set; }

    [JsonPropertyName("sidecarTags")]
    public string[]? SidecarTags { get; set; }

    public static MusicAnalysisResult Fail(string error) => new() { Ok = false, Error = error };
}
