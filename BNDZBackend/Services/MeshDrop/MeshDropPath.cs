namespace BNDZ.Services.MeshDrop;

/// <summary>
/// Contain Mesh Drop receive paths under the chosen destination folder.
/// Peer-supplied relative paths must never be combined raw — Path.Combine
/// returns a rooted second argument as-is, and <c>..</c> escapes the folder.
/// </summary>
public static class MeshDropPath
{
    public const int MaxRelativePathChars = 4096;

    /// <summary>
    /// Map <paramref name="relativePath"/> under <paramref name="destDir"/>.
    /// Returns false for rooted/UNC/drive paths, <c>.</c>/<c>..</c> segments, or any
    /// result that is not strictly inside the destination folder.
    /// </summary>
    public static bool TryResolveContainedPath(string destDir, string relativePath, out string fullPath)
    {
        fullPath = "";
        if (string.IsNullOrWhiteSpace(destDir) || string.IsNullOrWhiteSpace(relativePath))
            return false;
        if (relativePath.Length > MaxRelativePathChars)
            return false;

        var normalized = relativePath
            .Replace('/', Path.DirectorySeparatorChar)
            .Replace('\\', Path.DirectorySeparatorChar)
            .Trim();

        if (Path.IsPathRooted(normalized) || Path.IsPathFullyQualified(normalized))
            return false;

        var parts = normalized.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 0)
            return false;

        var invalid = Path.GetInvalidFileNameChars();
        foreach (var part in parts)
        {
            if (part is "." or "..")
                return false;
            if (part.IndexOfAny(invalid) >= 0)
                return false;
        }

        try
        {
            var root = Path.GetFullPath(destDir);
            var candidate = Path.GetFullPath(Path.Combine(root, Path.Combine(parts)));
            var rootPrefix = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                             + Path.DirectorySeparatorChar;
            if (!candidate.StartsWith(rootPrefix, StringComparison.OrdinalIgnoreCase))
                return false;
            fullPath = candidate;
            return true;
        }
        catch
        {
            return false;
        }
    }
}
