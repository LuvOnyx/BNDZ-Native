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
    private const int ListenerCount = 2;

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
            try
            {
                await using var server = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.InOut,
                    NamedPipeServerStream.MaxAllowedServerInstances,
                    PipeTransmissionMode.Byte,
                    PipeOptions.Asynchronous);

                await server.WaitForConnectionAsync(token);
                await HandleClientAsync(server, token);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[BndzBackendHostIpc] Listen error: {ex.Message}");
                try { await Task.Delay(100, token); } catch { break; }
            }
        }
    }

    private async Task HandleClientAsync(NamedPipeServerStream server, CancellationToken token)
    {
        using var reader = new StreamReader(server, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
        var line = await reader.ReadLineAsync(token);
        if (string.IsNullOrWhiteSpace(line))
        {
            await WriteLineAsync(server, JsonSerializer.Serialize(new { type = "ERROR", payload = new { error = "empty request" } }), token);
            return;
        }

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
                response = await System.Windows.Application.Current.Dispatcher.InvokeAsync(
                    () => main.HandleBackendHostIpc(line)).Task;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzBackendHostIpc] Handle error: {ex.Message}");
            response = JsonSerializer.Serialize(new { type = "ERROR", payload = new { error = ex.Message } });
        }

        await WriteLineAsync(server, response, token);
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
