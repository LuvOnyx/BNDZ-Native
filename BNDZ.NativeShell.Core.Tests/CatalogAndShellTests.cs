using BNDZ.NativeShell.Core.Models;
using BNDZ.NativeShell.Core.Services;
using BNDZ.NativeShell.Core.ViewModels;
using Xunit;

namespace BNDZ.NativeShell.Core.Tests;

public class LocalFolderCatalogTests
{
    [Fact]
    public async Task ListAsync_returns_directories_before_files()
    {
        var root = Path.Combine(Path.GetTempPath(), "bndz-native-shell-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            Directory.CreateDirectory(Path.Combine(root, "zeta-dir"));
            Directory.CreateDirectory(Path.Combine(root, "alpha-dir"));
            await File.WriteAllTextAsync(Path.Combine(root, "b.txt"), "b");
            await File.WriteAllTextAsync(Path.Combine(root, "a.txt"), "a");

            var catalog = new LocalFolderCatalog();
            var items = await catalog.ListAsync(root);

            Assert.Equal(4, items.Count);
            Assert.True(items[0].IsDirectory);
            Assert.True(items[1].IsDirectory);
            Assert.False(items[2].IsDirectory);
            Assert.False(items[3].IsDirectory);
            Assert.Equal("alpha-dir", items[0].Name);
            Assert.Equal("zeta-dir", items[1].Name);
            Assert.Equal("a.txt", items[2].Name);
            Assert.Equal("b.txt", items[3].Name);
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }

    [Fact]
    public async Task ListAsync_missing_path_returns_empty()
    {
        var catalog = new LocalFolderCatalog();
        var items = await catalog.ListAsync(Path.Combine(Path.GetTempPath(), "no-such-" + Guid.NewGuid()));
        Assert.Empty(items);
    }
}

public class LocalPreviewBuilderTests
{
    [Fact]
    public async Task BuildAsync_null_returns_empty()
    {
        var snap = await new LocalPreviewBuilder().BuildAsync(null);
        Assert.Equal(PreviewSnapshot.Empty.Title, snap.Title);
    }

    [Fact]
    public async Task BuildAsync_file_includes_size_fact()
    {
        var path = Path.Combine(Path.GetTempPath(), "bndz-preview-" + Guid.NewGuid().ToString("N") + ".txt");
        await File.WriteAllTextAsync(path, "hello");
        try
        {
            var snap = await new LocalPreviewBuilder().BuildAsync(path);
            Assert.Equal(Path.GetFileName(path), snap.Title);
            Assert.Contains(snap.Facts, f => f.Label == "Size");
        }
        finally
        {
            File.Delete(path);
        }
    }
}

public class ShellViewModelTests
{
    [Fact]
    public async Task Navigate_updates_entries_and_path()
    {
        var root = Path.Combine(Path.GetTempPath(), "bndz-shell-vm-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        await File.WriteAllTextAsync(Path.Combine(root, "one.txt"), "1");
        try
        {
            var vm = new ShellViewModel(
                new LocalFolderCatalog(),
                new LocalDriveCatalog(),
                new LocalPreviewBuilder());

            await vm.NavigateCommand.ExecuteAsync(root);

            Assert.Equal(Path.GetFullPath(root), Path.GetFullPath(vm.CurrentPath));
            Assert.Contains(vm.Entries, e => e.Name == "one.txt");
            Assert.False(string.IsNullOrWhiteSpace(vm.StatusText));
        }
        finally
        {
            Directory.Delete(root, recursive: true);
        }
    }
}
