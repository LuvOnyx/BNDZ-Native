using System.Diagnostics;
using System.Net.Http;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// No-admin local engine. Runs upstream QEMU for Windows as a separate process
/// (never linked) with WHPX when Windows Hypervisor Platform is on, else TCG.
/// User-mode networking with hostfwd, so no TAP, vSwitch or administrator rights.
/// </summary>
public static class CloudDriveQemu
{
    public sealed record Artifact(string Name, string Url, string Sha256, long Size);

    // Pinned first-use downloads. All are fetched from their upstream publishers.
    public static readonly Artifact SevenZipR = new(
        "7zr.exe", "https://www.7-zip.org/a/7zr.exe",
        "256feca8e274e5da655e2a284fabafd9f554365eb164862089dacd4e8276d282", 602_624);
    public static readonly Artifact SevenZip = new(
        "7z2301-x64.exe", "https://www.7-zip.org/a/7z2301-x64.exe",
        "26cb6e9f56333682122fafe79dbcdfd51e9f47cc7217dccd29ac6fc33b5598cd", 1_589_510);
    public static readonly Artifact QemuSetup = new(
        "qemu-w64-setup-20260811.exe", "https://qemu.weilnetz.de/w64/2026/qemu-w64-setup-20260811.exe",
        "f98a8aeb5f7faea9765b6dee28316c266cd179d80354a2fed8e50176f9a2e59f", 206_615_928);
    public static readonly Artifact GuestImage = new(
        "generic_alpine-3.24.1-x86_64-bios-cloudinit-r0.qcow2",
        "https://dl-cdn.alpinelinux.org/alpine/v3.24/releases/cloud/generic_alpine-3.24.1-x86_64-bios-cloudinit-r0.qcow2",
        "6e2e6fe0572b6632527f268d3659e8fccebda4e1ee470fafe2c4d7b85b6a4df6", 183_697_408);

    public static IReadOnlyList<Artifact> Artifacts => new[] { SevenZipR, SevenZip, QemuSetup, GuestImage };

    /// <summary>Files kept from the QEMU installer. The rest of it is never extracted.</summary>
    public static readonly string[] QemuKeep =
    {
        "qemu-system-x86_64.exe", "qemu-img.exe", "*.dll", "COPYING", "COPYING.LIB",
        "share/bios-256k.bin", "share/kvmvapic.bin", "share/linuxboot_dma.bin",
        "share/vgabios-stdvga.bin", "share/efi-virtio.rom", "share/pxe-virtio.rom",
    };

    public const int GuestPanelPort = 8080;
    public const int GuestSshPort = 22;
    public const string DataLabel = "BNDZDATA";

    /// <summary>Runtime folder on the volume the user picked, so C: is never filled.</summary>
    public static string RuntimeDir(string volumeRoot) => Path.Combine(volumeRoot, "BNDZ", "CloudDrives", ".runtime");

    public static string QemuDir(string runtime) => Path.Combine(runtime, "qemu");
    public static string QemuExe(string runtime) => Path.Combine(QemuDir(runtime), "qemu-system-x86_64.exe");
    public static string QemuImg(string runtime) => Path.Combine(QemuDir(runtime), "qemu-img.exe");
    public static string BaseImage(string runtime) => Path.Combine(runtime, "images", GuestImage.Name);

    public static bool RuntimeReady(string runtime) =>
        File.Exists(QemuExe(runtime)) && File.Exists(QemuImg(runtime)) && File.Exists(BaseImage(runtime));

    // ---------- accelerator ----------

    /// <summary>WHPX needs the hypervisor running and WinHvPlatform.dll (HypervisorPlatform feature).</summary>
    public static bool WhpxLikely(bool hypervisorPresent, Func<string, bool>? exists = null)
    {
        exists ??= File.Exists;
        var sys = Environment.GetFolderPath(Environment.SpecialFolder.System);
        if (string.IsNullOrEmpty(sys)) sys = @"C:\Windows\System32";
        return hypervisorPresent && exists(Path.Combine(sys, "WinHvPlatform.dll"));
    }

    public static string AccelLabel(bool whpx) => whpx ? "whpx" : "tcg";

    // ---------- command line ----------

    public sealed record LaunchSpec(
        string Name, string SystemDisk, string DataDisk, string SeedIso,
        int PanelPort, int SshPort, int QmpPort, string ConsoleLog, string PidFile,
        bool Whpx, int MemoryMb = 512, int Cpus = 2);

    public static string DiskFormat(string path) =>
        Path.GetExtension(path).ToLowerInvariant() switch
        {
            ".vhdx" => "vhdx",
            ".vhd" => "vpc",
            ".qcow2" => "qcow2",
            _ => "raw",
        };

    public static IReadOnlyList<string> BuildArgs(LaunchSpec s)
    {
        var a = new List<string> { "-name", s.Name, "-machine", "pc" };
        // QEMU tries each -accel in order, so a WHPX failure still boots under TCG.
        if (s.Whpx) { a.Add("-accel"); a.Add("whpx,kernel-irqchip=off"); }
        a.Add("-accel"); a.Add("tcg,thread=multi");
        a.AddRange(new[] { "-cpu", s.Whpx ? "qemu64" : "max", "-smp", s.Cpus.ToString(), "-m", s.MemoryMb.ToString() });
        a.AddRange(new[] { "-drive", "file=" + Q(s.SystemDisk) + ",if=virtio,format=" + DiskFormat(s.SystemDisk) + ",cache=writeback" });
        a.AddRange(new[] { "-drive", "file=" + Q(s.DataDisk) + ",if=virtio,format=" + DiskFormat(s.DataDisk) + ",cache=writeback" });
        a.AddRange(new[] { "-drive", "file=" + Q(s.SeedIso) + ",media=cdrom,readonly=on" });
        a.AddRange(new[]
        {
            "-netdev", "user,id=n0,hostfwd=tcp:127.0.0.1:" + s.PanelPort + "-:" + GuestPanelPort + ",hostfwd=tcp:127.0.0.1:" + s.SshPort + "-:" + GuestSshPort,
            "-device", "virtio-net-pci,netdev=n0",
            "-display", "none", "-vga", "none",
            "-serial", "file:" + s.ConsoleLog,
            "-qmp", "tcp:127.0.0.1:" + s.QmpPort + ",server=on,wait=off",
            "-pidfile", s.PidFile,
        });
        return a;
    }

    /// <summary>QEMU -drive values escape commas by doubling them.</summary>
    private static string Q(string path) => path.Replace(",", ",,");

    // ---------- guest seed (Alpine, OpenRC) ----------

    public static string BootstrapScript() => @"#!/bin/sh
# BNDZ data disk. Formats only a blank disk, so a disk made by another engine is kept.
mkdir -p /data /opt/bndz/panel
dev=$(blkid | grep 'LABEL=""BNDZDATA""' | cut -d: -f1 | head -n1)
if [ -z ""$dev"" ]; then
  for d in /dev/vdb /dev/sdb; do
    [ -b ""$d"" ] || continue
    if [ -z ""$(blkid ""$d"")"" ]; then
      command -v mkfs.ext4 >/dev/null 2>&1 || apk add --no-cache e2fsprogs
      mkfs.ext4 -F -q -L BNDZDATA ""$d"" && dev=""$d""
    fi
    break
  done
fi
grep -q 'LABEL=BNDZDATA' /etc/fstab || echo 'LABEL=BNDZDATA /data ext4 defaults,nofail 0 2' >> /etc/fstab
mountpoint -q /data || mount /data || true
seed=$(blkid | grep -i 'LABEL=""cidata""' | cut -d: -f1 | head -n1)
if [ -n ""$seed"" ]; then
  mkdir -p /run/bndz-seed
  mount -o ro ""$seed"" /run/bndz-seed 2>/dev/null || true
  for f in server.py index.html app.js app.css qrcodegen.py; do
    [ -f ""/run/bndz-seed/$f"" ] && cp ""/run/bndz-seed/$f"" /opt/bndz/panel/""$f""
  done
  umount /run/bndz-seed 2>/dev/null || true
fi
";

    public static string PanelInit() => @"#!/sbin/openrc-run
name=""bndz-panel""
description=""BNDZ Cloud Drive panel""
command=""/usr/bin/python3""
command_args=""/opt/bndz/panel/server.py""
command_background=true
pidfile=""/run/bndz-panel.pid""
directory=""/opt/bndz/panel""
output_log=""/var/log/bndz-panel.log""
error_log=""/var/log/bndz-panel.log""
depend() { need net localmount; after sshd; }
start_pre() { /bin/sh /usr/local/sbin/bndz-bootstrap.sh; }
";

    public static string PanelConf(string password, string? publicHost, string? pathPrefix, string? originSecret)
    {
        if (string.IsNullOrWhiteSpace(password) || password.Any(c => c is '\'' or '\n' or '\r'))
            throw new InvalidOperationException("Drive password is not usable in the guest config.");
        var sb = new StringBuilder();
        sb.Append("export BNDZ_PANEL_USER='bndz'\n");
        sb.Append("export BNDZ_FTP_PASSWORD='").Append(password).Append("'\n");
        sb.Append("export BNDZ_PANEL_PORT='").Append(GuestPanelPort).Append("'\n");
        var host = (publicHost ?? "").Trim();
        if (host.Length > 0 && host.All(c => char.IsAsciiLetterOrDigit(c) || c is '.' or '-'))
            sb.Append("export BNDZ_PUBLIC_HOST='").Append(host).Append("'\n");
        var prefix = (pathPrefix ?? "").Trim();
        if (prefix.Length > 1 && prefix.StartsWith('/') && prefix.IndexOf('/', 1) < 0 && prefix.All(c => c == '/' || char.IsAsciiLetterOrDigit(c) || c == '-'))
            sb.Append("export BNDZ_PATH_PREFIX='").Append(prefix).Append("'\nexport BNDZ_ROUTE_GUARD='1'\n");
        var secret = (originSecret ?? "").Trim();
        if (secret.Length is >= 16 and <= 128 && secret.All(char.IsAsciiLetterOrDigit))
            sb.Append("export BNDZ_ORIGIN_SECRET='").Append(secret).Append("'\n");
        return sb.ToString();
    }

    public static string UserData(string? publicKey, string password, string? publicHost, string? pathPrefix = null, string? originSecret = null)
    {
        var key = (publicKey ?? "").Trim().Replace("\r", "").Replace("\n", "");
        var sb = new StringBuilder();
        sb.Append("#cloud-config\nhostname: bndz\n");
        sb.Append("users:\n  - name: bndz\n    shell: /bin/sh\n    lock_passwd: true\n");
        if (key.Length > 0)
            sb.Append("    ssh_authorized_keys:\n      - \"").Append(key.Replace("\\", "\\\\").Replace("\"", "\\\"")).Append("\"\n");
        sb.Append("ssh_pwauth: false\n");
        sb.Append("write_files:\n");
        Literal(sb, "/usr/local/sbin/bndz-bootstrap.sh", "0755", BootstrapScript());
        Literal(sb, "/etc/init.d/bndz-panel", "0755", PanelInit());
        Literal(sb, "/etc/conf.d/bndz-panel", "0600", PanelConf(password, publicHost, pathPrefix, originSecret));
        sb.Append("runcmd:\n  - [rc-update, add, bndz-panel, default]\n  - [rc-service, bndz-panel, start]\n");
        return sb.ToString();
    }

    private static void Literal(StringBuilder sb, string path, string mode, string body)
    {
        sb.Append("  - path: ").Append(path).Append("\n    permissions: '").Append(mode).Append("'\n    content: |\n");
        foreach (var line in body.Replace("\r", "").TrimEnd('\n').Split('\n'))
            sb.Append("      ").Append(line).Append('\n');
    }

    public static void WriteSeed(string path, string id, string? publicKey, string password, string? publicHost,
        IEnumerable<(string GuestPath, string Text)> panelFiles, string? pathPrefix = null, string? originSecret = null)
    {
        var files = new List<(string Name, byte[] Data)>
        {
            ("user-data", Encoding.UTF8.GetBytes(UserData(publicKey, password, publicHost, pathPrefix, originSecret))),
            ("meta-data", Encoding.UTF8.GetBytes("instance-id: bndz-" + id + "\nlocal-hostname: bndz\n")),
        };
        foreach (var f in panelFiles)
        {
            var name = Path.GetFileName((f.GuestPath ?? "").Replace('\\', '/'));
            if (name.Length > 0) files.Add((name, Encoding.UTF8.GetBytes(f.Text ?? "")));
        }
        CloudDriveSeedIso.Write(path, files);
    }

    // ---------- first-use download ----------

    public sealed record Progress(string Name, long Done, long Total);

    /// <summary>Resumable (HTTP Range into .part), SHA256-checked download. Returns the final path.</summary>
    public static async Task<string> FetchAsync(Artifact art, string dir, IProgress<Progress>? progress, CancellationToken ct, HttpClient? http = null)
    {
        Directory.CreateDirectory(dir);
        var final = Path.Combine(dir, art.Name);
        if (File.Exists(final) && string.Equals(await Sha256Async(final, ct), art.Sha256, StringComparison.OrdinalIgnoreCase))
        {
            progress?.Report(new Progress(art.Name, art.Size, art.Size));
            return final;
        }
        var part = final + ".part";
        var client = http ?? new HttpClient { Timeout = TimeSpan.FromMinutes(30) };
        try
        {
            for (var attempt = 0; attempt < 4; attempt++)
            {
                long have = File.Exists(part) ? new FileInfo(part).Length : 0;
                if (have > art.Size) { File.Delete(part); have = 0; }
                if (have < art.Size)
                {
                    try
                    {
                        using var req = new HttpRequestMessage(HttpMethod.Get, art.Url);
                        if (have > 0) req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(have, null);
                        using var resp = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
                        resp.EnsureSuccessStatusCode();
                        if (have > 0 && resp.StatusCode != System.Net.HttpStatusCode.PartialContent) have = 0;
                        await using var src = await resp.Content.ReadAsStreamAsync(ct);
                        await using var dst = new FileStream(part, have > 0 ? FileMode.Append : FileMode.Create, FileAccess.Write, FileShare.None, 1 << 20);
                        var buf = new byte[1 << 20];
                        int n;
                        var last = DateTime.UtcNow;
                        while ((n = await src.ReadAsync(buf, ct)) > 0)
                        {
                            await dst.WriteAsync(buf.AsMemory(0, n), ct);
                            have += n;
                            if ((DateTime.UtcNow - last).TotalMilliseconds > 250) { progress?.Report(new Progress(art.Name, have, art.Size)); last = DateTime.UtcNow; }
                        }
                    }
                    catch (Exception) when (!ct.IsCancellationRequested && attempt < 3)
                    {
                        await Task.Delay(1500 * (attempt + 1), ct);
                        continue;
                    }
                }
                var hash = await Sha256Async(part, ct);
                if (string.Equals(hash, art.Sha256, StringComparison.OrdinalIgnoreCase))
                {
                    File.Move(part, final, overwrite: true);
                    progress?.Report(new Progress(art.Name, art.Size, art.Size));
                    return final;
                }
                File.Delete(part);
            }
            throw new InvalidOperationException(art.Name + " did not match its pinned SHA256 after several tries.");
        }
        finally
        {
            if (http == null) client.Dispose();
        }
    }

    public static async Task<string> Sha256Async(string path, CancellationToken ct)
    {
        await using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read, 1 << 20);
        var hash = await SHA256.HashDataAsync(fs, ct);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    /// <summary>
    /// Downloads and unpacks QEMU and the guest image into the runtime folder on the chosen volume.
    /// 7zr unpacks 7-Zip, 7-Zip unpacks only the files QEMU needs from the upstream installer.
    /// </summary>
    public static async Task EnsureRuntimeAsync(string runtime, IProgress<Progress>? progress, CancellationToken ct)
    {
        var dl = Path.Combine(runtime, "downloads");
        Directory.CreateDirectory(dl);
        if (!File.Exists(BaseImage(runtime)))
        {
            var img = await FetchAsync(GuestImage, dl, progress, ct);
            Directory.CreateDirectory(Path.GetDirectoryName(BaseImage(runtime))!);
            File.Move(img, BaseImage(runtime), overwrite: true);
        }
        if (File.Exists(QemuExe(runtime)) && File.Exists(QemuImg(runtime))) return;

        var zr = await FetchAsync(SevenZipR, dl, progress, ct);
        var z = await FetchAsync(SevenZip, dl, progress, ct);
        var setup = await FetchAsync(QemuSetup, dl, progress, ct);
        var sevenDir = Path.Combine(runtime, "7z");
        Directory.CreateDirectory(sevenDir);
        Run(zr, new[] { "x", "-y", "-o" + sevenDir, z, "7z.exe", "7z.dll", "License.txt" }, 120_000);
        var tmp = QemuDir(runtime) + ".partial";
        if (Directory.Exists(tmp)) Directory.Delete(tmp, true);
        var args = new List<string> { "x", "-y", "-o" + tmp, setup };
        args.AddRange(QemuKeep.Select(k => k.Replace('/', '\\')));
        Run(Path.Combine(sevenDir, "7z.exe"), args, 600_000);
        if (!File.Exists(Path.Combine(tmp, "qemu-system-x86_64.exe")))
            throw new InvalidOperationException("QEMU did not unpack from the pinned installer.");
        File.WriteAllText(Path.Combine(tmp, "SOURCE.txt"), SourceOffer);
        if (Directory.Exists(QemuDir(runtime))) Directory.Delete(QemuDir(runtime), true);
        Directory.Move(tmp, QemuDir(runtime));
        // The installer is no longer needed once unpacked.
        TryDelete(setup);
    }

    public const string SourceOffer =
        "QEMU is free software under the GNU GPL v2 (see COPYING; some parts LGPL, see COPYING.LIB).\n" +
        "BNDZ runs it as a separate program and does not link to it. These binaries were unpacked from\n" +
        "the upstream Windows build " + "qemu-w64-setup-20260811.exe" + " by Stefan Weil (https://qemu.weilnetz.de/).\n" +
        "Corresponding source: https://qemu.weilnetz.de/w64/2026/ (build sources) and https://www.qemu.org/download/#source\n" +
        "BNDZ will also provide the corresponding source on request for three years; contact the BNDZ team.\n";

    public static (int code, string output) Run(string exe, IEnumerable<string> args, int timeoutMs)
    {
        var psi = new ProcessStartInfo(exe) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi) ?? throw new InvalidOperationException("Could not start " + Path.GetFileName(exe));
        var so = p.StandardOutput.ReadToEndAsync();
        var se = p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit(timeoutMs)) { try { p.Kill(true); } catch { } throw new TimeoutException(Path.GetFileName(exe) + " timed out."); }
        var outText = so.Result + se.Result;
        if (p.ExitCode != 0) throw new InvalidOperationException(Path.GetFileName(exe) + " failed (" + p.ExitCode + "): " + outText.Trim());
        return (p.ExitCode, outText);
    }

    // ---------- disks ----------

    /// <summary>Per-drive copy-on-write system disk over the pinned base image.</summary>
    public static void EnsureSystemDisk(string runtime, string path)
    {
        if (File.Exists(path)) return;
        Run(QemuImg(runtime), new[] { "create", "-q", "-f", "qcow2", "-F", "qcow2", "-b", BaseImage(runtime), path }, 60_000);
    }

    /// <summary>
    /// Data disk as dynamic VHDX: QEMU (vhdx driver), Hyper-V and WSL2 (wsl --mount --vhd) all open it,
    /// so a drive made in compatibility mode moves to a faster engine later. Never recreated.
    /// </summary>
    public static void EnsureDataDisk(string runtime, string path, int sizeGb)
    {
        if (File.Exists(path)) return;
        Run(QemuImg(runtime), new[] { "create", "-q", "-f", DiskFormat(path), "-o", DiskFormat(path) == "vhdx" ? "subformat=dynamic" : "preallocation=off", path, sizeGb + "G" }, 60_000);
    }

    // ---------- process control ----------

    public static int FreePort()
    {
        var l = new TcpListener(System.Net.IPAddress.Loopback, 0);
        l.Start();
        var port = ((System.Net.IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    public static Process Launch(string runtime, LaunchSpec spec)
    {
        var psi = new ProcessStartInfo(QemuExe(runtime))
        {
            UseShellExecute = false, CreateNoWindow = true,
            WorkingDirectory = QemuDir(runtime),
            RedirectStandardError = true, RedirectStandardOutput = true,
        };
        psi.ArgumentList.Add("-L"); psi.ArgumentList.Add(Path.Combine(QemuDir(runtime), "share"));
        foreach (var a in BuildArgs(spec)) psi.ArgumentList.Add(a);
        var p = Process.Start(psi) ?? throw new InvalidOperationException("QEMU did not start.");
        p.OutputDataReceived += (_, e) => { if (e.Data != null) AppendLog(spec.ConsoleLog + ".qemu.txt", e.Data); };
        p.ErrorDataReceived += (_, e) => { if (e.Data != null) AppendLog(spec.ConsoleLog + ".qemu.txt", e.Data); };
        p.BeginOutputReadLine();
        p.BeginErrorReadLine();
        return p;
    }

    private static void AppendLog(string path, string line)
    {
        try { File.AppendAllText(path, line + Environment.NewLine); } catch { }
    }

    /// <summary>ACPI power button over QMP, then quit if the guest is still up.</summary>
    public static async Task<bool> StopAsync(int qmpPort, int pid, TimeSpan grace, CancellationToken ct)
    {
        try
        {
            await QmpAsync(qmpPort, "system_powerdown", ct);
        }
        catch { }
        var until = DateTime.UtcNow + grace;
        while (DateTime.UtcNow < until)
        {
            if (!Alive(pid)) return true;
            await Task.Delay(500, ct);
        }
        try { await QmpAsync(qmpPort, "quit", ct); } catch { }
        await Task.Delay(1500, ct);
        if (Alive(pid)) { try { Process.GetProcessById(pid).Kill(true); } catch { } }
        return false;
    }

    public static bool Alive(int pid)
    {
        if (pid <= 0) return false;
        try { using var p = Process.GetProcessById(pid); return !p.HasExited && p.ProcessName.StartsWith("qemu", StringComparison.OrdinalIgnoreCase); }
        catch { return false; }
    }

    private static async Task QmpAsync(int port, string command, CancellationToken ct)
    {
        using var c = new TcpClient();
        await c.ConnectAsync(System.Net.IPAddress.Loopback, port, ct);
        await using var s = c.GetStream();
        var r = new StreamReader(s);
        var w = new StreamWriter(s) { AutoFlush = true, NewLine = "\n" };
        await r.ReadLineAsync(ct);
        await w.WriteLineAsync("{\"execute\":\"qmp_capabilities\"}");
        await r.ReadLineAsync(ct);
        await w.WriteLineAsync("{\"execute\":\"" + command + "\"}");
        await r.ReadLineAsync(ct);
    }

    private static void TryDelete(string path)
    {
        try { File.Delete(path); } catch { }
    }
}
