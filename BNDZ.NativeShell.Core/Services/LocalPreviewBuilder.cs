using BNDZ.NativeShell.Core.Contracts;
using BNDZ.NativeShell.Core.Models;

namespace BNDZ.NativeShell.Core.Services;

/// <summary>Basic metadata preview. Later: Property Store / FilePreviewMetaService.</summary>
public sealed class LocalPreviewBuilder : IPreviewBuilder
{
    public Task<PreviewSnapshot> BuildAsync(string? path, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        if (string.IsNullOrWhiteSpace(path))
            return Task.FromResult(PreviewSnapshot.Empty);

        try
        {
            if (Directory.Exists(path))
            {
                var dir = new DirectoryInfo(path);
                var childCount = 0;
                try { childCount = dir.EnumerateFileSystemInfos().Take(5001).Count(); }
                catch { /* access denied */ }

                return Task.FromResult(new PreviewSnapshot
                {
                    Title = dir.Name,
                    Subtitle = "Folder",
                    FullPath = dir.FullName,
                    IsDirectory = true,
                    Facts =
                    [
                        new PreviewFact { Label = "Path", Value = dir.FullName },
                        new PreviewFact { Label = "Modified", Value = dir.LastWriteTime.ToString("g") },
                        new PreviewFact { Label = "Items", Value = childCount > 5000 ? "5000+" : childCount.ToString() },
                        new PreviewFact { Label = "Attributes", Value = dir.Attributes.ToString() },
                    ],
                });
            }

            if (File.Exists(path))
            {
                var file = new FileInfo(path);
                return Task.FromResult(new PreviewSnapshot
                {
                    Title = file.Name,
                    Subtitle = string.IsNullOrEmpty(file.Extension)
                        ? "File"
                        : file.Extension.TrimStart('.').ToUpperInvariant(),
                    FullPath = file.FullName,
                    IsDirectory = false,
                    Facts =
                    [
                        new PreviewFact { Label = "Path", Value = file.FullName },
                        new PreviewFact { Label = "Size", Value = FormatBytes(file.Length) },
                        new PreviewFact { Label = "Modified", Value = file.LastWriteTime.ToString("g") },
                        new PreviewFact { Label = "Created", Value = file.CreationTime.ToString("g") },
                        new PreviewFact { Label = "Attributes", Value = file.Attributes.ToString() },
                    ],
                });
            }
        }
        catch
        {
            return Task.FromResult(new PreviewSnapshot
            {
                Title = Path.GetFileName(path) ?? path,
                Subtitle = "Unavailable",
                FullPath = path,
                Facts = [new PreviewFact { Label = "Path", Value = path }],
            });
        }

        return Task.FromResult(PreviewSnapshot.Empty);
    }

    private static string FormatBytes(long bytes)
    {
        if (bytes < 1024) return $"{bytes} B";
        double value = bytes;
        string[] units = ["KB", "MB", "GB", "TB"];
        var unit = -1;
        do
        {
            value /= 1024;
            unit++;
        } while (value >= 1024 && unit < units.Length - 1);
        return $"{value:0.#} {units[unit]}";
    }
}
