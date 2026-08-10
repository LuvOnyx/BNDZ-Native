using System.Text.Json;
using BNDZShell.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Windows.Storage;

namespace BNDZShell.Bndz;

/// <summary>Native WinUI list — owns the center HWND cell in the split shell.</summary>
public sealed partial class NativeListHost : UserControl
{
    private readonly NativeFileListViewModel _vm = new();
    public event EventHandler<NativeListContextEventArgs>? ContextChanged;

    public NativeListHost()
    {
        InitializeComponent();
        DataContext = _vm;
        FileList.ItemsSource = _vm.Items;
        _vm.PropertyChanged += (_, e) =>
        {
            if (e.PropertyName is nameof(NativeFileListViewModel.CurrentPath))
                RaiseContext();
        };
    }

    public NativeFileListViewModel ViewModel => _vm;

    /// <summary>Overlay bounds — collapsed under full-window BNDZUI (HWND airspace).</summary>
    public void ApplyListBounds(double x, double y, double width, double height, bool visible)
    {
        if (!visible || width < 8 || height < 8)
        {
            Visibility = Visibility.Collapsed;
            IsHitTestVisible = false;
            return;
        }

        Margin = new Thickness(x, y, 0, 0);
        Width = width;
        Height = height;
        Visibility = Visibility.Visible;
        IsHitTestVisible = true;
    }

    public void ShowInGrid()
    {
        ClearValue(WidthProperty);
        ClearValue(HeightProperty);
        ClearValue(MarginProperty);
        HorizontalAlignment = HorizontalAlignment.Stretch;
        VerticalAlignment = VerticalAlignment.Stretch;
        Visibility = Visibility.Visible;
        IsHitTestVisible = true;
    }

    public async Task NavigateAsync(string path)
    {
        await _vm.NavigateAsync(path).ConfigureAwait(true);
        PushDirListing(complete: true);
        RaiseContext();
    }

    public void PushDirListing(bool complete = true)
    {
        var rows = _vm.Items.Select(row => new
        {
            id = row.FullPath,
            name = row.Name,
            path = row.FullPath,
            type = row.IsDirectory ? "directory" : "file",
            size = row.Size,
            modified = row.Modified,
            extension = row.IsDirectory ? "" : System.IO.Path.GetExtension(row.Name).TrimStart('.'),
            isDirectory = row.IsDirectory,
        }).ToList();

        ContextChanged?.Invoke(this, new NativeListContextEventArgs
        {
            Kind = NativeListContextKind.DirListing,
            Path = _vm.CurrentPath,
            ListingJson = JsonSerializer.Serialize(new
            {
                type = "BNDZ_DIR_LISTING",
                payload = new { path = _vm.CurrentPath, complete, items = rows },
            }),
        });
        RaiseContext();
    }

    private void RaiseContext()
    {
        var rows = FileList.SelectedItems.OfType<FileListRowItem>().ToList();
        if (rows.Count == 0 && FileList.SelectedItem is FileListRowItem single)
            rows = [single];

        ContextChanged?.Invoke(this, new NativeListContextEventArgs
        {
            Kind = NativeListContextKind.Selection,
            Path = _vm.CurrentPath,
            SelectedPaths = rows.Count > 0 ? rows.Select(r => r.FullPath).ToArray() : null,
            SelectedNames = rows.Count > 0 ? rows.Select(r => r.Name).ToArray() : null,
            SelectedTypes = rows.Count > 0 ? rows.Select(r => r.TypeLabel).ToArray() : null,
            SelectedSizes = rows.Count > 0 ? rows.Select(r => r.Size).ToArray() : null,
            SelectedModified = rows.Count > 0 ? rows.Select(r => r.Modified).ToArray() : null,
        });
    }

    private async void FileList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is not FileListRowItem row) return;
        if (row.IsDirectory)
        {
            await _vm.NavigateAsync(row.FullPath).ConfigureAwait(true);
            PushDirListing(complete: true);
            return;
        }

        try
        {
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
            {
                FileName = row.FullPath,
                UseShellExecute = true,
            });
        }
        catch { /* ignore */ }
    }

    private void FileList_SelectionChanged(object sender, SelectionChangedEventArgs e) => RaiseContext();

    private async void FileList_DragItemsStarting(object sender, DragItemsStartingEventArgs e)
    {
        var rows = FileList.SelectedItems.OfType<FileListRowItem>().ToList();
        if (rows.Count == 0 && e.Items.FirstOrDefault() is FileListRowItem single)
            rows = [single];

        var storageItems = new List<IStorageItem>();
        foreach (var row in rows)
        {
            if (row.Name == "..") continue;
            try
            {
                if (row.IsDirectory)
                    storageItems.Add(await StorageFolder.GetFolderFromPathAsync(row.FullPath));
                else
                    storageItems.Add(await StorageFile.GetFileFromPathAsync(row.FullPath));
            }
            catch { /* skip */ }
        }

        if (storageItems.Count == 0) return;
        e.Data.SetStorageItems(storageItems);
        e.Cancel = false;
    }
}

public enum NativeListContextKind
{
    Selection,
    DirListing,
}

public sealed class NativeListContextEventArgs : EventArgs
{
    public NativeListContextKind Kind { get; init; }
    public string? Path { get; init; }
    public string[]? SelectedPaths { get; init; }
    public string[]? SelectedNames { get; init; }
    public string[]? SelectedTypes { get; init; }
    public long[]? SelectedSizes { get; init; }
    public string[]? SelectedModified { get; init; }
    public string? ListingJson { get; init; }
}
