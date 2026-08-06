using BNDZ.NativeShell.Core.Contracts;
using BNDZ.NativeShell.Core.Models;

namespace BNDZ.NativeShell.Core.Services;

/// <summary>Enumerates logical drives + a few special roots. Later: BndzNamespaceService.</summary>
public sealed class LocalDriveCatalog : IDriveCatalog
{
    public Task<IReadOnlyList<DriveEntry>> ListAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        var list = new List<DriveEntry>();

        try
        {
            foreach (var drive in DriveInfo.GetDrives())
            {
                ct.ThrowIfCancellationRequested();
                if (!drive.IsReady)
                    continue;

                var kind = drive.DriveType switch
                {
                    DriveType.Removable => DriveKind.Removable,
                    DriveType.Network => DriveKind.Network,
                    _ => DriveKind.Fixed,
                };

                string label;
                try
                {
                    label = string.IsNullOrWhiteSpace(drive.VolumeLabel)
                        ? drive.Name.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
                        : $"{drive.VolumeLabel} ({drive.Name.TrimEnd('\\', '/')})";
                }
                catch
                {
                    label = drive.Name;
                }

                long? total = null;
                long? free = null;
                try
                {
                    total = drive.TotalSize;
                    free = drive.AvailableFreeSpace;
                }
                catch
                {
                    // ignore capacity probe failures
                }

                list.Add(new DriveEntry
                {
                    Id = drive.Name,
                    Label = label,
                    Path = drive.RootDirectory.FullName,
                    Kind = kind,
                    TotalBytes = total,
                    FreeBytes = free,
                });
            }
        }
        catch
        {
            // fall through with specials only
        }

        // Special locations — always present for a usable sidebar on any OS.
        AddSpecial(list, "home", "Home", Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
        AddSpecial(list, "desktop", "Desktop", Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory));
        AddSpecial(list, "docs", "Documents", Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));
        AddSpecial(list, "downloads", "Downloads", Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads"));

        return Task.FromResult<IReadOnlyList<DriveEntry>>(list);
    }

    private static void AddSpecial(List<DriveEntry> list, string id, string label, string? path)
    {
        if (string.IsNullOrWhiteSpace(path) || !Directory.Exists(path))
            return;
        if (list.Any(d => string.Equals(d.Path, path, StringComparison.OrdinalIgnoreCase)))
            return;

        list.Add(new DriveEntry
        {
            Id = id,
            Label = label,
            Path = path,
            Kind = DriveKind.Special,
        });
    }
}
