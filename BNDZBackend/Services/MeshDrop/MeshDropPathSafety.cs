namespace BNDZ.Services.MeshDrop;

/// <summary>
/// Keeps Mesh Drop receive writes inside the user-chosen destination folder.
/// Peer-supplied relative paths are untrusted — Path.Combine ignores destDir for
/// rooted paths, and ".." segments resolve outside the inbox (zip-slip).
/// </summary>
public static class MeshDropPathSafety
{
    /// <summary>
    /// Resolve <paramref name="relativePath"/> under <paramref name="destDir"/>.
    /// Returns false when the path is empty, rooted, or would escape destDir.
    /// </summary>
    public static bool TryResolveContainedFile(string destDir, string relativePath, out string fullPath)
    {
        fullPath = "";
        if (string.IsNullOrWhiteSpace(destDir) || string.IsNullOrWhiteSpace(relativePath))
            return false;

        string destRoot;
        try
        {
            destRoot = Path.GetFullPath(destDir);
        }
        catch
        {
            return false;
        }

        var destPrefix = destRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;

        var normalizedRel = relativePath.Replace('/', Path.DirectorySeparatorChar)
            .Replace('\\', Path.DirectorySeparatorChar)
            .Trim();
        if (normalizedRel.Length == 0)
            return false;

        // Rooted / UNC / drive-qualified paths must not replace destDir via Path.Combine.
        if (Path.IsPathRooted(normalizedRel) || Path.IsPathRooted(relativePath.Trim()))
            return false;

        string candidate;
        try
        {
            candidate = Path.GetFullPath(Path.Combine(destRoot, normalizedRel));
        }
        catch
        {
            return false;
        }

        var destNorm = destRoot.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        var candNorm = candidate.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (string.Equals(candNorm, destNorm, StringComparison.OrdinalIgnoreCase))
            return false;

        if (!candidate.StartsWith(destPrefix, StringComparison.OrdinalIgnoreCase))
            return false;

        fullPath = candidate;
        return true;
    }
}
