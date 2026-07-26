using System.IO.Hashing;
using System.Text;

namespace BNDZ.Services.Mesh;

/// <summary>Content-addressed local cache for remote mesh files.</summary>
public sealed class MeshCacheService
{
    private readonly string _blobRoot;

    public MeshCacheService()
    {
        _blobRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BNDZ", "Mesh", "blobs");
        Directory.CreateDirectory(_blobRoot);
    }

    public string BlobPathForHash(string hash) =>
        Path.Combine(_blobRoot, hash[..2], hash);

    public async Task<string> StoreAsync(Stream source, CancellationToken ct = default)
    {
        var temp = Path.Combine(Path.GetTempPath(), $"bndz-mesh-{Guid.NewGuid():N}.tmp");
        await using (var fs = File.Create(temp))
        {
            await source.CopyToAsync(fs, ct).ConfigureAwait(false);
        }
        var hash = await ComputeFileHashHexAsync(temp, ct).ConfigureAwait(false);
        var dest = BlobPathForHash(hash);
        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
        if (!File.Exists(dest)) File.Move(temp, dest);
        else File.Delete(temp);
        return dest;
    }

    public async Task<string> EnsureCachedAsync(IMeshProvider provider, string hostId, string remotePath, CancellationToken ct = default)
    {
        var hash = Convert.ToHexString(XxHash64.Hash(Encoding.UTF8.GetBytes($"{hostId}:{remotePath}"))).ToLowerInvariant();
        var dest = BlobPathForHash(hash);
        if (File.Exists(dest) && new FileInfo(dest).Length > 0) return dest;
        Directory.CreateDirectory(Path.GetDirectoryName(dest)!);
        await provider.DownloadAsync(remotePath, dest, null, ct).ConfigureAwait(false);
        return dest;
    }

    public static async Task<string> ComputeFileHashHexAsync(string path, CancellationToken ct = default)
    {
        await using var fs = File.OpenRead(path);
        var hasher = new XxHash64();
        var buffer = new byte[81920];
        int read;
        while ((read = await fs.ReadAsync(buffer, ct).ConfigureAwait(false)) > 0)
            hasher.Append(buffer.AsSpan(0, read));
        return Convert.ToHexString(hasher.GetCurrentHash()).ToLowerInvariant();
    }

    private static Encoding Encoding => System.Text.Encoding.UTF8;
}
