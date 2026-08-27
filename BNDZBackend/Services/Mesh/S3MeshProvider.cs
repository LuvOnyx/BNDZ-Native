using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;

namespace BNDZ.Services.Mesh;

/// <summary>S3-compatible storage (AWS, R2, MinIO, etc.) via AWSSDK.S3.</summary>
public sealed class S3MeshProvider : IMeshProvider
{
    private MeshHostRecord? _host;
    private string? _secret;
    private IAmazonS3? _client;
    private string? _bucket;

    public MeshProviderKind Kind => MeshProviderKind.S3;
    public bool IsConnected { get; private set; }

    public Task ConnectAsync(MeshHostRecord host, CancellationToken ct = default)
    {
        _host = host;
        _secret = MeshCredentialVault.Unprotect(host.ProtectedSecret);
        _bucket = host.S3Bucket ?? throw new InvalidOperationException("S3 bucket required");
        var endpoint = host.S3Endpoint ?? "https://s3.amazonaws.com";
        var (serviceUrl, useHttps) = ParseEndpoint(endpoint);
        var config = new AmazonS3Config
        {
            ServiceURL = serviceUrl,
            ForcePathStyle = true,
            UseHttp = !useHttps,
        };
        if (!string.IsNullOrWhiteSpace(host.S3Region))
            config.AuthenticationRegion = host.S3Region;
        var creds = new BasicAWSCredentials(host.S3AccessKeyId ?? "", _secret ?? "");
        _client = new AmazonS3Client(creds, config);
        IsConnected = true;
        return Task.CompletedTask;
    }

    private static (string ServiceUrl, bool UseHttps) ParseEndpoint(string endpoint)
    {
        var raw = endpoint.Trim();
        var useHttps = raw.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            || (!raw.StartsWith("http://", StringComparison.OrdinalIgnoreCase) && raw.Contains("amazonaws", StringComparison.OrdinalIgnoreCase));
        var stripped = raw
            .Replace("https://", "", StringComparison.OrdinalIgnoreCase)
            .Replace("http://", "", StringComparison.OrdinalIgnoreCase)
            .TrimEnd('/');
        var serviceUrl = useHttps ? $"https://{stripped}" : $"http://{stripped}";
        return (serviceUrl, useHttps);
    }

    public async Task<IReadOnlyList<MeshDirEntry>> ListAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        var prefix = remotePath.TrimStart('/');
        if (!string.IsNullOrEmpty(prefix) && !prefix.EndsWith('/')) prefix += "/";
        var request = new ListObjectsV2Request
        {
            BucketName = _bucket,
            Prefix = prefix,
            Delimiter = "/",
        };
        var entries = new List<MeshDirEntry>();
        ListObjectsV2Response response;
        do
        {
            response = await _client!.ListObjectsV2Async(request, ct).ConfigureAwait(false);
            foreach (var common in response.CommonPrefixes)
            {
                var name = common.TrimEnd('/').Split('/').LastOrDefault() ?? "";
                if (!string.IsNullOrEmpty(name))
                    entries.Add(new MeshDirEntry { Name = name, IsDirectory = true });
            }
            foreach (var obj in response.S3Objects)
            {
                if (obj.Key == prefix) continue;
                var name = obj.Key.TrimEnd('/').Split('/').LastOrDefault() ?? obj.Key;
                entries.Add(new MeshDirEntry
                {
                    Name = name,
                    IsDirectory = false,
                    Size = obj.Size,
                    ModifiedUtc = obj.LastModified,
                });
            }
            request.ContinuationToken = response.NextContinuationToken;
        } while (response.IsTruncated == true);
        return entries
            .OrderByDescending(e => e.IsDirectory)
            .ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public async Task DownloadAsync(string remotePath, string localFile, IProgress<long>? progress = null, CancellationToken ct = default)
    {
        EnsureConnected();
        var key = remotePath.TrimStart('/');
        Directory.CreateDirectory(Path.GetDirectoryName(localFile)!);
        var request = new GetObjectRequest { BucketName = _bucket, Key = key };
        using var response = await _client!.GetObjectAsync(request, ct).ConfigureAwait(false);
        await response.WriteResponseStreamToFileAsync(localFile, false, ct).ConfigureAwait(false);
        progress?.Report(new FileInfo(localFile).Length);
    }

    public async Task UploadAsync(string localFile, string remotePath, IProgress<long>? progress = null, CancellationToken ct = default)
    {
        EnsureConnected();
        var key = remotePath.TrimStart('/');
        var request = new PutObjectRequest
        {
            BucketName = _bucket,
            Key = key,
            FilePath = localFile,
        };
        await _client!.PutObjectAsync(request, ct).ConfigureAwait(false);
        progress?.Report(new FileInfo(localFile).Length);
    }

    public async Task DeleteAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        var key = remotePath.TrimStart('/');
        await _client!.DeleteObjectAsync(_bucket, key, ct).ConfigureAwait(false);
    }

    public async Task RecursiveDeleteAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        var prefix = remotePath.TrimStart('/').TrimEnd('/');
        if (string.IsNullOrEmpty(prefix)) throw new InvalidOperationException("Refusing to recursively delete S3 bucket root");
        prefix += "/";
        string? token = null;
        do
        {
            var list = await _client!.ListObjectsV2Async(new ListObjectsV2Request
            {
                BucketName = _bucket,
                Prefix = prefix,
                ContinuationToken = token,
            }, ct).ConfigureAwait(false);
            if (list.S3Objects.Count > 0)
            {
                var del = new DeleteObjectsRequest { BucketName = _bucket };
                foreach (var obj in list.S3Objects)
                    del.Objects.Add(new KeyVersion { Key = obj.Key });
                await _client.DeleteObjectsAsync(del, ct).ConfigureAwait(false);
            }
            token = list.NextContinuationToken;
            if (list.IsTruncated != true) break;
        } while (true);
        // Also delete the "folder" marker if present
        try { await _client!.DeleteObjectAsync(_bucket, prefix.TrimEnd('/'), ct).ConfigureAwait(false); } catch { }
        try { await _client!.DeleteObjectAsync(_bucket, prefix, ct).ConfigureAwait(false); } catch { }
    }

    public Task MkdirAsync(string remotePath, CancellationToken ct = default)
    {
        var key = remotePath.TrimStart('/').TrimEnd('/') + "/";
        return UploadAsync(CreateEmptyMarker(), key, null, ct);
    }

    public async Task RenameAsync(string fromPath, string toPath, CancellationToken ct = default)
    {
        EnsureConnected();
        var fromKey = fromPath.TrimStart('/');
        var toKey = toPath.TrimStart('/');
        await _client!.CopyObjectAsync(_bucket, fromKey, _bucket, toKey, ct).ConfigureAwait(false);
        await _client.DeleteObjectAsync(_bucket, fromKey, ct).ConfigureAwait(false);
    }

    public Task CreateFileAsync(string remotePath, CancellationToken ct = default)
    {
        var marker = CreateEmptyMarker();
        return UploadAsync(marker, remotePath.TrimStart('/'), null, ct);
    }

    public async Task WriteAsync(string remotePath, Stream content, IProgress<long>? progress = null, CancellationToken ct = default)
    {
        EnsureConnected();
        var key = remotePath.TrimStart('/');
        var tmp = Path.Combine(Path.GetTempPath(), $"bndz-s3-write-{Guid.NewGuid():N}");
        try
        {
            await using (var fs = File.Create(tmp))
            {
                await content.CopyToAsync(fs, ct).ConfigureAwait(false);
            }
            await UploadAsync(tmp, key, progress, ct).ConfigureAwait(false);
        }
        finally
        {
            try { File.Delete(tmp); } catch { }
        }
    }

    public Task WriteBytesAsync(string remotePath, byte[] content, CancellationToken ct = default)
    {
        using var ms = new MemoryStream(content);
        return WriteAsync(remotePath, ms, null, ct);
    }

    public async Task<MeshFileAttributes> GetAttributesAsync(string remotePath, CancellationToken ct = default)
    {
        EnsureConnected();
        var key = remotePath.TrimStart('/');
        try
        {
            var meta = await _client!.GetObjectMetadataAsync(_bucket, key, ct).ConfigureAwait(false);
            return new MeshFileAttributes
            {
                Path = "/" + key,
                Exists = true,
                IsDirectory = key.EndsWith('/'),
                Size = meta.ContentLength,
                ModifiedUtc = meta.LastModified,
            };
        }
        catch
        {
            return new MeshFileAttributes { Path = "/" + key, Exists = false };
        }
    }

    private static string CreateEmptyMarker()
    {
        var p = Path.Combine(Path.GetTempPath(), $"bndz-mesh-{Guid.NewGuid():N}.tmp");
        File.WriteAllBytes(p, []);
        return p;
    }

    private void EnsureConnected()
    {
        if (!IsConnected || _client == null) throw new InvalidOperationException("S3 not connected");
    }

    public void Disconnect()
    {
        IsConnected = false;
        _client?.Dispose();
        _client = null;
        _host = null;
    }

    public ValueTask DisposeAsync()
    {
        Disconnect();
        return ValueTask.CompletedTask;
    }
}
