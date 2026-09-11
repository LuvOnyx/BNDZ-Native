using BNDZ.NativeShell.Core.Services;
using BNDZ.NativeShell.Core.ViewModels;
using BNDZ.NativeShell.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Windows.System;
using Windows.UI.Core;

namespace BNDZ.NativeShell;

/// <summary>
/// Destination WinUI host. Same <see cref="ShellViewModel"/> as the WPF comparison host.
/// Layout mirrors Files topology (tabs / omnibar / sidebar / content / preview) without importing Files sources.
/// </summary>
public sealed partial class MainWindow : Window
{
    private readonly ShellViewModel _vm;

    private readonly ThemeService _themeService;

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
        // Use CoreWindow for global key events to avoid XAML island issues
        CoreWindow.GetForCurrentThread().KeyDown += MainWindow_KeyDown;

        // Initialize theme service for Windows theme synchronization
        _themeService = new ThemeService(this);
        _themeService.StartListening();
    }

    private async void OnActivated(object sender, Microsoft.UI.Xaml.WindowActivatedEventArgs args)
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
        // Alt+D or Ctrl+L: Focus on omnibar (address bar)
        else if ((e.Key == Windows.System.VirtualKey.D && e.KeyStatus.IsMenuKeyDown) ||
                 (e.Key == Windows.System.VirtualKey.L &&
                  (CoreWindow.GetForCurrentThread().GetKeyState(Windows.System.VirtualKey.Control) & CoreVirtualKeyStates.Down) == CoreVirtualKeyStates.Down))
        {
            OmnibarTextBox?.Focus(FocusState.Programmatic);
            e.Handled = true;
        }
    }

    private void MainWindow_KeyDown(CoreWindow sender, KeyEventArgs e)
    {
        // Handle global keyboard shortcuts
        if (_vm == null) return;

        var ctrl = (CoreWindow.GetForCurrentThread().GetKeyState(VirtualKey.Control) & CoreVirtualKeyStates.Down) == CoreVirtualKeyStates.Down;
        var shift = (CoreWindow.GetForCurrentThread().GetKeyState(VirtualKey.Shift) & CoreVirtualKeyStates.Down) == CoreVirtualKeyStates.Down;
        var menu = (CoreWindow.GetForCurrentThread().GetKeyState(VirtualKey.Menu) & CoreVirtualKeyStates.Down) == CoreVirtualKeyStates.Down;

        // Backspace: Go up one level
        if (e.VirtualKey == Windows.System.VirtualKey.Back &&
            !menu && // Not Alt+Backspace
            _vm.GoUpCommand.CanExecute(null))
        {
            _vm.GoUpCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Alt+Up: Go up
        if (e.VirtualKey == Windows.System.VirtualKey.Up &&
            menu && // Alt+Up
            _vm.GoUpCommand.CanExecute(null))
        {
            _vm.GoUpCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Delete: Delete selected item
        if (e.VirtualKey == Windows.System.VirtualKey.Delete &&
            !menu && // Not Alt+Delete
            _vm.DeleteCommand.CanExecute(null))
        {
            _vm.DeleteCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Shift+Delete: Permanently delete
        if (e.VirtualKey == Windows.System.VirtualKey.Delete &&
            shift && // Shift key
            !menu && // Not Alt+Shift+Delete
            _vm.PermanentDeleteCommand.CanExecute(null))
        {
            _vm.PermanentDeleteCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // F2: Rename selected item
        if (e.VirtualKey == Windows.System.VirtualKey.F2 &&
            _vm.RenameCommand.CanExecute(null))
        {
            _vm.RenameCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Ctrl+A: Select all
        if (e.VirtualKey == Windows.System.VirtualKey.A &&
            ctrl &&
            !shift && // Not Ctrl+Shift+A
            !menu && // Not Ctrl+Alt+A
            _vm.SelectAllCommand.CanExecute(null))
        {
            _vm.SelectAllCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Ctrl+C: Copy
        if (e.VirtualKey == Windows.System.VirtualKey.C &&
            ctrl &&
            !shift && // Not Ctrl+Shift+C
            !menu && // Not Ctrl+Alt+C
            _vm.CopyCommand.CanExecute(null))
        {
            _vm.CopyCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Ctrl+X: Cut
        if (e.VirtualKey == Windows.System.VirtualKey.X &&
            ctrl &&
            !shift && // Not Ctrl+Shift+X
            !menu && // Not Ctrl+Alt+X
            _vm.CutCommand.CanExecute(null))
        {
            _vm.CutCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Ctrl+V: Paste
        if (e.VirtualKey == Windows.System.VirtualKey.V &&
            ctrl &&
            !shift && // Not Ctrl+Shift+V
            !menu && // Not Ctrl+Alt+V
            _vm.PasteCommand.CanExecute(null))
        {
            _vm.PasteCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // F3: Search/focus search
        if (e.VirtualKey == Windows.System.VirtualKey.F3 &&
            _vm.FocusSearchCommand.CanExecute(null))
        {
            _vm.FocusSearchCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Alt+Enter: Properties
        if (e.VirtualKey == Windows.System.VirtualKey.Enter &&
            menu && // Alt+Enter
            _vm.ShowPropertiesCommand.CanExecute(null))
        {
            _vm.ShowPropertiesCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Ctrl+Shift+N: New folder
        if (e.VirtualKey == Windows.System.VirtualKey.N &&
            ctrl &&
            shift && // Ctrl+Shift+N
            !menu && // Not Alt+Ctrl+Shift+N
            _vm.CreateFolderCommand.CanExecute(null))
        {
            _vm.CreateFolderCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Alt+Left: Go back
        if (e.VirtualKey == Windows.System.VirtualKey.Left &&
            menu && // Alt+Left
            _vm.GoBackCommand.CanExecute(null))
        {
            _vm.GoBackCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Alt+Right: Go forward
        if (e.VirtualKey == Windows.System.VirtualKey.Right &&
            menu && // Alt+Right
            _vm.GoForwardCommand.CanExecute(null))
        {
            _vm.GoForwardCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Alt+Up: Go up
        if (e.VirtualKey == Windows.System.VirtualKey.Up &&
            menu && // Alt+Up
            _vm.GoUpCommand.CanExecute(null))
        {
            _vm.GoUpCommand.Execute(null);
            e.Handled = true;
            return;
        }

        // Alt+P: Preview pane
        if (e.VirtualKey == Windows.System.VirtualKey.P &&
            menu && // Alt+P
            _vm.TogglePreviewPaneCommand.CanExecute(null))
        {
            _vm.TogglePreviewPaneCommand.Execute(null);
            e.Handled = true;
            return;
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
