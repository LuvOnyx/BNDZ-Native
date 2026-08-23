using System.Management;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BNDZ.Services;

/// <summary>
/// VSS named branch (Branching Impl A): create a ClientAccessible volume shadow,
/// persist a named pointer, browse via GLOBALROOT device path, restore via transfer queue.
/// </summary>
public sealed class VssBranchService
{
    private static readonly Lazy<VssBranchService> Lazy = new(() => new VssBranchService());
    public static VssBranchService Instance => Lazy.Value;

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly string _dir;
    private readonly object _lock = new();
    private FileTransferQueueService? _queue;

    private VssBranchService()
    {
        _dir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "TimeMachine", "vss-branches");
        Directory.CreateDirectory(_dir);
    }

    public void SetTransferQueue(FileTransferQueueService queue) => _queue = queue;

    public sealed class VssBranchDto
    {
        public string Id { get; set; } = "";
        public string Name { get; set; } = "";
        public string RootPath { get; set; } = "";
        public string VolumeRoot { get; set; } = "";
        public string ShadowId { get; set; } = "";
        public string DeviceObject { get; set; } = "";
        public string BrowseRoot { get; set; } = "";
        public string Kind { get; set; } = "vss";
        public string CreatedUtc { get; set; } = "";
    }

    public sealed class SystemShadowDto
    {
        public string Id { get; set; } = "";
        public string VolumeRoot { get; set; } = "";
        public string DeviceObject { get; set; } = "";
        public string BrowseRoot { get; set; } = "";
        public string CreatedUtc { get; set; } = "";
        public bool ClientAccessible { get; set; }
        public string OriginalPath { get; set; } = "";
    }

    public VssBranchDto Create(string rootPath, string name)
    {
        if (string.IsNullOrWhiteSpace(rootPath) || !Directory.Exists(rootPath))
            throw new DirectoryNotFoundException("Folder not found for VSS branch.");

        var full = Path.GetFullPath(rootPath);
        var volume = Path.GetPathRoot(full) ?? throw new InvalidOperationException("Cannot resolve volume.");
        var shadow = CreateShadowCopy(volume);
        if (string.IsNullOrEmpty(shadow.ShadowId) || string.IsNullOrEmpty(shadow.DeviceObject))
            throw new InvalidOperationException(
                "VSS snapshot failed — run BNDZ elevated or ensure Volume Shadow Copy is available.");

        var rel = full.Length > volume.Length ? full[volume.Length..].TrimStart('\\', '/') : "";
        var browse = CombineShadow(shadow.DeviceObject, rel);
        var id = Guid.NewGuid().ToString("N")[..12];
        var dto = new VssBranchDto
        {
            Id = id,
            Name = string.IsNullOrWhiteSpace(name) ? $"vss-{DateTime.Now:yyyyMMdd-HHmm}" : name.Trim(),
            RootPath = full.Replace('\\', '/'),
            VolumeRoot = volume,
            ShadowId = shadow.ShadowId,
            DeviceObject = shadow.DeviceObject,
            BrowseRoot = browse.Replace('\\', '/'),
            CreatedUtc = DateTime.UtcNow.ToString("O"),
        };

        lock (_lock)
        {
            File.WriteAllText(Path.Combine(_dir, id + ".json"), JsonSerializer.Serialize(dto, Json));
        }
        return dto;
    }

    public List<VssBranchDto> List()
    {
        lock (_lock)
        {
            var list = new List<VssBranchDto>();
            foreach (var file in Directory.EnumerateFiles(_dir, "*.json"))
            {
                try
                {
                    var dto = JsonSerializer.Deserialize<VssBranchDto>(File.ReadAllText(file), Json);
                    if (dto != null) list.Add(dto);
                }
                catch { /* skip */ }
            }
            return list.OrderByDescending(b => b.CreatedUtc).ToList();
        }
    }

    public VssBranchDto? Get(string id)
    {
        lock (_lock)
        {
            var file = Path.Combine(_dir, id + ".json");
            if (!File.Exists(file)) return null;
            return JsonSerializer.Deserialize<VssBranchDto>(File.ReadAllText(file), Json);
        }
    }

    public bool Delete(string id)
    {
        var dto = Get(id);
        if (dto == null) return false;
        try { DeleteShadowCopy(dto.ShadowId); } catch { /* may need elevation */ }
        lock (_lock)
        {
            var file = Path.Combine(_dir, id + ".json");
            if (File.Exists(file)) File.Delete(file);
        }
        return true;
    }

    /// <summary>List files under the VSS browse root (read-only shadow).</summary>
    public List<object> Browse(string id, string? relative = null)
    {
        var dto = Get(id) ?? throw new KeyNotFoundException("VSS branch not found.");
        var root = dto.BrowseRoot.Replace('/', '\\');
        if (!string.IsNullOrWhiteSpace(relative))
            root = Path.Combine(root, relative.Replace('/', '\\').TrimStart('\\'));

        var results = new List<object>();
        if (!Directory.Exists(root)) return results;

        foreach (var dir in Directory.EnumerateDirectories(root))
        {
            var di = new DirectoryInfo(dir);
            results.Add(new
            {
                id = di.FullName.Replace('\\', '/'),
                name = di.Name,
                type = "directory",
                path = di.FullName.Replace('\\', '/'),
                size = 0L,
                modified = di.LastWriteTimeUtc.ToString("O"),
                isVss = true,
            });
        }
        foreach (var file in Directory.EnumerateFiles(root))
        {
            var fi = new FileInfo(file);
            results.Add(new
            {
                id = fi.FullName.Replace('\\', '/'),
                name = fi.Name,
                type = "file",
                path = fi.FullName.Replace('\\', '/'),
                size = fi.Length,
                extension = fi.Extension.TrimStart('.').ToLowerInvariant(),
                modified = fi.LastWriteTimeUtc.ToString("O"),
                isVss = true,
            });
        }
        return results;
    }

    public async Task RestoreAsync(string id, IReadOnlyList<string>? relativePaths = null, CancellationToken ct = default)
    {
        var dto = Get(id) ?? throw new KeyNotFoundException("VSS branch not found.");
        var liveRoot = dto.RootPath.Replace('/', '\\');
        var shadowRoot = dto.BrowseRoot.Replace('/', '\\');

        var sources = new List<string>();
        if (relativePaths == null || relativePaths.Count == 0)
        {
            if (Directory.Exists(shadowRoot))
                sources.AddRange(Directory.EnumerateFileSystemEntries(shadowRoot));
        }
        else
        {
            foreach (var rel in relativePaths)
            {
                var src = Path.Combine(shadowRoot, rel.Replace('/', '\\').TrimStart('\\'));
                if (File.Exists(src) || Directory.Exists(src)) sources.Add(src);
            }
        }

        if (sources.Count == 0) return;

        var opId = $"vss-restore-{id}-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
        _queue?.RegisterJob(opId, "copy", $"Restore VSS {dto.Name}", "vss", sources.Count, "vss-branch", FileTransferPriority.Normal, liveRoot);

        var ops = new FileOperationService();
        await ops.ExecuteOperationAsync(opId, "copy", sources, liveRoot, bypassRecycleBin: false, cancellationToken: ct).ConfigureAwait(false);
    }

    /// <summary>
    /// List all existing system shadow copies for the volume containing <paramref name="path"/>.
    /// Returns read-only snapshots (created by Windows, not just BNDZ) with device paths for browsing.
    /// </summary>
    public List<SystemShadowDto> ListSystemShadows(string path)
    {
        var full = Path.GetFullPath(path.Trim());
        var volume = (Path.GetPathRoot(full) ?? "C:\\").TrimEnd('\\', '/') + "\\";
        var result = new List<SystemShadowDto>();
        try
        {
            using var searcher = new ManagementObjectSearcher(
                $"SELECT * FROM Win32_ShadowCopy WHERE VolumeName='{volume.Replace("'", "''")}' OR VolumeName='{volume.TrimEnd('\\').Replace("'", "''")}'");
            foreach (ManagementObject obj in searcher.Get())
            {
                var id = obj["ID"]?.ToString() ?? "";
                var device = obj["DeviceObject"]?.ToString() ?? "";
                var created = obj["InstallDate"]?.ToString() ?? "";
                var clientAcc = obj["ClientAccessible"] is bool b && b;
                // Parse WMI datetime (yyyyMMddHHmmss.000000±mmm)
                var createdUtc = ParseWmiDate(created);
                // Relative path within volume
                var rel = full.Length > volume.Length ? full[volume.Length..].TrimStart('\\', '/') : "";
                var browseRoot = string.IsNullOrEmpty(device) ? "" : CombineShadow(device, rel);
                result.Add(new SystemShadowDto
                {
                    Id = id,
                    VolumeRoot = volume,
                    DeviceObject = device,
                    BrowseRoot = browseRoot.Replace('\\', '/'),
                    CreatedUtc = createdUtc,
                    ClientAccessible = clientAcc,
                    OriginalPath = full.Replace('\\', '/'),
                });
            }
        }
        catch (Exception ex)
        {
            System.Diagnostics.Debug.WriteLine($"[VssBranchService] ListSystemShadows: {ex.Message}");
        }
        return result.OrderByDescending(s => s.CreatedUtc).ToList();
    }

    private static string ParseWmiDate(string wmi)
    {
        // WMI date format: "20250601120000.000000+000"
        if (string.IsNullOrWhiteSpace(wmi) || wmi.Length < 14) return wmi;
        try
        {
            var year = int.Parse(wmi[..4]);
            var month = int.Parse(wmi[4..6]);
            var day = int.Parse(wmi[6..8]);
            var hour = int.Parse(wmi[8..10]);
            var min = int.Parse(wmi[10..12]);
            var sec = int.Parse(wmi[12..14]);
            return new DateTime(year, month, day, hour, min, sec, DateTimeKind.Utc).ToString("O");
        }
        catch { return wmi; }
    }

    private static (string ShadowId, string DeviceObject) CreateShadowCopy(string volumeRoot)
    {
        // WMI Win32_ShadowCopy — no native AlphaVSS dependency; requires backup privilege / elevation.
        using var cls = new ManagementClass("Win32_ShadowCopy");
        using var inParams = cls.GetMethodParameters("Create");
        inParams["Volume"] = volumeRoot.EndsWith('\\') ? volumeRoot : volumeRoot + "\\";
        inParams["Context"] = "ClientAccessible";
        using var outParams = cls.InvokeMethod("Create", inParams, null);
        if (outParams == null)
            return ("", "");

        var returnValue = Convert.ToUInt32(outParams["ReturnValue"]);
        if (returnValue != 0)
            throw new InvalidOperationException($"Win32_ShadowCopy.Create returned {returnValue}.");

        var shadowId = outParams["ShadowID"]?.ToString() ?? "";
        if (string.IsNullOrEmpty(shadowId)) return ("", "");

        using var searcher = new ManagementObjectSearcher(
            $"SELECT DeviceObject FROM Win32_ShadowCopy WHERE ID='{shadowId.Replace("'", "''")}'");
        foreach (ManagementObject obj in searcher.Get())
        {
            var device = obj["DeviceObject"]?.ToString() ?? "";
            return (shadowId, device);
        }
        return (shadowId, "");
    }

    private static void DeleteShadowCopy(string shadowId)
    {
        if (string.IsNullOrWhiteSpace(shadowId)) return;
        using var searcher = new ManagementObjectSearcher(
            $"SELECT * FROM Win32_ShadowCopy WHERE ID='{shadowId.Replace("'", "''")}'");
        foreach (ManagementObject obj in searcher.Get())
        {
            obj.Delete();
        }
    }

    private static string CombineShadow(string deviceObject, string relative)
    {
        var device = deviceObject.TrimEnd('\\');
        if (string.IsNullOrEmpty(relative)) return device + "\\";
        return device + "\\" + relative.Replace('/', '\\').TrimStart('\\');
    }

    /// <summary>Restore files from a system shadow (read-only, identified by DeviceObject path).</summary>
    public async Task RestoreSystemShadowAsync(
        string shadowDeviceObject,
        string originalPath,
        IReadOnlyList<string>? relativePaths = null,
        CancellationToken ct = default)
    {
        var rel = "";
        var full = Path.GetFullPath(originalPath.Trim());
        var volume = Path.GetPathRoot(full) ?? "C:\\";
        if (full.Length > volume.Length)
            rel = full[volume.Length..].TrimStart('\\', '/');

        var shadowRoot = CombineShadow(shadowDeviceObject, rel);
        var liveRoot = full;

        var sources = new List<string>();
        if (relativePaths == null || relativePaths.Count == 0)
        {
            if (Directory.Exists(shadowRoot))
                sources.AddRange(Directory.EnumerateFileSystemEntries(shadowRoot));
            else if (File.Exists(shadowRoot))
                sources.Add(shadowRoot);
        }
        else
        {
            foreach (var rp in relativePaths)
            {
                var src = Path.Combine(shadowRoot, rp.Replace('/', '\\').TrimStart('\\'));
                if (File.Exists(src) || Directory.Exists(src)) sources.Add(src);
            }
        }

        if (sources.Count == 0) return;

        var opId = $"vss-sys-restore-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
        _queue?.RegisterJob(opId, "copy", $"Restore system shadow of {Path.GetFileName(liveRoot)}", "vss", sources.Count, "vss-system", FileTransferPriority.Normal, liveRoot);

        var ops = new FileOperationService();
        await ops.ExecuteOperationAsync(opId, "copy", sources, liveRoot, bypassRecycleBin: false, cancellationToken: ct).ConfigureAwait(false);
    }
}

public sealed class SystemShadowDto
{
    public string Id { get; set; } = "";
    public string VolumeRoot { get; set; } = "";
    public string DeviceObject { get; set; } = "";
    public string BrowseRoot { get; set; } = "";
    public string CreatedUtc { get; set; } = "";
    public bool ClientAccessible { get; set; }
    public string OriginalPath { get; set; } = "";
}
