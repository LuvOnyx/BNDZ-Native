using CommunityToolkit.Mvvm.ComponentModel;
using System.Collections.ObjectModel;
using System.Text.Json;

namespace BNDZShell.ViewModels;

public sealed partial class FileListRowItem : ObservableObject
{
    public string Name { get; init; } = "";
    public string FullPath { get; init; } = "";
    public bool IsDirectory { get; init; }
    public long Size { get; init; }
    public string Modified { get; init; } = "";
    public string TypeLabel { get; init; } = "";
    public string SizeLabel => IsDirectory ? "" : FormatBytes(Size);

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        double kb = bytes / 1024.0;
        if (kb < 1024) return $"{kb:0.#} KB";
        double mb = kb / 1024.0;
        if (mb < 1024) return $"{mb:0.#} MB";
        double gb = mb / 1024.0;
        return $"{gb:0.##} GB";
    }
}

public sealed partial class NativeFileListViewModel : ObservableObject
{
    public ObservableCollection<FileListRowItem> Items { get; } = new();

    [ObservableProperty]
    private string _currentPath = "/";

    [ObservableProperty]
    private string _statusText = "Ready";

    [ObservableProperty]
    private bool _isLoading;

    public static bool IsVirtualShellPath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return false;
        var p = path.Trim();
        if (p is "/" or "\\") return true;
        if (p.StartsWith("::", StringComparison.Ordinal)) return true;
        if (p.StartsWith("shell:", StringComparison.OrdinalIgnoreCase)) return true;
        if (p.StartsWith("/shell:", StringComparison.OrdinalIgnoreCase)) return true;
        if (p.StartsWith("/bndz/", StringComparison.OrdinalIgnoreCase)) return true;
        return false;
    }

    public async Task NavigateAsync(string path, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(path)) return;
        var normalized = path.Trim();

        if (!IsVirtualShellPath(normalized))
        {
            if (!Directory.Exists(normalized) && !File.Exists(normalized))
            {
                StatusText = "Path not found";
                return;
            }
            if (File.Exists(normalized))
                normalized = Path.GetDirectoryName(normalized) ?? normalized;
        }

        CurrentPath = normalized;
        await LoadDirectoryAsync(normalized, ct).ConfigureAwait(false);
    }

    public async Task LoadDirectoryAsync(string path, CancellationToken ct = default)
    {
        IsLoading = true;
        StatusText = "Loading…";
        Items.Clear();

        try
        {
            using var doc = await Bndz.BndzInProcessClient.InvokeAsync("GET_DIR_CONTENTS", new { path }, ct).ConfigureAwait(false);
            if (doc is null)
            {
                if (!IsVirtualShellPath(path))
                    await LoadViaShellEnumerateAsync(path, ct).ConfigureAwait(false);
                else
                    StatusText = "Backend returned empty listing";
                return;
            }

            if (!TryReadItems(doc.RootElement, out var itemsEl))
            {
                if (!IsVirtualShellPath(path))
                    await LoadViaShellEnumerateAsync(path, ct).ConfigureAwait(false);
                else
                    StatusText = "Backend listing parse failed";
                return;
            }

            foreach (var item in itemsEl.EnumerateArray())
            {
                var row = ParseItem(item);
                if (row is not null) Items.Add(row);
            }
            StatusText = $"{Items.Count} items";
        }
        catch (Exception ex)
        {
            StatusText = ex.Message;
            if (!IsVirtualShellPath(path))
                await LoadViaShellEnumerateAsync(path, ct).ConfigureAwait(false);
        }
        finally
        {
            IsLoading = false;
        }
    }

    /// <summary>Accepts both classic array payload and backend-host { items: [...] }.</summary>
    private static bool TryReadItems(JsonElement root, out JsonElement itemsEl)
    {
        itemsEl = default;
        if (!root.TryGetProperty("payload", out var payload)) return false;
        if (payload.ValueKind == JsonValueKind.Array)
        {
            itemsEl = payload;
            return true;
        }
        if (payload.ValueKind == JsonValueKind.Object
            && payload.TryGetProperty("items", out itemsEl)
            && itemsEl.ValueKind == JsonValueKind.Array)
        {
            return true;
        }
        return false;
    }

    private static FileListRowItem? ParseItem(JsonElement item)
    {
        var name = item.TryGetProperty("name", out var n) ? n.GetString() : null;
        var fullPath = item.TryGetProperty("path", out var p) ? p.GetString() : null;
        if (string.IsNullOrWhiteSpace(name) || string.IsNullOrWhiteSpace(fullPath)) return null;
        var type = item.TryGetProperty("type", out var ty) ? ty.GetString() ?? "" : "";
        var isDir = item.TryGetProperty("isDirectory", out var d) && d.ValueKind == JsonValueKind.True
            || type.Equals("folder", StringComparison.OrdinalIgnoreCase)
            || type.Equals("directory", StringComparison.OrdinalIgnoreCase)
            || type.Equals("drive", StringComparison.OrdinalIgnoreCase);
        long size = item.TryGetProperty("size", out var s) && s.TryGetInt64(out var sz) ? sz : 0;
        var modified = item.TryGetProperty("modified", out var m) ? m.GetString() ?? "" : "";
        return new FileListRowItem
        {
            Name = name,
            FullPath = fullPath,
            IsDirectory = isDir,
            Size = size,
            Modified = modified,
            TypeLabel = string.IsNullOrEmpty(type) ? (isDir ? "folder" : "file") : type,
        };
    }

    private Task LoadViaShellEnumerateAsync(string path, CancellationToken ct)
    {
        return Task.Run(() =>
        {
            ct.ThrowIfCancellationRequested();
            var parent = Directory.GetParent(path);
            if (parent is not null)
            {
                Items.Add(new FileListRowItem
                {
                    Name = "..",
                    FullPath = parent.FullName,
                    IsDirectory = true,
                    TypeLabel = "folder",
                });
            }

            foreach (var dir in Directory.EnumerateDirectories(path))
            {
                ct.ThrowIfCancellationRequested();
                var info = new DirectoryInfo(dir);
                Items.Add(new FileListRowItem
                {
                    Name = info.Name,
                    FullPath = info.FullName,
                    IsDirectory = true,
                    Modified = info.LastWriteTimeUtc.ToString("o"),
                    TypeLabel = "folder",
                });
            }

            foreach (var file in Directory.EnumerateFiles(path))
            {
                ct.ThrowIfCancellationRequested();
                var info = new FileInfo(file);
                Items.Add(new FileListRowItem
                {
                    Name = info.Name,
                    FullPath = info.FullName,
                    IsDirectory = false,
                    Size = info.Length,
                    Modified = info.LastWriteTimeUtc.ToString("o"),
                    TypeLabel = Path.GetExtension(info.Name).TrimStart('.'),
                });
            }

            StatusText = $"{Items.Count} items";
        }, ct);
    }
}
