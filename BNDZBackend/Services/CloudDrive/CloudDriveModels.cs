namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Phase B Cloud Drive records. Secrets never appear on the DTO sent to the UI.
/// States: creating | running | stopped | error | deleting.
/// </summary>
public sealed class CloudDriveRecord
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    /// <summary>cloud | local</summary>
    public string Placement { get; set; } = "";
    /// <summary>fly | local-microvm</summary>
    public string Provider { get; set; } = "";
    public string State { get; set; } = "stopped";
    public string? Message { get; set; }
    public int SizeGb { get; set; } = 20;
    public string? Region { get; set; }
    public string? DiskPath { get; set; }
    public string? VhdxPath { get; set; }
    public string? VmName { get; set; }
    public string? Hypervisor { get; set; }
    public string? Host { get; set; }
    public int Port { get; set; } = 22;
    public int SshPort { get; set; }
    public int FtpsPort { get; set; }
    public int WebDavPort { get; set; }
    public string User { get; set; } = "bndz";
    public string? FlyOrg { get; set; }
    public string? FlyApp { get; set; }
    public string? FlyMachineId { get; set; }
    public string? FlyVolumeId { get; set; }
    public string? KeyType { get; set; }
    public string? PublicKey { get; set; }
    public string? Fingerprint { get; set; }
    /// <summary>DPAPI blob, base64. Never copy onto the UI DTO.</summary>
    public string? ProtectedPrivateKey { get; set; }
    /// <summary>DPAPI blob for the per-drive FTPS/WebDAV password. Never copy onto the UI DTO.</summary>
    public string? ProtectedFtpPassword { get; set; }
    /// <summary>DPAPI blob for the Cloudflare Tunnel token. Local drives only. Never copy onto the UI DTO.</summary>
    public string? ProtectedTunnelToken { get; set; }
    public string? TunnelHostname { get; set; }
    public string? TunnelState { get; set; }
    public string? TunnelMessage { get; set; }
    public string? SshNote { get; set; }
    /// <summary>True after a Fly restore replaced the machine. The client key did not change.</summary>
    public bool HostKeyChanged { get; set; }
    public string? PreviousHost { get; set; }
    /// <summary>Volume left behind after a restore. Not a secret. It still bills until dropped.</summary>
    public string? PreviousFlyVolumeId { get; set; }
    public string? HostKeyNote { get; set; }
    /// <summary>Stable guest address on the local Hyper-V switch. Not a secret. Unused until a rootfs boots.</summary>
    public string? LocalGuestIp { get; set; }
    public List<CloudDriveSnapshot> Snapshots { get; set; } = new();
    public string CreatedUtc { get; set; } = "";
    public string UpdatedUtc { get; set; } = "";

    public CloudDriveDto ToDto()
    {
        CloudDrivePorts.Ensure(this);
        CloudDriveTunnel.ApplyStatus(this);
        var endpoints = CloudDriveProtocols.For(this);
        var ssh = endpoints.FirstOrDefault(e => e.Id == "ssh")?.CopyText ?? "";
        var local = string.Equals(Placement, "local", StringComparison.OrdinalIgnoreCase);
        return new CloudDriveDto
        {
            Id = Id,
            Name = Name,
            Placement = Placement,
            Provider = Provider,
            State = State,
            Message = CloudDriveSecrets.Redact(Message),
            SizeGb = SizeGb,
            Region = Region,
            DiskPath = DiskPath,
            VhdxPath = VhdxPath,
            VmName = VmName,
            Hypervisor = Hypervisor,
            Host = Host,
            Port = SshPort,
            SshPort = SshPort,
            FtpsPort = FtpsPort,
            WebDavPort = WebDavPort,
            User = string.IsNullOrWhiteSpace(User) ? "bndz" : User,
            FlyOrg = FlyOrg,
            FlyApp = FlyApp,
            FlyMachineId = FlyMachineId,
            FlyVolumeId = FlyVolumeId,
            KeyType = KeyType,
            PublicKey = PublicKey,
            Fingerprint = Fingerprint,
            SshCommand = ssh,
            SshNote = SshNote,
            Endpoints = endpoints,
            TunnelState = TunnelState,
            TunnelMessage = CloudDriveSecrets.Redact(TunnelMessage),
            TunnelTokenConfigured = !string.IsNullOrWhiteSpace(ProtectedTunnelToken),
            TunnelHostname = TunnelHostname,
            CloudflaredPresent = CloudDriveTunnel.FindCloudflared() != null,
            AwayGuide = local ? CloudDriveTunnel.Guide(this) : null,
            HostKeyChanged = HostKeyChanged,
            PreviousHost = PreviousHost,
            PreviousFlyVolumeId = PreviousFlyVolumeId,
            HostKeyNote = HostKeyNote,
            LocalGuestIp = LocalGuestIp,
            ShareUrl = CloudDriveProtocols.ShareUrl(this),
            MachineHost = CloudDriveProtocols.MachineHost(this),
            AddressGuide = CloudDriveProtocols.AddressGuide(this),
            Snapshots = Snapshots ?? new List<CloudDriveSnapshot>(),
            CreatedUtc = CreatedUtc,
            UpdatedUtc = UpdatedUtc,
        };
    }
}

public sealed class CloudDriveDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Placement { get; set; } = "";
    public string Provider { get; set; } = "";
    public string State { get; set; } = "";
    public string? Message { get; set; }
    public int SizeGb { get; set; }
    public string? Region { get; set; }
    public string? DiskPath { get; set; }
    public string? VhdxPath { get; set; }
    public string? VmName { get; set; }
    public string? Hypervisor { get; set; }
    public string? Host { get; set; }
    public int Port { get; set; }
    public int SshPort { get; set; }
    public int FtpsPort { get; set; }
    public int WebDavPort { get; set; }
    public string User { get; set; } = "bndz";
    public string? FlyOrg { get; set; }
    public string? FlyApp { get; set; }
    public string? FlyMachineId { get; set; }
    public string? FlyVolumeId { get; set; }
    public string? KeyType { get; set; }
    public string? PublicKey { get; set; }
    public string? Fingerprint { get; set; }
    public string SshCommand { get; set; } = "";
    public string? SshNote { get; set; }
    public List<CloudDriveEndpoint> Endpoints { get; set; } = new();
    public string? TunnelState { get; set; }
    public string? TunnelMessage { get; set; }
    public bool TunnelTokenConfigured { get; set; }
    public string? TunnelHostname { get; set; }
    public bool CloudflaredPresent { get; set; }
    public string? AwayGuide { get; set; }
    public bool HostKeyChanged { get; set; }
    public string? PreviousHost { get; set; }
    public string? PreviousFlyVolumeId { get; set; }
    public string? HostKeyNote { get; set; }
    /// <summary>Stable guest address on the local Hyper-V switch. Not a secret.</summary>
    public string? LocalGuestIp { get; set; }
    /// <summary>https://hostname/ people send. Empty until a hostname you control is saved.</summary>
    public string? ShareUrl { get; set; }
    /// <summary>Fly machine address or this-PC loopback. Not the link you send.</summary>
    public string? MachineHost { get; set; }
    public string? AddressGuide { get; set; }
    public List<CloudDriveSnapshot> Snapshots { get; set; } = new();
    public string CreatedUtc { get; set; } = "";
    public string UpdatedUtc { get; set; } = "";
}

public sealed class CloudDriveCreateRequest
{
    public string Name { get; set; } = "";
    public string Placement { get; set; } = "";
    public int SizeGb { get; set; } = 20;
    public string Region { get; set; } = "iad";
    public string DiskPath { get; set; } = "";
    public string? FlyToken { get; set; }
}

public sealed class CloudDriveProbe
{
    public bool TokenConfigured { get; set; }
    public bool TokenValid { get; set; }
    public string? OrgSlug { get; set; }
    public string? TokenMessage { get; set; }
    public bool HyperV { get; set; }
    public bool WslPresent { get; set; }
    public string? WslVersion { get; set; }
    public bool Elevated { get; set; }
    public bool CloudflaredPresent { get; set; }
    public string? CloudflaredMessage { get; set; }
    public bool RootfsPresent { get; set; }
    public string? RootfsPath { get; set; }
    public string? RootfsMessage { get; set; }
    public string Preferred { get; set; } = "none";
    public string Guidance { get; set; } = "";
}

public static class CloudDriveSsh
{
    public static string CommandFor(CloudDriveRecord drive)
    {
        CloudDrivePorts.Ensure(drive);
        var host = CloudDriveProtocols.PublicHost(drive);
        if (string.IsNullOrWhiteSpace(host)) return "";
        var user = string.IsNullOrWhiteSpace(drive.User) ? "bndz" : drive.User.Trim();
        return $"ssh -p {drive.SshPort} {user}@{host}";
    }
}
