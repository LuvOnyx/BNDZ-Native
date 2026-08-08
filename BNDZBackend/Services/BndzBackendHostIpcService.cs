using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>
/// Named-pipe control plane for architecture #3: FilesMerge WinUI shell ↔ full BNDZBackend.
/// Speaks the same JSON envelope as WebView2 IPC (<c>type</c> / <c>id</c> / <c>payload</c>).
/// </summary>
public sealed class BndzBackendHostIpcService : IDisposable
{
    public const string PipeName = "BNDZ.Backend.Host";
    /// <summary>Concurrent accept loops — FilesMerge fires settings + list + icons in parallel.</summary>
    private const int ListenerCount = 12;

    private static readonly Lazy<BndzBackendHostIpcService> _instance = new(() => new BndzBackendHostIpcService());
    public static BndzBackendHostIpcService Instance => _instance.Value;

    private CancellationTokenSource? _cts;
    private Task[]? _listenTasks;
    private MainWindow? _main;

    private BndzBackendHostIpcService() { }

    public void RegisterMain(MainWindow main) => _main = main;

    public void Start()
    {
        if (_listenTasks != null) return;
        _cts = new CancellationTokenSource();
        _listenTasks = new Task[ListenerCount];
        for (var i = 0; i < ListenerCount; i++)
            _listenTasks[i] = Task.Run(() => ListenLoopAsync(_cts.Token));

        try
        {
            var readyPath = Path.Combine(Path.GetTempPath(), "bndz-backend-host-ready.txt");
            File.WriteAllText(readyPath, $"{Environment.ProcessId}\n{PipeName}\n");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzBackendHostIpc] ready marker failed: {ex.Message}");
        }
    }

    public void Dispose()
    {
        try { _cts?.Cancel(); } catch { }
        _cts?.Dispose();
        _cts = null;
        _listenTasks = null;
        try
        {
            var readyPath = Path.Combine(Path.GetTempPath(), "bndz-backend-host-ready.txt");
            if (File.Exists(readyPath)) File.Delete(readyPath);
        }
        catch { }
    }

    private async Task ListenLoopAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            NamedPipeServerStream? server = null;
            try
            {
                server = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.InOut,
                    NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);

                await server.WaitForConnectionAsync(token).ConfigureAwait(false);

                // Hand off so this accept loop can take the next client immediately
                // (long GET_DIR_CONTENTS / SCAN_FOLDER_SIZES must not stall other RPCs).
                var connected = server;
                server = null;
                _ = Task.Run(async () =>
                {
                    try
                    {
                        await HandleClientAsync(connected, token).ConfigureAwait(false);
                    }
                    catch (Exception ex)
                    {
                        Debug.WriteLine($"[BndzBackendHostIpc] Client error: {ex.Message}");
                    }
                    finally
                    {
                        try { await connected.DisposeAsync().ConfigureAwait(false); } catch { }
                    }
                }, token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[BndzBackendHostIpc] Listen error: {ex.Message}");
                try { await Task.Delay(100, token).ConfigureAwait(false); } catch { break; }
            }
            finally
            {
                if (server is not null)
                {
                    try { await server.DisposeAsync().ConfigureAwait(false); } catch { }
                }
            }
        }
    }

    private async Task HandleClientAsync(NamedPipeServerStream server, CancellationToken token)
    {
        using var reader = new StreamReader(server, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
        // Keep the pipe open for many RPCs — reconnect-per-call was dominating FilesMerge cold load.
        while (!token.IsCancellationRequested)
        {
            string? line;
            try
            {
                line = await reader.ReadLineAsync(token).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (IOException)
            {
                break;
            }

            if (line is null)
                break; // client disconnected
            if (string.IsNullOrWhiteSpace(line))
                continue;

            string response;
            try
            {
                var main = _main;
                if (main is null)
                {
                    response = JsonSerializer.Serialize(new { type = "ERROR", payload = new { error = "backend main window not ready" } });
                }
                else
                {
                    // Full IPC surface — waiter registration + dispatch; accept loop already handed off.
                    response = await main.HandleBackendHostIpcAsync(line).ConfigureAwait(false);
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[BndzBackendHostIpc] Handle error: {ex.Message}");
                response = JsonSerializer.Serialize(new { type = "ERROR", payload = new { error = ex.Message } });
            }

            try
            {
                await WriteLineAsync(server, response, token).ConfigureAwait(false);
            }
            catch
            {
                break;
            }
        }
    }

    private static async Task WriteLineAsync(Stream server, string json, CancellationToken token)
    {
        try
        {
            var bytes = Encoding.UTF8.GetBytes(json + "\n");
            await server.WriteAsync(bytes, token);
            await server.FlushAsync(token);
        }
        catch { }
    }
}
