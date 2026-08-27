using System;
using System.IO;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;

namespace BNDZ.Services
{
    /// <summary>
    /// Serves local files to WebView2 via the bndz-stream custom scheme (with byte-range support).
    /// Must NOT use the bndz.local virtual-host folder mapping — WebResourceRequested does not fire there.
    /// </summary>
    public static class LocalStreamService
    {
        public const string CustomScheme = "bndz-stream";
        public const string CustomSchemeAuthority = "local";

        // bytes=START-END | bytes=START- | bytes=-SUFFIX
        private static readonly Regex RangeRegex = new(
            @"bytes=(?:(\d+)-(\d*)|-(\d+))",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

        public static string ParseLocalStreamPath(string requestUri)
        {
            if (string.IsNullOrEmpty(requestUri)) return "";

            string remainder;
            if (requestUri.StartsWith(CustomScheme + ":", StringComparison.OrdinalIgnoreCase))
            {
                // bndz-stream://local/C%3A/Users/...  or  bndz-stream:///C%3A/...
                string withoutScheme = requestUri.Substring(CustomScheme.Length + 1); // after "bndz-stream:"
                if (withoutScheme.StartsWith("//", StringComparison.Ordinal))
                    withoutScheme = withoutScheme.Substring(2);
                // Strip optional authority ("local/")
                if (withoutScheme.StartsWith(CustomSchemeAuthority + "/", StringComparison.OrdinalIgnoreCase))
                    remainder = withoutScheme.Substring(CustomSchemeAuthority.Length + 1);
                else
                    remainder = withoutScheme.TrimStart('/');
            }
            else
            {
                // Legacy: http(s)://bndz.local/local-stream/... (broken under folder mapping; kept for parse compat)
                const string marker = "/local-stream/";
                int idx = requestUri.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
                if (idx < 0) return "";
                remainder = requestUri.Substring(idx + marker.Length);
            }

            int hash = remainder.IndexOf('#');
            if (hash >= 0) remainder = remainder.Substring(0, hash);
            int query = remainder.IndexOf('?');
            if (query >= 0) remainder = remainder.Substring(0, query);

            // Decode segment-by-segment so drive colons (%3A) and unicode filenames resolve correctly
            var segments = remainder.Split('/');
            for (int i = 0; i < segments.Length; i++)
            {
                try { segments[i] = Uri.UnescapeDataString(segments[i].Replace('+', ' ')); }
                catch { segments[i] = segments[i].Replace("%3A", ":").Replace("%3a", ":"); }
            }
            remainder = string.Join("\\", segments);
            while (remainder.Contains("\\\\")) remainder = remainder.Replace("\\\\", "\\");

            if (remainder.Length >= 2 && char.IsLetter(remainder[0]) && remainder[1] == ':')
                remainder = char.ToUpperInvariant(remainder[0]) + remainder.Substring(1);

            return remainder;
        }

        public static bool IsStreamRequest(string requestUri)
        {
            if (string.IsNullOrEmpty(requestUri)) return false;
            return requestUri.StartsWith(CustomScheme + ":", StringComparison.OrdinalIgnoreCase)
                || requestUri.Contains("bndz.local/local-stream/", StringComparison.OrdinalIgnoreCase);
        }

        public static string GetContentType(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            return ext switch
            {
                ".html" or ".htm" => "text/html; charset=utf-8",
                ".txt" or ".md" or ".js" or ".json" or ".css" or ".csv" or ".cs" or ".xml" => "text/plain; charset=utf-8",
                ".png" => "image/png",
                ".jpg" or ".jpeg" => "image/jpeg",
                ".gif" => "image/gif",
                ".webp" => "image/webp",
                ".bmp" => "image/bmp",
                ".ico" => "image/x-icon",
                ".svg" => "image/svg+xml",
                ".tif" or ".tiff" => "image/tiff",
                ".avif" => "image/avif",
                ".heic" => "image/heic",
                ".mp4" or ".m4v" => "video/mp4",
                ".webm" => "video/webm",
                ".mkv" => "video/x-matroska",
                ".avi" => "video/x-msvideo",
                ".mov" => "video/quicktime",
                ".wmv" => "video/x-ms-wmv",
                ".mpg" or ".mpeg" => "video/mpeg",
                ".mp3" => "audio/mpeg",
                ".wav" => "audio/wav",
                ".ogg" or ".oga" => "audio/ogg",
                ".flac" => "audio/flac",
                ".m4a" => "audio/mp4",
                ".aac" => "audio/aac",
                ".wma" => "audio/x-ms-wma",
                ".opus" => "audio/opus",
                ".pdf" => "application/pdf",
                ".woff" => "font/woff",
                ".woff2" => "font/woff2",
                ".ttf" => "font/ttf",
                ".otf" => "font/otf",
                ".glb" => "model/gltf-binary",
                ".gltf" => "model/gltf+json",
                ".obj" => "model/obj",
                ".stl" => "model/stl",
                ".fbx" => "application/octet-stream",
                ".dae" => "model/vnd.collada+xml",
                ".ply" => "application/octet-stream",
                _ => "application/octet-stream"
            };
        }

        public static void ServeLocalFile(
            CoreWebView2Environment env,
            CoreWebView2WebResourceRequestedEventArgs e,
            string localPath)
        {
            if (e.Request.Method == "OPTIONS")
            {
                var empty = new MemoryStream();
                e.Response = env.CreateWebResourceResponse(empty, 204, "No Content",
                    "Access-Control-Allow-Origin: *\r\n" +
                    "Access-Control-Allow-Methods: GET, OPTIONS\r\n" +
                    "Access-Control-Allow-Headers: Range");
                return;
            }

            if (string.IsNullOrEmpty(localPath) || !File.Exists(localPath))
            {
                System.Diagnostics.Debug.WriteLine($"[local-stream] 404 path='{localPath}' uri='{e.Request.Uri}'");
                var empty = new MemoryStream();
                e.Response = env.CreateWebResourceResponse(empty, 404, "Not Found", "Content-Type: text/plain\r\nAccess-Control-Allow-Origin: *");
                return;
            }

            var fileInfo = new FileInfo(localPath);
            long fileLength = fileInfo.Length;
            string contentType = GetContentType(localPath);

            string? rangeHeader = null;
            foreach (var header in e.Request.Headers)
            {
                if (header.Key.Equals("Range", StringComparison.OrdinalIgnoreCase))
                {
                    rangeHeader = header.Value;
                    break;
                }
            }

            if (string.IsNullOrEmpty(rangeHeader))
            {
                // Full file — FileStream is seekable (WebView2 rewinds before read).
                var stream = new FileStream(localPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                string responseHeaders =
                    $"Content-Type: {contentType}\r\n" +
                    $"Content-Length: {fileLength}\r\n" +
                    "Accept-Ranges: bytes\r\n" +
                    "Access-Control-Allow-Origin: *";
                e.Response = env.CreateWebResourceResponse(stream, 200, "OK", responseHeaders);
                return;
            }

            var match = RangeRegex.Match(rangeHeader.Trim());
            if (!match.Success || fileLength <= 0)
            {
                if (fileLength <= 0)
                {
                    var empty = new MemoryStream();
                    e.Response = env.CreateWebResourceResponse(empty, 416, "Range Not Satisfiable",
                        $"Content-Range: bytes */0\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *");
                    return;
                }

                var stream = new FileStream(localPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                e.Response = env.CreateWebResourceResponse(stream, 200, "OK",
                    $"Content-Type: {contentType}\r\nContent-Length: {fileLength}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *");
                return;
            }

            long start;
            long end;
            if (match.Groups[3].Success && !string.IsNullOrEmpty(match.Groups[3].Value))
            {
                // Suffix: bytes=-N  → last N bytes
                long suffix = long.Parse(match.Groups[3].Value);
                if (suffix <= 0)
                {
                    Respond416(env, e, fileLength);
                    return;
                }
                start = Math.Max(0, fileLength - suffix);
                end = fileLength - 1;
            }
            else
            {
                start = long.Parse(match.Groups[1].Value);
                end = match.Groups[2].Success && !string.IsNullOrEmpty(match.Groups[2].Value)
                    ? long.Parse(match.Groups[2].Value)
                    : fileLength - 1;
            }

            if (start < 0) start = 0;
            if (end >= fileLength) end = fileLength - 1;

            // Seek past EOF / empty range after clamp — satisfy with 416 (HTTP semantics).
            if (start >= fileLength || start > end)
            {
                Respond416(env, e, fileLength);
                return;
            }

            long length = end - start + 1;
            // Seekable partial stream — WebView2 rewinds CreateWebResourceResponse streams before read.
            var partialStream = new PartialFileStream(localPath, start, length);

            string partialHeaders =
                $"Content-Type: {contentType}\r\n" +
                $"Content-Length: {length}\r\n" +
                $"Content-Range: bytes {start}-{end}/{fileLength}\r\n" +
                "Accept-Ranges: bytes\r\n" +
                "Access-Control-Allow-Origin: *";

            e.Response = env.CreateWebResourceResponse(partialStream, 206, "Partial Content", partialHeaders);
        }

        private static void Respond416(
            CoreWebView2Environment env,
            CoreWebView2WebResourceRequestedEventArgs e,
            long fileLength)
        {
            var empty = new MemoryStream();
            e.Response = env.CreateWebResourceResponse(empty, 416, "Range Not Satisfiable",
                $"Content-Range: bytes */{fileLength}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *");
        }
    }

    /// <summary>
    /// Seekable read-only window over a file byte range.
    /// Must be seekable: WebView2 rewinds response streams before consuming them.
    /// </summary>
    internal sealed class PartialFileStream : Stream
    {
        private readonly FileStream _inner;
        private readonly long _fileOffset;
        private readonly long _length;
        private long _position;

        public PartialFileStream(string path, long fileOffset, long length)
        {
            _inner = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            _fileOffset = fileOffset;
            _length = length;
            _position = 0;
            _inner.Seek(_fileOffset, SeekOrigin.Begin);
        }

        public override bool CanRead => true;
        public override bool CanSeek => true;
        public override bool CanWrite => false;
        public override long Length => _length;

        public override long Position
        {
            get => _position;
            set => Seek(value, SeekOrigin.Begin);
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            if (count <= 0) return 0;
            long remaining = _length - _position;
            if (remaining <= 0) return 0;
            int toRead = (int)Math.Min(count, remaining);
            // Keep inner cursor aligned with logical position (WebView2 may Seek between Reads).
            long expectedInner = _fileOffset + _position;
            if (_inner.Position != expectedInner)
                _inner.Seek(expectedInner, SeekOrigin.Begin);
            int read = _inner.Read(buffer, offset, toRead);
            _position += read;
            return read;
        }

        public override long Seek(long offset, SeekOrigin origin)
        {
            long next = origin switch
            {
                SeekOrigin.Begin => offset,
                SeekOrigin.Current => _position + offset,
                SeekOrigin.End => _length + offset,
                _ => throw new ArgumentOutOfRangeException(nameof(origin)),
            };
            if (next < 0) next = 0;
            if (next > _length) next = _length;
            _position = next;
            _inner.Seek(_fileOffset + _position, SeekOrigin.Begin);
            return _position;
        }

        public override void Flush() { }
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing) _inner.Dispose();
            base.Dispose(disposing);
        }
    }
}
