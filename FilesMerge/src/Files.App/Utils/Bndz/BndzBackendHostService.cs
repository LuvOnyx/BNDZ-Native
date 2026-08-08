// Copyright (c) BNDZ — FilesMerge ↔ BNDZBackend host bridge
// Files Community portions remain MIT (see LICENSE-MIT).

using System.Collections.Concurrent;
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
/// Persistent connection pool (reconnect-per-call was the cold-load killer).
/// </summary>
internal static class BndzBackendClient
{
	public const string PipeName = "BNDZ.Backend.Host";
	private const int PoolSize = 8;

	private static readonly ConcurrentBag<PooledPipe> Pool = new();
	private static int _poolCreated;

	public static async Task<JsonDocument?> InvokeAsync(string type, object? payload = null, int connectTimeoutMs = 2500, CancellationToken ct = default)
	{
		var id = Guid.NewGuid().ToString("N");
		var request = JsonSerializer.Serialize(new { type, id, payload = payload ?? new { } });
		return await InvokeAsyncFromRawJsonAsync(request, connectTimeoutMs, ct).ConfigureAwait(false);
	}

	/// <summary>Forward a WebView-shaped JSON envelope to the backend host pipe and return the response document.</summary>
	public static async Task<JsonDocument?> InvokeAsyncFromRawJsonAsync(string requestJson, int connectTimeoutMs = 8000, CancellationToken ct = default)
	{
		// Ensure correlating id exists for request/response matching on the host.
		string line = requestJson;
		try
		{
			using var doc = JsonDocument.Parse(requestJson);
			var root = doc.RootElement;
			if (!root.TryGetProperty("id", out _) && root.TryGetProperty("type", out var typeEl))
			{
				var type = typeEl.GetString() ?? "UNKNOWN";
				object? payload = null;
				if (root.TryGetProperty("payload", out var p))
					payload = JsonSerializer.Deserialize<object>(p.GetRawText());
				line = JsonSerializer.Serialize(new { type, id = Guid.NewGuid().ToString("N"), payload });
			}
		}
		catch
		{
			line = requestJson;
		}

		var payloadBytes = Encoding.UTF8.GetBytes(line.TrimEnd() + "\n");
		Exception? last = null;

		for (var attempt = 0; attempt < 2; attempt++)
		{
			ct.ThrowIfCancellationRequested();
			PooledPipe? lease = null;
			try
			{
				lease = await RentAsync(connectTimeoutMs, ct).ConfigureAwait(false);
				using var roundTripCts = CancellationTokenSource.CreateLinkedTokenSource(ct);
				roundTripCts.CancelAfter(TimeSpan.FromSeconds(60));
				await lease.SendAndReceiveAsync(payloadBytes, roundTripCts.Token).ConfigureAwait(false);
				var responseLine = lease.LastResponse;
				Return(lease);
				lease = null;

				if (string.IsNullOrWhiteSpace(responseLine))
					return null;

				return JsonDocument.Parse(responseLine);
			}
			catch (Exception ex) when (attempt == 0)
			{
				last = ex;
				DropLease(ref lease);
			}
			catch
			{
				DropLease(ref lease);
				throw;
			}
		}

		if (last is not null)
			throw last;
		return null;
	}

	private static void DropLease(ref PooledPipe? lease)
	{
		if (lease is null) return;
		var drop = lease;
		lease = null;
		try { drop.Dispose(); } catch { }
		Interlocked.Decrement(ref _poolCreated);
		try { PoolGate.Release(); } catch { }
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

	private static readonly SemaphoreSlim PoolGate = new(PoolSize, PoolSize);

	private static async Task<PooledPipe> RentAsync(int connectTimeoutMs, CancellationToken ct)
	{
		// Bound the wait so a starved pool fails the IPC call instead of hanging until FE 45s.
		var rented = await PoolGate.WaitAsync(TimeSpan.FromSeconds(8), ct).ConfigureAwait(false);
		if (!rented)
			throw new TimeoutException("BNDZ backend pipe pool exhausted (waited 8s).");
		try
		{
			while (Pool.TryTake(out var ready))
			{
				if (ready.IsAlive)
					return ready;
				ready.Dispose();
				Interlocked.Decrement(ref _poolCreated);
			}

			var created = Interlocked.Increment(ref _poolCreated);
			if (created > PoolSize)
			{
				// Should be rare with PoolGate — roll back and wait for a returned pipe.
				Interlocked.Decrement(ref _poolCreated);
				for (var i = 0; i < 40; i++)
				{
					await Task.Delay(15, ct).ConfigureAwait(false);
					if (Pool.TryTake(out var reused) && reused.IsAlive)
						return reused;
					if (reused is not null)
					{
						reused.Dispose();
						Interlocked.Decrement(ref _poolCreated);
					}
				}

				Interlocked.Increment(ref _poolCreated);
			}

			var pipe = new PooledPipe();
			try
			{
				await pipe.ConnectAsync(connectTimeoutMs, ct).ConfigureAwait(false);
				return pipe;
			}
			catch
			{
				try { pipe.Dispose(); } catch { }
				Interlocked.Decrement(ref _poolCreated);
				throw;
			}
		}
		catch
		{
			PoolGate.Release();
			throw;
		}
	}

	private static void Return(PooledPipe pipe)
	{
		try
		{
			if (!pipe.IsAlive)
			{
				try { pipe.Dispose(); } catch { }
				Interlocked.Decrement(ref _poolCreated);
				return;
			}

			Pool.Add(pipe);
		}
		finally
		{
			PoolGate.Release();
		}
	}

	private sealed class PooledPipe : IDisposable
	{
		private NamedPipeClientStream? _client;
		private SystemIO.StreamReader? _reader;
		private readonly SemaphoreSlim _gate = new(1, 1);
		public string? LastResponse { get; private set; }
		public bool IsAlive => _client is { IsConnected: true };

		public async Task ConnectAsync(int connectTimeoutMs, CancellationToken ct)
		{
			_client = new NamedPipeClientStream(".", PipeName, PipeDirection.InOut, PipeOptions.Asynchronous);
			await _client.ConnectAsync(connectTimeoutMs, ct).ConfigureAwait(false);
			_reader = new SystemIO.StreamReader(_client, Encoding.UTF8, detectEncodingFromByteOrderMarks: false, leaveOpen: true);
		}

		public async Task SendAndReceiveAsync(byte[] payload, CancellationToken ct)
		{
			await _gate.WaitAsync(ct).ConfigureAwait(false);
			try
			{
				if (_client is null || _reader is null)
					throw new InvalidOperationException("pipe not connected");
				await _client.WriteAsync(payload, ct).ConfigureAwait(false);
				await _client.FlushAsync(ct).ConfigureAwait(false);
				LastResponse = await _reader.ReadLineAsync(ct).ConfigureAwait(false);
			}
			finally
			{
				_gate.Release();
			}
		}

		public void Dispose()
		{
			try { _reader?.Dispose(); } catch { }
			try { _client?.Dispose(); } catch { }
			try { _gate.Dispose(); } catch { }
			_reader = null;
			_client = null;
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
	private readonly SemaphoreSlim _startLock = new(1, 1);
	private Process? _process;
	private bool _ownsProcess;
	private CancellationTokenSource? _monitorCts;

	public BndzBackendStatus Status { get; private set; } =
		new(BndzBackendConnectionState.Offline, "BNDZ backend offline");

	public event EventHandler<BndzBackendStatus>? StatusChanged;

	public async Task EnsureStartedAsync(CancellationToken ct = default, bool startMonitor = true)
	{
		await _startLock.WaitAsync(ct).ConfigureAwait(false);
		try
		{
			await EnsureStartedCoreAsync(ct, startMonitor).ConfigureAwait(false);
		}
		finally
		{
			_startLock.Release();
		}
	}

	private async Task EnsureStartedCoreAsync(CancellationToken ct, bool startMonitor)
	{
		SetStatus(new(BndzBackendConnectionState.Starting, "BNDZ backend starting…"));

		if (await BndzBackendClient.TryPingAsync(ct).ConfigureAwait(false))
		{
			SetStatus(new(BndzBackendConnectionState.Connected, "BNDZ backend connected", SafePid()));
			_ = ProveBrainAsync(CancellationToken.None);
			if (startMonitor)
				StartMonitor();
			return;
		}

		lock (_gate)
		{
			if (_process is { HasExited: false })
			{
				// Spawn already in flight — wait for ping below.
			}
			else
			{
				var exe = ResolveBndzExe();
				if (exe is null)
				{
					SetStatus(new(BndzBackendConnectionState.Offline, "BNDZ backend missing", Detail: "Build BNDZBackend (npm run build + dotnet), then relaunch."));
					return;
				}

				// UseShellExecute=false so package / layout launches are reliable (no shell verb quirks).
				_process = Process.Start(new ProcessStartInfo
				{
					FileName = exe,
					Arguments = "--backend-host --skip-elevation",
					UseShellExecute = false,
					CreateNoWindow = true,
					WorkingDirectory = SystemIO.Path.GetDirectoryName(exe)!,
				});
				_ownsProcess = _process is not null;
			}
		}

		if (_process is null && Status.State == BndzBackendConnectionState.Offline)
			return;

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
				SetStatus(new(BndzBackendConnectionState.Connected, "BNDZ backend connected", SafePid()));
				_ = ProveBrainAsync(CancellationToken.None);
				if (startMonitor)
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
					if (await BndzBackendClient.TryPingAsync(token).ConfigureAwait(false))
						continue;

					SetStatus(new(BndzBackendConnectionState.Offline, "BNDZ backend offline", Detail: "Reconnecting…"));
					lock (_gate)
					{
						// Only clear handle if the child actually died — never orphan a live host
						// then spawn a second BNDZ.exe.
						if (_process is null || _process.HasExited)
						{
							_process = null;
							_ownsProcess = false;
						}
						else
						{
							try { _process.Kill(entireProcessTree: true); } catch { }
							_process = null;
							_ownsProcess = false;
						}
					}
					try
					{
						// Do not StartMonitor again — this loop owns the watchdog.
						await EnsureStartedAsync(token, startMonitor: false).ConfigureAwait(false);
					}
					catch (OperationCanceledException) { break; }
					catch
					{
						/* next loop retries */
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
		if (!string.IsNullOrWhiteSpace(env) && SystemIO.File.Exists(env))
			return env;

		var baseDir = AppContext.BaseDirectory;
		// Prefer isolated bndz-host/ tree (full WPF output) — never mix BNDZ net8 deps into Files root.
		var candidates = new[]
		{
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "bndz-host", "BNDZ.exe")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "BNDZ.exe")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "BNDZBackend", "bin", "Debug", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(baseDir, "..", "..", "..", "..", "..", "..", "BNDZBackend", "bin", "Release", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(Environment.CurrentDirectory, "BNDZBackend", "bin", "Debug", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
			SystemIO.Path.GetFullPath(SystemIO.Path.Combine(Environment.CurrentDirectory, "BNDZBackend", "bin", "Release", "net8.0-windows10.0.19041.0", "BNDZ.exe")),
		};
		foreach (var c in candidates)
		{
			if (SystemIO.File.Exists(c))
				return c;
		}
		return null;
	}
}
