namespace BNDZ.Services.Mesh.Incus;

/// <summary>Remote Incus HTTPS endpoint used to launch ephemeral VPS-like instances for Mesh.</summary>
public sealed class IncusEndpointRecord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..12];
    public string Alias { get; set; } = "Incus";
    /// <summary>Base API URL, e.g. https://incus.example:8443</summary>
    public string ApiUrl { get; set; } = "";
    public string? ServerFingerprint { get; set; }
    public string? Project { get; set; } = "default";
    public string DefaultImage { get; set; } = "ubuntu/24.04/cloud";
    public string DefaultImageServer { get; set; } = "https://images.linuxcontainers.org";
    public string DefaultInstanceType { get; set; } = "container";
    public string DefaultSshUser { get; set; } = "ubuntu";
    public int DefaultSshPort { get; set; } = 22;
    public string? DefaultSshKeyPath { get; set; }
    public bool AllowInsecureTls { get; set; }
    public string? Notes { get; set; }
    public string? LastError { get; set; }
    public DateTime? LastSeenUtc { get; set; }
    public bool Trusted { get; set; }
    /// <summary>One-shot trust token (DPAPI-protected after save). Never returned to UI after upsert.</summary>
    public string? TrustTokenPlain { get; set; }
    public byte[]? ProtectedTrustToken { get; set; }
}

public sealed class IncusEphemeralInstanceRecord
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N")[..12];
    public string EndpointId { get; set; } = "";
    public string InstanceName { get; set; } = "";
    public string Status { get; set; } = "Unknown";
    public string? Ipv4 { get; set; }
    public string? Ipv6 { get; set; }
    public string? MeshHostId { get; set; }
    public string ImageAlias { get; set; } = "";
    public string InstanceType { get; set; } = "container";
    public bool Ephemeral { get; set; } = true;
    public DateTime CreatedUtc { get; set; } = DateTime.UtcNow;
    public string? LastError { get; set; }
    public string? Notes { get; set; }
}

public sealed class IncusLaunchRequest
{
    public string EndpointId { get; set; } = "";
    public string? Name { get; set; }
    public string? ImageAlias { get; set; }
    public string? ImageServer { get; set; }
    public string? InstanceType { get; set; }
    public bool Ephemeral { get; set; } = true;
    public bool Start { get; set; } = true;
    public bool RegisterMeshHost { get; set; } = true;
    public string? SshUser { get; set; }
    public int? SshPort { get; set; }
    public string? SshKeyPath { get; set; }
    public string? Alias { get; set; }
    /// <summary>Seconds to wait for a global IPv4 after start.</summary>
    public int WaitIpSeconds { get; set; } = 90;
}

public sealed class IncusServerInfo
{
    public string ApiVersion { get; set; } = "";
    public string? Auth { get; set; }
    public bool Trusted { get; set; }
    public string? EnvironmentServerName { get; set; }
    public string? Fingerprint { get; set; }
}

public sealed class IncusImageAlias
{
    public string Name { get; set; } = "";
    public string? Description { get; set; }
    public string? Target { get; set; }
    public string? Type { get; set; }
}

public sealed class IncusInstanceSummary
{
    public string Name { get; set; } = "";
    public string Status { get; set; } = "";
    public string Type { get; set; } = "";
    public bool Ephemeral { get; set; }
    public string? Project { get; set; }
}
