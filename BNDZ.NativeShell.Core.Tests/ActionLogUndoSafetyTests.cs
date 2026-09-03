using BNDZ.Services;
using Xunit;

namespace BNDZ.NativeShell.Core.Tests;

public class ActionLogUndoSafetyTests
{
    [Fact]
    public void CollectUndoTargets_rejects_destination_root_and_escapes()
    {
        var dest = Path.Combine(Path.GetTempPath(), "bndz-undo-root-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dest);
        try
        {
            var targets = ActionLogUndoSafety.CollectUndoTargets(dest, new[]
            {
                "",
                ".",
                "..",
                "../outside.txt",
                "..\\..\\outside.txt",
                "/",
                Path.DirectorySeparatorChar.ToString(),
                Path.Combine("..", "sibling.txt"),
            });

            Assert.Empty(targets);
            Assert.False(ActionLogUndoSafety.TryResolveContainedChild(dest, "/", out _));
            Assert.False(ActionLogUndoSafety.TryResolveContainedChild(dest, Path.DirectorySeparatorChar.ToString(), out _));
        }
        finally
        {
            Directory.Delete(dest, recursive: true);
        }
    }

    [Fact]
    public void CollectUndoTargets_rejects_rooted_paths()
    {
        var dest = Path.Combine(Path.GetTempPath(), "bndz-undo-rooted-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dest);
        try
        {
            var unixRooted = Path.Combine(Path.GetPathRoot(Path.GetTempPath()) ?? "/", "etc", "passwd");
            var targets = ActionLogUndoSafety.CollectUndoTargets(dest, new[]
            {
                unixRooted,
                "/tmp/evil.txt",
                @"C:\Windows\System32\cmd.exe",
            });

            Assert.DoesNotContain(targets, t =>
                string.Equals(Path.GetFullPath(t), Path.GetFullPath(unixRooted), StringComparison.OrdinalIgnoreCase));
            Assert.DoesNotContain(targets, t =>
                t.Contains("evil.txt", StringComparison.OrdinalIgnoreCase)
                && !t.StartsWith(Path.GetFullPath(dest), StringComparison.OrdinalIgnoreCase));
            foreach (var t in targets)
            {
                Assert.StartsWith(Path.GetFullPath(dest), Path.GetFullPath(t), StringComparison.OrdinalIgnoreCase);
                Assert.NotEqual(Path.GetFullPath(dest).TrimEnd(Path.DirectorySeparatorChar),
                    Path.GetFullPath(t).TrimEnd(Path.DirectorySeparatorChar),
                    StringComparer.OrdinalIgnoreCase);
            }
        }
        finally
        {
            Directory.Delete(dest, recursive: true);
        }
    }

    [Fact]
    public void CollectUndoTargets_keeps_nested_safe_paths()
    {
        var dest = Path.Combine(Path.GetTempPath(), "bndz-undo-ok-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dest);
        try
        {
            Assert.True(ActionLogUndoSafety.TryResolveContainedChild(dest, "from-zip.txt", out var file));
            Assert.Equal(Path.GetFullPath(Path.Combine(dest, "from-zip.txt")), file);
            Assert.True(ActionLogUndoSafety.TryResolveContainedChild(dest, "pkg/a.dll", out var nested));
            Assert.Equal(Path.GetFullPath(Path.Combine(dest, "pkg", "a.dll")), nested);
        }
        finally
        {
            Directory.Delete(dest, recursive: true);
        }
    }

    [Fact]
    public void DeleteContainedTargets_does_not_wipe_destination_or_siblings()
    {
        var dest = Path.Combine(Path.GetTempPath(), "bndz-undo-wipe-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dest);
        try
        {
            File.WriteAllText(Path.Combine(dest, "keep-me.txt"), "precious");
            File.WriteAllText(Path.Combine(dest, "from-zip.txt"), "extracted");
            var nested = Path.Combine(dest, "pkg");
            Directory.CreateDirectory(nested);
            File.WriteAllText(Path.Combine(nested, "a.dll"), "x");
            File.WriteAllText(Path.Combine(nested, "preexisting.dll"), "y");

            var targets = ActionLogUndoSafety.CollectUndoTargets(dest, new[]
            {
                "from-zip.txt",
                "pkg/a.dll",
                "pkg",
                ".",
                "..",
                dest,
            });
            ActionLogUndoSafety.DeleteContainedTargets(dest, targets);

            Assert.True(Directory.Exists(dest));
            Assert.True(File.Exists(Path.Combine(dest, "keep-me.txt")));
            Assert.False(File.Exists(Path.Combine(dest, "from-zip.txt")));
            Assert.False(File.Exists(Path.Combine(nested, "a.dll")));
            Assert.True(File.Exists(Path.Combine(nested, "preexisting.dll")));
        }
        finally
        {
            if (Directory.Exists(dest))
                Directory.Delete(dest, recursive: true);
        }
    }

    [Fact]
    public void DeleteContainedTargets_prunes_empty_extracted_dirs_only()
    {
        var dest = Path.Combine(Path.GetTempPath(), "bndz-undo-prune-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dest);
        try
        {
            var onlyExtracted = Path.Combine(dest, "fresh-tree", "sub");
            Directory.CreateDirectory(onlyExtracted);
            File.WriteAllText(Path.Combine(onlyExtracted, "c.txt"), "extracted");

            var targets = ActionLogUndoSafety.CollectUndoTargets(dest, new[] { "fresh-tree/sub/c.txt" });
            ActionLogUndoSafety.DeleteContainedTargets(dest, targets);

            Assert.True(Directory.Exists(dest));
            Assert.False(File.Exists(Path.Combine(onlyExtracted, "c.txt")));
            Assert.False(Directory.Exists(Path.Combine(dest, "fresh-tree")));
        }
        finally
        {
            if (Directory.Exists(dest))
                Directory.Delete(dest, recursive: true);
        }
    }
}
