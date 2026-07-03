using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>Named-pipe server so an independently installed BNDZ Launcher can drive FM navigation.</summary>
public sealed class BndzFileManagerIpcService : IDisposable
{
    public const string PipeName = "BNDZ.FileManager.IPC";
    private const int ListenerCount = 2;

    private static readonly Lazy<BndzFileManagerIpcService> _instance = new(() => new BndzFileManagerIpcService());
    public static BndzFileManagerIpcService Instance => _instance.Value;

    private CancellationTokenSource? _cts;
    private Task[]? _listenTasks;
    private MainWindow? _main;

    private BndzFileManagerIpcService() { }

    public void RegisterMain(MainWindow main) => _main = main;

    public void Start()
    {
        if (_listenTasks != null) return;
        _cts = new CancellationTokenSource();
        _listenTasks = new Task[ListenerCount];
        for (var i = 0; i < ListenerCount; i++)
            _listenTasks[i] = Task.Run(() => ListenLoopAsync(_cts.Token));
    }

    public void Dispose()
    {
        try { _cts?.Cancel(); } catch { }
        _cts?.Dispose();
        _cts = null;
        _listenTasks = null;
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
                Debug.WriteLine($"[BndzFileManagerIpcService] Listen error: {ex.Message}");
                await Task.Delay(100, token);
            }
        }
    }

    private async Task HandleClientAsync(NamedPipeServerStream server, CancellationToken token)
    {
        using var reader = new StreamReader(server, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
        var line = await reader.ReadLineAsync(token);
        if (string.IsNullOrWhiteSpace(line))
        {
            await WriteAckAsync(server, false, token);
            return;
        }

        var ok = false;
        try
        {
            using var doc = JsonDocument.Parse(line);
            var root = doc.RootElement;
            var action = root.TryGetProperty("action", out var act) ? act.GetString() : null;
            var path = root.TryGetProperty("path", out var p) ? p.GetString() : null;

            switch (action?.ToLowerInvariant())
            {
                case "open_path":
                    if (!string.IsNullOrWhiteSpace(path))
                        ok = await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                        {
                            _main?.OpenPathInManager(path);
                            return _main != null;
                        });
                    else
                        ok = await TryShowMainAsync();
                    break;
                case "show":
                default:
                    ok = await TryShowMainAsync();
                    break;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzFileManagerIpcService] Message error: {ex.Message}");
            ok = false;
        }

        await WriteAckAsync(server, ok, token);
    }

    private Task<bool> TryShowMainAsync() =>
        System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
        {
            _main?.ShowAndActivate();
            return _main != null;
        }).Task;

    private static async Task WriteAckAsync(Stream server, bool ok, CancellationToken token)
    {
        try
        {
            var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new { ok }) + "\n");
            await server.WriteAsync(bytes, token);
            await server.FlushAsync(token);
        }
        catch { }
    }
}
