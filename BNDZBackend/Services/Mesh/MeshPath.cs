namespace BNDZ.Services.Mesh;

/// <summary>BNDZ pane paths for the remote mesh namespace: /mesh, /mesh/{hostId}, /mesh/{hostId}/var/www</summary>
public static class MeshPath
{
    public const string Root = "/mesh";

    public static bool IsMeshPath(string? path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var n = Normalize(path);
        return n == Root || n.StartsWith(Root + "/", StringComparison.OrdinalIgnoreCase);
    }

    public static string Normalize(string path)
    {
        var p = path.Replace('\\', '/').Trim();
        if (!p.StartsWith('/')) p = '/' + p;
        while (p.Contains("//", StringComparison.Ordinal)) p = p.Replace("//", "/");
        if (p.Length > 1 && p.EndsWith('/')) p = p.TrimEnd('/');
        return p;
    }

    public static bool TryParse(string path, out string? hostId, out string remotePath)
    {
        hostId = null;
        remotePath = "/";
        var n = Normalize(path);
        if (!IsMeshPath(n)) return false;
        if (n.Equals(Root, StringComparison.OrdinalIgnoreCase)) return true;
        var rest = n.Substring(Root.Length + 1);
        if (string.IsNullOrEmpty(rest)) return true;
        var slash = rest.IndexOf('/');
        if (slash < 0)
        {
            hostId = rest;
            remotePath = "/";
            return true;
        }
        hostId = rest[..slash];
        remotePath = rest[slash..];
        if (string.IsNullOrEmpty(remotePath)) remotePath = "/";
        return !string.IsNullOrEmpty(hostId);
    }

    public static string Build(string hostId, string remotePath = "/")
    {
        var rp = remotePath.Replace('\\', '/');
        if (!rp.StartsWith('/')) rp = '/' + rp;
        if (rp.Length > 1 && rp.EndsWith('/')) rp = rp.TrimEnd('/');
        return rp == "/" ? $"{Root}/{hostId}" : $"{Root}/{hostId}{rp}";
    }

    public static string PanePathForEntry(string hostId, string remoteName, bool isDir)
    {
        var basePath = Build(hostId, "/");
        if (remoteName is "." or "..") return basePath;
        var parent = TryParse(basePath, out _, out var rp) ? rp : "/";
        var joined = parent.EndsWith('/') ? parent + remoteName : parent + "/" + remoteName;
        return Build(hostId, joined);
    }
}
