using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using Microsoft.Data.Sqlite;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;
using Microsoft.ML.Tokenizers;

namespace BNDZ.Services;

/// <summary>
/// Local semantic embedding service backed by a MiniLM-L6-v2 (or compatible) ONNX model.
///
/// Model bootstrap path (user/admin must place files here — nothing is auto-downloaded):
///
///   %LocalAppData%\BNDZ\Models\
///     embedding.onnx      — ONNX export of sentence-transformers/all-MiniLM-L6-v2
///                           (or any BERT-family encoder with input_ids / attention_mask /
///                            token_type_ids → last_hidden_state [batch, seq, dim])
///     vocab.txt           — BERT vocabulary for the tokenizer (ships with most HF models)
///
/// Download one-liner (PowerShell, requires Python + pip install transformers optimum):
///   python -m optimum.exporters.onnx --model sentence-transformers/all-MiniLM-L6-v2 bndzmodel
///   Copy-Item bndzmodel\model.onnx "$env:LOCALAPPDATA\BNDZ\Models\embedding.onnx"
///   Copy-Item bndzmodel\tokenizer.json "$env:LOCALAPPDATA\BNDZ\Models\vocab.txt"
///
/// Alternatively download the pre-exported model from:
///   https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2/tree/main/onnx
///   Place model_quantized.onnx → embedding.onnx and tokenizer.json → vocab.txt.
///
/// Graceful no-op: when files are absent the service exposes ModelLoaded=false and every
/// public method returns null/empty — callers fall through to keyword-only paths.
/// </summary>
public sealed class BndzEmbeddingService : IDisposable
{
    private static readonly Lazy<BndzEmbeddingService> Lazy = new(() => new BndzEmbeddingService());
    public static BndzEmbeddingService Instance => Lazy.Value;

    public static string ModelDir { get; } = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "BNDZ", "Models");

    public static string ModelPath { get; } = Path.Combine(ModelDir, "embedding.onnx");
    public static string VocabPath { get; } = Path.Combine(ModelDir, "vocab.txt");

    public bool ModelLoaded { get; private set; }
    public int EmbeddingDimension { get; private set; }

    private InferenceSession? _session;
    private BertTokenizer? _tokenizer;
    private readonly SemaphoreSlim _inferLock = new(1, 1);
    private bool _disposed;

    private BndzEmbeddingService()
    {
        TryLoad();
    }

    // ─── Public embedding API ─────────────────────────────────────────────────

    /// <summary>
    /// Encode text into a unit-normalized float[] embedding vector.
    /// Returns null if the model is not loaded.
    /// Thread-safe (serialized via semaphore).
    /// </summary>
    public float[]? GetEmbedding(string text)
    {
        if (!ModelLoaded || _session == null || _tokenizer == null) return null;
        if (string.IsNullOrWhiteSpace(text)) return null;

        _inferLock.Wait();
        try
        {
            return RunInference(text.Trim());
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Embedding] inference: {ex.Message}");
            return null;
        }
        finally
        {
            _inferLock.Release();
        }
    }

    /// <summary>Cosine similarity in [−1, 1]. Returns 0.0 for null or mismatched vectors.</summary>
    public static float CosineSimilarity(float[]? a, float[]? b)
    {
        if (a == null || b == null || a.Length != b.Length || a.Length == 0) return 0f;
        float dot = 0f, normA = 0f, normB = 0f;
        for (int i = 0; i < a.Length; i++)
        {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        var denom = MathF.Sqrt(normA) * MathF.Sqrt(normB);
        return denom < 1e-8f ? 0f : dot / denom;
    }

    /// <summary>
    /// Re-rank <paramref name="candidatePaths"/> by semantic similarity to
    /// <paramref name="query"/>. Paths without stored embeddings stay but score 0.
    /// Returns up to <paramref name="limit"/> results sorted by descending similarity.
    /// </summary>
    public List<(string Path, float Score)> SemanticRank(
        string query,
        IEnumerable<string> candidatePaths,
        int limit = 200)
    {
        var paths = candidatePaths?.ToList() ?? [];
        if (!ModelLoaded || paths.Count == 0)
            return paths.Select(p => (p, 0f)).Take(limit).ToList();

        var queryEmb = GetEmbedding(query);
        if (queryEmb == null)
            return paths.Select(p => (p, 0f)).Take(limit).ToList();

        var scored = new List<(string Path, float Score)>(paths.Count);
        foreach (var p in paths)
        {
            float score = 0f;
            try
            {
                var stored = BndzFileIndexService.Instance.GetEmbedding(
                    BndzFileIndexService.ToPanePathStatic(p));
                if (stored != null)
                    score = CosineSimilarity(queryEmb, stored);
                else
                {
                    // Embed on the fly from the filename (fast, no disk I/O).
                    var name = Path.GetFileNameWithoutExtension(p);
                    var liveEmb = GetEmbedding(name);
                    if (liveEmb != null)
                        score = CosineSimilarity(queryEmb, liveEmb);
                }
            }
            catch { }
            scored.Add((p, score));
        }

        return scored.OrderByDescending(x => x.Score).Take(limit).ToList();
    }

    // ─── Inference ────────────────────────────────────────────────────────────

    private float[] RunInference(string text)
    {
        // Tokenize (max 128 tokens for filename-scale texts).
        const int MaxTokens = 128;
        var tokenIds = _tokenizer!.EncodeToIds(text, maxTokenCount: MaxTokens, out _, out _);

        int seqLen = Math.Min(tokenIds.Count, MaxTokens);

        // Build input tensors: int64 [1, seqLen]
        var inputIds   = new DenseTensor<long>(new[] { 1, seqLen });
        var attnMask   = new DenseTensor<long>(new[] { 1, seqLen });
        var tokenTypes = new DenseTensor<long>(new[] { 1, seqLen });

        for (int i = 0; i < seqLen; i++)
        {
            inputIds[0, i]   = tokenIds[i];
            attnMask[0, i]   = 1L;
            tokenTypes[0, i] = 0L;
        }

        var inputs = new List<NamedOnnxValue>
        {
            NamedOnnxValue.CreateFromTensor("input_ids",      inputIds),
            NamedOnnxValue.CreateFromTensor("attention_mask", attnMask),
            NamedOnnxValue.CreateFromTensor("token_type_ids", tokenTypes),
        };

        using var outputs = _session!.Run(inputs);

        // last_hidden_state: [1, seqLen, dim]  or  sentence_embedding: [1, dim]
        // Try both output names (different ONNX exports use different names).
        DenseTensor<float>? hiddenState = null;
        foreach (var output in outputs)
        {
            if (output.Value is DenseTensor<float> t)
            {
                hiddenState = t;
                break;
            }
        }
        if (hiddenState == null) return [];

        var dims = hiddenState.Dimensions;
        if (dims.Length == 2)
        {
            // Direct sentence embedding [1, dim] — no pooling needed.
            int dim = dims[1];
            var vec = new float[dim];
            for (int d = 0; d < dim; d++)
                vec[d] = hiddenState[0, d];
            return Normalize(vec);
        }
        else if (dims.Length == 3)
        {
            // last_hidden_state [1, seqLen, dim] — mean pool over non-padding tokens.
            int dim = dims[2];
            var vec = new float[dim];
            int count = 0;
            for (int s = 0; s < seqLen; s++)
            {
                if (attnMask[0, s] == 0) continue;
                for (int d = 0; d < dim; d++)
                    vec[d] += hiddenState[0, s, d];
                count++;
            }
            if (count > 0)
                for (int d = 0; d < dim; d++)
                    vec[d] /= count;
            return Normalize(vec);
        }

        return [];
    }

    private static float[] Normalize(float[] vec)
    {
        float norm = 0f;
        foreach (var v in vec) norm += v * v;
        norm = MathF.Sqrt(norm);
        if (norm < 1e-8f) return vec;
        for (int i = 0; i < vec.Length; i++)
            vec[i] /= norm;
        return vec;
    }

    // ─── Model load ───────────────────────────────────────────────────────────

    private void TryLoad()
    {
        try
        {
            if (!File.Exists(ModelPath))
            {
                System.Diagnostics.Debug.WriteLine($"[Embedding] No model at {ModelPath}. Semantic ranking disabled.");
                return;
            }
            if (!File.Exists(VocabPath))
            {
                System.Diagnostics.Debug.WriteLine($"[Embedding] No vocab at {VocabPath}. Semantic ranking disabled.");
                return;
            }

            // Try DirectML first (GPU), fall back to CPU on error.
            var so = new SessionOptions();
            try
            {
                so.AppendExecutionProvider_DML(0);
            }
            catch
            {
                // DirectML not available on this system — CPU inference still works.
            }
            so.GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_ALL;
            so.ExecutionMode = ExecutionMode.ORT_SEQUENTIAL;
            so.InterOpNumThreads = 1;
            so.IntraOpNumThreads = Math.Min(4, Environment.ProcessorCount);

            _session = new InferenceSession(ModelPath, so);

            // Determine embedding dimension from first float output.
            foreach (var output in _session.OutputMetadata)
            {
                var dims = output.Value.Dimensions;
                if (dims != null && dims.Length >= 2)
                {
                    EmbeddingDimension = dims[^1];
                    if (EmbeddingDimension > 0) break;
                }
            }
            if (EmbeddingDimension == 0) EmbeddingDimension = 384; // MiniLM-L6-v2 default

            // Load BERT tokenizer.
            _tokenizer = BertTokenizer.Create(VocabPath);

            ModelLoaded = true;
            System.Diagnostics.Debug.WriteLine($"[Embedding] Loaded model dim={EmbeddingDimension} from {ModelPath}");
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[Embedding] Load failed: {ex.Message}");
            _session?.Dispose();
            _session = null;
            _tokenizer = null;
            ModelLoaded = false;
        }
    }

    // ─── Status ───────────────────────────────────────────────────────────────

    public object GetStatus() => new
    {
        modelLoaded = ModelLoaded,
        embeddingDimension = EmbeddingDimension,
        modelPath = ModelPath,
        vocabPath = VocabPath,
        modelExists = File.Exists(ModelPath),
        vocabExists = File.Exists(VocabPath),
    };

    // ─── Dispose ──────────────────────────────────────────────────────────────

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _inferLock.Wait();
        try
        {
            _session?.Dispose();
            _session = null;
        }
        finally
        {
            _inferLock.Release();
            _inferLock.Dispose();
        }
    }
}
