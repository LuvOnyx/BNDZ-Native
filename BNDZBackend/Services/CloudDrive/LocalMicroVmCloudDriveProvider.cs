using System.Diagnostics;
using System.Security.Principal;
using System.Text;
using Microsoft.Win32;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// This PC placement: a sealed disk slot on a user-picked volume, hosted by
/// Hyper-V when it can run, otherwise an honest WSL2 / missing-hypervisor report.
/// Not a shared folder and not Docker Desktop.
/// </summary>
public sealed class LocalMicroVmCloudDriveProvider : ICloudDriveProvider
{
    public string Id => "local-microvm";

    public CloudDriveProbe Probe()
    {
        var hyperV = HyperVInstalled();
        var (wslPresent, wslVersion) = ProbeWsl();
        var elevated = IsElevated();
        var rootfs = CloudDriveLocalRootfs.Describe();
        string preferred;
        string guidance;
        if (hyperV && elevated)
        {
            preferred = "hyper-v";
            guidance = rootfs.Present
                ? "Hyper-V is available and this process is elevated. Start boots the pinned Ubuntu rootfs. The sealed VHDX is the data disk and is not recreated."
                : rootfs.Message;
        }
        else if (hyperV)
        {
            preferred = "hyper-v";
            guidance = rootfs.Present
                ? "Hyper-V is installed. Start needs BNDZ running elevated. The pinned rootfs is on this PC. The sealed VHDX is the data disk and is not recreated."
                : "Hyper-V is installed. Start needs BNDZ running elevated. " + rootfs.Message;
        }
        else if (wslPresent && wslVersion == "2")
        {
            preferred = "none";
            guidance = "WSL2 is installed, and the rootfs fetch can use it to patch cloud-init. This PC Cloud Drives still boot in Hyper-V, not in WSL. Turn on Hyper-V. Docker is not used.";
        }
        else if (wslPresent)
        {
            preferred = "none";
            guidance = "WSL is present but not version 2. Turn on Hyper-V to boot a This PC Cloud Drive. Docker is not used.";
        }
        else
        {
            preferred = "none";
            guidance = "No Hyper-V layer was detected. Turn on the Windows Hyper-V feature. Cloud Drive does not use Docker Desktop.";
        }

        return new CloudDriveProbe
        {
            HyperV = hyperV,
            WslPresent = wslPresent,
            WslVersion = wslVersion,
            Elevated = elevated,
            RootfsPresent = rootfs.Present,
            RootfsPath = rootfs.Path,
            RootfsMessage = rootfs.Message,
            Preferred = preferred,
            Guidance = guidance,
        };
    }

    public Task CreateAsync(CloudDriveRecord drive, CloudDriveCreateRequest request, Func<string?> readFlyToken, CancellationToken ct)
    {
        var probe = Probe();
        drive.Hypervisor = probe.Preferred;
        var root = NormalizePath(request.DiskPath);
        var pathError = ValidateDiskPath(root);
        if (pathError != null)
        {
            drive.State = "error";
            drive.Message = pathError;
            return Task.CompletedTask;
        }

        var slot = Path.Combine(root, "BNDZ", "CloudDrives", drive.Id);
        Directory.CreateDirectory(slot);
        drive.DiskPath = slot;
        drive.VmName = "BNDZ-" + drive.Id;
        drive.VhdxPath = Path.Combine(slot, "disk.vhdx");
        WriteSlotNotes(drive);
        CloudDrivePorts.Ensure(drive);
        drive.Host = "127.0.0.1";
        drive.Port = drive.SshPort;
        drive.SshNote = CloudDriveProtocols.OperatorNote(drive);
        if (string.IsNullOrWhiteSpace(drive.LocalGuestIp))
            drive.LocalGuestIp = CloudDriveLocalRootfs.GuestIpFor(drive.Id);

        if (probe.HyperV && probe.Elevated)
        {
            var (ok, detail) = TryNewVhd(drive);
            if (!ok)
            {
                drive.State = "stopped";
                drive.Message = "Sealed folder is at " + slot + ". Hyper-V did not create the data VHDX. " + TrimDetail(detail);
                return Task.CompletedTask;
            }
            drive.State = "stopped";
            drive.Message = probe.RootfsPresent
                ? "Sealed data VHDX is on the drive you picked. Start boots the pinned Ubuntu rootfs and does not recreate that VHDX."
                : "Sealed data folder is at " + slot + ". " + probe.RootfsMessage;
            return Task.CompletedTask;
        }

        drive.State = "stopped";
        drive.Message = "Sealed disk folder is at " + slot + ". " + probe.Guidance;
        return Task.CompletedTask;
    }

    public Task StartAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct)
    {
        var probe = Probe();
        drive.Hypervisor = probe.Preferred;
        if (string.IsNullOrWhiteSpace(drive.DiskPath) || !Directory.Exists(drive.DiskPath))
        {
            drive.State = "error";
            drive.Message = "The sealed folder is missing. Create the drive again and pick a path on another volume.";
            return Task.CompletedTask;
        }

        if (!probe.HyperV)
        {
            drive.State = "error";
            drive.Message = probe.Guidance;
            drive.SshNote = drive.SshNote;
            return Task.CompletedTask;
        }
        if (!probe.Elevated)
        {
            drive.State = "error";
            drive.Message = "Hyper-V is installed, but BNDZ is not elevated. Approve the administrator prompt and Start again. The disk slot stays at " + drive.DiskPath + ".";
            return Task.CompletedTask;
        }

        if (!probe.RootfsPresent)
        {
            drive.State = "error";
            drive.Message = probe.RootfsMessage;
            drive.SshNote = CloudDriveProtocols.OperatorNote(drive);
            return Task.CompletedTask;
        }

        if (string.IsNullOrWhiteSpace(drive.LocalGuestIp))
            drive.LocalGuestIp = CloudDriveLocalRootfs.GuestIpFor(drive.Id);
        var password = CloudDriveSecrets.UnprotectFromBase64(drive.ProtectedFtpPassword);
        if (string.IsNullOrWhiteSpace(password))
        {
            drive.State = "error";
            drive.Message = "This drive has no sign-in password in Windows secure storage. Create it again on this PC.";
            return Task.CompletedTask;
        }
        if (string.IsNullOrWhiteSpace(drive.PublicKey))
        {
            drive.State = "error";
            drive.Message = "This drive has no SSH public key. Create it again on this PC.";
            return Task.CompletedTask;
        }

        var seedPath = Path.Combine(drive.DiskPath, "seed.iso");
        try
        {
            var panel = CloudDrivePanelAssets.Files()
                .Select(file => (Name: Path.GetFileName(file.GuestPath), Text: file.Text));
            CloudDriveLocalRootfs.WriteSeed(
                seedPath,
                drive.Id,
                drive.LocalGuestIp,
                drive.PublicKey,
                password,
                CloudDriveProtocols.PublicHostname(drive),
                panel);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            if (!File.Exists(seedPath))
            {
                drive.State = "error";
                drive.Message = "Could not write the cloud-init seed. " + TrimDetail(CloudDriveSecrets.Redact(ex.Message));
                return Task.CompletedTask;
            }
        }
        catch (Exception ex)
        {
            drive.State = "error";
            drive.Message = "Could not write the cloud-init seed. " + TrimDetail(CloudDriveSecrets.Redact(ex.Message));
            return Task.CompletedTask;
        }

        var (ok, detail) = TryStartVm(drive, probe.RootfsPath ?? "", seedPath);
        if (!ok)
        {
            TryClearPortProxy(drive);
            drive.State = "error";
            drive.Message = TrimDetail(detail);
            return Task.CompletedTask;
        }

        CloudDrivePorts.Ensure(drive);
        drive.Host = "127.0.0.1";
        drive.Port = drive.SshPort;
        drive.SshNote = CloudDriveProtocols.OperatorNote(drive);
        if (detail.Contains("STATE=Running", StringComparison.OrdinalIgnoreCase))
        {
            drive.State = "running";
            var panelUp = CloudDriveLocalRootfs.TcpOpen("127.0.0.1", drive.WebDavPort, 700);
            var sshUp = panelUp || CloudDriveLocalRootfs.TcpOpen("127.0.0.1", drive.SshPort, 700);
            var diskNote = detail.Contains("DATA_KEPT", StringComparison.Ordinal)
                ? " The existing data VHDX was kept."
                : detail.Contains("DATA_CREATED", StringComparison.Ordinal)
                    ? " A new data VHDX was created because the sealed folder did not have one."
                    : " The data VHDX was not recreated.";
            if (panelUp)
                drive.Message = "Hyper-V reports the VM running. The panel port on this PC accepted a connection." + diskNote;
            else if (sshUp)
                drive.Message = "Hyper-V reports the VM running. The SSH port on this PC accepted a connection." + diskNote;
            else
                drive.Message = "Hyper-V reports the VM running. The panel port is not accepting connections yet. First boot installs packages and can take several minutes." + diskNote;
        }
        else
        {
            TryClearPortProxy(drive);
            drive.State = "stopped";
            drive.Message = "Hyper-V accepted the VM record but it is not running. " + TrimDetail(detail);
        }
        return Task.CompletedTask;
    }

    public Task StopAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct)
    {
        var probe = Probe();
        var vhdxReady = !string.IsNullOrWhiteSpace(drive.VhdxPath) && File.Exists(drive.VhdxPath);
        if (!vhdxReady || !probe.HyperV)
        {
            drive.State = "stopped";
            drive.Message = string.IsNullOrWhiteSpace(drive.Message)
                ? "Drive is stopped. No Hyper-V VM is attached yet."
                : drive.Message;
            return Task.CompletedTask;
        }
        if (!probe.Elevated)
        {
            drive.State = "error";
            drive.Message = "Stopping the Hyper-V VM needs an elevated BNDZ session.";
            return Task.CompletedTask;
        }

        var (ok, detail) = RunHyperVScript(StopScript, VmEnv(drive));
        if (!ok && !detail.Contains("STATE=", StringComparison.Ordinal))
        {
            drive.State = "error";
            drive.Message = "Hyper-V could not stop the VM. " + TrimDetail(detail);
            return Task.CompletedTask;
        }
        drive.State = "stopped";
        TryDeleteSeed(drive);
        drive.Message = "VM stopped. Port publishing was removed. The sealed data VHDX is still at " + (drive.VhdxPath ?? drive.DiskPath) + ".";
        return Task.CompletedTask;
    }

    public Task DeleteAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct)
    {
        var probe = Probe();
        var vhdxReady = !string.IsNullOrWhiteSpace(drive.VhdxPath) && File.Exists(drive.VhdxPath);
        if (probe.HyperV && vhdxReady && !probe.Elevated)
            throw new InvalidOperationException("A sealed VHDX is on disk. Elevate BNDZ and delete again so Hyper-V can drop the VM before the folder is removed.");
        if (probe.HyperV && probe.Elevated && vhdxReady && !string.IsNullOrWhiteSpace(drive.VmName))
        {
            var (ok, detail) = RunHyperVScript(DeleteScript, VmEnv(drive));
            if (!ok)
                throw new InvalidOperationException("Hyper-V could not remove the VM, so the sealed folder was left in place. " + TrimDetail(detail));
        }
        else if (probe.HyperV && !probe.Elevated && !string.IsNullOrWhiteSpace(drive.VmName))
        {
            throw new InvalidOperationException("A Hyper-V VM may still be registered. Elevate BNDZ and delete again so the VM is removed before the folder.");
        }

        if (!string.IsNullOrWhiteSpace(drive.DiskPath) && Directory.Exists(drive.DiskPath))
        {
            var root = Path.GetFullPath(drive.DiskPath);
            if (!root.Contains(Path.DirectorySeparatorChar + "BNDZ" + Path.DirectorySeparatorChar + "CloudDrives" + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                throw new InvalidOperationException("Refusing to delete a folder that is not a BNDZ Cloud Drive slot.");
            Directory.Delete(root, recursive: true);
        }
        return Task.CompletedTask;
    }

    public Task RefreshAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct)
    {
        var probe = Probe();
        drive.Hypervisor = probe.Preferred;
        if (!probe.HyperV || !probe.Elevated || string.IsNullOrWhiteSpace(drive.VmName))
            return Task.CompletedTask;

        var (ok, detail) = RunHyperVScript(@"
$name = $env:BNDZ_VM_NAME
$vm = Get-VM -Name $name -ErrorAction SilentlyContinue
if (-not $vm) { Write-Output 'STATE=Missing'; exit 0 }
Write-Output ('STATE=' + $vm.State)
", VmEnv(drive));
        if (!ok) return Task.CompletedTask;
        if (detail.Contains("STATE=Running", StringComparison.OrdinalIgnoreCase))
        {
            drive.State = "running";
            CloudDrivePorts.Ensure(drive);
            var panelUp = CloudDriveLocalRootfs.TcpOpen("127.0.0.1", drive.WebDavPort, 400);
            drive.Message = panelUp
                ? "The panel port on this PC accepted a connection."
                : "VM is running. The panel port is not accepting connections yet. First boot installs packages and can take several minutes.";
            drive.SshNote = CloudDriveProtocols.OperatorNote(drive);
        }
        else if (detail.Contains("STATE=Off", StringComparison.OrdinalIgnoreCase)
                 || detail.Contains("STATE=Saved", StringComparison.OrdinalIgnoreCase)
                 || detail.Contains("STATE=Missing", StringComparison.OrdinalIgnoreCase))
            drive.State = drive.State == "error" ? drive.State : "stopped";
        return Task.CompletedTask;
    }

    public static string? ValidateDiskPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return "Pick a folder on a drive other than the system volume.";
        string full;
        try { full = Path.GetFullPath(path); }
        catch { return "That path is not a valid folder location."; }
        if (!Path.IsPathRooted(full))
            return "Enter a full path on another drive, for example D:\\BNDZ Drives.";

        string sysRoot;
        try { sysRoot = Path.GetPathRoot(Environment.SystemDirectory) ?? ""; }
        catch { sysRoot = ""; }
        var root = Path.GetPathRoot(full) ?? "";
        if (!string.IsNullOrEmpty(sysRoot)
            && string.Equals(root.TrimEnd('\\'), sysRoot.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase))
        {
            return "This PC placement keeps the sealed disk off the system volume (" + sysRoot + "). Pick a folder on D:, a USB drive, or another letter.";
        }
        var rootProbe = root.TrimEnd('\\');
        if (rootProbe.Length == 2 && rootProbe[1] == ':')
        {
            try
            {
                if (!Directory.Exists(rootProbe + "\\"))
                    return "Drive " + rootProbe + " is not available. Pick a connected volume.";
            }
            catch { /* ignore */ }
        }
        return null;
    }

    public static string NormalizePath(string? path)
    {
        var p = (path ?? "").Trim().Trim('"');
        if (p.Length == 2 && p[1] == ':') p += "\\";
        return p;
    }

    private static void WriteSlotNotes(CloudDriveRecord drive)
    {
        if (string.IsNullOrWhiteSpace(drive.DiskPath)) return;
        CloudDrivePorts.Ensure(drive);
        CloudDriveSlot.Write(drive.DiskPath, ManifestFrom(drive));
    }

    internal static CloudDriveSlotManifest ManifestFrom(CloudDriveRecord drive) => new()
    {
        Id = drive.Id,
        Name = drive.Name,
        Placement = "local",
        SizeGb = drive.SizeGb,
        VmName = drive.VmName,
        PublicKey = drive.PublicKey,
        Fingerprint = drive.Fingerprint,
        SshPort = drive.SshPort,
        FtpsPort = drive.FtpsPort,
        WebDavPort = drive.WebDavPort,
        User = string.IsNullOrWhiteSpace(drive.User) ? "bndz" : drive.User,
    };

    public Task<CloudDriveOp> CreateSnapshotAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct) =>
        Task.FromResult(LocalSnapshotUnsupported());

    public Task<CloudDriveOp> ListSnapshotsAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct) =>
        Task.FromResult(LocalSnapshotUnsupported());

    public Task<CloudDriveOp> RestoreSnapshotAsync(CloudDriveRecord drive, string snapshotId, Func<string?> readFlyToken, CancellationToken ct) =>
        Task.FromResult(LocalSnapshotUnsupported());

    public Task<CloudDriveOp> DropPreviousVolumeAsync(CloudDriveRecord drive, Func<string?> readFlyToken, CancellationToken ct) =>
        Task.FromResult(new CloudDriveOp(false, "Previous Fly volumes belong to Cloud placement. This PC drive moves by copying the sealed folder."));

    private static CloudDriveOp LocalSnapshotUnsupported() =>
        new(false, "Snapshots are for Cloud placement. On This PC, stop the drive and copy the sealed folder.");

    private static (bool ok, string detail) TryNewVhd(CloudDriveRecord drive)
    {
        if (string.IsNullOrWhiteSpace(drive.VhdxPath)) return (false, "No VHDX path.");
        var bytes = (long)Math.Clamp(drive.SizeGb, 1, 4096) * 1024L * 1024L * 1024L;
        return RunHyperVScript(@"
$ErrorActionPreference = 'Stop'
if (-not (Get-Command New-VHD -ErrorAction SilentlyContinue)) { Write-Error 'Hyper-V PowerShell module (New-VHD) is not available.'; exit 2 }
if (Test-Path -LiteralPath $env:BNDZ_VHD_PATH) { Write-Output 'VHD_EXISTS'; exit 0 }
New-VHD -Path $env:BNDZ_VHD_PATH -SizeBytes ([int64]$env:BNDZ_VHD_BYTES) -Dynamic | Out-Null
Write-Output 'VHD_OK'
", new Dictionary<string, string>
        {
            ["BNDZ_VHD_PATH"] = drive.VhdxPath,
            ["BNDZ_VHD_BYTES"] = bytes.ToString(),
        });
    }

    private static (bool ok, string detail) TryStartVm(CloudDriveRecord drive, string rootfsPath, string seedPath)
    {
        var vmDir = Path.Combine(drive.DiskPath ?? "", "vm");
        Directory.CreateDirectory(vmDir);
        var osPath = Path.Combine(drive.DiskPath ?? "", "os.vhdx");
        var bytes = (long)Math.Clamp(drive.SizeGb, 1, 4096) * 1024L * 1024L * 1024L;
        var env = VmEnv(drive);
        env["BNDZ_ROOTFS"] = rootfsPath;
        env["BNDZ_OS_VHD"] = osPath;
        env["BNDZ_DATA_VHD"] = drive.VhdxPath ?? "";
        env["BNDZ_SEED_ISO"] = seedPath;
        env["BNDZ_VM_DIR"] = vmDir;
        env["BNDZ_GUEST_IP"] = drive.LocalGuestIp ?? "";
        env["BNDZ_VHD_BYTES"] = bytes.ToString();
        return RunHyperVScript(StartScript, env, 180_000);
    }

    private static void TryClearPortProxy(CloudDriveRecord drive)
    {
        RunHyperVScript(ClearProxyScript, VmEnv(drive), 20_000);
    }

    private static void TryDeleteSeed(CloudDriveRecord drive)
    {
        if (string.IsNullOrWhiteSpace(drive.DiskPath)) return;
        try
        {
            var seed = Path.Combine(drive.DiskPath, "seed.iso");
            if (File.Exists(seed)) File.Delete(seed);
        }
        catch
        {
            /* The VM may still hold the DVD. Export skips seed.iso either way. */
        }
    }

    private const string ClearProxyScript = """
        $ErrorActionPreference = 'Continue'
        foreach ($p in @($env:BNDZ_SSH_PORT, $env:BNDZ_FTPS_PORT, $env:BNDZ_PANEL_PORT, $env:BNDZ_WEBDAV_PORT)) {
          if (-not $p) { continue }
          netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$p | Out-Null
        }
        Write-Output 'PROXY_CLEARED'
        """;

    private const string StopScript = """
        $ErrorActionPreference = 'Stop'
        foreach ($p in @($env:BNDZ_SSH_PORT, $env:BNDZ_FTPS_PORT, $env:BNDZ_PANEL_PORT, $env:BNDZ_WEBDAV_PORT)) {
          if (-not $p) { continue }
          netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$p | Out-Null
        }
        $name = $env:BNDZ_VM_NAME
        $vm = Get-VM -Name $name -ErrorAction SilentlyContinue
        if (-not $vm) { Write-Output 'STATE=Missing'; exit 0 }
        Stop-VM -Name $name -Force -TurnOff -ErrorAction SilentlyContinue
        $vm = Get-VM -Name $name
        Write-Output ('STATE=' + $vm.State)
        """;

    private const string DeleteScript = """
        $ErrorActionPreference = 'Continue'
        foreach ($p in @($env:BNDZ_SSH_PORT, $env:BNDZ_FTPS_PORT, $env:BNDZ_PANEL_PORT, $env:BNDZ_WEBDAV_PORT)) {
          if (-not $p) { continue }
          netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$p | Out-Null
        }
        $name = $env:BNDZ_VM_NAME
        $vm = Get-VM -Name $name -ErrorAction SilentlyContinue
        if ($vm) {
          Stop-VM -Name $name -Force -TurnOff -ErrorAction SilentlyContinue
          Remove-VM -Name $name -Force
        }
        Write-Output 'REMOVED'
        """;

    private const string StartScript = """
        $ErrorActionPreference = 'Stop'
        function Clear-BndzProxy {
          foreach ($p in @($env:BNDZ_SSH_PORT, $env:BNDZ_FTPS_PORT, $env:BNDZ_PANEL_PORT, $env:BNDZ_WEBDAV_PORT)) {
            if (-not $p) { continue }
            netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$p | Out-Null
          }
        }
        function Add-BndzProxy([string]$listen, [string]$dest) {
          netsh interface portproxy delete v4tov4 listenaddress=127.0.0.1 listenport=$listen | Out-Null
          netsh interface portproxy add v4tov4 listenaddress=127.0.0.1 listenport=$listen connectaddress=$env:BNDZ_GUEST_IP connectport=$dest | Out-Null
          if ($LASTEXITCODE -ne 0) { throw "portproxy failed for $listen" }
        }
        if (-not (Test-Path -LiteralPath $env:BNDZ_ROOTFS)) { Clear-BndzProxy; Write-Error 'ROOTFS_MISSING'; exit 2 }
        $data = $env:BNDZ_DATA_VHD
        if (Test-Path -LiteralPath $data) { Write-Output 'DATA_KEPT' }
        else {
          New-VHD -Path $data -SizeBytes ([int64]$env:BNDZ_VHD_BYTES) -Dynamic | Out-Null
          Write-Output 'DATA_CREATED'
        }
        $os = $env:BNDZ_OS_VHD
        if (Test-Path -LiteralPath $os) { Write-Output 'OS_KEPT' }
        else {
          New-VHD -Path $os -ParentPath $env:BNDZ_ROOTFS -Differencing | Out-Null
          Write-Output 'OS_CREATED'
        }
        $sw = Get-VMSwitch -Name 'BNDZ-CloudDrive' -ErrorAction SilentlyContinue
        if (-not $sw) { New-VMSwitch -Name 'BNDZ-CloudDrive' -SwitchType Internal | Out-Null }
        $alias = $null
        for ($try = 0; $try -lt 10 -and -not $alias; $try++) {
          $alias = Get-NetAdapter | Where-Object { $_.Name -like 'vEthernet (BNDZ-CloudDrive)*' } | Select-Object -First 1 -ExpandProperty Name
          if (-not $alias) { Start-Sleep -Milliseconds 400 }
        }
        if (-not $alias) { Clear-BndzProxy; throw 'Internal switch adapter was not found.' }
        $existingIp = Get-NetIPAddress -InterfaceAlias $alias -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -eq '172.30.8.1' }
        if (-not $existingIp) { New-NetIPAddress -InterfaceAlias $alias -IPAddress 172.30.8.1 -PrefixLength 24 | Out-Null }
        $nat = Get-NetNat -Name 'BNDZ-CloudDrive' -ErrorAction SilentlyContinue
        if (-not $nat) { New-NetNat -Name 'BNDZ-CloudDrive' -InternalIPInterfaceAddressPrefix '172.30.8.0/24' | Out-Null }
        Add-BndzProxy $env:BNDZ_SSH_PORT '22'
        Add-BndzProxy $env:BNDZ_FTPS_PORT '990'
        Add-BndzProxy $env:BNDZ_PANEL_PORT '8080'
        Add-BndzProxy $env:BNDZ_WEBDAV_PORT '8090'
        $name = $env:BNDZ_VM_NAME
        $vm = Get-VM -Name $name -ErrorAction SilentlyContinue
        if (-not $vm) {
          New-VM -Name $name -Generation 2 -MemoryStartupBytes 1GB -VHDPath $os -SwitchName 'BNDZ-CloudDrive' -Path $env:BNDZ_VM_DIR | Out-Null
          Add-VMHardDiskDrive -VMName $name -Path $data
          Add-VMDvdDrive -VMName $name -Path $env:BNDZ_SEED_ISO
          Set-VM -Name $name -AutomaticCheckpointsEnabled $false -CheckpointType Disabled
          $osDrive = Get-VMHardDiskDrive -VMName $name | Where-Object { $_.Path -eq $os } | Select-Object -First 1
          Set-VMFirmware -VMName $name -EnableSecureBoot Off -FirstBootDevice $osDrive
          Set-VMProcessor -VMName $name -Count 2
        } else {
          $attached = @(Get-VMHardDiskDrive -VMName $name)
          $hasOs = $false
          foreach ($disk in $attached) { if ($disk.Path -eq $os) { $hasOs = $true } }
          if ($vm.State -ne 'Off' -and -not $hasOs) {
            Stop-VM -Name $name -Force -TurnOff
            $vm = Get-VM -Name $name
          }
          if ($vm.State -eq 'Off') {
            foreach ($disk in @(Get-VMHardDiskDrive -VMName $name)) {
              if ($disk.Path -ne $os -and $disk.Path -ne $data) {
                Remove-VMHardDiskDrive -VMName $name -ControllerType $disk.ControllerType -ControllerNumber $disk.ControllerNumber -ControllerLocation $disk.ControllerLocation
              }
            }
            $now = @(Get-VMHardDiskDrive -VMName $name)
            $hasOs = $false
            $hasData = $false
            foreach ($disk in $now) {
              if ($disk.Path -eq $os) { $hasOs = $true }
              if ($disk.Path -eq $data) { $hasData = $true }
            }
            if (-not $hasOs) { Add-VMHardDiskDrive -VMName $name -Path $os }
            if (-not $hasData) { Add-VMHardDiskDrive -VMName $name -Path $data }
            $dvd = Get-VMDvdDrive -VMName $name | Select-Object -First 1
            if (-not $dvd) { Add-VMDvdDrive -VMName $name -Path $env:BNDZ_SEED_ISO }
            else { Set-VMDvdDrive -VMName $name -ControllerNumber $dvd.ControllerNumber -ControllerLocation $dvd.ControllerLocation -Path $env:BNDZ_SEED_ISO }
            Get-VMNetworkAdapter -VMName $name | Connect-VMNetworkAdapter -SwitchName 'BNDZ-CloudDrive'
            Set-VM -Name $name -AutomaticCheckpointsEnabled $false -CheckpointType Disabled
            $osDrive = Get-VMHardDiskDrive -VMName $name | Where-Object { $_.Path -eq $os } | Select-Object -First 1
            if (-not $osDrive) { Clear-BndzProxy; throw 'OS disk is not attached.' }
            Set-VMFirmware -VMName $name -EnableSecureBoot Off -FirstBootDevice $osDrive
            Set-VMProcessor -VMName $name -Count 2
          }
        }
        $vm = Get-VM -Name $name
        if ($vm.State -ne 'Running') { Start-VM -Name $name }
        Start-Sleep -Seconds 1
        $vm = Get-VM -Name $name
        Write-Output ('STATE=' + $vm.State)
        """;

    private static (bool ok, string detail) RunHyperVScript(string script, IReadOnlyDictionary<string, string>? env = null, int timeoutMs = 90_000)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        };
        if (env != null)
        {
            foreach (var pair in env) psi.Environment[pair.Key] = pair.Value;
        }
        psi.ArgumentList.Add("-NoProfile");
        psi.ArgumentList.Add("-NonInteractive");
        psi.ArgumentList.Add("-Command");
        psi.ArgumentList.Add(script);
        try
        {
            using var proc = Process.Start(psi);
            if (proc == null) return (false, "PowerShell did not start.");
            var stdoutTask = proc.StandardOutput.ReadToEndAsync();
            var stderrTask = proc.StandardError.ReadToEndAsync();
            if (!proc.WaitForExit(timeoutMs))
            {
                try { proc.Kill(entireProcessTree: true); } catch { /* best effort */ }
                return (false, "Hyper-V command timed out.");
            }
            var stdout = stdoutTask.GetAwaiter().GetResult();
            var stderr = stderrTask.GetAwaiter().GetResult();
            var detail = CloudDriveSecrets.Redact((stdout + "\n" + stderr).Trim());
            if (detail.Length > 500) detail = detail[..500];
            return (proc.ExitCode == 0, string.IsNullOrWhiteSpace(detail) ? "Hyper-V returned no details." : detail);
        }
        catch (Exception ex)
        {
            return (false, CloudDriveSecrets.Redact(ex.Message));
        }
    }

    private static Dictionary<string, string> VmEnv(CloudDriveRecord drive)
    {
        CloudDrivePorts.Ensure(drive);
        return new Dictionary<string, string>
        {
            ["BNDZ_VM_NAME"] = drive.VmName ?? "",
            ["BNDZ_SSH_PORT"] = drive.SshPort.ToString(),
            ["BNDZ_FTPS_PORT"] = drive.FtpsPort.ToString(),
            ["BNDZ_PANEL_PORT"] = drive.WebDavPort.ToString(),
            ["BNDZ_WEBDAV_PORT"] = (drive.WebDavPort + 1).ToString(),
        };
    }

    private static bool HyperVInstalled()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            using var vmms = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\vmms");
            if (vmms != null) return true;
            using var compute = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services\vmcompute");
            return compute != null;
        }
        catch { return false; }
    }

    private static (bool present, string? version) ProbeWsl()
    {
        if (!OperatingSystem.IsWindows()) return (false, null);
        string wsl;
        try { wsl = Path.Combine(Environment.SystemDirectory, "wsl.exe"); }
        catch { return (false, null); }
        if (!File.Exists(wsl)) return (false, null);

        var psi = new ProcessStartInfo
        {
            FileName = wsl,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.Unicode,
            StandardErrorEncoding = Encoding.Unicode,
        };
        psi.ArgumentList.Add("--status");
        try
        {
            using var proc = Process.Start(psi);
            if (proc == null) return (true, null);
            if (!proc.WaitForExit(4000))
            {
                try { proc.Kill(entireProcessTree: true); } catch { /* best effort */ }
                return (true, null);
            }
            var text = proc.StandardOutput.ReadToEnd() + "\n" + proc.StandardError.ReadToEnd();
            if (text.Contains("Default Version: 2", StringComparison.OrdinalIgnoreCase)
                || text.Contains("version 2", StringComparison.OrdinalIgnoreCase))
                return (true, "2");
            if (text.Contains("Default Version: 1", StringComparison.OrdinalIgnoreCase))
                return (true, "1");
            return (true, null);
        }
        catch
        {
            return (true, null);
        }
    }

    private static bool IsElevated()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            using var id = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch { return false; }
    }

    private static string TrimDetail(string detail)
    {
        var one = detail.Replace('\r', ' ').Replace('\n', ' ').Trim();
        return one.Length > 280 ? one[..280] : one;
    }
}
