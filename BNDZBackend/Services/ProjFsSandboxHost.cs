using System.Diagnostics;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>
/// Overlay marker helper for Project Sandbox sessions.
/// Does NOT mount a ProjFS VirtualizationInstance or OS-visible volume.
/// When ProjectedFSLib.dll is present we still only create a shadow overlay
/// directory + .bndz-projfs marker so Commit/Discard can merge via the transfer queue.
/// Real ProjFS/WinFsp volume mounting is not shipped — journal/shadow is the product path.
/// </summary>
public static class ProjFsSandboxHost
{
    private static readonly Dictionary<string, string> ActiveRoots = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object Gate = new();

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibrary(string lpFileName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr hModule);

    /// <summary>True when ProjectedFSLib.dll can be loaded (capability probe only).</summary>
    public static bool IsProjFsAvailable()
    {
        try
        {
            var h = LoadLibrary("ProjectedFSLib.dll");
            if (h == IntPtr.Zero) return false;
            FreeLibrary(h);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Prepare a shadow overlay directory under the session root and write a marker file.
    /// Returns true when the overlay dir is ready — not when an OS volume is mounted.
    /// </summary>
    public static bool TryStartSession(string sessionId, string liveRoot, string virtualRoot)
    {
        if (string.IsNullOrWhiteSpace(sessionId) || string.IsNullOrWhiteSpace(virtualRoot))
            return false;

        try
        {
            Directory.CreateDirectory(virtualRoot);
            var marker = Path.Combine(virtualRoot, ".bndz-projfs");
            var mode = IsProjFsAvailable() ? "journal+marker" : "journal";
            File.WriteAllText(marker, $"live={liveRoot}\nsession={sessionId}\nmode={mode}\n");
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
        lock (Gate)
        {
            if (ActiveRoots.TryGetValue(sessionId, out var root))
            {
                ActiveRoots.Remove(sessionId);
                try
                {
                    var marker = Path.Combine(root, ".bndz-projfs");
                    if (File.Exists(marker)) File.Delete(marker);
                }
                catch { /* ignore */ }
            }
        }
    }

    public static bool IsSessionActive(string sessionId)
    {
        lock (Gate) return ActiveRoots.ContainsKey(sessionId);
    }
}
