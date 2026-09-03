namespace BNDZ.Services.MeshDrop;

/// <summary>Mesh Drop receive writes must stay inside the user-chosen destination folder.</summary>
public static class MeshDropPathSafety
{
    public static bool TryResolveContainedFile(string destDir, string relativePath, out string fullPath)
        => BNDZ.Services.PathContainment.TryResolveContainedFile(destDir, relativePath, out fullPath);
}
