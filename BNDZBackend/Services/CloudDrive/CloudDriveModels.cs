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
    public string? SshNote { get; set; }
    public string CreatedUtc { get; set; } = "";
    public string UpdatedUtc { get; set; } = "";

    public CloudDriveDto ToDto() => new()
    {
        Id = Id,
        Name = Name,
        Placement = Placement,
        Provider = Provider,
        State = State,
        Message = Message,
        SizeGb = SizeGb,
        Region = Region,
        DiskPath = DiskPath,
        VhdxPath = VhdxPath,
        VmName = VmName,
        Hypervisor = Hypervisor,
        Host = Host,
        Port = Port <= 0 ? 22 : Port,
        User = string.IsNullOrWhiteSpace(User) ? "bndz" : User,
        FlyOrg = FlyOrg,
        FlyApp = FlyApp,
        FlyMachineId = FlyMachineId,
        FlyVolumeId = FlyVolumeId,
        KeyType = KeyType,
        PublicKey = PublicKey,
        Fingerprint = Fingerprint,
        SshCommand = CloudDriveSsh.CommandFor(this),
        SshNote = SshNote,
        CreatedUtc = CreatedUtc,
        UpdatedUtc = UpdatedUtc,
    };
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
    public string Preferred { get; set; } = "none";
    public string Guidance { get; set; } = "";
}

public static class CloudDriveSsh
{
    public static string CommandFor(CloudDriveRecord drive)
    {
        var host = string.IsNullOrWhiteSpace(drive.Host)
            ? (string.Equals(drive.Placement, "local", StringComparison.OrdinalIgnoreCase) ? "127.0.0.1" : "pending-host")
            : drive.Host.Trim();
        var port = drive.Port <= 0 ? 22 : drive.Port;
        var user = string.IsNullOrWhiteSpace(drive.User) ? "bndz" : drive.User.Trim();
        return $"ssh -p {port} {user}@{host}";
    }
}
