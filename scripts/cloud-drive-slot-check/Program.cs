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
Assert(CloudDriveSlot.LocalMoveNote(true, false, "SHA256:abc").Contains("unchanged", StringComparison.Ordinal), "same disk note");

Directory.Delete(root, recursive: true);
Console.WriteLine("cloud-drive-slot-check: ok");

static void Assert(bool condition, string name)
{
    if (!condition) throw new InvalidOperationException(name);
}
