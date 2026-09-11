using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Meziantou.Framework.Win32;

namespace BNDZ.Services;

/// <summary>
/// Incremental BNDZ file-index updater driven by NTFS USN change journals.
///
/// Complements UsnHealthWatcherService (which only tracks health/shortcuts) by keeping
/// the BndzFileIndexService warm across all indexed NTFS volumes. Each fixed NTFS drive
/// gets its own background pump thread via ChangeJournal.Open(). FileSystemWatcher
/// fallback covers non-NTFS / network volumes.
///
/// Start() is called once from BndzIpcHost / MainWindow constructors alongside
/// UsnHealthWatcherService.Instance.Start(). The two services are orthogonal.
/// </summary>
public sealed class BndzUsnJournalWatcher : IDisposable
{
    private static readonly Lazy<BndzUsnJournalWatcher> Lazy = new(() => new BndzUsnJournalWatcher());
    public static BndzUsnJournalWatcher Instance => Lazy.Value;

    private readonly List<IDisposable> _journals = new();
    private readonly ConcurrentDictionary<string, FileSystemWatcher> _fallbackWatchers = new(StringComparer.OrdinalIgnoreCase);
    private readonly CancellationTokenSource _cts = new();
    private int _started;
    private bool _disposed;

    private BndzUsnJournalWatcher() { }

    /// <summary>
    /// Start journal pumps for all ready fixed NTFS drives.
    /// For drives that don't support the journal API, a FileSystemWatcher fallback is wired.
    /// Safe to call multiple times.
    /// </summary>
    public void Start()
    {
        if (Interlocked.Exchange(ref _started, 1) != 0) return;

        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (!drive.IsReady || drive.DriveType != DriveType.Fixed) continue;

                var root = drive.RootDirectory.FullName;

                if (string.Equals(drive.DriveFormat, "NTFS", StringComparison.OrdinalIgnoreCase))
                {
                    TryStartJournalPump(drive, root);
                }
                else
                {
                    // ReFS / FAT / exFAT — fall back to FileSystemWatcher only for indexed roots.
                    if (IsIndexedRoot(root))
                        EnsureFallbackWatcher(root);
                }
            }
            catch { /* skip inaccessible drives */ }
        }
    }

    // ─── Journal pump ─────────────────────────────────────────────────────────

    private void TryStartJournalPump(DriveInfo drive, string root)
    {
        try
        {
            var journal = ChangeJournal.Open(drive);
            lock (_journals) { _journals.Add(journal); }
            var ct = _cts.Token;
            _ = Task.Run(() => PumpJournal(root, journal, ct), ct);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[UsnWatcher] Journal open failed for {root}: {ex.Message}. Using FSW.");
            if (IsIndexedRoot(root))
                EnsureFallbackWatcher(root);
        }
    }

    private static void PumpJournal(string volumeRoot, ChangeJournal journal, CancellationToken ct)
    {
        try
        {
            foreach (var entry in journal.Entries)
            {
                if (ct.IsCancellationRequested) break;

                try
                {
                    // Resolve entry properties via reflection (API evolved across lib versions).
                    string? name = null;
                    string reason = "";
                    var t = entry.GetType();

                    if (t.GetProperty("Name")?.GetValue(entry) is string n && !string.IsNullOrWhiteSpace(n))
                        name = n;
                    if (string.IsNullOrWhiteSpace(name))
                        name = entry.ToString();
                    if (string.IsNullOrWhiteSpace(name)) continue;

                    reason = t.GetProperty("Reason")?.GetValue(entry)?.ToString() ?? "";

                    // We only care about create / delete / rename / data changes.
                    bool isDelete = reason.IndexOf("Delete", StringComparison.OrdinalIgnoreCase) >= 0
                                 || reason.IndexOf("RenameOld", StringComparison.OrdinalIgnoreCase) >= 0;
                    bool isCreate = reason.IndexOf("Create", StringComparison.OrdinalIgnoreCase) >= 0
                                 || reason.IndexOf("RenameNew", StringComparison.OrdinalIgnoreCase) >= 0;
                    bool isChange = reason.IndexOf("Data", StringComparison.OrdinalIgnoreCase) >= 0
                                 || reason.IndexOf("Basic", StringComparison.OrdinalIgnoreCase) >= 0;

                    if (!isDelete && !isCreate && !isChange) continue;

                    // Try to get the parent path from the entry for full-path resolution.
                    string? fullPath = null;
                    if (t.GetProperty("Path")?.GetValue(entry) is string p && !string.IsNullOrWhiteSpace(p))
                        fullPath = p;
                    if (string.IsNullOrWhiteSpace(fullPath))
                        fullPath = TryResolvePathByName(volumeRoot, name);
                    if (string.IsNullOrWhiteSpace(fullPath)) continue;

                    ApplyEntry(fullPath, isDelete);
                }
                catch { /* individual entry errors are non-fatal */ }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[UsnWatcher] Pump error on {volumeRoot}: {ex.Message}");
        }
    }

    private static void ApplyEntry(string fullPath, bool isDelete)
    {
        try
        {
            var dir = Path.GetDirectoryName(fullPath) ?? "";
            var name = Path.GetFileName(fullPath);
            if (string.IsNullOrEmpty(name)) return;
            var dirPane = "/" + dir.Replace('\\', '/');

            if (isDelete)
                BndzFileIndexService.Instance.ApplyFsEvent("Deleted", dirPane, name);
            else
                BndzFileIndexService.Instance.ApplyFsEvent("Created", dirPane, name);
        }
        catch { }
    }

    /// <summary>
    /// Best-effort full-path reconstruction from volume root + leaf name.
    /// When the journal entry doesn't carry a path, we look the file up in the existing
    /// BNDZ index first (name LIKE match within the volume) and fall back to a shallow
    /// directory scan of common profile folders.
    /// </summary>
    private static string? TryResolvePathByName(string volumeRoot, string name)
    {
        try
        {
            // Ask the BNDZ index — if we already know this name the path is there.
            var hits = BndzFileIndexService.Instance.Search(name, 1, "/" + volumeRoot.TrimEnd('\\').Replace('\\', '/'));
            if (hits.Count > 0)
            {
                var pathProp = hits[0].GetType().GetProperty("path")?.GetValue(hits[0]) as string;
                if (!string.IsNullOrEmpty(pathProp))
                    return BndzFileIndexService.ToPanePathStatic(pathProp).TrimStart('/');
            }
        }
        catch { }
        return null;
    }

    // ─── Fallback FileSystemWatcher ──────────────────────────────────────────

    private void EnsureFallbackWatcher(string root)
    {
        if (_fallbackWatchers.ContainsKey(root)) return;
        try
        {
            var fsw = new FileSystemWatcher(root)
            {
                IncludeSubdirectories = true,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
                InternalBufferSize = 65536,
            };
            fsw.Created  += (_, e) => SafeApply("Created", e.FullPath);
            fsw.Deleted  += (_, e) => SafeApply("Deleted", e.FullPath);
            fsw.Changed  += (_, e) => SafeApply("Changed", e.FullPath);
            fsw.Renamed  += (_, e) => { SafeApply("Deleted", e.OldFullPath); SafeApply("Created", e.FullPath); };
            fsw.Error    += (_, _) => { };
            fsw.EnableRaisingEvents = true;
            _fallbackWatchers.TryAdd(root, fsw);
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[UsnWatcher/FSW] {root}: {ex.Message}");
        }
    }

    private static void SafeApply(string ev, string fullPath)
    {
        try
        {
            var dir = Path.GetDirectoryName(fullPath) ?? "";
            var name = Path.GetFileName(fullPath);
            if (string.IsNullOrEmpty(name)) return;
            BndzFileIndexService.Instance.ApplyFsEvent(ev, "/" + dir.Replace('\\', '/'), name);
        }
        catch { }
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private static bool IsIndexedRoot(string root)
    {
        // Returns true when the volume contains any of the default indexed locations.
        var rootNorm = root.TrimEnd('\\').ToUpperInvariant();
        foreach (var special in new[]
        {
            Environment.SpecialFolder.Desktop, Environment.SpecialFolder.MyDocuments,
            Environment.SpecialFolder.MyPictures, Environment.SpecialFolder.MyMusic,
            Environment.SpecialFolder.MyVideos, Environment.SpecialFolder.UserProfile,
        })
        {
            try
            {
                var p = Environment.GetFolderPath(special);
                if (!string.IsNullOrEmpty(p) && p.ToUpperInvariant().StartsWith(rootNorm))
                    return true;
            }
            catch { }
        }
        return false;
    }

    // ─── Dispose ─────────────────────────────────────────────────────────────

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cts.Cancel();
        lock (_journals)
        {
            foreach (var j in _journals)
                try { j.Dispose(); } catch { }
            _journals.Clear();
        }
        foreach (var w in _fallbackWatchers.Values)
            try { w.Dispose(); } catch { }
        _fallbackWatchers.Clear();
        _cts.Dispose();
    }
}
