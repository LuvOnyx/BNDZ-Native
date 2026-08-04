using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using Meziantou.Framework.Win32;

namespace BNDZ.Services;

/// <summary>
/// Live library-health feed. Profile-folder watchers catch broken shortcuts as they appear;
/// NTFS USN journals (when the volume allows) catch deletes by leaf name under those roots.
/// Problems show up in /bndz/problems and list badges without a manual scan.
/// </summary>
public sealed class UsnHealthWatcherService : IDisposable
{
    private static readonly Lazy<UsnHealthWatcherService> Lazy = new(() => new UsnHealthWatcherService());
    public static UsnHealthWatcherService Instance => Lazy.Value;

    private readonly ConcurrentDictionary<string, FileSystemWatcher> _fsw = new(StringComparer.OrdinalIgnoreCase);
    private readonly List<IDisposable> _journals = new();
    private readonly CancellationTokenSource _cts = new();
    private int _started;

    private UsnHealthWatcherService() { }

    public void Start()
    {
        if (Interlocked.Exchange(ref _started, 1) != 0) return;

        foreach (var root in ProfileRoots())
            TryAddFsWatcher(root);

        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (!drive.IsReady || drive.DriveType != DriveType.Fixed) continue;
                if (!string.Equals(drive.DriveFormat, "NTFS", StringComparison.OrdinalIgnoreCase)) continue;

                var journal = ChangeJournal.Open(drive);
                _journals.Add(journal);
                var root = drive.RootDirectory.FullName;
                _ = Task.Run(() => PumpJournal(root, journal, _cts.Token), _cts.Token);
            }
            catch
            {
                // No journal access — FSW still covers Desktop/Documents/Downloads.
            }
        }
    }

    private static List<string> ProfileRoots()
    {
        var list = new List<string>();
        void Add(Environment.SpecialFolder folder)
        {
            try
            {
                var path = Environment.GetFolderPath(folder);
                if (!string.IsNullOrEmpty(path) && Directory.Exists(path))
                    list.Add(path);
            }
            catch { }
        }

        Add(Environment.SpecialFolder.UserProfile);
        Add(Environment.SpecialFolder.DesktopDirectory);
        Add(Environment.SpecialFolder.MyDocuments);
        Add(Environment.SpecialFolder.MyPictures);
        Add(Environment.SpecialFolder.MyMusic);
        try
        {
            var downloads = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
            if (Directory.Exists(downloads)) list.Add(downloads);
        }
        catch { }

        return list;
    }

    private void TryAddFsWatcher(string root)
    {
        try
        {
            if (!_fsw.TryAdd(root, null!)) return;
            var w = new FileSystemWatcher(root)
            {
                IncludeSubdirectories = true,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.Attributes,
                EnableRaisingEvents = true,
            };
            w.Deleted += (_, e) => OnPathGone(e.FullPath);
            w.Created += (_, e) => OnPathAppeared(e.FullPath);
            w.Renamed += (_, e) =>
            {
                OnPathGone(e.OldFullPath);
                OnPathAppeared(e.FullPath);
            };
            _fsw[root] = w;
        }
        catch
        {
            _fsw.TryRemove(root, out _);
        }
    }

    private void PumpJournal(string volumeRoot, ChangeJournal journal, CancellationToken ct)
    {
        try
        {
            foreach (var entry in journal.Entries)
            {
                if (ct.IsCancellationRequested) break;
                // Older package: entry is ChangeJournalEntry with Name via ToString or dynamic
                var name = entry.ToString() ?? "";
                // Prefer Name property when present (v2/v3 records)
                try
                {
                    var nameProp = entry.GetType().GetProperty("Name");
                    if (nameProp?.GetValue(entry) is string n && !string.IsNullOrWhiteSpace(n))
                        name = n;
                    var reasonProp = entry.GetType().GetProperty("Reason");
                    var reason = reasonProp?.GetValue(entry)?.ToString() ?? "";
                    if (reason.IndexOf("Delete", StringComparison.OrdinalIgnoreCase) < 0
                        && reason.IndexOf("Rename", StringComparison.OrdinalIgnoreCase) < 0)
                        continue;
                }
                catch { continue; }

                if (string.IsNullOrWhiteSpace(name)) continue;
                OnLeafGone(volumeRoot, name);
            }
        }
        catch
        {
            // Journal cursor / access failures are non-fatal.
        }
    }

    private static void OnLeafGone(string volumeRoot, string leafName)
    {
        try
        {
            foreach (var root in ProfileRoots())
            {
                if (!root.StartsWith(volumeRoot, StringComparison.OrdinalIgnoreCase)) continue;
                ScanLinksForMissingTarget(root, leafName);
            }
        }
        catch { }
    }

    private static string ToPaneDir(string winPath)
    {
        var dir = Path.GetDirectoryName(winPath) ?? winPath;
        var n = dir.Replace('\\', '/');
        if (n.Length >= 2 && n[1] == ':')
            return "/" + n[0] + ":" + n[2..];
        return "/" + n.TrimStart('/');
    }

    private static void OnPathGone(string fullPath)
    {
        try
        {
            LibraryHealthService.Instance.ClearProblemsForExactPath(fullPath);

            var dir = Path.GetDirectoryName(fullPath);
            var leaf = Path.GetFileName(fullPath);
            if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir))
                ScanLinksForMissingTarget(dir, leaf ?? "");

            try
            {
                BndzFileIndexService.Instance.ApplyFsEvent("Deleted", ToPaneDir(fullPath), Path.GetFileName(fullPath));
            }
            catch { }
        }
        catch { }
    }

    private static void OnPathAppeared(string fullPath)
    {
        try
        {
            if (fullPath.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase))
                CheckShortcut(fullPath);

            try
            {
                BndzFileIndexService.Instance.ApplyFsEvent("Created", ToPaneDir(fullPath), Path.GetFileName(fullPath));
            }
            catch { }
        }
        catch { }
    }

    private static void ScanLinksForMissingTarget(string dir, string deletedLeaf)
    {
        try
        {
            if (!Directory.Exists(dir)) return;
            foreach (var lnk in Directory.EnumerateFiles(dir, "*.lnk", SearchOption.TopDirectoryOnly))
                CheckShortcut(lnk);

            if (deletedLeaf.EndsWith(".lnk", StringComparison.OrdinalIgnoreCase))
                LibraryHealthService.Instance.ClearProblemsForExactPath(Path.Combine(dir, deletedLeaf));
        }
        catch { }
    }

    private static void CheckShortcut(string lnkPath)
    {
        try
        {
            if (!File.Exists(lnkPath)) return;
            Type? shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            dynamic shell = Activator.CreateInstance(shellType)!;
            dynamic shortcut = shell.CreateShortcut(lnkPath);
            string? target = shortcut.TargetPath as string;
            try { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shortcut); } catch { }
            try { System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell); } catch { }

            if (string.IsNullOrWhiteSpace(target))
            {
                LibraryHealthService.Instance.UpsertLiveProblem(
                    "BrokenLink", "error", lnkPath,
                    "Shortcut has no target.",
                    "Delete or retarget the shortcut.");
                return;
            }

            if (File.Exists(target) || Directory.Exists(target))
            {
                LibraryHealthService.Instance.ClearProblemsForExactPath(lnkPath);
                return;
            }

            LibraryHealthService.Instance.UpsertLiveProblem(
                "MissingTarget", "warning", lnkPath,
                $"Target missing: {target}",
                "Retarget or remove the shortcut.");
        }
        catch { }
    }

    public void Dispose()
    {
        _cts.Cancel();
        foreach (var w in _fsw.Values)
        {
            try { w?.Dispose(); } catch { }
        }
        _fsw.Clear();
        foreach (var j in _journals)
        {
            try { j.Dispose(); } catch { }
        }
        _journals.Clear();
        _cts.Dispose();
    }
}
