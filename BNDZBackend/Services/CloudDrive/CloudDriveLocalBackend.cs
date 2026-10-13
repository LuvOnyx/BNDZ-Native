namespace BNDZ.Services.CloudDrive;

/// <summary>
/// Picks the local engine. Nothing here ever blocks a This PC drive:
/// Hyper-V (already on and elevated) → WSL2 (hypervisor already running) →
/// bundled QEMU with WHPX → bundled QEMU in compatibility mode (TCG, works everywhere).
/// No Windows feature has to be turned on. Faster mode is optional.
/// </summary>
public static class CloudDriveLocalBackend
{
    public const string HyperV = "hyper-v";
    public const string Wsl2 = "wsl2";
    public const string QemuWhpx = "qemu-whpx";
    public const string QemuTcg = "qemu-tcg";
    /// <summary>Kept for old saved probes. Choose never returns it.</summary>
    public const string None = "none";

    public sealed record HostCaps(bool HyperVInstalled, bool HypervisorPresent, bool Elevated, string? WslVersion, bool Whpx);

    public static string Choose(HostCaps c)
    {
        if (c.HyperVInstalled && c.HypervisorPresent && c.Elevated) return HyperV;
        if (c.HypervisorPresent && string.Equals(c.WslVersion, "2", StringComparison.Ordinal)) return Wsl2;
        if (c.Whpx) return QemuWhpx;
        return QemuTcg;
    }

    /// <summary>Old two-flag form. Without hypervisor details it never picks Hyper-V or WSL2 blindly.</summary>
    public static string Choose(bool hyperV, string? wslVersion) =>
        Choose(new HostCaps(hyperV, hyperV, true, wslVersion, false));

    public static bool IsQemu(string? backend) => backend is QemuWhpx or QemuTcg;
    public static bool Accelerated(string? backend) => backend is HyperV or Wsl2 or QemuWhpx;

    public static bool Available(bool hyperV, string? wslVersion) => true;

    /// <summary>A saved choice wins. Otherwise This PC, since it always works now.</summary>
    public static string DefaultPlacement(bool hyperV, string? wslVersion, string? lastChoice)
    {
        if (lastChoice is "cloud" or "local") return lastChoice;
        return "local";
    }

    public static string ModeLabel(string? backend) => Accelerated(backend) ? "Running accelerated" : "Running in compatibility mode";

    public static string Explain(string backend, bool elevated) => backend switch
    {
        HyperV => "Running accelerated with Hyper-V. The disk stays on the drive you pick.",
        Wsl2 => "Running accelerated with WSL2. The disk stays on the drive you pick.",
        QemuWhpx => "Running accelerated. Nothing to set up in Windows. The disk stays on the drive you pick.",
        _ => "Running in compatibility mode. Works on any PC with nothing to set up in Windows, just slower. The disk stays on the drive you pick.",
    };

    public const string FasterModeHowTo =
        "Optional. Faster mode turns on Windows Hypervisor Platform and Virtual Machine Platform. Windows asks for administrator approval and needs a restart. Your drives work either way, and the same disk is used after the restart.";

    /// <summary>Old name kept for the probe field; it now describes the optional faster mode.</summary>
    public const string EnableHowTo = FasterModeHowTo;

    public const string FasterModeCommand =
        "Enable-WindowsOptionalFeature -Online -NoRestart -FeatureName HypervisorPlatform -All; Enable-WindowsOptionalFeature -Online -NoRestart -FeatureName VirtualMachinePlatform -All";
}
