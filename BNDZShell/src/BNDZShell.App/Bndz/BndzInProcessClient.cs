using System.Text.Json;
using BNDZ.Services;

namespace BNDZShell.Bndz;

/// <summary>In-process IPC bridge — no named pipe, no sidecar BNDZ.exe.</summary>
internal static class BndzInProcessClient
{
    public static Task<JsonDocument?> InvokeAsyncFromRawJsonAsync(string requestJson, CancellationToken ct = default)
        => BndzEmbeddedBackendHost.InvokeAsync(requestJson, ct);

    public static Task<JsonDocument?> InvokeAsync(string type, object? payload = null, CancellationToken ct = default)
        => BndzEmbeddedBackendHost.InvokeAsync(type, payload, ct);
}
