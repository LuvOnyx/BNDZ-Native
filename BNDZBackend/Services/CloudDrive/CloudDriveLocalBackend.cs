namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Picks the local VM backend. Hyper-V when it is installed, otherwise WSL2.
/// A missing backend never becomes a raw error in the create flow.
/// </summary>
public static class CloudDriveLocalBackend
{
    public const string HyperV = "hyper-v";
    public const string Wsl2 = "wsl2";
    public const string None = "none";

    public static string Choose(bool hyperV, string? wslVersion)
    {
        if (hyperV) return HyperV;
        if (string.Equals(wslVersion, "2", StringComparison.Ordinal)) return Wsl2;
        return None;
    }

    public static bool Available(bool hyperV, string? wslVersion) => Choose(hyperV, wslVersion) != None;

    /// <summary>
    /// A saved choice wins, including when that backend is off, so This PC stays selectable.
    /// With no saved choice, Cloud is preselected only when this PC cannot run a local VM.
    /// </summary>
    public static string DefaultPlacement(bool hyperV, string? wslVersion, string? lastChoice)
    {
        if (lastChoice is "cloud" or "local") return lastChoice;
        return Available(hyperV, wslVersion) ? "local" : "cloud";
    }

    public static string Explain(string backend, bool elevated)
    {
        if (backend == HyperV && elevated)
            return "This PC will boot the drive in Hyper-V. The disk stays on the folder you pick.";
        if (backend == HyperV)
            return "Hyper-V is installed. Windows asks for administrator approval when the drive starts. The disk stays on the folder you pick.";
        if (backend == Wsl2)
            return "Hyper-V is off. This PC will run the drive with WSL2. The disk stays on the folder you pick.";
        return "Hyper-V and WSL2 are off, so the VM cannot start yet. You can still put the disk on a drive you pick. Enable Hyper-V, then start the drive.";
    }

    public const string EnableHowTo =
        "Turn on Hyper-V, then restart Windows. From an administrator PowerShell: Enable-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V -All";
}
