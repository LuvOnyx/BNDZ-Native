using BNDZ.NativeShell.Core.Models;

namespace BNDZ.NativeShell.Core.Contracts;

public interface IDriveCatalog
{
    Task<IReadOnlyList<DriveEntry>> ListAsync(CancellationToken ct = default);
}
