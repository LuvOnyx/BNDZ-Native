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

const string connector = "secret-connector-token-value-0123456789";
Assert(!script.Contains(connector, StringComparison.Ordinal), "bootstrap has no tunnel token");
var unit = CloudDriveLocalRootfs.TunnelUnit(connector);
Assert(unit.Contains("Environment=TUNNEL_TOKEN=" + connector, StringComparison.Ordinal), "unit holds the token");
Assert(!unit.Contains("--token", StringComparison.Ordinal), "unit does not pass --token");
var tunnelIso = Path.Combine(root, "tunnel.iso");
CloudDriveLocalRootfs.WriteSeed(tunnelIso, "cdabc123", "172.30.8.10", publicKey, password, "files.example.com", null, connector);
var tunnelFiles = ReadCidata(tunnelIso);
Assert(Encoding.UTF8.GetString(tunnelFiles["bndz-tunnel.service"]).Contains(connector, StringComparison.Ordinal), "seed unit has token");
Assert(!Encoding.UTF8.GetString(tunnelFiles["bootstrap.sh"]).Contains(connector, StringComparison.Ordinal), "seed bootstrap has no token");

Assert(CloudDriveHostname.DefaultBaseDomain == "cloud.bndz.org", "base domain");
Assert(CloudDriveHostname.ZoneName("cloud.bndz.org") == "bndz.org", "zone");
Assert(CloudDriveHostname.ZoneName("example.com") == "example.com", "apex zone");
Assert(CloudDriveHostname.LandingUrl(null) == "https://cloud.bndz.org/", "landing");
Assert(CloudDriveHostname.DriveUrl("cloud.bndz.org", "desk") == "https://cloud.bndz.org/desk/", "drive url");
Assert(CloudDriveHostname.ShareLink("cloud.bndz.org", "desk", "tok_1") == "https://cloud.bndz.org/s/tok_1", "share link");
Assert(CloudDriveHostname.ShareLink("cloud.bndz.org", "desk", "a/b") == "", "share rejects slash");
Assert(CloudDriveHostname.OriginHost("cloud.bndz.org", "desk") == "d-desk.bndz.org", "origin host");
Assert(CloudDriveHostname.DnsLabel("desk") == "d-desk", "dns label");
Assert(CloudDriveHostname.ValidateSlug("Desk") == "Use lowercase letters, numbers, and hyphens.", "reject upper");
Assert(CloudDriveHostname.ValidateSlug("-desk") == "The path cannot start or end with a hyphen.", "reject hyphen");
Assert(CloudDriveHostname.ValidateSlug(new string('a', 62)) == "The path cannot be longer than 61 characters.", "reject length");
Assert(CloudDriveHostname.ValidateSlug("s") == "That path is reserved.", "reserved s");
Assert(CloudDriveHostname.ValidateSlug("cloud") == null, "cloud path is allowed");
Assert(CloudDriveHostname.Slug("S", "id", null) == "s-drive", "reserved slug");
Assert(CloudDriveHostname.Slug("Desk", "id", new[] { "desk" }) == "desk-2", "slug collision");
Assert(CloudDriveHostname.Slug("Cloud", "id", null) == "cloud", "cloud slug");
var now = DateTime.UtcNow;
var claims = new[]
{
    new SlugClaim
    {
        DriveId = "a",
        Slug = "desk",
        Redirects = new[] { new CloudDriveSlugRedirect { From = "old", UntilUtc = now.AddDays(1).ToString("o") } },
    },
};
Assert(CloudDriveHostname.Availability("desk", claims, null, now) == "That path is already taken.", "current slug taken");
Assert(CloudDriveHostname.Availability("old", claims, null, now) == "That path is already taken.", "redirect taken");
Assert(CloudDriveHostname.Availability("old", claims, "a", now) == null, "owner reclaims redirect");
Assert(CloudDriveHostname.Availability("studio", claims, null, now) == null, "free path");
Assert(CloudDriveHostname.Availability("desk", claims, "a", now) == null, "owner keeps current");
var renamed = new List<CloudDriveSlugRedirect>();
Assert(CloudDriveHostname.Rename("desk", renamed, "studio", now, out var nextSlug) == null, "rename ok");
Assert(nextSlug == "studio" && renamed.Count == 1 && renamed[0].From == "desk", "rename stores old path");
Assert(CloudDriveHostname.RedirectActive(renamed[0].UntilUtc, now.AddDays(29)), "redirect inside grace");
Assert(!CloudDriveHostname.RedirectActive(renamed[0].UntilUtc, now.AddDays(31)), "redirect after grace");
Assert(CloudDriveHostname.Availability("desk", new[] { new SlugClaim { DriveId = "a", Slug = "studio", Redirects = renamed } }, null, now) == "That path is already taken.", "renamed path stays taken");
var router = CloudDriveRouter.Script("cloud.bndz.org", new[]
{
    new CloudDriveRouter.DriveRoute
    {
        Slug = "studio",
        Origin = "https://d-studio.bndz.org",
        Redirects = renamed,
    },
});
Assert(router.Contains("/studio/", StringComparison.Ordinal), "worker path");
Assert(router.Contains("301", StringComparison.Ordinal), "worker redirect");
Assert(router.Contains("\"desk\"", StringComparison.Ordinal), "worker old path");
Assert(router.Contains("replica", StringComparison.Ordinal), "worker reason");
Assert(router.Contains("d-studio.bndz.org", StringComparison.Ordinal), "worker origin");
Assert(!router.Contains("fly.dev", StringComparison.Ordinal) && !router.Contains(connector, StringComparison.Ordinal), "worker has no secret");
var prefixed = CloudDriveLocalRootfs.PanelUnit(password, "cloud.bndz.org", "/desk", "old:desk");
Assert(prefixed.Contains("BNDZ_PATH_PREFIX=/desk", StringComparison.Ordinal), "prefix env");
Assert(prefixed.Contains("BNDZ_SLUG_REDIRECTS=old:desk", StringComparison.Ordinal), "redirect env");
Assert(prefixed.Contains("BNDZ_ROUTE_GUARD=1", StringComparison.Ordinal), "route guard env");
Assert(!prefixed.Contains("BNDZ_ORIGIN_SECRET", StringComparison.Ordinal), "prefix unit has no secret");
var locked = CloudDriveLocalRootfs.PanelUnit(password, "cloud.bndz.org", "/desk", null, "abc123secretvalue");
Assert(locked.Contains("BNDZ_ORIGIN_SECRET=abc123secretvalue", StringComparison.Ordinal), "origin secret env");
Assert(!CloudDriveLocalRootfs.PanelUnit(password, "files.example.com").Contains("BNDZ_PATH_PREFIX", StringComparison.Ordinal), "plain unit has no prefix");
Assert(CloudDriveHostname.ContainsInternalOrigin("ssh bndz@app.fly.dev"), "fly origin");
Assert(CloudDriveHostname.ContainsInternalOrigin("http://10.0.0.8/"), "ip origin");
Assert(!CloudDriveHostname.ContainsInternalOrigin("https://cloud.bndz.org/desk/"), "public origin");
Assert(CloudDriveLocalBackend.Choose(true, null) == "hyper-v", "prefer hyper-v");
Assert(CloudDriveLocalBackend.Choose(false, "2") == "wsl2", "fallback wsl2");
Assert(CloudDriveLocalBackend.Choose(false, "1") == "none", "no backend");
Assert(CloudDriveLocalBackend.DefaultPlacement(true, null, null) == "local", "default local when hyper-v");
Assert(CloudDriveLocalBackend.DefaultPlacement(false, "2", null) == "local", "default local when wsl2");
Assert(CloudDriveLocalBackend.DefaultPlacement(false, null, null) == "cloud", "default cloud when none");
Assert(CloudDriveLocalBackend.DefaultPlacement(true, null, "cloud") == "cloud", "remember cloud");
Assert(CloudDriveLocalBackend.DefaultPlacement(false, null, "local") == "local", "remember local");
Assert(CloudDriveLocalBackend.EnableHowTo.Contains("Enable-WindowsOptionalFeature", StringComparison.Ordinal), "enable how-to");

var dry = CloudDriveCloudflare.Describe("cloud.bndz.org", "desk", false);
Assert(dry.Mode == "dry-run" && dry.PublicUrl == "https://cloud.bndz.org/desk/", "dry-run url");
Assert(dry.OriginHost == "d-desk.bndz.org" && dry.DnsName == "d-desk" && dry.WorkerRoute == "cloud.bndz.org/*", "dry-run route");
Assert(dry.Message.Contains("Zone DNS Edit", StringComparison.Ordinal) && dry.Message.Contains("Workers Scripts Edit", StringComparison.Ordinal) && dry.Message.Contains("deploy.sh", StringComparison.Ordinal) && !dry.Message.Contains(connector, StringComparison.Ordinal), "dry-run scopes");
foreach (var blocked in new[] { "bndz.org", "www.bndz.org", "www", "@", "cloud.bndz.org", "studio.example.com" })
{
    try
    {
        CloudDriveCloudflare.RejectDnsChange(blocked);
        throw new InvalidOperationException("dns allowed " + blocked);
    }
    catch (InvalidOperationException ex) when (ex.Message.StartsWith("Refusing", StringComparison.Ordinal))
    {
    }
}
CloudDriveCloudflare.RejectDnsChange("d-e2e-abc.bndz.org");
CloudDriveCloudflare.RejectDnsChange("d-desk.bndz.org", "tun1.cfargotunnel.com");
try
{
    CloudDriveCloudflare.RejectDnsChange("d-desk.bndz.org", "15.204.218.94");
    throw new InvalidOperationException("website address was writable");
}
catch (InvalidOperationException ex) when (ex.Message.Contains("live website", StringComparison.Ordinal))
{
}
StubHandler.Reset();
var live = await CloudDriveCloudflare.PublishAsync("cf-test-token-value-0123456789abcdef", "cloud.bndz.org", "desk", new StubHandler(), CancellationToken.None);
Assert(live.Mode == "published" && live.TunnelId == "tun1" && live.ConnectorToken == connector, "published plan");
Assert(live.WorkerScript.Contains("/desk/", StringComparison.Ordinal) && live.WorkerScript.Contains("301", StringComparison.Ordinal), "published worker");
Assert(live.Message.Contains("bndz-cloud-routes", StringComparison.Ordinal), "kv namespace named");
Assert(!live.Message.Contains(connector, StringComparison.Ordinal) && !live.Message.Contains("cf-test-token", StringComparison.Ordinal), "plan message has no token");
Assert(!StubHandler.Urls.Any(u => u.Contains("/workers/", StringComparison.Ordinal)), "no worker upload");
Assert(StubHandler.Urls.Any(u => u.Contains("drive%3Adesk", StringComparison.Ordinal) || u.Contains("drive:desk", StringComparison.Ordinal)), "kv drive key");
Assert(!StubHandler.Bodies.Any(b => b.Contains("15.204.218.94", StringComparison.Ordinal) || b.Contains("\"name\":\"bndz.org\"", StringComparison.Ordinal) || b.Contains("\"name\":\"www", StringComparison.Ordinal) || b.Contains("\"name\":\"cloud.bndz.org\"", StringComparison.Ordinal)), "dns guard");
StubHandler.Reset();
StubHandler.Mode = "no-kv";
var partial = await CloudDriveCloudflare.PublishAsync("cf-test-token-value-0123456789abcdef", "cloud.bndz.org", "desk", new StubHandler(), CancellationToken.None);
Assert(partial.Mode == "published" && partial.ConnectorToken == connector && partial.Message.Contains("deploy.sh", StringComparison.Ordinal), "missing kv stays published");
Assert(!StubHandler.Urls.Any(u => u.Contains("/workers/", StringComparison.Ordinal)), "missing kv does not upload a worker");
var noToken = await CloudDriveCloudflare.PublishAsync(null, "cloud.bndz.org", "desk", new StubHandler(), CancellationToken.None);
Assert(noToken.Mode == "dry-run" && noToken.ConnectorToken == null, "missing token stays dry-run");

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

file sealed class StubHandler : HttpMessageHandler
{
    public static string Mode = "ok";
    public static readonly List<string> Urls = new();
    public static readonly List<string> Bodies = new();

    public static void Reset()
    {
        Mode = "ok";
        Urls.Clear();
        Bodies.Clear();
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        var url = request.RequestUri?.AbsoluteUri ?? "";
        Urls.Add((request.Method?.Method ?? "") + " " + url);
        var sent = request.Content == null ? "" : await request.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false);
        if (sent.Length > 0) Bodies.Add(sent);
        if (request.Method == HttpMethod.Get && url.Contains("/storage/kv/namespaces/", StringComparison.Ordinal) && url.Contains("/values/", StringComparison.Ordinal))
        {
            return new HttpResponseMessage(System.Net.HttpStatusCode.NotFound)
            {
                Content = new StringContent("""{"success":false,"errors":[{"code":10009,"message":"key not found"}]}""", Encoding.UTF8, "application/json"),
            };
        }
        string json;
        if (url.Contains("/zones?name=", StringComparison.Ordinal))
            json = """{"success":true,"result":[{"id":"zone1","account":{"id":"acct1"}}]}""";
        else if (url.Contains("/cfd_tunnel?", StringComparison.Ordinal))
            json = """{"success":true,"result":[]}""";
        else if (request.Method == HttpMethod.Post && url.Contains("/cfd_tunnel", StringComparison.Ordinal) && !url.Contains("/configurations", StringComparison.Ordinal))
            json = """{"success":true,"result":{"id":"tun1","token":"secret-connector-token-value-0123456789"}}""";
        else if (url.Contains("/configurations", StringComparison.Ordinal))
            json = """{"success":true,"result":{}}""";
        else if (url.Contains("/dns_records?", StringComparison.Ordinal))
            json = """{"success":true,"result":[]}""";
        else if (request.Method == HttpMethod.Post && url.Contains("/dns_records", StringComparison.Ordinal))
            json = """{"success":true,"result":{"id":"dns1"}}""";
        else if (url.Contains("/storage/kv/namespaces?", StringComparison.Ordinal) || url.EndsWith("/storage/kv/namespaces", StringComparison.Ordinal))
            json = Mode == "no-kv"
                ? """{"success":true,"result":[]}"""
                : """{"success":true,"result":[{"id":"ns1","title":"bndz-cloud-routes"}]}""";
        else if (request.Method == HttpMethod.Put && url.Contains("/storage/kv/namespaces/", StringComparison.Ordinal) && url.Contains("/values/", StringComparison.Ordinal))
            json = """{"success":true}""";
        else
            json = """{"success":false,"errors":[{"message":"unexpected"}]}""";
        return new HttpResponseMessage(System.Net.HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
    }
}
