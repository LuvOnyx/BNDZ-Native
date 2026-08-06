using BNDZ.NativeShell.Core.Services;
using BNDZ.NativeShell.Core.ViewModels;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace BNDZ.NativeShell;

/// <summary>
/// Destination WinUI host. Same <see cref="ShellViewModel"/> as the WPF comparison host.
/// Layout mirrors Files topology (tabs / omnibar / sidebar / content / preview) without importing Files sources.
/// </summary>
public sealed partial class MainWindow : Window
{
    private readonly ShellViewModel _vm;

    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);

        _vm = new ShellViewModel(
            new LocalFolderCatalog(),
            new LocalDriveCatalog(),
            new LocalPreviewBuilder());
        RootGrid.DataContext = _vm;
        Activated += OnActivated;
    }

    private async void OnActivated(object sender, WindowActivatedEventArgs args)
    {
        Activated -= OnActivated;
        await _vm.InitializeAsync();
    }

    private void Omnibar_KeyDown(object sender, Microsoft.UI.Xaml.Input.KeyRoutedEventArgs e)
    {
        if (e.Key == Windows.System.VirtualKey.Enter &&
            _vm.SubmitOmnibarCommand.CanExecute(null))
        {
            _vm.SubmitOmnibarCommand.Execute(null);
            e.Handled = true;
        }
    }

    private void DriveList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is Core.Models.DriveEntry drive &&
            _vm.OpenDriveCommand.CanExecute(drive))
        {
            _vm.OpenDriveCommand.Execute(drive);
        }
    }

    private void FileList_ItemClick(object sender, ItemClickEventArgs e)
    {
        if (e.ClickedItem is Core.Models.FileEntry entry)
            _vm.SelectedEntry = entry;
    }

    private void FileList_DoubleTapped(object sender, Microsoft.UI.Xaml.Input.DoubleTappedRoutedEventArgs e)
    {
        if (FileList.SelectedItem is Core.Models.FileEntry entry &&
            _vm.ActivateEntryCommand.CanExecute(entry))
        {
            _vm.ActivateEntryCommand.Execute(entry);
        }
    }
}
