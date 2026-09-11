using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.Json;

namespace BNDZ.Services.RamStaging;

/// <summary>RAM-disk and fast-staging zones with auto-flush on close.</summary>
public sealed class RamStagingService : IDisposable
{
    private readonly FileTransferQueueService _queue;
    private readonly ImDiskProvider _imDisk = new();
    private readonly ArsenalAimProvider _aim = new();
    private readonly FastStagingProvider _fast = new();
    private readonly ConcurrentDictionary<string, RamStagingZone> _zones = new();
    private readonly ConcurrentDictionary<string, List<RamZoneMapping>> _mappings = new();
    private readonly ConcurrentDictionary<string, FileSystemWatcher> _watchers = new();
    private readonly string _configPath;
    private readonly string _mappingsPath;
    private Action<object>? _zoneChanged;
    private System.Threading.Timer? _memoryTimer;
    private bool _memoryPressureActive;

    public RamStagingService(FileTransferQueueService queue)
    {
        _queue = queue;
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "RamStaging");
        Directory.CreateDirectory(dir);
        _configPath = Path.Combine(dir, "zones.json");
        _mappingsPath = Path.Combine(dir, "mappings.json");
        // Defer Directory.Exists mount-path probes off the UI thread — stale drive letters from
        // a previous session can hang synchronously for several hundred ms each.
        _ = System.Threading.Tasks.Task.Run(() => { LoadZones(); LoadMappings(); });
        _memoryTimer = new System.Threading.Timer(_ => CheckMemoryPressure(), null, TimeSpan.FromSeconds(15), TimeSpan.FromSeconds(30));
    }

    public bool ImDiskAvailable => _imDisk.IsAvailable;

    public void SetZoneChangedHandler(Action<object>? handler) => _zoneChanged = handler;

    public IReadOnlyList<RamStagingZone> ListZones() => _zones.Values.OrderBy(z => z.CreatedUtc).ToList();

    public RamStagingZone? GetZone(string zoneId) => _zones.TryGetValue(zoneId, out var z) ? z : null;

    public async Task<RamStagingZone> CreateZoneAsync(string name, long sizeBudgetMb, bool preferRam = true, CancellationToken ct = default)
    {
        var id = Guid.NewGuid().ToString("N")[..10];
        var zone = new RamStagingZone
        {
            Id = id,
            Name = name,
            SizeBudgetMb = sizeBudgetMb,
            State = RamZoneState.Mounting,
        };

        try
        {
            // Prefer true RAM: ImDisk first, then AIM. If AIM CLI is present but the
            // SCSI miniport is missing, elevate-install the vendored driver once, then retry.
            if (preferRam && !_imDisk.IsAvailable)
            {
                zone.State = RamZoneState.Mounting;
                NotifyZoneChanged(zone);
                // Bundled ImDisk is always present — run install.cmd (one-time admin UAC).
                var install = await InstallImDiskAsync(ct).ConfigureAwait(false);
                _imDisk.InvalidateAvailabilityCache();
                    if (!install.ok && string.IsNullOrWhiteSpace(zone.Error))
                    zone.Error = SoftenRamError(install.error);
            }

            if (preferRam && _imDisk.IsAvailable)
            {
                string? leakedLetter = null;
                try
                {
                    var (mountPath, letter) = await _imDisk.CreateRamVolumeAsync(sizeBudgetMb, ct: ct).ConfigureAwait(false);
                    leakedLetter = letter;
                    await WaitForWritableMountAsync(mountPath, ct).ConfigureAwait(false);
                    zone.Kind = RamZoneKind.RamDisk;
                    zone.MountPath = mountPath;
                    zone.DriveLetter = letter;
                    zone.Provider = "imdisk";
                    zone.Error = null;
                }
                catch (Exception ex)
                {
                    if (!string.IsNullOrEmpty(leakedLetter))
                    {
                        try { await _imDisk.DismountAsync(leakedLetter, ct).ConfigureAwait(false); } catch { /* best effort */ }
                    }
                    zone.Error = SoftenRamError(ex.Message);
                }
            }

            // Do NOT Process.Start aim_cli when ImDisk fails — a broken vendored CLI pops a
            // Windows "could not be started" dialog that we cannot suppress. Use Fast Staging.
            // AIM is only used when a prior successful ProbeNow latched IsKnownAvailable.
            if (preferRam
                && (string.IsNullOrWhiteSpace(zone.MountPath) || !Directory.Exists(zone.MountPath))
                && _aim.IsKnownAvailable)
            {
                string? leakedLetter = null;
                try
                {
                    var (mountPath, letter, deviceId) = await _aim.CreateRamVolumeAsync(sizeBudgetMb, ct).ConfigureAwait(false);
                    leakedLetter = letter;
                    await WaitForWritableMountAsync(mountPath, ct).ConfigureAwait(false);
                    zone.Kind = RamZoneKind.RamDisk;
                    zone.MountPath = mountPath;
                    zone.DriveLetter = letter;
                    zone.ProviderDeviceId = deviceId;
                    zone.Provider = "aim";
                    zone.Error = null;
                }
                catch (Exception ex)
                {
                    if (!string.IsNullOrEmpty(leakedLetter))
                    {
                        try { await _aim.DismountAsync(leakedLetter, null, ct).ConfigureAwait(false); } catch { /* best effort */ }
                    }
                    zone.Error = SoftenRamError(ex.Message);
                }
            }

            if (string.IsNullOrWhiteSpace(zone.MountPath) || !Directory.Exists(zone.MountPath))
            {
                zone.Kind = RamZoneKind.FastStaging;
                zone.Provider = "fast";
                zone.MountPath = _fast.CreateZone(id);
                Directory.CreateDirectory(zone.MountPath);
                await WaitForWritableMountAsync(zone.MountPath, ct).ConfigureAwait(false);
                // Healthy Fast Staging / RAM — silent. No admin lecture on successful mount.
                zone.Error = null;
            }
            zone.State = RamZoneState.Ready;
        }
        catch (Exception ex)
        {
            zone.State = RamZoneState.Error;
            zone.Error = ex.Message;
            zone.Kind = RamZoneKind.FastStaging;
            zone.MountPath = _fast.CreateZone(id);
            Directory.CreateDirectory(zone.MountPath);
            zone.State = RamZoneState.Ready;
        }

        if (string.IsNullOrWhiteSpace(zone.MountPath) || !Directory.Exists(zone.MountPath))
            throw new InvalidOperationException(zone.Error ?? "Could not create a writable staging mount.");

        _zones[id] = zone;
        _mappings[id] = new List<RamZoneMapping>();
        AttachZoneWatcher(zone);
        SaveZones();
        NotifyZoneChanged(zone);
        return zone;
    }

    public async Task StagePathsAsync(string zoneId, IReadOnlyList<string> paths, CancellationToken ct = default)
    {
        if (!_zones.TryGetValue(zoneId, out var zone))
            throw new InvalidOperationException("Zone not found");
        if (string.IsNullOrWhiteSpace(zone.MountPath) || !Directory.Exists(zone.MountPath))
            throw new InvalidOperationException("Zone mount is missing — remount or create a new zone.");

        var operationId = Guid.NewGuid().ToString("N");
        var files = CollectFiles(paths);
        if (files.Count == 0)
        {
            // Folder-only / empty folder stage — still create directory trees.
            var created = 0;
            foreach (var path in paths)
            {
                if (!Directory.Exists(path)) continue;
                var rootName = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)) ?? "folder";
                Directory.CreateDirectory(Path.Combine(zone.MountPath, rootName));
                created++;
            }
            if (created == 0)
                throw new InvalidOperationException("No readable files or folders to stage. Check the source paths.");
            zone.IsDirty = true;
            zone.State = RamZoneState.Dirty;
            NotifyZoneChanged(zone);
            SaveZones();
            return;
        }
        _queue.RegisterJob(operationId, "stage-to-ram", $"Stage to {zone.Name}", "bndz",
            files.Count, "ram-staging", FileTransferPriority.High, zone.MountPath);

        var sw = Stopwatch.StartNew();
        long transferred = 0;
        int done = 0;
        var failures = new List<string>();
        var maps = _mappings.GetOrAdd(zoneId, _ => new List<RamZoneMapping>());

        try
        {
            foreach (var (src, rel) in files)
            {
                ct.ThrowIfCancellationRequested();
                var dest = Path.Combine(zone.MountPath, rel);
                var destDir = Path.GetDirectoryName(dest);
                if (!string.IsNullOrEmpty(destDir)) Directory.CreateDirectory(destDir);

                try
                {
                    await CopyFileResilientAsync(src, dest, ct).ConfigureAwait(false);
                }
                catch (Exception ex)
                {
                    var name = Path.GetFileName(src);
                    failures.Add($"{name}: {SoftenShareViolation(ex.Message)}");
                    continue;
                }

                maps.Add(new RamZoneMapping { SourcePath = src, StagedPath = dest });
                transferred += new FileInfo(dest).Length;
                done++;
                zone.UsedBytes = transferred;
                zone.StagedFileCount = maps.Count;
                zone.IsDirty = true;
                zone.State = RamZoneState.Dirty;
                var pct = (int)Math.Clamp(done * 100.0 / files.Count, 0, 99);
                _queue.UpdateProgress(operationId, pct, src, done, files.Count, transferred, 0, transferred / Math.Max(sw.Elapsed.TotalSeconds, 0.1));
                NotifyZoneChanged(zone);
            }

            if (failures.Count > 0 && done == 0)
            {
                var msg = failures[0];
                _queue.MarkFailed(operationId, msg);
                throw new InvalidOperationException(msg);
            }

            _queue.MarkCompleted(operationId);
            zone.IsDirty = done > 0 || zone.IsDirty;
            zone.State = zone.IsDirty ? RamZoneState.Dirty : RamZoneState.Ready;
            zone.StagedFileCount = maps.Count;
            // Healthy mounts stay silent — partial skips go to the toast only.
            zone.Error = null;
            SaveZones();
            SaveMappings();
            NotifyZoneChanged(zone);
            if (failures.Count > 0)
                throw new InvalidOperationException($"Staged {done} of {files.Count} files. {failures[0]}");
        }
        catch (Exception ex) when (ex is not InvalidOperationException || !ex.Message.StartsWith("Staged ", StringComparison.Ordinal))
        {
            _queue.MarkFailed(operationId, SoftenShareViolation(ex.Message));
            throw;
        }
    }

    public async Task FlushZoneAsync(string zoneId, CancellationToken ct = default)
    {
        if (!_zones.TryGetValue(zoneId, out var zone))
            throw new InvalidOperationException("Zone not found");
        if (!_mappings.TryGetValue(zoneId, out var maps) || maps.Count == 0)
        {
            // In-mount edits (New folder / direct create) mark Dirty without write-back maps.
            // Clear dirty so Flush / status stay honest — nothing to write back.
            if (zone.IsDirty)
            {
                zone.IsDirty = false;
                zone.State = RamZoneState.Ready;
                zone.Error = null;
                SaveZones();
                NotifyZoneChanged(zone);
            }
            return;
        }

        zone.State = RamZoneState.Flushing;
        NotifyZoneChanged(zone);

        var operationId = Guid.NewGuid().ToString("N");
        _queue.RegisterJob(operationId, "flush-from-ram", $"Flush {zone.Name}", "bndz",
            maps.Count, "ram-staging", FileTransferPriority.High);

        var sw = Stopwatch.StartNew();
        long transferred = 0;
        int done = 0;

        try
        {
            foreach (var map in maps)
            {
                ct.ThrowIfCancellationRequested();
                if (!File.Exists(map.StagedPath)) { done++; continue; }

                var destDir = Path.GetDirectoryName(map.SourcePath);
                if (!string.IsNullOrEmpty(destDir)) Directory.CreateDirectory(destDir);
                await CopyFileResilientAsync(map.StagedPath, map.SourcePath, ct).ConfigureAwait(false);
                transferred += new FileInfo(map.StagedPath).Length;
                done++;
                var pct = (int)Math.Clamp(done * 100.0 / maps.Count, 0, 99);
                _queue.UpdateProgress(operationId, pct, map.SourcePath, done, maps.Count, transferred, 0, transferred / Math.Max(sw.Elapsed.TotalSeconds, 0.1));
            }

            zone.IsDirty = false;
            zone.State = RamZoneState.Ready;
            _queue.MarkCompleted(operationId);
            SaveZones();
            SaveMappings();
            NotifyZoneChanged(zone);
        }
        catch (Exception ex)
        {
            zone.State = RamZoneState.Error;
            zone.Error = ex.Message;
            _queue.MarkFailed(operationId, ex.Message);
            NotifyZoneChanged(zone);
            throw;
        }
    }

    /// <summary>Remount an unmounted RamDisk zone, or recreate Fast Staging folder if missing.</summary>
    public async Task<RamStagingZone> RemountZoneAsync(string zoneId, CancellationToken ct = default)
    {
        if (!_zones.TryGetValue(zoneId, out var zone))
            throw new InvalidOperationException("Zone not found");

        if (!string.IsNullOrWhiteSpace(zone.MountPath) && Directory.Exists(zone.MountPath))
        {
            zone.State = zone.IsDirty ? RamZoneState.Dirty : RamZoneState.Ready;
            zone.Error = null;
            AttachZoneWatcher(zone);
            SaveZones();
            NotifyZoneChanged(zone);
            return zone;
        }

        zone.State = RamZoneState.Mounting;
        NotifyZoneChanged(zone);

        if (zone.Kind == RamZoneKind.RamDisk && _imDisk.IsAvailable)
        {
            string? leakedLetter = null;
            try
            {
                var (mountPath, letter) = await _imDisk.CreateRamVolumeAsync(zone.SizeBudgetMb, ct: ct).ConfigureAwait(false);
                leakedLetter = letter;
                await WaitForWritableMountAsync(mountPath, ct).ConfigureAwait(false);
                zone.MountPath = mountPath;
                zone.DriveLetter = letter;
                zone.Provider = "imdisk";
                zone.Kind = RamZoneKind.RamDisk;
                zone.Error = "Remounted empty RAM disk — prior contents were lost after reboot.";
            }
            catch (Exception ex)
            {
                if (!string.IsNullOrEmpty(leakedLetter))
                {
                    try { await _imDisk.DismountAsync(leakedLetter, ct).ConfigureAwait(false); } catch { /* */ }
                }
                zone.Error = SoftenRamError(ex.Message);
            }
        }

        if (zone.Kind == RamZoneKind.RamDisk
            && (string.IsNullOrWhiteSpace(zone.MountPath) || !Directory.Exists(zone.MountPath))
            && _aim.IsKnownAvailable)
        {
            string? leakedLetter = null;
            try
            {
                var (mountPath, letter, deviceId) = await _aim.CreateRamVolumeAsync(zone.SizeBudgetMb, ct).ConfigureAwait(false);
                leakedLetter = letter;
                await WaitForWritableMountAsync(mountPath, ct).ConfigureAwait(false);
                zone.MountPath = mountPath;
                zone.DriveLetter = letter;
                zone.ProviderDeviceId = deviceId;
                zone.Provider = "aim";
                zone.Kind = RamZoneKind.RamDisk;
                zone.Error = "Remounted empty RAM disk — prior contents were lost after reboot.";
            }
            catch (Exception)
            {
                if (!string.IsNullOrEmpty(leakedLetter))
                {
                    try { await _aim.DismountAsync(leakedLetter, null, ct).ConfigureAwait(false); } catch { /* */ }
                }
                zone.Kind = RamZoneKind.FastStaging;
                zone.Provider = "fast";
                zone.DriveLetter = null;
                zone.MountPath = _fast.CreateZone(zoneId);
                Directory.CreateDirectory(zone.MountPath);
                await WaitForWritableMountAsync(zone.MountPath, ct).ConfigureAwait(false);
                zone.Error = null;
            }
        }
        else if (string.IsNullOrWhiteSpace(zone.MountPath) || !Directory.Exists(zone.MountPath))
        {
            zone.Kind = RamZoneKind.FastStaging;
            zone.Provider = "fast";
            zone.DriveLetter = null;
            zone.MountPath = _fast.CreateZone(zoneId);
            Directory.CreateDirectory(zone.MountPath);
            await WaitForWritableMountAsync(zone.MountPath, ct).ConfigureAwait(false);
            zone.Error = null;
        }

        zone.State = zone.IsDirty ? RamZoneState.Dirty : RamZoneState.Ready;
        _mappings.TryAdd(zoneId, new List<RamZoneMapping>());
        AttachZoneWatcher(zone);
        SaveZones();
        NotifyZoneChanged(zone);
        return zone;
    }

    public async Task DeleteZoneAsync(string zoneId, bool flushFirst = true, CancellationToken ct = default)
    {
        if (!_zones.TryGetValue(zoneId, out var zone)) return;

        // Flush only when write-back mappings exist. In-mount creates (New folder / paste
        // without Stage) mark Dirty via the watcher but have nothing to flush — blocking
        // eject on that left zones undeletable.
        if (flushFirst && zone.IsDirty
            && _mappings.TryGetValue(zoneId, out var maps) && maps.Count > 0)
        {
            await FlushZoneAsync(zoneId, ct).ConfigureAwait(false);
        }

        DetachZoneWatcher(zoneId);

        if (zone.Kind == RamZoneKind.RamDisk && !string.IsNullOrEmpty(zone.DriveLetter))
        {
            if (string.Equals(zone.Provider, "aim", StringComparison.OrdinalIgnoreCase))
                await _aim.DismountAsync(zone.DriveLetter, zone.ProviderDeviceId, ct).ConfigureAwait(false);
            else
                await _imDisk.DismountAsync(zone.DriveLetter, ct).ConfigureAwait(false);
        }
        else
            _fast.DeleteZone(zoneId);

        // Always wipe the FastStaging folder when present (even after a RamDisk fallthrough).
        try { _fast.DeleteZone(zoneId); } catch { /* best effort */ }

        _zones.TryRemove(zoneId, out _);
        _mappings.TryRemove(zoneId, out _);
        SaveZones();
        SaveMappings();
        _imDisk.InvalidateAvailabilityCache();
        _aim.InvalidateAvailabilityCache();
    }

    public void MarkDirty(string zoneId)
    {
        if (_zones.TryGetValue(zoneId, out var zone))
        {
            zone.IsDirty = true;
            zone.State = RamZoneState.Dirty;
            SaveZones();
            NotifyZoneChanged(zone);
        }
    }

    private void AttachZoneWatcher(RamStagingZone zone)
    {
        if (string.IsNullOrWhiteSpace(zone.MountPath) || !Directory.Exists(zone.MountPath)) return;
        DetachZoneWatcher(zone.Id);
        var watcher = new FileSystemWatcher(zone.MountPath)
        {
            IncludeSubdirectories = true,
            EnableRaisingEvents = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
        };
        FileSystemEventHandler onChange = (_, _) => MarkDirty(zone.Id);
        RenamedEventHandler onRename = (_, _) => MarkDirty(zone.Id);
        watcher.Changed += onChange;
        watcher.Created += onChange;
        watcher.Deleted += onChange;
        watcher.Renamed += onRename;
        _watchers[zone.Id] = watcher;
    }

    private void DetachZoneWatcher(string zoneId)
    {
        if (_watchers.TryRemove(zoneId, out var watcher))
        {
            watcher.EnableRaisingEvents = false;
            watcher.Dispose();
        }
    }

    public RamStagingStatus GetStatus()
    {
        var zones = _zones.Values.ToList();
        return new RamStagingStatus
        {
            ImDiskAvailable = _imDisk.IsAvailable,
            AimAvailable = _aim.IsKnownAvailable,
            ImDiskInstallerCached = ImDiskInstaller.CachedInstallerPresent(),
            ZoneCount = zones.Count,
            TotalUsedBytes = zones.Sum(z => z.UsedBytes),
            DirtyCount = zones.Count(z => z.IsDirty),
        };
    }

    public async Task<(bool ok, string? error)> InstallImDiskAsync(CancellationToken ct = default)
    {
        if (_imDisk.IsAvailable) return (true, null);
        var result = await ImDiskInstaller.DownloadAndInstallAsync(ct: ct).ConfigureAwait(false);
        _imDisk.InvalidateAvailabilityCache();
        if (!result.ok) return result;
        // Verify the binary actually exists — installer can exit 0 without placing imdisk.exe.
        if (!_imDisk.IsAvailable)
            return (false, "ImDisk installer finished but imdisk.exe was not found. Reboot or install ImDisk Toolkit manually.");
        return (true, null);
    }

    public Task<(bool ok, string? error)> InstallAimAsync(CancellationToken ct = default)
    {
        _ = ct;
        // Never auto-probe a potentially broken CLI from UI/settings — that pops OS dialogs.
        return Task.FromResult<(bool ok, string? error)>((false, null));
    }

    private static async Task WaitForWritableMountAsync(string mountPath, CancellationToken ct)
    {
        for (var i = 0; i < 40; i++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                if (Directory.Exists(mountPath))
                {
                    var probe = Path.Combine(mountPath, $".bndz-write-{Guid.NewGuid():N}.tmp");
                    await File.WriteAllTextAsync(probe, "ok", ct).ConfigureAwait(false);
                    File.Delete(probe);
                    return;
                }
            }
            catch
            {
                /* retry */
            }
            await Task.Delay(100, ct).ConfigureAwait(false);
        }
        throw new InvalidOperationException($"Staging mount is not writable: {mountPath}");
    }

    /// <summary>Shared-read source copy with retries — locked archives / indexer holds no longer abort the whole stage.</summary>
    private static async Task CopyFileResilientAsync(string src, string dest, CancellationToken ct)
    {
        const int maxAttempts = 8;
        Exception? last = null;
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                await Task.Run(() =>
                {
                    // Prefer replacing a locked dest by opening with Delete share when possible.
                    if (File.Exists(dest))
                    {
                        try { File.Delete(dest); }
                        catch (IOException) { /* overwrite via Create below */ }
                    }

                    using var input = new FileStream(
                        src, FileMode.Open, FileAccess.Read,
                        FileShare.ReadWrite | FileShare.Delete,
                        bufferSize: 128 * 1024,
                        options: FileOptions.SequentialScan);
                    using var output = new FileStream(
                        dest, FileMode.Create, FileAccess.Write,
                        FileShare.Read | FileShare.Delete,
                        bufferSize: 128 * 1024,
                        options: FileOptions.SequentialScan);
                    input.CopyTo(output);
                }, ct).ConfigureAwait(false);
                return;
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                last = ex;
                if (attempt >= maxAttempts) break;
                await Task.Delay(40 * attempt * attempt, ct).ConfigureAwait(false);
            }
        }

        throw last ?? new IOException($"Could not copy {Path.GetFileName(src)}.");
    }

    private static string SoftenShareViolation(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "File in use — close it and try again.";
        if (raw.Contains("being used by another process", StringComparison.OrdinalIgnoreCase)
            || raw.Contains("sharing violation", StringComparison.OrdinalIgnoreCase)
            || raw.Contains("32)", StringComparison.Ordinal))
            return "File is open in another app — close it and stage again.";
        if (raw.Length > 120) return raw[..117] + "…";
        return raw;
    }

    /// <summary>Scrub vendor/admin lecture — never surface in UI. Healthy mounts stay silent.</summary>
    private static string? SoftenRamError(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        var t = raw.Trim();

        // Delete every admin / AIM / Install / reboot sermon.
        if (t.Contains("admin", StringComparison.OrdinalIgnoreCase)
            || t.Contains("approve", StringComparison.OrdinalIgnoreCase)
            || t.Contains("UAC", StringComparison.OrdinalIgnoreCase)
            || t.Contains("AIM", StringComparison.OrdinalIgnoreCase)
            || t.Contains("Arsenal", StringComparison.OrdinalIgnoreCase)
            || t.Contains("ImDisk", StringComparison.OrdinalIgnoreCase)
            || t.Contains("Install", StringComparison.OrdinalIgnoreCase)
            || t.Contains("DriverSetup", StringComparison.OrdinalIgnoreCase)
            || t.Contains("reboot", StringComparison.OrdinalIgnoreCase)
            || t.Contains("recreate", StringComparison.OrdinalIgnoreCase)
            || t.Contains("privileges", StringComparison.OrdinalIgnoreCase)
            || t.Contains("cancelled", StringComparison.OrdinalIgnoreCase)
            || t.Contains("1223")
            || t.Contains("404", StringComparison.OrdinalIgnoreCase)
            || t.Contains("Not Found", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }

        if (t.Contains("Fast Staging", StringComparison.OrdinalIgnoreCase)
            || t.Contains("disk-backed", StringComparison.OrdinalIgnoreCase))
            return "Fast Staging (disk-backed).";

        if (t.Length > 80)
            t = t[..77] + "…";
        return t;
    }

    private static List<(string src, string rel)> CollectFiles(IReadOnlyList<string> paths)
    {
        var result = new List<(string, string)>();
        foreach (var path in paths)
        {
            if (File.Exists(path))
                result.Add((path, Path.GetFileName(path)));
            else if (Directory.Exists(path))
            {
                var rootName = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)) ?? "folder";
                foreach (var file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
                {
                    var rel = Path.Combine(rootName, Path.GetRelativePath(path, file)).Replace('\\', '/');
                    result.Add((file, rel));
                }
            }
        }
        return result;
    }

    private void LoadZones()
    {
        if (!File.Exists(_configPath)) return;
        try
        {
            var json = File.ReadAllText(_configPath);
            var zones = JsonSerializer.Deserialize<List<RamStagingZone>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (zones == null) return;
            foreach (var z in zones)
            {
                // Re-soften persisted errors so old AIM/Install copy never surfaces in the UI.
                if (!string.IsNullOrWhiteSpace(z.Error))
                    z.Error = SoftenRamError(z.Error);

                var mountAlive = Directory.Exists(z.MountPath)
                    || (!string.IsNullOrEmpty(z.DriveLetter) && Directory.Exists($"{z.DriveLetter}:\\"));
                if (mountAlive)
                {
                    // Healthy mounts never show soft/lecture status.
                    z.Error = null;
                    _zones[z.Id] = z;
                    AttachZoneWatcher(z);
                    continue;
                }
                // Keep RamDisk records after reboot so we can remount instead of wiping JSON.
                if (z.Kind == RamZoneKind.RamDisk)
                {
                    z.State = RamZoneState.Unmounted;
                    z.MountPath = "";
                    z.Error = null;
                    _zones[z.Id] = z;
                }
            }
        }
        catch { /* fresh */ }
    }

    private void LoadMappings()
    {
        if (!File.Exists(_mappingsPath)) return;
        try
        {
            var json = File.ReadAllText(_mappingsPath);
            var dict = JsonSerializer.Deserialize<Dictionary<string, List<RamZoneMapping>>>(json, new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            if (dict == null) return;
            foreach (var (zoneId, maps) in dict)
            {
                if (!_zones.ContainsKey(zoneId) || maps == null || maps.Count == 0) continue;
                _mappings[zoneId] = maps;
                if (_zones.TryGetValue(zoneId, out var zone))
                {
                    zone.StagedFileCount = maps.Count;
                    if (zone.IsDirty) zone.State = RamZoneState.Dirty;
                }
            }
        }
        catch { /* fresh */ }
    }

    private void SaveZones()
    {
        try
        {
            var json = JsonSerializer.Serialize(_zones.Values.ToList(), new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(_configPath, json);
        }
        catch { /* best effort */ }
    }

    private void SaveMappings()
    {
        try
        {
            var payload = _mappings.ToDictionary(kv => kv.Key, kv => kv.Value);
            var json = JsonSerializer.Serialize(payload, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(_mappingsPath, json);
        }
        catch { /* best effort */ }
    }

    private void NotifyZoneChanged(RamStagingZone zone)
        => _zoneChanged?.Invoke(new { type = "RAM_STAGING_ZONE_CHANGED", payload = zone.ToDto() });

    private void CheckMemoryPressure()
    {
        try
        {
            if (!TryGetMemoryLoadPercent(out var loadPct)) return;
            var underPressure = loadPct >= 92;
            if (underPressure == _memoryPressureActive) return;
            _memoryPressureActive = underPressure;
            _zoneChanged?.Invoke(new
            {
                type = "RAM_STAGING_MEMORY_PRESSURE",
                payload = new { underPressure, loadPercent = loadPct, dirtyZones = _zones.Values.Count(z => z.IsDirty) },
            });
        }
        catch { /* best effort */ }
    }

    private static bool TryGetMemoryLoadPercent(out uint loadPercent)
    {
        var status = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
        if (!GlobalMemoryStatusEx(ref status)) { loadPercent = 0; return false; }
        loadPercent = status.dwMemoryLoad;
        return true;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    public void Dispose()
    {
        _memoryTimer?.Dispose();
        _memoryTimer = null;
        foreach (var watcher in _watchers.Values)
        {
            watcher.EnableRaisingEvents = false;
            watcher.Dispose();
        }
        _watchers.Clear();
        foreach (var zone in _zones.Values)
        {
            if (zone.IsDirty)
            {
                try { FlushZoneAsync(zone.Id).GetAwaiter().GetResult(); } catch { }
            }
        }
    }
}

public sealed class RamStagingStatus
{
    public bool ImDiskAvailable { get; set; }
    /// <summary>True when aim_cli can talk to the loaded SCSI miniport.</summary>
    public bool AimAvailable { get; set; }
    public bool ImDiskInstallerCached { get; set; }
    public int ZoneCount { get; set; }
    public long TotalUsedBytes { get; set; }
    public int DirtyCount { get; set; }
}
