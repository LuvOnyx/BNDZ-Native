using System.Net.Http;
using LLama;
using LLama.Common;

namespace BNDZ.Services;

/// <summary>
/// In-process local GGUF inference. Model downloads only after explicit user consent
/// via AI_DOWNLOAD_MODEL IPC to %LOCALAPPDATA%\BNDZ\models.
/// </summary>
public sealed class LocalAiService : IDisposable
{
    public const string ModelFileName = "qwen2.5-1.5b-instruct-q4_k_m.gguf";
    public const string ModelDisplayName = "Qwen2.5-1.5B-Instruct";
    public const string ModelSizeLabel = "~1 GB";
    private const string ModelUrl =
        "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf";

    private static readonly string ModelDir = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "BNDZ", "models");

    private readonly SemaphoreSlim _gate = new(1, 1);
    private LLamaWeights? _weights;
    private ModelParams? _parameters;
    private bool _disposed;
    private bool _isDownloading;
    private double _downloadProgress;

    public string ModelPath => Path.Combine(ModelDir, ModelFileName);

    public bool IsModelPresent => File.Exists(ModelPath);

    public bool IsLoaded => _weights != null && _parameters != null;

    public bool IsDownloading => _isDownloading;

    public double DownloadProgress => _downloadProgress;

    /// <summary>Downloads the GGUF model file. Call only after user consent.</summary>
    public async Task<bool> DownloadModelAsync(IProgress<double>? progress = null, CancellationToken cancellationToken = default)
    {
        if (IsModelPresent) return true;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            if (IsModelPresent) return true;
            _isDownloading = true;
            _downloadProgress = 0;

            Directory.CreateDirectory(ModelDir);

            using var http = new HttpClient { Timeout = TimeSpan.FromHours(2) };
            using var response = await http.GetAsync(ModelUrl, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
            response.EnsureSuccessStatusCode();

            var total = response.Content.Headers.ContentLength ?? 0L;
            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            var tempPath = ModelPath + ".download";
            await using (var file = File.Create(tempPath))
            {
                var buffer = new byte[81920];
                long read = 0;
                int n;
                while ((n = await stream.ReadAsync(buffer, cancellationToken)) > 0)
                {
                    await file.WriteAsync(buffer.AsMemory(0, n), cancellationToken);
                    read += n;
                    if (total > 0)
                    {
                        _downloadProgress = (double)read / total;
                        progress?.Report(_downloadProgress);
                    }
                }
            }

            File.Move(tempPath, ModelPath, overwrite: true);
            _downloadProgress = 1;
            progress?.Report(1);
            return true;
        }
        catch
        {
            try
            {
                var tempPath = ModelPath + ".download";
                if (File.Exists(tempPath)) File.Delete(tempPath);
            }
            catch { /* best effort */ }
            return false;
        }
        finally
        {
            _isDownloading = false;
            _gate.Release();
        }
    }

    public async Task<string> GenerateAsync(string prompt, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(prompt) || !IsModelPresent) return string.Empty;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await EnsureLoadedAsync(cancellationToken);
            if (_weights == null || _parameters == null) return string.Empty;

            var executor = new StatelessExecutor(_weights, _parameters);
            var sb = new System.Text.StringBuilder();
            var inferParams = new InferenceParams
            {
                MaxTokens = 768,
                AntiPrompts = new List<string> { "\n\nUser:", "\n\nFilenames:", "```" }
            };

            var formatted = FormatInstructPrompt(prompt);
            await foreach (var token in executor.InferAsync(formatted, inferParams, cancellationToken))
                sb.Append(token);

            return sb.ToString().Trim();
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<string> GenerateStreamAsync(
        string prompt,
        Action<string> onChunk,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(prompt) || !IsModelPresent) return string.Empty;

        await _gate.WaitAsync(cancellationToken);
        try
        {
            await EnsureLoadedAsync(cancellationToken);
            if (_weights == null || _parameters == null) return string.Empty;

            var executor = new StatelessExecutor(_weights, _parameters);
            var sb = new System.Text.StringBuilder();
            var inferParams = new InferenceParams
            {
                MaxTokens = 768,
                AntiPrompts = new List<string> { "\n\nUser:", "\n\nFilenames:", "```" }
            };

            var formatted = FormatInstructPrompt(prompt);
            await foreach (var token in executor.InferAsync(formatted, inferParams, cancellationToken))
            {
                sb.Append(token);
                if (!string.IsNullOrEmpty(token)) onChunk(token);
            }

            return sb.ToString().Trim();
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task EnsureLoadedAsync(CancellationToken cancellationToken)
    {
        if (_weights != null) return;
        if (!IsModelPresent) return;

        var parameters = new ModelParams(ModelPath)
        {
            ContextSize = 2048,
            GpuLayerCount = 0
        };

        _parameters = parameters;
        _weights = await Task.Run(() => LLamaWeights.LoadFromFile(parameters), cancellationToken);
    }

    private static string FormatInstructPrompt(string userPrompt)
        => $"<|im_start|>system\nYou are a helpful file manager assistant. Be concise and follow formatting instructions exactly.\n<|im_start|>user\n{userPrompt}\n<|im_start|>assistant\n";

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _weights?.Dispose();
        _gate.Dispose();
    }
}
