using System.Diagnostics;
using System.Runtime.InteropServices;
using BNDZ.Services.RamStaging;

namespace BNDZ.Services;

/// <summary>
/// Project Sandbox volume host.
/// Mount priority: ImDisk RAM zone (full drive letter) → SUBST drive letter via DefineDosDevice
/// (no driver required) → shadow overlay directory (plain folder, always works).
/// Full ProjFS VirtualizationInstance is not required for the product path.
/// </summary>
public static class ProjFsSandboxHost
{
    private static readonly Dictionary<string, string> ActiveRoots = new(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string, string> ActiveZoneIds = new(StringComparer.OrdinalIgnoreCase);
    private static readonly Dictionary<string, char> ActiveSubstDrives = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object Gate = new();
    private static RamStagingService? _ram;

    public static void BindRamStaging(RamStagingService? ram) => _ram = ram;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibrary(string lpFileName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr hModule);

    /// <summary>
    /// DefineDosDevice maps a drive letter to a directory — the same mechanism SUBST uses.
    /// Flags: DDD_RAW_TARGET_PATH=0x1 not needed; we pass the \??\-prefixed UNC path.
    /// To remove: call with DDD_REMOVE_DEFINITION (0x2) | DDD_EXACT_MATCH_ON_REMOVE (0x4).
    /// </summary>
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool DefineDosDevice(uint dwFlags, string lpDeviceName, string? lpTargetPath);

    private const uint DDD_REMOVE_DEFINITION = 0x2;
    private const uint DDD_EXACT_MATCH_ON_REMOVE = 0x4;
    private const uint DDD_NO_BROADCAST_SYSTEM = 0x8;

    public static bool IsProjFsAvailable()
    {
        try
        {
            var h = LoadLibrary("ProjectedFSLib.dll");
            if (h == IntPtr.Zero) return false;
            FreeLibrary(h);
            return true;
        }
        catch { return false; }
    }

    /// <summary>
    /// Find a free drive letter from Z down to P that can be used for SUBST.
    /// Skips letters already in use by drives or previous BNDZ sessions.
    /// </summary>
    private static char? FindFreeSubstDrive()
    {
        var usedBySystem = DriveInfo.GetDrives()
            .Select(d => char.ToUpperInvariant(d.Name[0]))
            .ToHashSet();
        lock (Gate)
        {
            foreach (var kv in ActiveSubstDrives)
                usedBySystem.Add(kv.Value);
        }
        for (var c = 'Z'; c >= 'P'; c--)
        {
            if (!usedBySystem.Contains(c)) return c;
        }
        return null;
    }

    /// <summary>
    /// Attempt to SUBST a drive letter to <paramref name="dir"/> using DefineDosDevice.
    /// Returns the drive root path (e.g. "Z:\") on success, or null on failure.
    /// </summary>
    private static string? TrySubstMount(string dir, string sessionId)
    {
        var letter = FindFreeSubstDrive();
        if (letter == null) return null;
        var deviceName = $"{letter}:";
        // DefineDosDevice target must be \??\ prefixed (NT namespace) when not using DDD_RAW_TARGET_PATH.
        var target = $@"\??\{dir.TrimEnd('\\', '/')}";
        try
        {
            if (!DefineDosDevice(DDD_NO_BROADCAST_SYSTEM, deviceName, target))
            {
                Debug.WriteLine($"[Sandbox] DefineDosDevice failed: {Marshal.GetLastWin32Error()}");
                return null;
            }
            var root = $@"{deviceName}\";
            lock (Gate) ActiveSubstDrives[sessionId] = letter.Value;
            Debug.WriteLine($"[Sandbox] SUBST drive {deviceName} → {dir}");
            return root;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sandbox] SUBST mount error: {ex.Message}");
            return null;
        }
    }

    private static void TrySubstUnmount(string sessionId)
    {
        char letter;
        lock (Gate)
        {
            if (!ActiveSubstDrives.TryGetValue(sessionId, out letter)) return;
            ActiveSubstDrives.Remove(sessionId);
        }
        try
        {
            DefineDosDevice(DDD_REMOVE_DEFINITION | DDD_EXACT_MATCH_ON_REMOVE | DDD_NO_BROADCAST_SYSTEM,
                $"{letter}:", null);
            Debug.WriteLine($"[Sandbox] SUBST removed {letter}:");
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sandbox] SUBST remove error: {ex.Message}");
        }
    }

    public static bool TryStartSession(string sessionId, string liveRoot, string virtualRoot)
    {
        if (string.IsNullOrWhiteSpace(sessionId) || string.IsNullOrWhiteSpace(virtualRoot))
            return false;

        try
        {
            // 1) Prefer OS-visible ImDisk RAM volume when staging is available.
            if (_ram != null && _ram.ImDiskAvailable)
            {
                try
                {
                    var zone = _ram.CreateZoneAsync($"sandbox-{sessionId[..Math.Min(8, sessionId.Length)]}", 2048, preferRam: true)
                        .GetAwaiter().GetResult();
                    if (!string.IsNullOrWhiteSpace(zone.MountPath) && Directory.Exists(zone.MountPath))
                    {
                        var marker = Path.Combine(zone.MountPath, ".bndz-projfs");
                        File.WriteAllText(marker, $"live={liveRoot}\nsession={sessionId}\nmode=imdisk\nmount={zone.MountPath}\n");
                        lock (Gate)
                        {
                            ActiveRoots[sessionId] = zone.MountPath;
                            ActiveZoneIds[sessionId] = zone.Id;
                        }
                        Debug.WriteLine($"[Sandbox] ImDisk volume ready: {zone.MountPath}");
                        return true;
                    }
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"[Sandbox] ImDisk mount failed, trying SUBST: {ex.Message}");
                }
            }

            // 2) SUBST via DefineDosDevice — no driver required, gives DAWs/editors a real drive letter.
            Directory.CreateDirectory(virtualRoot);
            var substRoot = TrySubstMount(virtualRoot, sessionId);
            if (substRoot != null)
            {
                var marker = Path.Combine(virtualRoot, ".bndz-projfs");
                File.WriteAllText(marker, $"live={liveRoot}\nsession={sessionId}\nmode=subst\nmount={substRoot}\n");
                lock (Gate) ActiveRoots[sessionId] = substRoot;
                Debug.WriteLine($"[Sandbox] SUBST drive ready: {substRoot}");
                return true;
            }

            // 3) Plain shadow overlay directory (always works, no drive letter).
            var overlayMarker = Path.Combine(virtualRoot, ".bndz-projfs");
            var mode = IsProjFsAvailable() ? "journal+marker" : "journal";
            File.WriteAllText(overlayMarker, $"live={liveRoot}\nsession={sessionId}\nmode={mode}\n");
            lock (Gate) ActiveRoots[sessionId] = virtualRoot;
            Debug.WriteLine($"[Sandbox] Shadow overlay ready ({mode}) for session {sessionId}: {virtualRoot}");
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[Sandbox] TryStartSession failed: {ex.Message}");
            return false;
        }
    }

    public static void StopSession(string sessionId)
    {
        string? zoneId = null;
        string? substDir = null;
        lock (Gate)
        {
            if (ActiveZoneIds.TryGetValue(sessionId, out zoneId))
                ActiveZoneIds.Remove(sessionId);
            if (ActiveRoots.TryGetValue(sessionId, out var root))
            {
                ActiveRoots.Remove(sessionId);
                substDir = root;
                try
                {
                    // Delete marker from the real directory (not the drive root).
                    var markerDir = root.Length == 3 && root[1] == ':' ? root : root;
                    var marker = Path.Combine(markerDir, ".bndz-projfs");
                    if (File.Exists(marker)) File.Delete(marker);
                }
                catch { /* ignore */ }
            }
        }
        TrySubstUnmount(sessionId);
        if (!string.IsNullOrEmpty(zoneId) && _ram != null)
        {
            try { _ram.DeleteZoneAsync(zoneId, flushFirst: false).GetAwaiter().GetResult(); }
            catch (Exception ex) { Debug.WriteLine($"[Sandbox] DeleteZone: {ex.Message}"); }
        }
    }

    public static string? GetMountPath(string sessionId)
    {
        lock (Gate) return ActiveRoots.TryGetValue(sessionId, out var r) ? r : null;
    }
}
