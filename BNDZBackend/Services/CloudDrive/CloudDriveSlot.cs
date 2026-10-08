using System.Text.Json;

namespace BNDZ.Services.CloudDrive;

/// <summary>A Fly volume snapshot. Ids and sizes only — no tokens.</summary>
public sealed class CloudDriveSnapshot
{
    public string Id { get; set; } = "";
    public string Status { get; set; } = "";
    public string CreatedAt { get; set; } = "";
    public long SizeBytes { get; set; }
}

/// <summary>Public metadata written beside a sealed disk. Never a private key.</summary>
public sealed class CloudDriveSlotManifest
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Placement { get; set; } = "local";
    public int SizeGb { get; set; }
    public string? VmName { get; set; }
    public string? PublicKey { get; set; }
    public string? Fingerprint { get; set; }
    public int SshPort { get; set; }
    public int FtpsPort { get; set; }
    public int WebDavPort { get; set; }
    public string User { get; set; } = "bndz";
    /// <summary>Keeps the public URL when the sealed folder moves.</summary>
    public string? PublicSlug { get; set; }
}

public static class CloudDriveSnapshots
{
    public static string? ValidateId(string? id)
    {
        var s = (id ?? "").Trim();
        if (s.Length < 6 || s.Length > 128) return "That snapshot id does not look usable.";
        foreach (var c in s)
        {
            if (c is not ((>= 'a' and <= 'z') or (>= 'A' and <= 'Z') or (>= '0' and <= '9') or '_' or '-'))
                return "That snapshot id does not look usable.";
        }
        return null;
    }

    public static List<CloudDriveSnapshot> Parse(string? json)
    {
        var list = new List<CloudDriveSnapshot>();
        if (string.IsNullOrWhiteSpace(json)) return list;
        try
        {
            using var doc = JsonDocument.Parse(json);
            Collect(doc.RootElement, list);
        }
        catch
        {
            return list;
        }
        return list;
    }

    private static void Collect(JsonElement el, List<CloudDriveSnapshot> list)
    {
        if (el.ValueKind == JsonValueKind.Array)
        {
            foreach (var item in el.EnumerateArray()) Collect(item, list);
            return;
        }
        if (el.ValueKind != JsonValueKind.Object) return;
        if (el.TryGetProperty("id", out var idEl) && idEl.ValueKind == JsonValueKind.String)
        {
            var id = idEl.GetString() ?? "";
            if (ValidateId(id) == null && !list.Any(s => string.Equals(s.Id, id, StringComparison.Ordinal)))
            {
                list.Add(new CloudDriveSnapshot
                {
                    Id = id,
                    Status = Str(el, "status"),
                    CreatedAt = Str(el, "created_at").Length > 0 ? Str(el, "created_at") : Str(el, "createdAt"),
                    SizeBytes = Num(el, "size"),
                });
                return;
            }
        }
        foreach (var key in new[] { "snapshots", "data", "volume_snapshots" })
        {
            if (el.TryGetProperty(key, out var nested)) Collect(nested, list);
        }
    }

    private static string Str(JsonElement el, string name)
    {
        if (!el.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String) return "";
        return v.GetString() ?? "";
    }

    private static long Num(JsonElement el, string name)
    {
        if (!el.TryGetProperty(name, out var v)) return 0;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n)) return n < 0 ? 0 : n;
        return 0;
    }
}

/// <summary>
/// Sealed-folder copy and open-existing rules. The folder holds the VHDX and
/// public drive.json. Private keys stay in the Windows registry store.
/// </summary>
public static class CloudDriveSlot
{
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        WriteIndented = true,
    };

    public static string? UnsafeId(string? id)
    {
        var s = (id ?? "").Trim();
        if (s.Length < 4 || s.Length > 64) return "That drive id cannot be used as a folder name.";
        foreach (var c in s)
        {
            if (c is not ((>= 'a' and <= 'z') or (>= 'A' and <= 'Z') or (>= '0' and <= '9') or '_' or '-'))
                return "That drive id cannot be used as a folder name.";
        }
        return null;
    }

    public static string PathKey(string? path)
    {
        var p = (path ?? "").Trim().Trim('"').Replace('/', '\\');
        if (p.Length == 2 && p[1] == ':') p += "\\";
        var unc = p.StartsWith("\\\\", StringComparison.Ordinal);
        var body = unc ? p[2..] : p;
        while (body.Contains("\\\\", StringComparison.Ordinal)) body = body.Replace("\\\\", "\\", StringComparison.Ordinal);
        p = unc ? "\\\\" + body : body;
        if (!(p.Length == 3 && p[1] == ':') && p.Length > 3 && p.EndsWith('\\'))
            p = p.TrimEnd('\\');
        return p.ToUpperInvariant();
    }

    public static string DestinationSlot(string destinationParent, string driveId)
    {
        var dest = (destinationParent ?? "").Trim().Trim('"').TrimEnd('\\', '/');
        var slash = Math.Max(dest.LastIndexOf('\\'), dest.LastIndexOf('/'));
        var leaf = slash >= 0 ? dest[(slash + 1)..] : dest;
        if (string.Equals(leaf, driveId, StringComparison.OrdinalIgnoreCase)) return dest;
        var sep = dest.Contains('/') && !dest.Contains('\\') ? "/" : "\\";
        return dest + sep + "BNDZ" + sep + "CloudDrives" + sep + driveId;
    }

    public static string? ExportPlanError(string? source, string? destinationParent, string? driveId)
    {
        if (UnsafeId(driveId) != null) return "That drive id cannot be used as a folder name.";
        var src = (source ?? "").Trim();
        var dest = (destinationParent ?? "").Trim();
        if (src.Length == 0 || dest.Length == 0)
            return "Pick the folder to copy the sealed disk into.";
        var srcKey = PathKey(src);
        var destKey = PathKey(dest);
        if (!IsAbsolute(srcKey) || !IsAbsolute(destKey))
            return "Enter a full path on another drive, for example E:\\BNDZ Drives.";
        if (IsSystemVolume(srcKey) || IsSystemVolume(destKey))
            return "Keep the sealed disk off the system volume (C:). Pick a folder on D:, a USB drive, or another letter.";
        var slot = DestinationSlot(dest, driveId!);
        var slotKey = PathKey(slot);
        if (srcKey == slotKey || srcKey == destKey)
            return "Pick a different folder. That is already this sealed disk.";
        if (IsNested(srcKey, destKey) || IsNested(destKey, srcKey) || IsNested(srcKey, slotKey) || IsNested(slotKey, srcKey))
            return "The copy cannot sit inside the sealed folder, and the sealed folder cannot sit inside the copy.";
        return null;
    }

    public static void Write(string folder, CloudDriveSlotManifest manifest)
    {
        Directory.CreateDirectory(folder);
        var note = new System.Text.StringBuilder();
        note.AppendLine("BNDZ Cloud Drive — sealed disk slot");
        note.AppendLine("Drive: " + manifest.Name);
        note.AppendLine("Id: " + manifest.Id);
        note.AppendLine("Intended size: " + manifest.SizeGb + " GB");
        note.AppendLine();
        note.AppendLine("This folder is the microVM disk root (VHDX + VM files), not a shared folder.");
        note.AppendLine("BNDZ remote-controls it. Do not treat loose files here as the drive.");
        note.AppendLine("Docker Desktop is not used.");
        note.AppendLine("Copy this whole folder to move the disk. Private keys are not in this folder.");
        if (manifest.SshPort > 0)
            note.AppendLine("SSH/SFTP 127.0.0.1:" + manifest.SshPort);
        if (manifest.FtpsPort > 0)
            note.AppendLine("FTPS 127.0.0.1:" + manifest.FtpsPort + " (plain FTP is off)");
        if (manifest.WebDavPort > 0)
            note.AppendLine("WebDAV http://127.0.0.1:" + manifest.WebDavPort + "/");
        if (!string.IsNullOrWhiteSpace(manifest.Fingerprint))
            note.AppendLine("Client key fingerprint: " + manifest.Fingerprint);
        File.WriteAllText(Path.Combine(folder, "DISK-SLOT.txt"), note.ToString());
        var json = JsonSerializer.Serialize(new CloudDriveSlotManifest
        {
            Id = manifest.Id,
            Name = manifest.Name,
            Placement = "local",
            SizeGb = manifest.SizeGb,
            VmName = manifest.VmName,
            PublicKey = manifest.PublicKey,
            Fingerprint = manifest.Fingerprint,
            SshPort = manifest.SshPort,
            FtpsPort = manifest.FtpsPort,
            WebDavPort = manifest.WebDavPort,
            User = string.IsNullOrWhiteSpace(manifest.User) ? "bndz" : manifest.User,
        }, JsonOpts);
        File.WriteAllText(Path.Combine(folder, "drive.json"), json);
    }

    public static CloudDriveSlotManifest Read(string folder)
    {
        if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder))
            throw new InvalidOperationException("That folder is not on this PC.");
        var jsonPath = Path.Combine(folder, "drive.json");
        if (!File.Exists(jsonPath))
            throw new InvalidOperationException("That folder is not a BNDZ sealed disk. It needs drive.json from a Cloud Drive.");
        CloudDriveSlotManifest? manifest;
        try
        {
            manifest = JsonSerializer.Deserialize<CloudDriveSlotManifest>(File.ReadAllText(jsonPath), JsonOpts);
        }
        catch
        {
            throw new InvalidOperationException("drive.json is not a BNDZ sealed-disk record.");
        }
        if (manifest == null || string.IsNullOrWhiteSpace(manifest.Id) || string.IsNullOrWhiteSpace(manifest.Name))
            throw new InvalidOperationException("drive.json is missing the drive id or name.");
        if (UnsafeId(manifest.Id) != null)
            throw new InvalidOperationException("The drive id in that folder is not usable.");
        if (manifest.Name.Length > 64 || manifest.Name.Any(char.IsControl))
            throw new InvalidOperationException("The drive name in that folder is not usable.");
        if (!string.IsNullOrWhiteSpace(manifest.Placement)
            && !string.Equals(manifest.Placement, "local", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("That drive.json is not a This PC sealed disk.");
        return manifest;
    }

    public static void CopyInto(string source, string destinationSlot, CancellationToken ct)
    {
        if (!Directory.Exists(source))
            throw new InvalidOperationException("The sealed folder is missing.");
        if (Directory.Exists(destinationSlot) && Directory.EnumerateFileSystemEntries(destinationSlot).Any())
            throw new InvalidOperationException("That folder already has files. Pick an empty destination.");
        Directory.CreateDirectory(destinationSlot);
        CopyRecursive(new DirectoryInfo(source), destinationSlot, ct);
    }

    public static string FlyHostKeyNote(string? fingerprint)
    {
        var key = string.IsNullOrWhiteSpace(fingerprint) ? "the same client key" : fingerprint.Trim();
        return "Client key unchanged (" + key + "). The machine was replaced, so the SSH server host key is new. On the next SSH or SFTP connection, confirm the new host key. The app address stays the same.";
    }

    public static string LocalMoveNote(bool hasPrivateKey, bool fingerprintMismatch, string? fingerprint)
    {
        if (!hasPrivateKey)
            return "This PC does not have the private key that was created with this drive. The data disk was not wiped. SSH from here needs that key, which stays on the PC that created the drive.";
        if (fingerprintMismatch)
            return "The sealed folder records a different client fingerprint than the key stored on this PC. SSH may be refused until the guest authorized_keys matches this PC.";
        var key = string.IsNullOrWhiteSpace(fingerprint) ? "stored on this PC" : fingerprint.Trim();
        return "Data disk kept. The client key on this PC is unchanged (" + key + "). The guest SSH host key is on this PC's OS disk and is new after a move. The sealed data VHDX is not recreated.";
    }

    private static void CopyRecursive(DirectoryInfo source, string dest, CancellationToken ct)
    {
        Directory.CreateDirectory(dest);
        foreach (var file in source.GetFiles())
        {
            ct.ThrowIfCancellationRequested();
            if (SkipExportFile(file.Name)) continue;
            var target = Path.Combine(dest, file.Name);
            using var input = file.Open(FileMode.Open, FileAccess.Read, FileShare.Read);
            using var output = new FileStream(target, FileMode.CreateNew, FileAccess.Write, FileShare.None);
            input.CopyTo(output, 1024 * 1024);
        }
        foreach (var dir in source.GetDirectories())
        {
            ct.ThrowIfCancellationRequested();
            if (string.Equals(dir.Name, "vm", StringComparison.OrdinalIgnoreCase)) continue;
            CopyRecursive(dir, Path.Combine(dest, dir.Name), ct);
        }
    }

    /// <summary>OS differencing disk and the cloud-init seed stay on this PC. The seed holds the guest password.</summary>
    private static bool SkipExportFile(string name) =>
        name.Equals("seed.iso", StringComparison.OrdinalIgnoreCase)
        || name.Equals("os.vhdx", StringComparison.OrdinalIgnoreCase)
        || name.Equals("bndz-tunnel.service", StringComparison.OrdinalIgnoreCase);

    private static bool IsAbsolute(string key)
    {
        if (key.StartsWith("\\\\", StringComparison.Ordinal)) return true;
        if (key.Length >= 3 && key[1] == ':' && key[2] == '\\') return true;
        if (key.StartsWith('\\')) return true;
        return false;
    }

    private static bool IsSystemVolume(string key) =>
        key.StartsWith("C:\\", StringComparison.Ordinal) || key == "C:";

    private static bool IsNested(string parent, string child)
    {
        if (parent == child) return false;
        var p = parent.EndsWith('\\') ? parent : parent + "\\";
        return child.StartsWith(p, StringComparison.Ordinal);
    }
}
