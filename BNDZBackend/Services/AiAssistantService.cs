using System;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>
/// File-manager AI features backed by an in-process local GGUF model (download-on-first-use).
/// Falls back to deterministic rules while the model downloads or if inference fails.
/// </summary>
public class AiAssistantService
{
    private readonly LocalAiService _localAi;

    public AiAssistantService(LocalAiService localAi)
    {
        _localAi = localAi;
    }

    public bool IsConfigured => true;

    public bool IsModelReady => _localAi.IsLoaded || _localAi.IsModelPresent;

    public async Task<string> GenerateResponseAsync(string prompt, CancellationToken cancellationToken = default)
    {
        try
        {
            var local = await _localAi.GenerateAsync(prompt, cancellationToken);
            if (!string.IsNullOrWhiteSpace(local)) return local;
        }
        catch
        {
            // fall through to rules
        }

        return AiRulesEngine.TryRulesResponse(prompt) ?? string.Empty;
    }

    public async Task<string> StreamResponseAsync(
        string prompt,
        Action<string> onChunk,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var local = await _localAi.GenerateStreamAsync(prompt, onChunk, cancellationToken);
            if (!string.IsNullOrWhiteSpace(local)) return local;
        }
        catch
        {
            // fall through to rules
        }

        var fallback = AiRulesEngine.TryRulesResponse(prompt) ?? string.Empty;
        if (!string.IsNullOrEmpty(fallback)) onChunk(fallback);
        return fallback;
    }
}
