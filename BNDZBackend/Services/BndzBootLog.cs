using System.Diagnostics;
using System.IO;

namespace BNDZ.Services;

/// <summary>
/// Cold-start marks in %LocalAppData%\BNDZ\boot.log (local time).
/// "+Nms" is measured from OS process start (not from the first mark), so runtime load / JIT
/// before App() is visible. Each process writes a "---- pid" header line first.
/// </summary>
public static class BndzBootLog
{
    private static readonly long T0 = Stopwatch.GetTimestamp();
    private static readonly double ProcessStartOffsetMs = ReadProcessStartOffsetMs();
    private static readonly object Gate = new();
    private static bool _headerWritten;

    private static double ReadProcessStartOffsetMs()
    {
        try
        {
            using var self = Process.GetCurrentProcess();
            var ms = (DateTime.Now - self.StartTime).TotalMilliseconds;
            return ms is > 0 and < 600_000 ? ms : 0;
        }
        catch
        {
            return 0;
        }
    }

    public static void Mark(string phase)
    {
        if (string.IsNullOrWhiteSpace(phase)) return;
        try
        {
            var ms = ProcessStartOffsetMs + Stopwatch.GetElapsedTime(T0).TotalMilliseconds;
            var line = $"{DateTime.Now:HH:mm:ss.fff} +{ms:0}ms {phase}{Environment.NewLine}";
            Debug.WriteLine("[BNDZ boot] " + line.TrimEnd());
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BNDZ");
            Directory.CreateDirectory(dir);
            lock (Gate)
            {
                if (!_headerWritten)
                {
                    _headerWritten = true;
                    line = $"---- pid {Environment.ProcessId} {Path.GetFileName(Environment.ProcessPath ?? "?")}{Environment.NewLine}" + line;
                }
                File.AppendAllText(Path.Combine(dir, "boot.log"), line);
            }
        }
        catch
        {
            /* logging must never block startup */
        }
    }
}
