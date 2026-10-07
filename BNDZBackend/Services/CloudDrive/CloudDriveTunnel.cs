using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Cloudflare Tunnel on the Windows host for This PC drives.
/// The token is passed as TUNNEL_TOKEN, never as a process argument and never logged.
/// This is not Cloudflare Containers and it is not the microVM.
/// </summary>
public static class CloudDriveTunnel
{
    private static readonly ConcurrentDictionary<string, Tracked> Live = new(StringComparer.Ordinal);

    public static string? FindCloudflared()
    {
        var names = OperatingSystem.IsWindows()
            ? new[] { "cloudflared.exe", "cloudflared" }
            : new[] { "cloudflared" };
        var path = Environment.GetEnvironmentVariable("PATH") ?? "";
        foreach (var dir in path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            foreach (var name in names)
            {
                try
                {
                    var full = Path.Combine(dir.Trim(), name);
                    if (File.Exists(full)) return full;
                }
                catch { /* skip bad PATH entries */ }
            }
        }

        if (!OperatingSystem.IsWindows()) return null;
        var roots = new[]
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        };
        foreach (var root in roots)
        {
            if (string.IsNullOrWhiteSpace(root)) continue;
            var candidate = Path.Combine(root, "cloudflared", "cloudflared.exe");
            if (File.Exists(candidate)) return candidate;
        }
        return null;
    }

    public static void ApplyStatus(CloudDriveRecord drive)
    {
        if (!IsLocal(drive))
        {
            drive.TunnelState = "cloud";
            drive.TunnelMessage = "Fly publishes this machine. Cloudflare Tunnel is the away path for This PC drives.";
            return;
        }

        if (Live.TryGetValue(drive.Id, out var tracked))
        {
            try
            {
                if (!tracked.Process.HasExited)
                {
                    drive.TunnelState = "running";
                    drive.TunnelMessage = "cloudflared is running for this drive. Public hostnames are configured in Cloudflare, aimed at this drive’s local origins.";
                    return;
                }
                drive.TunnelState = tracked.Process.ExitCode == 0 ? "stopped" : "error";
                drive.TunnelMessage = string.IsNullOrWhiteSpace(tracked.Tail)
                    ? "cloudflared exited."
                    : CloudDriveSecrets.Redact(tracked.Tail);
                return;
            }
            catch
            {
                drive.TunnelState = "error";
                drive.TunnelMessage = "cloudflared could not be queried.";
                return;
            }
        }

        if (string.IsNullOrWhiteSpace(drive.ProtectedTunnelToken))
        {
            drive.TunnelState = "token-needed";
            drive.TunnelMessage = "Paste a Cloudflare Tunnel token. BNDZ stores it with Windows DPAPI and does not show it again.";
            return;
        }

        if (FindCloudflared() == null)
        {
            drive.TunnelState = "missing-binary";
            drive.TunnelMessage = "cloudflared is not installed. Install the Cloudflare Tunnel client, then start away access. This is not Docker and not Cloudflare Containers.";
            return;
        }

        drive.TunnelState = "stopped";
        drive.TunnelMessage = "Token stored. Start away access to run cloudflared for this drive. BNDZ is not tracking a tunnel process right now.";
    }

    public static string Guide(CloudDriveRecord drive)
    {
        CloudDrivePorts.Ensure(drive);
        return "Cloudflare Tunnel publishes this PC drive. It is not Cloudflare Containers and it does not replace the disk. "
            + $"Point hostnames at ssh://127.0.0.1:{drive.SshPort} and http://127.0.0.1:{drive.WebDavPort}/ for the web panel. "
            + "Paste the install token. BNDZ passes it to cloudflared in the environment, not on the command line.";
    }

    public static (bool ok, string message) Start(CloudDriveRecord drive, string token)
    {
        if (!IsLocal(drive))
            return (false, "Cloudflare Tunnel is for This PC drives. Fly publishes the machine address itself.");

        var exe = FindCloudflared();
        if (exe == null)
        {
            drive.TunnelState = "missing-binary";
            drive.TunnelMessage = "cloudflared is not installed. Install the Cloudflare Tunnel client, then start away access.";
            return (false, drive.TunnelMessage);
        }

        Stop(drive.Id);
        Process proc;
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = exe,
                Arguments = "tunnel --no-autoupdate run",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardError = true,
                RedirectStandardOutput = true,
            };
            psi.Environment["TUNNEL_TOKEN"] = token;
            proc = Process.Start(psi) ?? throw new InvalidOperationException("cloudflared did not start.");
        }
        catch (Exception ex)
        {
            drive.TunnelState = "error";
            drive.TunnelMessage = "Could not start cloudflared. " + CloudDriveSecrets.Redact(ex.Message);
            return (false, drive.TunnelMessage);
        }

        var tracked = new Tracked(proc);
        Live[drive.Id] = tracked;
        Pump(proc.StandardOutput, tracked);
        Pump(proc.StandardError, tracked);
        try { proc.WaitForExit(500); } catch { /* still starting */ }
        try
        {
            if (proc.HasExited)
            {
                drive.TunnelState = "error";
                drive.TunnelMessage = string.IsNullOrWhiteSpace(tracked.Tail)
                    ? "cloudflared exited immediately. Check the tunnel token in Cloudflare."
                    : CloudDriveSecrets.Redact(tracked.Tail);
                return (false, drive.TunnelMessage);
            }
        }
        catch { /* process handle raced */ }

        drive.TunnelState = "running";
        drive.TunnelMessage = "cloudflared is running for this drive.";
        return (true, drive.TunnelMessage);
    }

    public static void Stop(string? driveId)
    {
        if (string.IsNullOrWhiteSpace(driveId)) return;
        if (!Live.TryRemove(driveId, out var tracked)) return;
        try
        {
            if (!tracked.Process.HasExited)
                tracked.Process.Kill(entireProcessTree: true);
        }
        catch { /* already gone */ }
        try { tracked.Process.Dispose(); } catch { /* ignore */ }
    }

    private static void Pump(StreamReader reader, Tracked tracked)
    {
        _ = Task.Run(() =>
        {
            try
            {
                string? line;
                while ((line = reader.ReadLine()) != null)
                {
                    var clean = CloudDriveSecrets.Redact(line).Replace('\r', ' ').Trim();
                    if (clean.Length > 240) clean = clean[..240];
                    lock (tracked)
                    {
                        tracked.Buffer.AppendLine(clean);
                        if (tracked.Buffer.Length > 1200)
                            tracked.Buffer.Remove(0, tracked.Buffer.Length - 1200);
                        tracked.Tail = tracked.Buffer.ToString().Trim();
                    }
                }
            }
            catch { /* process closed the pipe */ }
        });
    }

    private static bool IsLocal(CloudDriveRecord drive) =>
        string.Equals(drive.Placement, "local", StringComparison.OrdinalIgnoreCase);

    private sealed class Tracked
    {
        public Tracked(Process process) => Process = process;
        public Process Process { get; }
        public StringBuilder Buffer { get; } = new();
        public string Tail { get; set; } = "";
    }
}
