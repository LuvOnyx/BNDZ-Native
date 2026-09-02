using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;

namespace BNDZ.Services.Mesh.Incus;

/// <summary>
/// BNDZ-owned local temporary VPS factory (this PC is the host).
/// Uses Podman machine (WSL-backed) to create disposable Linux instances with SSH,
/// then registers them as Mesh hosts — no purchased remote VPS / no Incus endpoint ritual.
/// </summary>
public sealed class MeshLocalVpsFactory
{
    public const string LocalEndpointId = "bndz-local";
    public const string LocalEndpointAlias = "BNDZ Local";

    private readonly MeshDatabase _db;
    private readonly BndzMeshOrchestrator _orchestrator;
    private static readonly object Gate = new();

    public MeshLocalVpsFactory(MeshDatabase db, BndzMeshOrchestrator orchestrator)
    {
        _db = db;
        _orchestrator = orchestrator;
    }

    public sealed class FactoryStatus
    {
        public bool Ready { get; set; }
        public string Runtime { get; set; } = "none";
        public string Phase { get; set; } = "idle";
        public string? Detail { get; set; }
        public bool NeedsElevation { get; set; }
        public string? Error { get; set; }
    }

    public FactoryStatus Probe()
    {
        var podman = FindPodman();
        if (podman == null)
        {
            return new FactoryStatus
            {
                Ready = false,
                Runtime = "none",
                Phase = "missing-runtime",
                Detail = "Install Podman Desktop (or Podman CLI) — BNDZ creates temporary VPS containers on this PC.",
                Error = "Podman not found",
            };
        }

        var list = Run(podman, "machine list --format json", TimeSpan.FromSeconds(20));
        var combined = (list.Stderr + "\n" + list.Stdout);
        if (list.Exit != 0 && (
            combined.Contains("wsl", StringComparison.OrdinalIgnoreCase)
            || combined.Contains("0x80070422", StringComparison.OrdinalIgnoreCase)
            || combined.Contains("0xffffffff", StringComparison.OrdinalIgnoreCase)
            || list.Exit == 125))
        {
            return new FactoryStatus
            {
                Ready = false,
                Runtime = "podman",
                Phase = "wsl-disabled",
                NeedsElevation = true,
                Detail = "Windows Subsystem for Linux is required for the local VPS factory. Press Prepare factory (admin once), reboot if asked, then Create.",
                Error = Truncate(list.Stderr.Length > 0 ? list.Stderr : list.Stdout, 400),
            };
        }

        if (list.Exit == 0 && LooksLikeRunningMachine(list.Stdout))
        {
            var ping = Run(podman, "ps -q", TimeSpan.FromSeconds(15));
            if (ping.Exit == 0)
            {
                return new FactoryStatus
                {
                    Ready = true,
                    Runtime = "podman",
                    Phase = "ready",
                    Detail = "Local VPS factory ready — Create VPS spins a temporary Linux instance on this PC.",
                };
            }
        }

        return new FactoryStatus
        {
            Ready = false,
            Runtime = "podman",
            Phase = "machine-stopped",
            Detail = "Podman is installed. BNDZ will init/start the local machine on Create.",
        };
    }

    /// <summary>Ensure Podman machine is up (init/start). May require WSL enabled.</summary>
    public async Task<FactoryStatus> EnsureReadyAsync(CancellationToken ct = default)
    {
        var status = Probe();
        if (status.Ready) return status;

        var podman = FindPodman()
            ?? throw new InvalidOperationException(
                "Podman is required for local temporary VPS. Install Podman Desktop, then Create VPS again.");

        if (status.Phase == "wsl-disabled")
        {
            // UAC prompt — enables WSL + Virtual Machine Platform for the local factory.
            var elevated = TryEnableWslElevated();
            status = Probe();
            if (status.Phase == "wsl-disabled")
            {
                throw new InvalidOperationException(
                    elevated
                        ? "WSL features were toggled — reboot Windows, then press Create VPS again. "
                          + "BNDZ creates temporary VPS on this PC (Podman+WSL), not a purchased remote server."
                        : "Approve the admin prompt to enable WSL for the local VPS factory, or turn on "
                          + "'Windows Subsystem for Linux' + 'Virtual Machine Platform' in Windows Features, reboot, then Create.");
            }
        }

        await Task.Run(() =>
        {
            lock (Gate)
            {
                ct.ThrowIfCancellationRequested();
                var list = Run(podman, "machine list --format json", TimeSpan.FromSeconds(30));
                var hasMachine = list.Exit == 0 && !string.IsNullOrWhiteSpace(list.Stdout)
                    && list.Stdout.Trim() is not ("[]" or "null");

                if (!hasMachine)
                {
                    var init = Run(podman, "machine init --now", TimeSpan.FromMinutes(8));
                    if (init.Exit != 0)
                        throw new InvalidOperationException(
                            "Could not initialize Podman machine (local Linux VM for temporary VPS):\n"
                            + Truncate(init.Stderr + "\n" + init.Stdout, 900));
                }
                else if (!LooksLikeRunningMachine(list.Stdout))
                {
                    var start = Run(podman, "machine start", TimeSpan.FromMinutes(4));
                    if (start.Exit != 0)
                        throw new InvalidOperationException(
                            "Could not start Podman machine:\n" + Truncate(start.Stderr + "\n" + start.Stdout, 900));
                }

                var ping = Run(podman, "ps -q", TimeSpan.FromSeconds(20));
                if (ping.Exit != 0)
                    throw new InvalidOperationException(
                        "Podman machine started but engine is not responding:\n"
                        + Truncate(ping.Stderr + "\n" + ping.Stdout, 600));
            }
        }, ct).ConfigureAwait(false);

        EnsureLocalEndpointRecord();
        return Probe();
    }

    public async Task<IncusEphemeralInstanceRecord> CreateAsync(
        string? alias,
        string image,
        int cpus,
        string memory,
        bool ephemeral,
        CancellationToken ct = default)
    {
        await EnsureReadyAsync(ct).ConfigureAwait(false);
        var podman = FindPodman()!;
        EnsureLocalEndpointRecord();

        var name = $"bndz-{DateTime.UtcNow:yyMMddHHmmss}-{Random.Shared.Next(0x1000, 0xFFFF):x}";
        var hostPort = FindFreeTcpPort();
        var pubKey = TryFindSshPublicKey();
        var imageRef = string.IsNullOrWhiteSpace(image)
            ? "lscr.io/linuxserver/openssh-server:latest"
            : image.Trim();

        var record = new IncusEphemeralInstanceRecord
        {
            EndpointId = LocalEndpointId,
            InstanceName = name,
            Status = "Creating",
            ImageAlias = imageRef,
            InstanceType = "container",
            Ephemeral = ephemeral,
            CreatedUtc = DateTime.UtcNow,
            Notes = string.IsNullOrWhiteSpace(alias) ? $"Local VPS · {name}" : alias!,
        };
        _db.UpsertIncusEphemeral(record);

        try
        {
            var pull = Run(podman, $"pull {Quote(imageRef)}", TimeSpan.FromMinutes(10));
            if (pull.Exit != 0)
                throw new InvalidOperationException(
                    "Local VPS image pull failed:\n" + Truncate(pull.Stderr + "\n" + pull.Stdout, 900));

            var args = new StringBuilder();
            args.Append("run -d --name ").Append(Quote(name));
            args.Append(" --hostname ").Append(Quote(name));
            if (cpus > 0) args.Append(" --cpus=").Append(cpus);
            if (!string.IsNullOrWhiteSpace(memory)) args.Append(" --memory=").Append(Quote(memory.Trim()));
            args.Append(" -p ").Append(hostPort).Append(":2222");
            args.Append(" -e PUID=1000 -e PGID=1000 -e TZ=Etc/UTC -e USER_NAME=bndz -e SUDO_ACCESS=true");
            if (!string.IsNullOrWhiteSpace(pubKey))
                args.Append(" -e PUBLIC_KEY=").Append(Quote(pubKey));
            else
                args.Append(" -e PASSWORD_ACCESS=true -e USER_PASSWORD=bndz");
            args.Append(' ').Append(Quote(imageRef));

            var create = Run(podman, args.ToString(), TimeSpan.FromMinutes(3));
            if (create.Exit != 0)
                throw new InvalidOperationException(
                    "Local VPS create failed:\n" + Truncate(create.Stderr + "\n" + create.Stdout, 900));

            // Wait briefly for sshd
            await Task.Delay(2500, ct).ConfigureAwait(false);
            var sshReady = await WaitForLocalPortAsync(hostPort, ct, 60).ConfigureAwait(false);

            record.Ipv4 = "127.0.0.1";
            record.Status = sshReady ? "Running" : "Starting";
            if (!sshReady)
                record.LastError = "Instance created — SSH port not open yet; Refresh in a moment";

            var keyPath = TryFindSshPrivateKeyPath();
            var host = new MeshHostRecord
            {
                Id = $"localvps-{record.Id}",
                Alias = record.Notes ?? name,
                Provider = MeshProviderKind.Ssh,
                Hostname = "127.0.0.1",
                Port = hostPort,
                Username = "bndz",
                KeyPath = keyPath,
                AuthKind = string.IsNullOrWhiteSpace(keyPath) ? MeshAuthKind.Password : MeshAuthKind.PrivateKey,
                PasswordPlain = string.IsNullOrWhiteSpace(keyPath) ? "bndz" : null,
                ShowInNavTree = true,
                RemoteRootPath = "/config",
                Notes = $"local-vps:podman:{name}",
            };
            _orchestrator.UpsertHost(host);
            record.MeshHostId = host.Id;
            _db.UpsertIncusEphemeral(record);
            return record;
        }
        catch (Exception ex)
        {
            record.Status = "Error";
            record.LastError = ex.Message;
            _db.UpsertIncusEphemeral(record);
            try { Run(podman, $"rm -f {Quote(name)}", TimeSpan.FromSeconds(30)); } catch { /* ignore */ }
            throw;
        }
    }

    public async Task DestroyLocalAsync(string ephemeralId, CancellationToken ct = default)
    {
        var record = _db.GetIncusEphemeral(ephemeralId)
            ?? throw new InvalidOperationException("Local VPS not found");

        var podman = FindPodman();
        if (podman != null && !string.IsNullOrWhiteSpace(record.InstanceName))
        {
            await Task.Run(() =>
            {
                Run(podman, $"rm -f {Quote(record.InstanceName)}", TimeSpan.FromSeconds(60));
            }, ct).ConfigureAwait(false);
        }

        if (!string.IsNullOrWhiteSpace(record.MeshHostId))
        {
            try { _orchestrator.DeleteHost(record.MeshHostId!); }
            catch { /* ignore */ }
        }
        _db.DeleteIncusEphemeral(ephemeralId);
    }

    public async Task SetLocalActionAsync(string ephemeralId, string action, CancellationToken ct = default)
    {
        var record = _db.GetIncusEphemeral(ephemeralId)
            ?? throw new InvalidOperationException("Local VPS not found");
        if (string.IsNullOrWhiteSpace(record.InstanceName))
            throw new InvalidOperationException("Local VPS has no container name");

        var podman = FindPodman()
            ?? throw new InvalidOperationException("Podman is not installed or not on PATH");

        var cmd = action switch
        {
            "start" => $"start {Quote(record.InstanceName)}",
            "stop" => $"stop {Quote(record.InstanceName)}",
            "restart" => $"restart {Quote(record.InstanceName)}",
            _ => throw new InvalidOperationException($"Unsupported local VPS action: {action}"),
        };

        await Task.Run(() => Run(podman, cmd, TimeSpan.FromSeconds(90)), ct).ConfigureAwait(false);
    }

    public void EnsureVisible() => EnsureLocalEndpointRecord();

    private void EnsureLocalEndpointRecord()
    {
        var existing = _db.GetIncusEndpoint(LocalEndpointId);
        if (existing != null)
        {
            existing.Alias = LocalEndpointAlias;
            existing.ApiUrl = "https://127.0.0.1:8443";
            existing.Trusted = true;
            existing.AllowInsecureTls = true;
            existing.Notes = "BNDZ local temporary VPS factory (Podman)";
            existing.LastError = null;
            _db.UpsertIncusEndpoint(existing);
            return;
        }

        _db.UpsertIncusEndpoint(new IncusEndpointRecord
        {
            Id = LocalEndpointId,
            Alias = LocalEndpointAlias,
            ApiUrl = "https://127.0.0.1:8443",
            Trusted = true,
            AllowInsecureTls = true,
            DefaultImage = "lscr.io/linuxserver/openssh-server:latest",
            DefaultInstanceType = "container",
            DefaultSshUser = "bndz",
            DefaultSshPort = 22,
            Notes = "BNDZ local temporary VPS factory (Podman)",
        });
    }

    private static bool LooksLikeRunningMachine(string json)
    {
        if (string.IsNullOrWhiteSpace(json)) return false;
        // machine list json includes Running / Starting
        return json.Contains("\"Running\"", StringComparison.OrdinalIgnoreCase)
            || Regex.IsMatch(json, "\"Running\"\\s*:\\s*true", RegexOptions.IgnoreCase);
    }

    /// <summary>
    /// Shows a UAC elevation prompt and enables WSL + VirtualMachinePlatform.
    /// Returns true if the elevated process started (features may still need a reboot).
    /// </summary>
    private static bool TryEnableWslElevated()
    {
        try
        {
            const string script =
                "dism.exe /online /enable-feature /featurename:Microsoft-Windows-Subsystem-Linux /all /norestart; "
                + "dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart; "
                + "try { sc.exe config LxssManager start= auto } catch {}; "
                + "try { Start-Service LxssManager -ErrorAction SilentlyContinue } catch {}; "
                + "wsl.exe --update; "
                + "wsl.exe --install --no-distribution --web-download";
            var psi = new ProcessStartInfo
            {
                FileName = "powershell.exe",
                Arguments = "-NoProfile -ExecutionPolicy Bypass -Command \"" + script.Replace("\"", "\\\"", StringComparison.Ordinal) + "\"",
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            using var p = Process.Start(psi);
            if (p == null) return false;
            p.WaitForExit((int)TimeSpan.FromMinutes(8).TotalMilliseconds);
            return p.ExitCode == 0 || p.HasExited;
        }
        catch
        {
            // User cancelled UAC or elevation unavailable.
            return false;
        }
    }

    private static string? FindPodman()
    {
        var local = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Programs", "Podman", "podman.exe");
        if (File.Exists(local)) return local;

        var pf = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            "RedHat", "Podman", "podman.exe");
        if (File.Exists(pf)) return pf;

        var where = Run("where.exe", "podman", TimeSpan.FromSeconds(5));
        if (where.Exit == 0)
        {
            var line = where.Stdout.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .FirstOrDefault(l => l.EndsWith("podman.exe", StringComparison.OrdinalIgnoreCase));
            if (!string.IsNullOrWhiteSpace(line) && File.Exists(line)) return line;
        }
        return null;
    }

    private static (int Exit, string Stdout, string Stderr) Run(string file, string args, TimeSpan timeout)
    {
        var psi = new ProcessStartInfo
        {
            FileName = file,
            Arguments = args,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        using var p = Process.Start(psi) ?? throw new InvalidOperationException($"Failed to start {file}");
        var stdoutTask = p.StandardOutput.ReadToEndAsync();
        var stderrTask = p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit((int)timeout.TotalMilliseconds))
        {
            try { p.Kill(entireProcessTree: true); } catch { /* ignore */ }
            return (-1, "", "Timed out");
        }
        return (p.ExitCode, stdoutTask.GetAwaiter().GetResult(), stderrTask.GetAwaiter().GetResult());
    }

    private static string Quote(string value)
    {
        if (string.IsNullOrEmpty(value)) return "\"\"";
        if (!value.Contains(' ') && !value.Contains('"') && !value.Contains('\'')) return value;
        return "\"" + value.Replace("\"", "\\\"", StringComparison.Ordinal) + "\"";
    }

    private static int FindFreeTcpPort()
    {
        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        var port = ((IPEndPoint)listener.LocalEndpoint).Port;
        listener.Stop();
        return port;
    }

    private static async Task<bool> WaitForLocalPortAsync(int port, CancellationToken ct, int timeoutSec)
    {
        var deadline = DateTime.UtcNow.AddSeconds(timeoutSec);
        while (DateTime.UtcNow < deadline)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                using var client = new TcpClient();
                var connect = client.ConnectAsync(IPAddress.Loopback, port);
                var done = await Task.WhenAny(connect, Task.Delay(800, ct)).ConfigureAwait(false);
                if (done == connect && client.Connected) return true;
            }
            catch { /* retry */ }
            await Task.Delay(700, ct).ConfigureAwait(false);
        }
        return false;
    }

    private static string? TryFindSshPublicKey()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach (var name in new[] { "id_ed25519.pub", "id_rsa.pub", "id_ecdsa.pub" })
        {
            var path = Path.Combine(home, ".ssh", name);
            if (!File.Exists(path)) continue;
            try
            {
                var line = File.ReadAllLines(path)
                    .Select(l => l.Trim())
                    .FirstOrDefault(l => l.Length > 0 && !l.StartsWith('#'));
                if (!string.IsNullOrWhiteSpace(line)) return line;
            }
            catch { /* next */ }
        }
        return null;
    }

    private static string? TryFindSshPrivateKeyPath()
    {
        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        foreach (var name in new[] { "id_ed25519", "id_rsa", "id_ecdsa" })
        {
            var path = Path.Combine(home, ".ssh", name);
            if (File.Exists(path)) return path;
        }
        return null;
    }

    private static string Truncate(string s, int max) =>
        string.IsNullOrEmpty(s) ? "" : (s.Length <= max ? s : s[..max] + "…");
}
