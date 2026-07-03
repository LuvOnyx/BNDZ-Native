using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>Gemini REST streaming client for BNDZ Launcher AI chat.</summary>
public sealed class BndzGeminiClient
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(3) };
    private static readonly ConcurrentDictionary<string, CancellationTokenSource> Active =
        new(StringComparer.Ordinal);

    public static bool IsConfigured => !string.IsNullOrWhiteSpace(ResolveApiKey());

    public static void Cancel(string requestId)
    {
        if (Active.TryRemove(requestId, out var cts))
            cts.Cancel();
    }

    /// <summary>
    /// Non-streaming single-shot completion. Returns the full model text, or throws
    /// with a readable message if the key is missing or the API call fails.
    /// </summary>
    public static async Task<string> GenerateContentAsync(
        string prompt,
        double temperature = 0.2,
        CancellationToken cancellationToken = default)
    {
        var apiKey = ResolveApiKey();
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException(
                "Gemini API key not configured. Set GEMINI_API_KEY or UserData/BNDZ/gemini-api-key.txt");

        var url =
            $"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={Uri.EscapeDataString(apiKey)}";

        var body = new
        {
            contents = new[]
            {
                new { role = "user", parts = new[] { new { text = prompt } } },
            },
            generationConfig = new { temperature, maxOutputTokens = 4096 },
        };

        using var req = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
        };
        using var resp = await Http.SendAsync(req, cancellationToken);
        var payload = await resp.Content.ReadAsStringAsync(cancellationToken);
        if (!resp.IsSuccessStatusCode)
            throw new HttpRequestException(ParseGeminiError(payload) ?? $"Gemini HTTP {(int)resp.StatusCode}");

        var sb = new StringBuilder();
        ExtractTextChunks(payload, chunk => sb.Append(chunk));
        return sb.ToString();
    }

    public static async Task StreamChatAsync(
        string requestId,
        IReadOnlyList<GeminiChatMessage> messages,
        Action<string> onChunk,
        Action<string>? onError = null)
    {
        var apiKey = ResolveApiKey();
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            onError?.Invoke("Gemini API key not configured. Set GEMINI_API_KEY or UserData/BNDZ/gemini-api-key.txt");
            return;
        }

        var cts = new CancellationTokenSource();
        Active[requestId] = cts;
        try
        {
            var url =
                $"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:streamGenerateContent?alt=sse&key={Uri.EscapeDataString(apiKey)}";

            var body = new
            {
                contents = messages.Select(m => new
                {
                    role = m.Role == "assistant" ? "model" : "user",
                    parts = new[] { new { text = m.Content } },
                }),
                generationConfig = new { temperature = 0.7, maxOutputTokens = 4096 },
            };

            using var req = new HttpRequestMessage(HttpMethod.Post, url)
            {
                Content = new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"),
            };
            using var resp = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, cts.Token);
            if (!resp.IsSuccessStatusCode)
            {
                var err = await resp.Content.ReadAsStringAsync(cts.Token);
                onError?.Invoke(ParseGeminiError(err) ?? $"Gemini HTTP {(int)resp.StatusCode}");
                return;
            }

            await using var stream = await resp.Content.ReadAsStreamAsync(cts.Token);
            using var reader = new StreamReader(stream);
            while (!reader.EndOfStream && !cts.Token.IsCancellationRequested)
            {
                var line = await reader.ReadLineAsync(cts.Token);
                if (string.IsNullOrWhiteSpace(line) || !line.StartsWith("data:", StringComparison.Ordinal))
                    continue;
                var json = line["data:".Length..].Trim();
                if (json is "{" or "[DONE]" or "") continue;
                ExtractTextChunks(json, onChunk);
            }
        }
        catch (OperationCanceledException)
        {
            // user cancelled
        }
        catch (Exception ex)
        {
            onError?.Invoke(ex.Message);
        }
        finally
        {
            Active.TryRemove(requestId, out _);
            cts.Dispose();
        }
    }

    private static void ExtractTextChunks(string json, Action<string> onChunk)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("candidates", out var candidates)) return;
            foreach (var candidate in candidates.EnumerateArray())
            {
                if (!candidate.TryGetProperty("content", out var content)) continue;
                if (!content.TryGetProperty("parts", out var parts)) continue;
                foreach (var part in parts.EnumerateArray())
                {
                    if (part.TryGetProperty("text", out var textEl))
                    {
                        var chunk = textEl.GetString();
                        if (!string.IsNullOrEmpty(chunk)) onChunk(chunk);
                    }
                }
            }
        }
        catch { }
    }

    private static string? ParseGeminiError(string body)
    {
        try
        {
            using var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("error", out var err)
                && err.TryGetProperty("message", out var msg))
                return msg.GetString();
        }
        catch { }
        return null;
    }

    private static string? ResolveApiKey()
    {
        var env = Environment.GetEnvironmentVariable("GEMINI_API_KEY");
        if (!string.IsNullOrWhiteSpace(env)) return env.Trim();

        foreach (var userData in ResolveUserDataCandidates())
        {
            var path = Path.Combine(userData, "BNDZ", "gemini-api-key.txt");
            if (File.Exists(path))
            {
                var key = File.ReadAllText(path).Trim();
                if (!string.IsNullOrWhiteSpace(key)) return key;
            }
        }
        return null;
    }

    private static IEnumerable<string> ResolveUserDataCandidates()
    {
        var launcherDir = BndzFlowLauncherService.Instance.LauncherDirectory;
        yield return Path.Combine(launcherDir, "UserData");
        yield return Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Launcher", "UserData");
    }
}

public sealed class GeminiChatMessage
{
    public string Role { get; set; } = "user";
    public string Content { get; set; } = "";
}
