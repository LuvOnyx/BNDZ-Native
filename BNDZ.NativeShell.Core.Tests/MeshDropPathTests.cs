using BNDZ.Services.MeshDrop;
using Xunit;

namespace BNDZ.NativeShell.Core.Tests;

public class MeshDropPathTests
{
    [Fact]
    public void Nested_relative_file_stays_under_destination()
    {
        var root = Path.Combine(Path.GetTempPath(), "bndz-meshdrop-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            Assert.True(MeshDropPath.TryResolveContainedPath(root, "album/photo.jpg", out var dest));
            Assert.Equal(Path.GetFullPath(Path.Combine(root, "album", "photo.jpg")), dest);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Parent_segment_is_rejected()
    {
        var root = Path.Combine(Path.GetTempPath(), "bndz-meshdrop-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            Assert.False(MeshDropPath.TryResolveContainedPath(root, "../outside.txt", out _));
            Assert.False(MeshDropPath.TryResolveContainedPath(root, "ok/../../outside.txt", out _));
            Assert.False(MeshDropPath.TryResolveContainedPath(root, "..\\outside.txt", out _));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Rooted_and_absolute_payloads_are_rejected()
    {
        var root = Path.Combine(Path.GetTempPath(), "bndz-meshdrop-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            var outside = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "bndz-meshdrop-outside.txt"));
            Assert.False(MeshDropPath.TryResolveContainedPath(root, outside, out _));
            Assert.False(MeshDropPath.TryResolveContainedPath(root, "/etc/passwd", out _));
            Assert.False(MeshDropPath.TryResolveContainedPath(root, "", out _));
            Assert.False(MeshDropPath.TryResolveContainedPath(root, "   ", out _));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public void Overlong_relative_path_is_rejected()
    {
        var root = Path.Combine(Path.GetTempPath(), "bndz-meshdrop-" + Guid.NewGuid().ToString("N"));
        var tooLong = new string('a', MeshDropPath.MaxRelativePathChars + 1) + ".txt";
        Assert.False(MeshDropPath.TryResolveContainedPath(root, tooLong, out _));
    }
}
