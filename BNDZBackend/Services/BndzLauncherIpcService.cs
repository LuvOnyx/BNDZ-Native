using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>Named-pipe server for commands from Flow.Launcher.Plugin.BNDZ.</summary>
public sealed class BndzLauncherIpcService : IDisposable
{
    public const string PipeName = "BNDZ.Launcher.IPC";
    private const int ListenerCount = 4;

    private static readonly Lazy<BndzLauncherIpcService> _instance = new(() => new BndzLauncherIpcService());
    public static BndzLauncherIpcService Instance => _instance.Value;

    private CancellationTokenSource? _cts;
    private Task[]? _listenTasks;

    private BndzLauncherIpcService() { }

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
                Debug.WriteLine($"[BndzLauncherIpcService] Listen error: {ex.Message}");
                await Task.Delay(100, token);
            }
        }
    }

    private static async Task HandleClientAsync(NamedPipeServerStream server, CancellationToken token)
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
                case "show_shell":
                    ok = await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                    {
                        BndzLauncherShellService.Instance.Show();
                        return true;
                    });
                    break;
                case "toggle_shell":
                    ok = await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                    {
                        if (BndzLauncherShellService.Instance.IsVisible)
                            BndzLauncherShellService.Instance.Hide();
                        else
                            BndzLauncherShellService.Instance.Show();
                        return true;
                    });
                    break;
                case "hide_shell":
                    ok = await System.Windows.Application.Current.Dispatcher.InvokeAsync(() =>
                    {
                        BndzLauncherShellService.Instance.Hide();
                        return true;
                    });
                    break;
                case "open_path":
                    if (!string.IsNullOrWhiteSpace(path))
                        BndzHostCoordinator.Instance.OpenPathInFileManager(path);
                    else
                        BndzHostCoordinator.Instance.ShowFileManager();
                    ok = true;
                    break;
                case "show":
                default:
                    BndzHostCoordinator.Instance.ShowFileManager();
                    ok = true;
                    break;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzLauncherIpcService] Message error: {ex.Message}");
            ok = false;
        }

        await WriteAckAsync(server, ok, token);
    }

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
