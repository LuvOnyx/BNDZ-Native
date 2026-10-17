using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Xml.Linq;

namespace BNDZ.Services.CloudDrive;

/// <summary>One file or folder inside a drive, as listed over WebDAV.</summary>
public sealed record CloudBrowseEntry(string Name, string RelPath, bool IsFolder, long Size, DateTimeOffset ModifiedUtc);

/// <summary>
/// Browsing a running This-PC drive from the file list. The pane path is
/// `/cloud/&lt;driveId&gt;` for the drive root and `/cloud/&lt;driveId&gt;/a/b`
/// below it; the drive itself is served by its guest WebDAV on localhost,
/// signed in with the drive's own stored password (never sent to the UI).
/// </summary>
public static class CloudDriveBrowse
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(30) };

    /// <summary>Parse a `/cloud/<driveId>/rel/path` pane path. relPath is "" at the drive root.</summary>
    public static bool TryParsePanePath(string? path, out string driveId, out string relPath)
    {
        driveId = "";
        relPath = "";
        if (string.IsNullOrWhiteSpace(path)) return false;
        var p = path.Replace('\\', '/');
        if (!p.StartsWith("/cloud/", StringComparison.Ordinal)) return false;
        var rest = p["/cloud/".Length..].Trim('/');
        if (rest.Length == 0) return false;
        var slash = rest.IndexOf('/');
        if (slash < 0)
        {
            driveId = rest;
        }
        else
        {
            driveId = rest[..slash];
            relPath = rest[(slash + 1)..];
        }
        return driveId.Length > 0;
    }

    /// <summary>Normalize a drive-relative path, or null when it tries to escape the drive root.</summary>
    public static string? SanitizeRel(string? rel)
    {
        if (string.IsNullOrWhiteSpace(rel)) return "";
        var parts = new List<string>();
        foreach (var seg in rel.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries))
        {
            if (seg == ".") continue;
            if (seg == "..") return null;
            parts.Add(seg);
        }
        return string.Join("/", parts);
    }

    private static string EscapeRel(string rel) =>
        rel.Length == 0 ? "" : string.Join("/", rel.Split('/').Select(Uri.EscapeDataString));

    private static HttpRequestMessage DavRequest(HttpMethod method, int port, string rel, string password)
    {
        var url = "http://127.0.0.1:" + port + "/" + EscapeRel(rel);
        var req = new HttpRequestMessage(method, url);
        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes("bndz:" + password));
        req.Headers.Authorization = new AuthenticationHeaderValue("Basic", basic);
        return req;
    }

    /// <summary>List one folder of the drive (PROPFIND Depth 1).</summary>
    public static async Task<List<CloudBrowseEntry>> ListAsync(int webDavPort, string password, string relPath, CancellationToken ct)
    {
        using var req = DavRequest(new HttpMethod("PROPFIND"), webDavPort, relPath, password);
        req.Headers.TryAddWithoutValidation("Depth", "1");
        using var resp = await Http.SendAsync(req, ct).ConfigureAwait(false);
        resp.EnsureSuccessStatusCode();
        var xml = await resp.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        var doc = XDocument.Parse(xml);
        XNamespace d = "DAV:";
        var entries = new List<CloudBrowseEntry>();
        foreach (var r in doc.Descendants(d + "response"))
        {
            var href = r.Element(d + "href")?.Value ?? "";
            var decoded = Uri.UnescapeDataString(href).Trim('/');
            if (decoded.Length == 0) continue;
            if (string.Equals(decoded, relPath, StringComparison.Ordinal)) continue; // the folder itself
            var propstat = r.Elements(d + "propstat")
                .FirstOrDefault(ps => (ps.Element(d + "status")?.Value ?? "").Contains("200"))
                ?? r.Element(d + "propstat");
            var prop = propstat?.Element(d + "prop");
            var isFolder = prop?.Element(d + "resourcetype")?.Element(d + "collection") != null;
            long size = 0;
            if (!isFolder) _ = long.TryParse(prop?.Element(d + "getcontentlength")?.Value, out size);
            var modified = DateTimeOffset.TryParse(prop?.Element(d + "getlastmodified")?.Value, out var dto)
                ? dto
                : DateTimeOffset.UtcNow;
            var name = decoded[(decoded.LastIndexOf('/') + 1)..];
            if (name.Length == 0) continue;
            entries.Add(new CloudBrowseEntry(name, decoded, isFolder, size, modified));
        }
        entries.Sort((a, b) =>
        {
            var byKind = b.IsFolder.CompareTo(a.IsFolder);
            return byKind != 0 ? byKind : string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase);
        });
        return entries;
    }

    /// <summary>Download one file from the drive into the local opened-files cache; returns the local path.</summary>
    public static async Task<string> DownloadToOpenedCacheAsync(int webDavPort, string password, string driveId, string relPath, CancellationToken ct)
    {
        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "CloudDrives", "Opened", driveId);
        var segments = relPath.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var localPath = root;
        foreach (var seg in segments) localPath = Path.Combine(localPath, seg);
        Directory.CreateDirectory(Path.GetDirectoryName(localPath)!);
        using var req = DavRequest(HttpMethod.Get, webDavPort, relPath, password);
        using var resp = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct).ConfigureAwait(false);
        resp.EnsureSuccessStatusCode();
        await using var src = await resp.Content.ReadAsStreamAsync(ct).ConfigureAwait(false);
        await using var dst = new FileStream(localPath, FileMode.Create, FileAccess.Write, FileShare.Read);
        await src.CopyToAsync(dst, ct).ConfigureAwait(false);
        return localPath;
    }
}
