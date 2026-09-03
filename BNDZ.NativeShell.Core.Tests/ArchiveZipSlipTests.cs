using System.IO.Compression;
using BNDZ.Services;
using Xunit;

namespace BNDZ.NativeShell.Core.Tests;

public class ArchiveZipSlipTests
{
    [Fact]
    public void Zip_FullName_parent_segments_are_rejected()
    {
        var dest = Path.Combine(Path.GetTempPath(), "bndz-zipslip-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dest);
        try
        {
            using var ms = new MemoryStream();
            using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, leaveOpen: true))
            {
                zip.CreateEntry("safe/inside.txt");
                zip.CreateEntry("../escape.txt");
                zip.CreateEntry("payload/../../outside.txt");
            }
            ms.Position = 0;
            using var read = new ZipArchive(ms, ZipArchiveMode.Read);
            var names = read.Entries.Select(e => e.FullName).ToList();
            Assert.Contains(names, n => n.Replace('\\', '/').Contains("inside.txt"));
            foreach (var name in names)
            {
                var ok = PathContainment.TryResolveContainedFile(dest, name, out var full);
                if (name.Replace('\\', '/').Contains("inside.txt"))
                {
                    Assert.True(ok);
                    Assert.StartsWith(Path.GetFullPath(dest), full, StringComparison.OrdinalIgnoreCase);
                }
                else
                {
                    Assert.False(ok);
                }
            }
        }
        finally
        {
            Directory.Delete(dest, recursive: true);
        }
    }
}
