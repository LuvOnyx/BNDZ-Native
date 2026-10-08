// Live check for the no-admin QEMU engine. Usage: cloud-drive-qemu-check <volumeRoot> <panelDir>
// Creates a test drive on the volume, boots it, exercises the panel over localhost,
// stops, starts, checks persistence, then deletes the drive. Never touches a BNDZ profile.
using System.Diagnostics;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using BNDZ.Services.CloudDrive;

var volume = args.Length > 0 ? args[0] : @"F:\bndz-qemu-test\vol";
var panelDir = args.Length > 1 ? args[1] : Path.Combine("..", "..", "BNDZBackend", "Services", "CloudDrive", "guest", "panel");
var keepRuntime = args.Contains("--keep-runtime");
var runtime = CloudDriveQemu.RuntimeDir(volume);
var id = "qemutest";
var slot = Path.Combine(volume, "BNDZ", "CloudDrives", id);
var password = Convert.ToHexString(RandomNumberGenerator.GetBytes(12)).ToLowerInvariant();
var fails = 0;
void Ok(bool c, string m) { Console.WriteLine((c ? "PASS " : "FAIL ") + m); if (!c) fails++; }

var hv = HypervisorPresent();
var whpx = CloudDriveQemu.WhpxLikely(hv);
Console.WriteLine($"engine: {CloudDriveLocalBackend.Choose(new CloudDriveLocalBackend.HostCaps(false, hv, false, null, whpx))}  hypervisorPresent={hv}");

var sw = Stopwatch.StartNew();
long lastPct = -1; string lastName = "";
var prog = new Progress<CloudDriveQemu.Progress>(p =>
{
    var pct = p.Total > 0 ? p.Done * 100 / p.Total : 0;
    if (p.Name != lastName || pct / 10 != lastPct / 10) { Console.WriteLine($"  download {p.Name} {pct}% ({p.Done / 1048576.0:F1}/{p.Total / 1048576.0:F1} MiB)"); lastName = p.Name; lastPct = pct; }
});
await CloudDriveQemu.EnsureRuntimeAsync(runtime, prog, CancellationToken.None);
Console.WriteLine($"runtime ready in {sw.Elapsed.TotalSeconds:F1}s at {runtime}");
Ok(CloudDriveQemu.RuntimeReady(runtime), "QEMU and guest image present on the chosen volume");
Ok(File.Exists(Path.Combine(CloudDriveQemu.QemuDir(runtime), "COPYING")), "QEMU license kept next to the binaries");
Console.WriteLine("runtime size MiB: " + (Directory.EnumerateFiles(runtime, "*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length) / 1048576.0).ToString("F1"));

Directory.CreateDirectory(slot);
var sys = Path.Combine(slot, "system.qcow2");
var data = Path.Combine(slot, "disk.vhdx");
var seed = Path.Combine(slot, "seed.iso");
CloudDriveQemu.EnsureSystemDisk(runtime, sys);
CloudDriveQemu.EnsureDataDisk(runtime, data, 8);
var panelFiles = new[] { "server.py", "index.html", "app.js", "app.css", "qrcodegen.py" }
    .Select(n => ("/opt/bndz/panel/" + n, File.ReadAllText(Path.Combine(panelDir, n))));
CloudDriveQemu.WriteSeed(seed, id, null, password, null, panelFiles);
var panelPort = CloudDriveQemu.FreePort();
var sshPort = CloudDriveQemu.FreePort();
var qmpPort = CloudDriveQemu.FreePort();
var spec = new CloudDriveQemu.LaunchSpec("bndz-" + id, sys, data, seed, panelPort, sshPort, qmpPort,
    Path.Combine(slot, "console.log"), Path.Combine(slot, "qemu.pid"), whpx,
    Kernel: args.Contains("--bios") ? null : CloudDriveQemu.Kernel(runtime),
    Initrd: args.Contains("--bios") ? null : CloudDriveQemu.Initrd(runtime));
Console.WriteLine("qemu " + string.Join(' ', CloudDriveQemu.BuildArgs(spec)));

using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(30) };
var baseUrl = $"http://127.0.0.1:{panelPort}/";
var blob = RandomNumberGenerator.GetBytes(3 * 1024 * 1024 + 123);
var blobHash = Convert.ToHexString(SHA256.HashData(blob));

async Task<double> Boot(string label)
{
    var t = Stopwatch.StartNew();
    var p = CloudDriveQemu.Launch(runtime, spec);
    while (t.Elapsed < TimeSpan.FromMinutes(12))
    {
        if (p.HasExited) throw new Exception("QEMU exited: " + SafeRead(spec.ConsoleLog + ".qemu.txt"));
        try { var r = await http.GetAsync(baseUrl + "api/health"); if (r.IsSuccessStatusCode) break; } catch { }
        if (SafeRead(spec.ConsoleLog).Contains("Kernel panic", StringComparison.Ordinal)) { try { p.Kill(true); } catch { } throw new Exception("guest kernel panic"); }
        await Task.Delay(500);
    }
    Console.WriteLine($"{label}: panel answered after {t.Elapsed.TotalSeconds:F1}s (pid {p.Id})");
    return t.Elapsed.TotalSeconds;
}

async Task<string> Login()
{
    var r = await http.PostAsync(baseUrl + "api/login", new StringContent(JsonSerializer.Serialize(new { user = "bndz", password }), Encoding.UTF8, "application/json"));
    Ok(r.StatusCode == HttpStatusCode.OK, "login");
    return (r.Headers.TryGetValues("Set-Cookie", out var v) ? v.First() : "").Split(';')[0];
}

async Task<JsonElement> Json(HttpRequestMessage m) { var r = await http.SendAsync(m); var s = await r.Content.ReadAsStringAsync(); if (!r.IsSuccessStatusCode) throw new Exception(m.RequestUri + " " + (int)r.StatusCode + " " + s); return JsonDocument.Parse(s).RootElement; }
HttpRequestMessage Req(HttpMethod m, string path, string cookie, HttpContent? body = null) { var q = new HttpRequestMessage(m, baseUrl + path) { Content = body }; q.Headers.Add("Cookie", cookie); return q; }

async Task<List<double>> ListLatency(string cookie, int n)
{
    var times = new List<double>();
    for (var i = 0; i < n; i++) { var t = Stopwatch.StartNew(); await Json(Req(HttpMethod.Get, "api/list?path=", cookie)); times.Add(t.Elapsed.TotalMilliseconds); }
    return times;
}
double Median(List<double> v) { var s = v.OrderBy(x => x).ToList(); return s[s.Count / 2]; }

var proc = 0;
try
{
    var boot1 = await Boot("first boot (cloud-init, formats data disk)");
    var cookie = await Login();
    var me = await Json(Req(HttpMethod.Get, "api/admin", cookie));
    var total = me.GetProperty("total").GetInt64();
    Ok(total > 6L * 1024 * 1024 * 1024, $"panel serves the 8 GiB data disk (total {total / 1073741824.0:F1} GiB)");
    var lat = await ListLatency(cookie, 20);
    Console.WriteLine($"list latency ms: median {Median(lat):F1}  min {lat.Min():F1}  max {lat.Max():F1}");
    var t = Stopwatch.StartNew();
    var start = await Json(Req(HttpMethod.Post, "api/upload/start", cookie, new StringContent(JsonSerializer.Serialize(new { dir = "", name = "persist.bin", size = blob.Length }), Encoding.UTF8, "application/json")));
    var upId = start.GetProperty("id").GetString();
    await Json(Req(HttpMethod.Put, $"api/upload/chunk?id={upId}&offset=0", cookie, new ByteArrayContent(blob)));
    await Json(Req(HttpMethod.Post, "api/upload/finish", cookie, new StringContent(JsonSerializer.Serialize(new { id = upId }), Encoding.UTF8, "application/json")));
    Console.WriteLine($"upload {blob.Length / 1048576.0:F2} MiB in {t.Elapsed.TotalSeconds:F2}s");
    t.Restart();
    var dl = await (await http.SendAsync(Req(HttpMethod.Get, "api/download?path=persist.bin", cookie))).Content.ReadAsByteArrayAsync();
    Console.WriteLine($"download in {t.Elapsed.TotalSeconds:F2}s");
    Ok(Convert.ToHexString(SHA256.HashData(dl)) == blobHash, "download matches upload");
    var list = await Json(Req(HttpMethod.Get, "api/list?path=", cookie));
    Ok(list.GetProperty("entries").EnumerateArray().Any(e => e.GetProperty("name").GetString() == "persist.bin"), "list shows persist.bin");

    var pid = int.Parse(File.ReadAllText(spec.PidFile).Trim());
    t.Restart();
    var clean = await CloudDriveQemu.StopAsync(qmpPort, pid, TimeSpan.FromSeconds(60), CancellationToken.None);
    Console.WriteLine($"stop: {(clean ? "guest powered off" : "forced quit")} in {t.Elapsed.TotalSeconds:F1}s");
    Ok(!CloudDriveQemu.Alive(pid), "QEMU stopped");

    var boot2 = await Boot("second boot");
    cookie = await Login();
    lat = await ListLatency(cookie, 20);
    Console.WriteLine($"list latency ms (2nd boot): median {Median(lat):F1}  min {lat.Min():F1}  max {lat.Max():F1}");
    dl = await (await http.SendAsync(Req(HttpMethod.Get, "api/download?path=persist.bin", cookie))).Content.ReadAsByteArrayAsync();
    Ok(Convert.ToHexString(SHA256.HashData(dl)) == blobHash, "file persisted across stop/start");
    total = (await Json(Req(HttpMethod.Get, "api/admin", cookie))).GetProperty("total").GetInt64();
    Ok(total > 6L * 1024 * 1024 * 1024, $"second boot also serves the data disk (total {total / 1073741824.0:F1} GiB)");
    pid = int.Parse(File.ReadAllText(spec.PidFile).Trim());
    proc = pid;
    clean = await CloudDriveQemu.StopAsync(qmpPort, pid, TimeSpan.FromSeconds(60), CancellationToken.None);
    Console.WriteLine($"stop 2: {(clean ? "guest powered off" : "forced quit")}");
    var info = CloudDriveQemu.Run(CloudDriveQemu.QemuImg(runtime), new[] { "info", data }, 30_000).output;
    Console.WriteLine("data disk: " + string.Join(" | ", info.Split('\n').Where(l => l.StartsWith("file format") || l.StartsWith("virtual size") || l.StartsWith("disk size")).Select(l => l.Trim())));
}
catch (Exception e)
{
    fails++;
    Console.WriteLine("FAIL " + e.Message);
    Console.WriteLine("--- console tail ---\n" + Tail(SafeRead(spec.ConsoleLog), 60));
}
finally
{
    foreach (var p in Process.GetProcessesByName("qemu-system-x86_64")) { try { if (p.MainModule?.FileName?.StartsWith(runtime, StringComparison.OrdinalIgnoreCase) == true) p.Kill(true); } catch { } }
    await Task.Delay(1000);
    try { File.Copy(spec.ConsoleLog, Path.Combine(volume, "..", "last-console.log"), true); } catch { }
    if (!args.Contains("--keep-drive")) { try { Directory.Delete(slot, true); Console.WriteLine("deleted test drive " + slot); } catch (Exception e) { Console.WriteLine("delete failed: " + e.Message); fails++; } }
    if (!keepRuntime && !args.Contains("--keep-drive")) { try { Directory.Delete(runtime, true); Console.WriteLine("deleted runtime " + runtime); } catch (Exception e) { Console.WriteLine("runtime delete failed: " + e.Message); } }
}
Console.WriteLine(fails == 0 ? "ALL PASS" : fails + " FAILED");
return fails == 0 ? 0 : 1;

static string SafeRead(string p) { try { using var fs = new FileStream(p, FileMode.Open, FileAccess.Read, FileShare.ReadWrite); return new StreamReader(fs).ReadToEnd(); } catch { return ""; } }
static string Tail(string s, int n) => string.Join('\n', s.Split('\n').TakeLast(n));
static bool HypervisorPresent()
{
    try
    {
        var o = CloudDriveQemu.Run("powershell.exe", new[] { "-NoProfile", "-Command", "(Get-CimInstance Win32_ComputerSystem).HypervisorPresent" }, 30_000).output;
        return o.Trim().Equals("True", StringComparison.OrdinalIgnoreCase);
    }
    catch { return false; }
}
