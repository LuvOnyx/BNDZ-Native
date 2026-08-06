using BNDZ.NativeShell.Core.Models;

namespace BNDZ.NativeShell.Core.Contracts;

public interface IPreviewBuilder
{
    Task<PreviewSnapshot> BuildAsync(string? path, CancellationToken ct = default);
}
