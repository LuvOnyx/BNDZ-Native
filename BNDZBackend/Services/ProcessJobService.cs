using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using Meziantou.Framework.Win32;

namespace BNDZ.Services;

/// <summary>
/// Windows Job Objects — kill entire process trees (WinRAR / TeraCopy / scripts) on cancel/dispose.
/// </summary>
public static class ProcessJobService
{
    private static readonly ConcurrentDictionary<string, JobObject> Jobs = new(StringComparer.OrdinalIgnoreCase);

    public static bool TryAttach(string operationId, Process process)
    {
        if (string.IsNullOrEmpty(operationId) || process == null) return false;
        try
        {
            var job = Jobs.GetOrAdd(operationId, _ =>
            {
                var j = new JobObject($"BNDZ-{operationId}");
                j.SetLimits(new JobObjectLimits
                {
                    Flags = JobObjectLimitFlags.KillOnJobClose,
                });
                return j;
            });
            job.AssignProcess(process);
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ProcessJob] Attach failed: {ex.Message}");
            return false;
        }
    }

    public static void Terminate(string operationId)
    {
        if (string.IsNullOrEmpty(operationId)) return;
        if (!Jobs.TryRemove(operationId, out var job)) return;
        try
        {
            job.Terminate(1);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ProcessJob] Terminate failed: {ex.Message}");
        }
        finally
        {
            try { job.Dispose(); } catch { }
        }
    }

    public static void Release(string operationId)
    {
        if (string.IsNullOrEmpty(operationId)) return;
        if (!Jobs.TryRemove(operationId, out var job)) return;
        try { job.Dispose(); } catch { }
    }
}
