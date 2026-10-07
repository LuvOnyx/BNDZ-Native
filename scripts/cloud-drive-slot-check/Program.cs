using System.Buffers.Binary;
using System.Text;
using BNDZ.Services.CloudDrive;

var source = @"D:\BNDZ\CloudDrives\cdabc123";
Assert(CloudDriveSlot.ExportPlanError(source, @"E:\Backups", "cdabc123") == null, "export to another drive");
Assert(CloudDriveSlot.DestinationSlot(@"E:\Backups", "cdabc123") == @"E:\Backups\BNDZ\CloudDrives\cdabc123", "slot path");
Assert((CloudDriveSlot.ExportPlanError(source, @"C:\Users\mikey", "cdabc123") ?? "").Contains("system volume", StringComparison.Ordinal), "reject C:");
Assert((CloudDriveSlot.ExportPlanError(source, source, "cdabc123") ?? "").Contains("already this sealed disk", StringComparison.Ordinal), "reject same folder");
Assert((CloudDriveSlot.ExportPlanError(source, source + @"\nested", "cdabc123") ?? "").Contains("inside", StringComparison.Ordinal), "reject nested");
Assert((CloudDriveSlot.ExportPlanError("relative", @"E:\Backups", "cdabc123") ?? "").Contains("full path", StringComparison.Ordinal), "reject relative");

var root = Path.Combine(Path.GetTempPath(), "bndz-slot-" + Guid.NewGuid().ToString("N"));
var src = Path.Combine(root, "src");
var destParent = Path.Combine(root, "dest");
Directory.CreateDirectory(src);
Directory.CreateDirectory(destParent);
File.WriteAllText(Path.Combine(src, "disk.vhdx"), "not-a-real-vhdx");
File.WriteAllText(Path.Combine(src, "drive.json"), """{"id":"cdabc123","name":"Desk","placement":"local","privateKey":"should-not-survive"}""");
File.WriteAllText(Path.Combine(src, "seed.iso"), "secret-seed");
File.WriteAllText(Path.Combine(src, "os.vhdx"), "os-disk");
Directory.CreateDirectory(Path.Combine(src, "vm"));
File.WriteAllText(Path.Combine(src, "vm", "state.txt"), "vm-files");
var manifest = new CloudDriveSlotManifest
{
    Id = "cdabc123",
    Name = "Desk",
    SizeGb = 20,
    VmName = "BNDZ-cdabc123",
    PublicKey = "ssh-ed25519 AAAA",
    Fingerprint = "SHA256:abc",
    SshPort = 22210,
    FtpsPort = 21210,
    WebDavPort = 18110,
    User = "bndz",
};
CloudDriveSlot.Write(src, manifest);
Assert(CloudDriveSlot.ExportPlanError(src, destParent, "cdabc123") == null, "linux export plan");
var slot = CloudDriveSlot.DestinationSlot(destParent, "cdabc123");
CloudDriveSlot.CopyInto(src, slot, CancellationToken.None);
var copied = File.ReadAllText(Path.Combine(slot, "drive.json"));
Assert(copied.Contains("SHA256:abc", StringComparison.Ordinal), "fingerprint copied");
Assert(copied.Contains("ssh-ed25519 AAAA", StringComparison.Ordinal), "public key copied");
Assert(!copied.Contains("privateKey", StringComparison.Ordinal), "private key field absent");
Assert(!copied.Contains("should-not-survive", StringComparison.Ordinal), "rewritten drive.json dropped the secret");
Assert(File.ReadAllText(Path.Combine(slot, "disk.vhdx")) == "not-a-real-vhdx", "vhdx bytes");
Assert(!File.Exists(Path.Combine(slot, "seed.iso")), "seed not exported");
Assert(!File.Exists(Path.Combine(slot, "os.vhdx")), "os disk not exported");
Assert(!Directory.Exists(Path.Combine(slot, "vm")), "vm dir not exported");
var read = CloudDriveSlot.Read(slot);
Assert(read.Id == "cdabc123" && read.Fingerprint == "SHA256:abc", "read manifest");
try
{
    CloudDriveSlot.Read(destParent);
    throw new InvalidOperationException("empty folder should not read");
}
catch (InvalidOperationException ex)
{
    Assert(ex.Message.Contains("drive.json", StringComparison.Ordinal), "missing drive.json");
}

var snaps = CloudDriveSnapshots.Parse("""[{"id":"vs_preview01","status":"created","created_at":"2026-10-07T12:00:00Z","size":20971520}]""");
Assert(snaps.Count == 1 && snaps[0].SizeBytes == 20971520, "parse snapshot array");
var wrapped = CloudDriveSnapshots.Parse("""{"snapshots":[{"id":"vs_other01","status":"ready","created_at":"2026-10-07T12:00:00Z","size":1}]}""");
Assert(wrapped.Count == 1 && wrapped[0].Id == "vs_other01", "parse wrapped snapshots");
Assert(CloudDriveSnapshots.ValidateId("no") != null, "short snapshot id");
Assert(CloudDriveSnapshots.ValidateId("vs_ok12") == null, "snapshot id");
Assert(CloudDriveSlot.FlyHostKeyNote("SHA256:abc").Contains("unchanged", StringComparison.Ordinal)
    && CloudDriveSlot.FlyHostKeyNote("SHA256:abc").Contains("host key", StringComparison.Ordinal), "fly rebind note");
Assert(CloudDriveSlot.LocalMoveNote(false, false, "SHA256:abc").Contains("private key", StringComparison.Ordinal), "missing key note");
var moveNote = CloudDriveSlot.LocalMoveNote(true, false, "SHA256:abc");
Assert(moveNote.Contains("unchanged", StringComparison.Ordinal), "same disk note");
Assert(moveNote.Contains("OS disk", StringComparison.Ordinal), "host key stays on the OS disk");

const string password = "Zz9kQm4nPw7s";
const string publicKey = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAITestKey bndz-cloud-drive";
var script = CloudDriveLocalRootfs.BootstrapScript("172.30.8.10");
Assert(!script.Contains(password, StringComparison.Ordinal), "bootstrap has no password");
Assert(!script.Contains("sleep infinity", StringComparison.Ordinal), "bootstrap is not pid 1 sleep");
var blkidAt = script.IndexOf("blkid", StringComparison.Ordinal);
var mkfsAt = script.IndexOf("mkfs.ext4", StringComparison.Ordinal);
Assert(blkidAt >= 0 && mkfsAt > blkidAt, "blkid before mkfs");
var userData = CloudDriveLocalRootfs.UserData("cdabc123", "172.30.8.10", publicKey, password, "files.example.com");
Assert(userData.StartsWith("#cloud-config", StringComparison.Ordinal), "cloud-config");
Assert(userData.Contains(password, StringComparison.Ordinal), "user-data has password");
Assert(userData.Contains(publicKey, StringComparison.Ordinal), "user-data has public key");
Assert(userData.Contains("BNDZ_PUBLIC_HOST=files.example.com", StringComparison.Ordinal), "public host in unit");
Assert(CloudDriveLocalRootfs.MetaData("cdabc123").Contains("instance-id: bndz-cdabc123", StringComparison.Ordinal), "stable instance id");
var guest = CloudDriveLocalRootfs.GuestIpFor("cdabc123");
Assert(guest.StartsWith("172.30.8.", StringComparison.Ordinal), "guest prefix");
var octet = int.Parse(guest.Split('.')[3]);
Assert(octet is >= 10 and <= 209, "guest range");
var other = CloudDriveLocalRootfs.PickGuestIp("cdabc123", new[] { guest });
Assert(other != guest && other.StartsWith("172.30.8.", StringComparison.Ordinal), "guest collision");
var missing = CloudDriveLocalRootfs.Describe(null, @"D:\BNDZ\rootfs\ubuntu.vhdx", _ => false);
Assert(!missing.Present && missing.Message.Contains("fetch-cloud-drive-rootfs.ps1", StringComparison.Ordinal), "missing rootfs");
var vhdOnly = CloudDriveLocalRootfs.Describe(@"D:\img\ubuntu.vhd", @"D:\BNDZ\rootfs\ubuntu.vhdx", path => path.EndsWith(".vhd", StringComparison.OrdinalIgnoreCase));
Assert(!vhdOnly.Present && vhdOnly.Message.Contains("Convert-VHD", StringComparison.Ordinal), "vhd is not ready");
var ready = CloudDriveLocalRootfs.Describe(@"D:\img\ubuntu.vhdx", @"D:\BNDZ\rootfs\ubuntu.vhdx", path => path.EndsWith(".vhdx", StringComparison.OrdinalIgnoreCase));
Assert(ready.Present && ready.Message.Contains("not recreated", StringComparison.Ordinal), "vhdx ready");

var isoPath = Path.Combine(root, "seed.iso");
CloudDriveLocalRootfs.WriteSeed(isoPath, "cdabc123", "172.30.8.10", publicKey, password, "files.example.com", new[]
{
    ("server.py", "print('panel')\n"),
    ("index.html", "<p>files</p>"),
});
var isoFiles = ReadCidata(isoPath);
Assert(isoFiles["user-data"].AsSpan().IndexOf(Encoding.UTF8.GetBytes(password)) >= 0, "iso user-data password");
var isoScript = Encoding.UTF8.GetString(isoFiles["bootstrap.sh"]);
Assert(!isoScript.Contains(password, StringComparison.Ordinal), "iso bootstrap has no password");
Assert(Encoding.UTF8.GetString(isoFiles["server.py"]) == "print('panel')\n", "iso panel");
Assert(Encoding.UTF8.GetString(isoFiles["meta-data"]).Contains("bndz-cdabc123", StringComparison.Ordinal), "iso meta");
var wide = new byte[3000];
wide.AsSpan().Fill((byte)'Z');
var wideIso = Path.Combine(root, "wide.iso");
CloudDriveSeedIso.Write(wideIso, new[] { ("user-data", Encoding.UTF8.GetBytes("#cloud-config\n")), ("payload.bin", wide) });
var wideFiles = ReadCidata(wideIso);
Assert(wideFiles["payload.bin"].Length == 3000 && wideFiles["payload.bin"][0] == (byte)'Z', "multi-sector file");

var fetch = FindRepoFile(Path.Combine("scripts", "fetch-cloud-drive-rootfs.ps1"));
var fetchText = File.ReadAllText(fetch);
Assert(fetchText.Contains(CloudDriveLocalRootfs.ImageSha256, StringComparison.Ordinal), "fetch pins the digest");
Assert(fetchText.Contains(CloudDriveLocalRootfs.ImageUrl, StringComparison.Ordinal), "fetch pins the url");
Assert(fetchText.Contains("99-bndz-nocloud.cfg", StringComparison.Ordinal), "fetch patches datasource");
Assert(fetchText.Contains("Docker is not used", StringComparison.Ordinal), "fetch refuses docker");

Directory.Delete(root, recursive: true);
Console.WriteLine("cloud-drive-slot-check: ok");

static void Assert(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException(name);
}

static string FindRepoFile(string relative)
{
    var dir = new DirectoryInfo(AppContext.BaseDirectory);
    while (dir != null)
    {
        var candidate = Path.Combine(dir.FullName, relative);
        if (File.Exists(candidate)) return candidate;
        dir = dir.Parent;
    }
    throw new InvalidOperationException("missing " + relative);
}

static Dictionary<string, byte[]> ReadCidata(string path)
{
    var img = File.ReadAllBytes(path);
    var pvd = img.AsSpan(16 * 2048, 2048);
    if (pvd[0] != 1 || Encoding.ASCII.GetString(pvd.Slice(1, 5)) != "CD001")
        throw new InvalidOperationException("not a primary volume");
    var volumeId = Encoding.ASCII.GetString(pvd.Slice(40, 32)).Trim();
    if (!volumeId.Equals("cidata", StringComparison.Ordinal))
        throw new InvalidOperationException("volume id " + volumeId);
    var rootExtent = BinaryPrimitives.ReadUInt32LittleEndian(pvd.Slice(158, 4));
    var rootLen = BinaryPrimitives.ReadUInt32LittleEndian(pvd.Slice(166, 4));
    var dir = img.AsSpan((int)rootExtent * 2048, (int)rootLen);
    var map = new Dictionary<string, byte[]>(StringComparer.Ordinal);
    var pos = 0;
    while (pos + 33 < dir.Length)
    {
        var recLen = dir[pos];
        if (recLen == 0) break;
        var extent = BinaryPrimitives.ReadUInt32LittleEndian(dir.Slice(pos + 2, 4));
        var dataLen = BinaryPrimitives.ReadUInt32LittleEndian(dir.Slice(pos + 10, 4));
        var idLen = dir[pos + 32];
        var pad = (idLen % 2 == 0) ? 1 : 0;
        var su = pos + 33 + idLen + pad;
        var suEnd = pos + recLen;
        string? nm = null;
        var cursor = su;
        while (cursor + 4 <= suEnd)
        {
            if (dir[cursor] == 0)
            {
                cursor++;
                continue;
            }
            var sig = Encoding.ASCII.GetString(dir.Slice(cursor, 2));
            var sigLen = dir[cursor + 2];
            if (sigLen < 4 || cursor + sigLen > suEnd) break;
            if (sig == "NM" && dir[cursor + 4] == 0)
                nm = Encoding.ASCII.GetString(dir.Slice(cursor + 5, sigLen - 5));
            cursor += sigLen;
        }
        if (!string.IsNullOrEmpty(nm))
        {
            var bytes = dataLen == 0 ? Array.Empty<byte>() : img.AsSpan((int)extent * 2048, (int)dataLen).ToArray();
            map[nm] = bytes;
        }
        pos += recLen;
    }
    return map;
}
