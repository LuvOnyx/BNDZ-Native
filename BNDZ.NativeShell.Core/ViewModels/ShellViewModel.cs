using BNDZ.NativeShell.Core.Contracts;
using BNDZ.NativeShell.Core.Models;
using CommunityToolkit.Mvvm.ComponentModel;
using CommunityToolkit.Mvvm.Input;

namespace BNDZ.NativeShell.Core.ViewModels;

/// <summary>
/// Shell orchestration for the native WinUI host.
/// Layout proportions match BNDZ classic outer columns: sidebar ~17% / content ~71% / preview ~12%.
/// </summary>
public partial class ShellViewModel : ObservableObject
{
    private readonly IFolderCatalog _folders;
    private readonly IDriveCatalog _drives;
    private readonly IPreviewBuilder _preview;
    private CancellationTokenSource? _listCts;
    private CancellationTokenSource? _previewCts;

    public ShellViewModel(IFolderCatalog folders, IDriveCatalog drives, IPreviewBuilder preview)
    {
        _folders = folders;
        _drives = drives;
        _preview = preview;

        var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        if (string.IsNullOrWhiteSpace(home) || !Directory.Exists(home))
            home = Directory.GetCurrentDirectory();

        Tabs.Add(new ShellTab { Path = home, Title = TitleFor(home) });
        ActiveTab = Tabs[0];
        CurrentPath = home;
    }

    public ObservableCollectionEx<ShellTab> Tabs { get; } = new();
    public ObservableCollectionEx<DriveEntry> Drives { get; } = new();
    public ObservableCollectionEx<FileEntry> Entries { get; } = new();

    [ObservableProperty] private ShellTab? _activeTab;
    [ObservableProperty] private string _currentPath = string.Empty;
    [ObservableProperty] private string _statusText = "Ready";
    [ObservableProperty] private string _omnibarText = string.Empty;
    [ObservableProperty] private FileEntry? _selectedEntry;
    [ObservableProperty] private PreviewSnapshot _previewSnapshot = PreviewSnapshot.Empty;
    [ObservableProperty] private bool _isLoading;
    [ObservableProperty] private string _errorText = string.Empty;

    partial void OnActiveTabChanged(ShellTab? value)
    {
        if (value is null) return;
        _ = NavigateAsync(value.Path);
    }

    partial void OnSelectedEntryChanged(FileEntry? value)
    {
        _ = RefreshPreviewAsync(value?.FullPath);
    }

    partial void OnCurrentPathChanged(string value)
    {
        OmnibarText = value;
    }

    public async Task InitializeAsync()
    {
        var drives = await _drives.ListAsync().ConfigureAwait(false);
        Drives.ReplaceAll(drives);
        await NavigateAsync(CurrentPath).ConfigureAwait(false);
    }

    [RelayCommand]
    private async Task NavigateAsync(string? path)
    {
        if (string.IsNullOrWhiteSpace(path))
            return;

        string full;
        try { full = Path.GetFullPath(path); }
        catch
        {
            ErrorText = "Invalid path.";
            return;
        }

        if (!_folders.Exists(full) || !Directory.Exists(full))
        {
            ErrorText = "Folder not found.";
            return;
        }

        _listCts?.Cancel();
        _listCts = new CancellationTokenSource();
        var ct = _listCts.Token;

        IsLoading = true;
        ErrorText = string.Empty;
        try
        {
            var items = await _folders.ListAsync(full, ct).ConfigureAwait(false);
            if (ct.IsCancellationRequested) return;

            Entries.ReplaceAll(items);
            CurrentPath = full;
            if (ActiveTab is not null)
            {
                ActiveTab.Path = full;
                ActiveTab.Title = TitleFor(full);
            }

            StatusText = $"{items.Count} item{(items.Count == 1 ? "" : "s")}";
            SelectedEntry = null;
            PreviewSnapshot = PreviewSnapshot.Empty;
        }
        catch (OperationCanceledException)
        {
            // superseded navigation
        }
        catch (Exception ex)
        {
            ErrorText = ex.Message;
            StatusText = "Navigation failed";
        }
        finally
        {
            IsLoading = false;
        }
    }

    [RelayCommand]
    private Task GoUpAsync()
    {
        var parent = _folders.GetParent(CurrentPath);
        return parent is null ? Task.CompletedTask : NavigateAsync(parent);
    }

    [RelayCommand]
    private Task SubmitOmnibarAsync() => NavigateAsync(OmnibarText);

    [RelayCommand]
    private Task OpenDriveAsync(DriveEntry? drive) =>
        drive is null ? Task.CompletedTask : NavigateAsync(drive.Path);

    [RelayCommand]
    private async Task ActivateEntryAsync(FileEntry? entry)
    {
        if (entry is null) return;
        if (entry.IsDirectory)
        {
            await NavigateAsync(entry.FullPath).ConfigureAwait(false);
            return;
        }

        SelectedEntry = entry;
        await RefreshPreviewAsync(entry.FullPath).ConfigureAwait(false);
    }

    [RelayCommand]
    private void NewTab()
    {
        var path = string.IsNullOrWhiteSpace(CurrentPath)
            ? Environment.GetFolderPath(Environment.SpecialFolder.UserProfile)
            : CurrentPath;
        var tab = new ShellTab { Path = path, Title = TitleFor(path) };
        Tabs.Add(tab);
        ActiveTab = tab;
    }

    [RelayCommand]
    private void CloseTab(ShellTab? tab)
    {
        if (tab is null || Tabs.Count <= 1) return;
        var closingActive = ReferenceEquals(tab, ActiveTab);
        Tabs.Remove(tab);
        if (closingActive)
            ActiveTab = Tabs[^1];
    }

    [RelayCommand]
    private void SelectTab(ShellTab? tab)
    {
        if (tab is null) return;
        ActiveTab = tab;
    }

    private async Task RefreshPreviewAsync(string? path)
    {
        _previewCts?.Cancel();
        _previewCts = new CancellationTokenSource();
        var ct = _previewCts.Token;
        try
        {
            var snap = await _preview.BuildAsync(path, ct).ConfigureAwait(false);
            if (!ct.IsCancellationRequested)
                PreviewSnapshot = snap;
        }
        catch (OperationCanceledException)
        {
        }
    }

    private static string TitleFor(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "Home";
        var name = Path.GetFileName(path.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar));
        return string.IsNullOrEmpty(name) ? path : name;
    }
}

/// <summary>Minimal observable list helper (no WinUI dependency).</summary>
public sealed class ObservableCollectionEx<T> : System.Collections.ObjectModel.ObservableCollection<T>
{
    public void ReplaceAll(IEnumerable<T> items)
    {
        Clear();
        foreach (var item in items)
            Add(item);
    }
}
