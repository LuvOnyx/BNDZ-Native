using System.Diagnostics;
using System.IO;

namespace BNDZ.Services;

/// <summary>Cold-start marks in %LocalAppData%\BNDZ\boot.log (local time).</summary>
public static class BndzBootLog
{
    private static readonly long T0 = Stopwatch.GetTimestamp();
    private static readonly object Gate = new();

    public static void Mark(string phase)
    {
        if (string.IsNullOrWhiteSpace(phase)) return;
        try
        {
            var ms = Stopwatch.GetElapsedTime(T0).TotalMilliseconds;
            var line = $"{DateTime.Now:HH:mm:ss.fff} +{ms:0}ms {phase}{Environment.NewLine}";
            Debug.WriteLine("[BNDZ boot] " + line.TrimEnd());
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BNDZ");
            Directory.CreateDirectory(dir);
            lock (Gate)
            {
                File.AppendAllText(Path.Combine(dir, "boot.log"), line);
            }
        }
        catch
        {
            /* logging must never block startup */
        }
    }
}
