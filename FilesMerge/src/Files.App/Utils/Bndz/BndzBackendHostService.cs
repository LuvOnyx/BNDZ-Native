// Copyright (c) BNDZ — FilesMerge ↔ BNDZBackend host bridge
// Files Community portions remain MIT (see LICENSE-MIT).

using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;

namespace Files.App.Utils.Bndz;

/// <summary>Connection state of the architecture #3 BNDZBackend host process.</summary>
internal enum BndzBackendConnectionState
{
	Offline,
	Starting,
	Connected,
	Degraded,
}

/// <summary>Snapshot shown in the shell status chip.</summary>
internal sealed record BndzBackendStatus(
	BndzBackendConnectionState State,
	string Label,
	int? ProcessId = null,
	long? IndexedFileCount = null,
	string? Detail = null);

/// <summary>
/// Named-pipe client for <c>BNDZ.Backend.Host</c> — same type/id/payload envelope as WebView2 IPC.
/// </summary>
internal static class BndzBackendClient
{
	public const string PipeName = "BNDZ.Backend.Host";

	public static async Task<JsonDocument?> InvokeAsync(string type, object? payload = null, int connectTimeoutMs = 2500, CancellationToken ct = default)
	{
		var id = Guid.NewGuid().ToString("N");
		var request = JsonSerializer.Serialize(new { type, id, payload = payload ?? new { } });

		using var client = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
		await client.ConnectAsync(connectTimeoutMs, ct).ConfigureAwait(false);

		var bytes = Encoding.UTF8.GetBytes(request + "\n");
		await client.WriteAsync(bytes, ct).ConfigureAwait(false);
		await client.FlushAsync(ct).ConfigureAwait(false);

		using var reader = new StreamReader(client, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
		var line = await reader.ReadLineAsync(ct).ConfigureAwait(false);
		if (string.IsNullOrWhiteSpace(line))
			return null;

		return JsonDocument.Parse(line);
	}

	public static async Task<bool> TryPingAsync(CancellationToken ct = default)
	{
		try
		{
			using var doc = await InvokeAsync("IPC_PING", ct: ct).ConfigureAwait(false);
			if (doc is null) return false;
			var root = doc.RootElement;
			if (!root.TryGetProperty("type", out var t) || t.GetString() != "IPC_PING_RESULT")
				return false;
			if (root.TryGetProperty("payload", out var p) && p.TryGetProperty("ok", out var ok))
				return ok.ValueKind == JsonValueKind.True || (ok.ValueKind == JsonValueKind.String && ok.GetString() == "true");
			return true;
		}
		catch
		{
			return false;
		}
	}
}

/// <summary>
/// Owns the <c>BNDZ.exe --backend-host</c> child process for the FilesMerge shell.
/// Full backend brain — not HWND embed, not stubs.
/// </summary>
internal sealed class BndzBackendHostService
{
	public static BndzBackendHostService Instance { get; } = new();

	private readonly object _gate = new();
	private Process? _process;
	private bool _ownsProcess;
	private CancellationTokenSource? _monitorCts;

	public BndzBackendStatus Status { get; private set; } =
		new(BndzBackendConnectionState.Offline, "BNDZ backend offline");

	public event EventHandler<BndzBackendStatus>? StatusChanged;

	public async Task EnsureStartedAsync(CancellationToken ct = default)
	{
		SetStatus(new(BndzBackendConnectionState.Starting, "BNDZ backend starting…"));

		if (await BndzBackendClient.TryPingAsync(ct).ConfigureAwait(false))
		{
			await ProveBrainAsync(ct).ConfigureAwait(false);
			return;
		}

		var exe = ResolveBndzExe();
		if (exe is null)
		{
			SetStatus(new(BndzBackendConnectionState.Offline, "BNDZ backend missing", Detail: "Build BNDZBackend (npm run build + dotnet), then relaunch."));
			return;
		}

		lock (_gate)
		{
			if (_process is { HasExited: false })
			{
				// already spawning
			}
			else
			{
				_process = Process.Start(new ProcessStartInfo
				{
					FileName = exe,
					Arguments = "--backend-host --skip-elevation",
					UseShellExecute = true,
					WorkingDirectory = Path.GetDirectoryName(exe)!,
				});
				_ownsProcess = _process is not null;
			}
		}

		if (_process is null)
		{
			SetStatus(new(BndzBackendConnectionState.Offline, "BNDZ backend failed to start"));
			return;
		}

		for (var i = 0; i < 80; i++)
		{
			ct.ThrowIfCancellationRequested();
			if (await BndzBackendClient.TryPingAsync(ct).ConfigureAwait(false))
			{
				await ProveBrainAsync(ct).ConfigureAwait(false);
				StartMonitor();
				return;
			}
			await Task.Delay(150, ct).ConfigureAwait(false);
		}

		SetStatus(new(BndzBackendConnectionState.Degraded, "BNDZ backend unreachable", ProcessId: SafePid()));
	}

	public void Shutdown()
	{
		try { _monitorCts?.Cancel(); } catch { }
		_monitorCts?.Dispose();
		_monitorCts = null;

		lock (_gate)
		{
			if (_ownsProcess && _process is { HasExited: false })
			{
				try { _process.Kill(entireProcessTree: true); } catch { }
			}
			_process = null;
			_ownsProcess = false;
		}

		SetStatus(new(BndzBackendConnectionState.Offline, "BNDZ backend offline"));
	}

	private async Task ProveBrainAsync(CancellationToken ct)
	{
		try
		{
			using var doc = await BndzBackendClient.InvokeAsync("GET_INDEX_STATUS", ct: ct).ConfigureAwait(false);
			long? fileCount = null;
			int? pid = SafePid();
			if (doc is not null
				&& doc.RootElement.TryGetProperty("payload", out var payload)
				&& payload.ValueKind == JsonValueKind.Object)
			{
				if (payload.TryGetProperty("fileCount", out var fc) && fc.ValueKind == JsonValueKind.Number)
					fileCount = fc.GetInt64();
				if (payload.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.String)
				{
					SetStatus(new(BndzBackendConnectionState.Degraded, "BNDZ backend degraded", pid, Detail: err.GetString()));
					return;
				}
			}

			var label = fileCount is null
				? "BNDZ backend connected"
				: $"BNDZ backend · {fileCount:N0} indexed";
			SetStatus(new(BndzBackendConnectionState.Connected, label, pid, fileCount));
		}
		catch (Exception ex)
		{
			// Ping worked; index probe failed — still connected but flag it
			SetStatus(new(BndzBackendConnectionState.Connected, "BNDZ backend connected", SafePid(), Detail: ex.Message));
		}
	}

	private void StartMonitor()
	{
		try { _monitorCts?.Cancel(); } catch { }
		_monitorCts?.Dispose();
		_monitorCts = new CancellationTokenSource();
		var token = _monitorCts.Token;
		_ = Task.Run(async () =>
		{
			while (!token.IsCancellationRequested)
			{
				try
				{
					await Task.Delay(8000, token).ConfigureAwait(false);
					if (!await BndzBackendClient.TryPingAsync(token).ConfigureAwait(false))
					{
						SetStatus(new(BndzBackendConnectionState.Offline, "BNDZ backend offline"));
						break;
					}
				}
				catch (OperationCanceledException) { break; }
				catch { /* keep polling */ }
			}
		}, token);
	}

	private int? SafePid()
	{
		try
		{
			lock (_gate)
			{
				if (_process is { HasExited: false })
					return _process.Id;
			}
		}
		catch { }
		return null;
	}

	private void SetStatus(BndzBackendStatus status)
	{
		Status = status;
		try { StatusChanged?.Invoke(this, status); } catch { }
	}

	internal static string? ResolveBndzExe()
	{
		var env = Environment.GetEnvironmentVariable("BNDZ_FM_EXE");
		if (!string.IsNullOrWhiteSpace(env) && File.Exists(env))
			return env;

		var baseDir = AppContext.BaseDirectory;
		var candidates = new[]
		{
			Path.GetFullPath(Path.Combine(baseDir, "BNDZ.exe")),
			Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "BNDZBackend", "bin", "Debug", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
			Path.GetFullPath(Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "BNDZBackend", "bin", "Release", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
			Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "BNDZBackend", "bin", "Debug", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
			Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "BNDZBackend", "bin", "Release", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
		};
		foreach (var c in candidates)
		{
			if (File.Exists(c))
				return c;
		}
		return null;
	}
}
