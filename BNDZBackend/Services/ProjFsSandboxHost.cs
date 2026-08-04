using System.Diagnostics;
using System.Runtime.InteropServices;

namespace BNDZ.Services;

/// <summary>
/// ProjFS sandbox host (Impl B). Attempts to start a virtualization root when
/// Client-ProjFS is available; otherwise no-ops and the journal/shadow Commit path applies.
/// Full provider callbacks require Microsoft.Windows.ProjFS — detected at runtime via LoadLibrary.
/// </summary>
public static class ProjFsSandboxHost
{
    private static readonly Dictionary<string, string> ActiveRoots = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object Gate = new();

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr LoadLibrary(string lpFileName);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool FreeLibrary(IntPtr hModule);

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
    /// Prepare a ProjFS-compatible overlay root under the session shadow directory.
    /// When ProjFS DLL is missing, returns false and caller uses journal-only sandbox.
    /// </summary>
    public static bool TryStartSession(string sessionId, string liveRoot, string virtualRoot)
    {
        if (string.IsNullOrWhiteSpace(sessionId) || string.IsNullOrWhiteSpace(virtualRoot))
            return false;
        if (!IsProjFsAvailable())
        {
            Debug.WriteLine("[ProjFS] ProjectedFSLib.dll not available — using journal/shadow Commit.");
            return false;
        }

        try
        {
            Directory.CreateDirectory(virtualRoot);
            // Mark session as ProjFS-capable. Full VirtualizationInstance wiring needs the
            // Microsoft.Windows.ProjFS managed package; we persist the mapping so Commit/Discard
            // know to merge via transfer queue from this overlay root.
            var marker = Path.Combine(virtualRoot, ".bndz-projfs");
            File.WriteAllText(marker, $"live={liveRoot}\nsession={sessionId}\n");
            lock (Gate) ActiveRoots[sessionId] = virtualRoot;
            Debug.WriteLine($"[ProjFS] Overlay root ready for session {sessionId}: {virtualRoot}");
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ProjFS] TryStartSession failed: {ex.Message}");
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

    public static string? GetOverlayRoot(string sessionId)
    {
        lock (Gate) return ActiveRoots.TryGetValue(sessionId, out var r) ? r : null;
    }
}
