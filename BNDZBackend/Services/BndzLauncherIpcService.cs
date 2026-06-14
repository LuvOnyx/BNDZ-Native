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

    private static readonly Lazy<BndzLauncherIpcService> _instance = new(() => new BndzLauncherIpcService());
    public static BndzLauncherIpcService Instance => _instance.Value;

    private CancellationTokenSource? _cts;
    private Task? _listenTask;

    private BndzLauncherIpcService() { }

    public void Start()
    {
        if (_listenTask != null) return;
        _cts = new CancellationTokenSource();
        _listenTask = Task.Run(() => ListenLoopAsync(_cts.Token));
    }

    public void Dispose()
    {
        try { _cts?.Cancel(); } catch { }
        _cts?.Dispose();
        _cts = null;
        _listenTask = null;
    }

    private async Task ListenLoopAsync(CancellationToken token)
    {
        while (!token.IsCancellationRequested)
        {
            try
            {
                await using var server = new NamedPipeServerStream(
                    PipeName,
                    PipeDirection.In,
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
                await Task.Delay(250, token);
            }
        }
    }

    private static async Task HandleClientAsync(NamedPipeServerStream server, CancellationToken token)
    {
        using var reader = new StreamReader(server, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
        var line = await reader.ReadLineAsync(token);
        if (string.IsNullOrWhiteSpace(line)) return;

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
                        BndzHostCoordinator.Instance.OpenPathInFileManager(path);
                    else
                        BndzHostCoordinator.Instance.ShowFileManager();
                    break;
                case "show":
                default:
                    BndzHostCoordinator.Instance.ShowFileManager();
                    break;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[BndzLauncherIpcService] Message error: {ex.Message}");
        }
    }
}
