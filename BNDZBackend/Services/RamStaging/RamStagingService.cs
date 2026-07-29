using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text.Json;

namespace BNDZ.Services.RamStaging;

/// <summary>RAM-disk and fast-staging zones with auto-flush on close.</summary>
public sealed class RamStagingService : IDisposable
{
    private readonly FileTransferQueueService _queue;
    private readonly ImDiskProvider _imDisk = new();
    private readonly FastStagingProvider _fast = new();
    private readonly ConcurrentDictionary<string, RamStagingZone> _zones = new();
    private readonly ConcurrentDictionary<string, List<RamZoneMapping>> _mappings = new();
    private readonly string _configPath;
    private Action<object>? _zoneChanged;

    public RamStagingService(FileTransferQueueService queue)
    {
        _queue = queue;
        var dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ", "RamStaging");
        Directory.CreateDirectory(dir);
        _configPath = Path.Combine(dir, "zones.json");
        LoadZones();
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
            if (preferRam && _imDisk.IsAvailable)
            {
                var (mountPath, letter) = await _imDisk.CreateRamVolumeAsync(sizeBudgetMb, ct: ct).ConfigureAwait(false);
                zone.Kind = RamZoneKind.RamDisk;
                zone.MountPath = mountPath;
                zone.DriveLetter = letter;
            }
            else
            {
                zone.Kind = RamZoneKind.FastStaging;
                zone.MountPath = _fast.CreateZone(id);
                Directory.CreateDirectory(zone.MountPath);
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

        _zones[id] = zone;
        _mappings[id] = new List<RamZoneMapping>();
        SaveZones();
        NotifyZoneChanged(zone);
        return zone;
    }

    public async Task StagePathsAsync(string zoneId, IReadOnlyList<string> paths, CancellationToken ct = default)
    {
        if (!_zones.TryGetValue(zoneId, out var zone))
            throw new InvalidOperationException("Zone not found");

        var operationId = Guid.NewGuid().ToString("N");
        var files = CollectFiles(paths);
        _queue.RegisterJob(operationId, "stage-to-ram", $"Stage to {zone.Name}", "bndz",
            files.Count, "ram-staging", FileTransferPriority.High, zone.MountPath);

        var sw = Stopwatch.StartNew();
        long transferred = 0;
        int done = 0;
        var maps = _mappings.GetOrAdd(zoneId, _ => new List<RamZoneMapping>());

        try
        {
            foreach (var (src, rel) in files)
            {
                ct.ThrowIfCancellationRequested();
                var dest = Path.Combine(zone.MountPath, rel);
                var destDir = Path.GetDirectoryName(dest);
                if (!string.IsNullOrEmpty(destDir)) Directory.CreateDirectory(destDir);

                await Task.Run(() => File.Copy(src, dest, overwrite: true), ct).ConfigureAwait(false);
                maps.Add(new RamZoneMapping { SourcePath = src, StagedPath = dest });
                transferred += new FileInfo(dest).Length;
                done++;
                zone.UsedBytes = transferred;
                zone.StagedFileCount = maps.Count;
                zone.IsDirty = false;
                var pct = (int)Math.Clamp(done * 100.0 / files.Count, 0, 99);
                _queue.UpdateProgress(operationId, pct, src, done, files.Count, transferred, 0, transferred / Math.Max(sw.Elapsed.TotalSeconds, 0.1));
                NotifyZoneChanged(zone);
            }
            _queue.MarkCompleted(operationId);
            SaveZones();
        }
        catch (Exception ex)
        {
            _queue.MarkFailed(operationId, ex.Message);
            throw;
        }
    }

    public async Task FlushZoneAsync(string zoneId, CancellationToken ct = default)
    {
        if (!_zones.TryGetValue(zoneId, out var zone))
            throw new InvalidOperationException("Zone not found");
        if (!_mappings.TryGetValue(zoneId, out var maps) || maps.Count == 0) return;

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
                await Task.Run(() => File.Copy(map.StagedPath, map.SourcePath, overwrite: true), ct).ConfigureAwait(false);
                transferred += new FileInfo(map.StagedPath).Length;
                done++;
                var pct = (int)Math.Clamp(done * 100.0 / maps.Count, 0, 99);
                _queue.UpdateProgress(operationId, pct, map.SourcePath, done, maps.Count, transferred, 0, transferred / Math.Max(sw.Elapsed.TotalSeconds, 0.1));
            }

            zone.IsDirty = false;
            zone.State = RamZoneState.Ready;
            _queue.MarkCompleted(operationId);
            SaveZones();
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

    public async Task DeleteZoneAsync(string zoneId, bool flushFirst = true, CancellationToken ct = default)
    {
        if (!_zones.TryGetValue(zoneId, out var zone)) return;
        if (flushFirst && zone.IsDirty) await FlushZoneAsync(zoneId, ct).ConfigureAwait(false);

        if (zone.Kind == RamZoneKind.RamDisk && !string.IsNullOrEmpty(zone.DriveLetter))
            await _imDisk.DismountAsync(zone.DriveLetter, ct).ConfigureAwait(false);
        else
            _fast.DeleteZone(zoneId);

        _zones.TryRemove(zoneId, out _);
        _mappings.TryRemove(zoneId, out _);
        SaveZones();
    }

    public void MarkDirty(string zoneId)
    {
        if (_zones.TryGetValue(zoneId, out var zone))
        {
            zone.IsDirty = true;
            zone.State = RamZoneState.Dirty;
            NotifyZoneChanged(zone);
        }
    }

    public RamStagingStatus GetStatus()
    {
        var zones = _zones.Values.ToList();
        return new RamStagingStatus
        {
            ImDiskAvailable = _imDisk.IsAvailable,
            ZoneCount = zones.Count,
            TotalUsedBytes = zones.Sum(z => z.UsedBytes),
            DirtyCount = zones.Count(z => z.IsDirty),
        };
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
                if (Directory.Exists(z.MountPath) || (!string.IsNullOrEmpty(z.DriveLetter) && Directory.Exists($"{z.DriveLetter}:\\")))
                    _zones[z.Id] = z;
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

    private void NotifyZoneChanged(RamStagingZone zone)
        => _zoneChanged?.Invoke(new { type = "RAM_STAGING_ZONE_CHANGED", payload = zone.ToDto() });

    public void Dispose()
    {
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
    public int ZoneCount { get; set; }
    public long TotalUsedBytes { get; set; }
    public int DirtyCount { get; set; }
}
