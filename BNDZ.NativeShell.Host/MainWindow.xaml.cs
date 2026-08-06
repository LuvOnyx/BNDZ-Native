using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using BNDZ.NativeShell.Core.Models;
using BNDZ.NativeShell.Core.Services;
using BNDZ.NativeShell.Core.ViewModels;

namespace BNDZ.NativeShell.Host;

public partial class MainWindow : Window
{
    private readonly ShellViewModel _vm;

    public MainWindow()
    {
        InitializeComponent();
        _vm = new ShellViewModel(
            new LocalFolderCatalog(),
            new LocalDriveCatalog(),
            new LocalPreviewBuilder());
        DataContext = _vm;
        Loaded += OnLoaded;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        Loaded -= OnLoaded;
        await _vm.InitializeAsync();
    }

    private void Omnibar_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
        {
            if (_vm.SubmitOmnibarCommand.CanExecute(null))
                _vm.SubmitOmnibarCommand.Execute(null);
            e.Handled = true;
        }
    }

    private void FileList_MouseDoubleClick(object sender, MouseButtonEventArgs e)
    {
        if (FileList.SelectedItem is FileEntry entry &&
            _vm.ActivateEntryCommand.CanExecute(entry))
        {
            _vm.ActivateEntryCommand.Execute(entry);
        }
    }

    private void FileList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        _vm.SelectedEntry = FileList.SelectedItem as FileEntry;
    }

    private void DriveList_MouseLeftButtonUp(object sender, MouseButtonEventArgs e)
    {
        if (DriveList.SelectedItem is DriveEntry drive &&
            _vm.OpenDriveCommand.CanExecute(drive))
        {
            _vm.OpenDriveCommand.Execute(drive);
        }
    }

    private void Tab_Click(object sender, RoutedEventArgs e)
    {
        if (sender is FrameworkElement { DataContext: ShellTab tab } &&
            _vm.SelectTabCommand.CanExecute(tab))
        {
            _vm.SelectTabCommand.Execute(tab);
        }
    }

    private void TabClose_Click(object sender, RoutedEventArgs e)
    {
        e.Handled = true;
        if (sender is FrameworkElement { DataContext: ShellTab tab } &&
            _vm.CloseTabCommand.CanExecute(tab))
        {
            _vm.CloseTabCommand.Execute(tab);
        }
    }
}
