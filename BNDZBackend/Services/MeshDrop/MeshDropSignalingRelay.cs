using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;

namespace BNDZ.Services.MeshDrop;

/// <summary>Optional HTTP signaling relay — auto-exchanges answer codes without manual paste.</summary>
public static class MeshDropSignalingRelay
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };

    public sealed class RelayRoom
    {
        public string RoomId { get; set; } = "";
        public string JoinUrl { get; set; } = "";
        public string PollUrl { get; set; } = "";
    }

    public static async Task<RelayRoom?> CreateHostRoomAsync(string relayBaseUrl, string meshCode, string? label = null, CancellationToken ct = default)
    {
        var baseUrl = NormalizeBase(relayBaseUrl);
        if (baseUrl == null) return null;

        var body = new { offer = meshCode, label = label ?? "BNDZ Mesh Drop" };
        try
        {
            var res = await Http.PostAsJsonAsync($"{baseUrl}/api/room", body, ct).ConfigureAwait(false);
            if (!res.IsSuccessStatusCode) return null;
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync(ct).ConfigureAwait(false));
            var root = doc.RootElement;
            var roomId = root.TryGetProperty("roomId", out var r) ? r.GetString() : null;
            if (string.IsNullOrEmpty(roomId)) return null;
            return new RelayRoom
            {
                RoomId = roomId,
                JoinUrl = root.TryGetProperty("joinUrl", out var j) ? j.GetString() ?? $"{baseUrl}/join/{roomId}" : $"{baseUrl}/join/{roomId}",
                PollUrl = root.TryGetProperty("pollUrl", out var p) ? p.GetString() ?? $"{baseUrl}/api/room/{roomId}/answer" : $"{baseUrl}/api/room/{roomId}/answer",
            };
        }
        catch
        {
            return null;
        }
    }

    public static async Task<string?> PollAnswerAsync(string pollUrl, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(pollUrl)) return null;
        try
        {
            using var doc = JsonDocument.Parse(await Http.GetStringAsync(pollUrl, ct).ConfigureAwait(false));
            if (doc.RootElement.TryGetProperty("answer", out var a))
            {
                var answer = a.GetString();
                if (!string.IsNullOrWhiteSpace(answer)) return answer;
            }
        }
        catch { /* not ready */ }
        return null;
    }

    public static async Task<bool> SubmitAnswerAsync(string relayBaseUrl, string roomId, string answerCode, CancellationToken ct = default)
    {
        var baseUrl = NormalizeBase(relayBaseUrl);
        if (baseUrl == null || string.IsNullOrWhiteSpace(roomId)) return false;
        try
        {
            var res = await Http.PostAsJsonAsync($"{baseUrl}/api/room/{Uri.EscapeDataString(roomId)}/answer",
                new { answer = answerCode }, ct).ConfigureAwait(false);
            return res.IsSuccessStatusCode;
        }
        catch
        {
            return false;
        }
    }

    public static async Task<string?> ResolveRoomOfferAsync(string relayBaseUrl, string roomId, CancellationToken ct = default)
    {
        var baseUrl = NormalizeBase(relayBaseUrl);
        if (baseUrl == null) return null;
        try
        {
            using var doc = JsonDocument.Parse(
                await Http.GetStringAsync($"{baseUrl}/api/room/{Uri.EscapeDataString(roomId)}", ct).ConfigureAwait(false));
            if (doc.RootElement.TryGetProperty("offer", out var o))
                return o.GetString();
        }
        catch { /* */ }
        return null;
    }

    private static string? NormalizeBase(string? url)
    {
        if (string.IsNullOrWhiteSpace(url)) return null;
        return url.Trim().TrimEnd('/');
    }
}
