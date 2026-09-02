using BNDZ.Services.MeshDrop;
using Xunit;

namespace BNDZ.NativeShell.Core.Tests;

public class MeshDropPathSafetyTests
{
    [Fact]
    public void Nested_relative_file_stays_inside_destination()
    {
        var dest = Path.Combine(Path.GetTempPath(), "bndz-meshdrop-" + Guid.NewGuid().ToString("N"), "inbox");
        Directory.CreateDirectory(dest);
        try
        {
            Assert.True(MeshDropPathSafety.TryResolveContainedFile(dest, "photos/cat.png", out var full));
            Assert.True(full.StartsWith(Path.GetFullPath(dest), StringComparison.OrdinalIgnoreCase));
            Assert.Equal("cat.png", Path.GetFileName(full));
        }
        finally
        {
            Directory.Delete(Path.GetDirectoryName(dest)!, recursive: true);
        }
    }

    [Fact]
    public void Parent_segments_cannot_escape_destination()
    {
        var dest = Path.Combine(Path.GetTempPath(), "bndz-meshdrop-" + Guid.NewGuid().ToString("N"), "inbox");
        Directory.CreateDirectory(dest);
        try
        {
            Assert.False(MeshDropPathSafety.TryResolveContainedFile(dest, "../outside.txt", out _));
            Assert.False(MeshDropPathSafety.TryResolveContainedFile(dest, "..\\..\\outside.txt", out _));
            Assert.False(MeshDropPathSafety.TryResolveContainedFile(dest, "ok/../../outside.txt", out _));
        }
        finally
        {
            Directory.Delete(Path.GetDirectoryName(dest)!, recursive: true);
        }
    }

    [Fact]
    public void Rooted_and_empty_paths_are_rejected()
    {
        var dest = Path.Combine(Path.GetTempPath(), "bndz-meshdrop-" + Guid.NewGuid().ToString("N"), "inbox");
        Directory.CreateDirectory(dest);
        try
        {
            Assert.False(MeshDropPathSafety.TryResolveContainedFile(dest, "", out _));
            Assert.False(MeshDropPathSafety.TryResolveContainedFile(dest, "   ", out _));
            Assert.False(MeshDropPathSafety.TryResolveContainedFile(dest, ".", out _));
            Assert.False(MeshDropPathSafety.TryResolveContainedFile(dest, Path.DirectorySeparatorChar.ToString(), out _));
            Assert.False(MeshDropPathSafety.TryResolveContainedFile(dest, Path.GetTempPath(), out _));
            if (OperatingSystem.IsWindows())
            {
                Assert.False(MeshDropPathSafety.TryResolveContainedFile(dest, @"C:\Windows\notepad.exe", out _));
                Assert.False(MeshDropPathSafety.TryResolveContainedFile(dest, @"\\server\share\file.bin", out _));
            }
        }
        finally
        {
            Directory.Delete(Path.GetDirectoryName(dest)!, recursive: true);
        }
    }
}
