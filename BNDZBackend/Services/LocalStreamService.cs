using System;
using System.IO;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;

namespace BNDZ.Services
{
    /// <summary>
    /// Serves local files to WebView2 via bndz.local/local-stream with byte-range support for media playback.
    /// </summary>
    public static class LocalStreamService
    {
        private static readonly Regex RangeRegex = new(@"bytes=(\d+)-(\d*)", RegexOptions.Compiled);

        public static string ParseLocalStreamPath(string requestUri)
        {
            const string marker = "/local-stream/";
            int idx = requestUri.IndexOf(marker, StringComparison.OrdinalIgnoreCase);
            if (idx < 0) return "";

            string remainder = requestUri.Substring(idx + marker.Length);
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

        public static string GetContentType(string path)
        {
            string ext = Path.GetExtension(path).ToLowerInvariant();
            return ext switch
            {
                ".txt" or ".md" or ".js" or ".json" or ".css" or ".csv" or ".cs" or ".xml" or ".html" or ".htm" => "text/plain; charset=utf-8",
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
                _ => "application/octet-stream"
            };
        }

        public static void ServeLocalFile(
            CoreWebView2Environment env,
            CoreWebView2WebResourceRequestedEventArgs e,
            string localPath)
        {
            if (string.IsNullOrEmpty(localPath) || !File.Exists(localPath))
            {
                System.Diagnostics.Debug.WriteLine($"[local-stream] 404 path='{localPath}' uri='{e.Request.Uri}'");
                var empty = new MemoryStream();
                e.Response = env.CreateWebResourceResponse(empty, 404, "Not Found", "Content-Type: text/plain");
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
                var stream = File.OpenRead(localPath);
                string responseHeaders =
                    $"Content-Type: {contentType}\r\n" +
                    $"Content-Length: {fileLength}\r\n" +
                    "Accept-Ranges: bytes\r\n" +
                    "Access-Control-Allow-Origin: *";
                e.Response = env.CreateWebResourceResponse(stream, 200, "OK", responseHeaders);
                return;
            }

            var match = RangeRegex.Match(rangeHeader);
            if (!match.Success)
            {
                var stream = File.OpenRead(localPath);
                e.Response = env.CreateWebResourceResponse(stream, 200, "OK",
                    $"Content-Type: {contentType}\r\nContent-Length: {fileLength}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *");
                return;
            }

            long start = long.Parse(match.Groups[1].Value);
            long end = match.Groups[2].Success && !string.IsNullOrEmpty(match.Groups[2].Value)
                ? long.Parse(match.Groups[2].Value)
                : fileLength - 1;

            if (start < 0) start = 0;
            if (end >= fileLength) end = fileLength - 1;
            if (start > end)
            {
                var empty = new MemoryStream();
                e.Response = env.CreateWebResourceResponse(empty, 416, "Range Not Satisfiable",
                    $"Content-Range: bytes */{fileLength}\r\nAccess-Control-Allow-Origin: *");
                return;
            }

            long length = end - start + 1;
            var partialStream = new PartialFileStream(localPath, start, length);

            string partialHeaders =
                $"Content-Type: {contentType}\r\n" +
                $"Content-Length: {length}\r\n" +
                $"Content-Range: bytes {start}-{end}/{fileLength}\r\n" +
                "Accept-Ranges: bytes\r\n" +
                "Access-Control-Allow-Origin: *";

            e.Response = env.CreateWebResourceResponse(partialStream, 206, "Partial Content", partialHeaders);
        }
    }

    /// <summary>Read-only stream over a byte range of a file on disk.</summary>
    internal sealed class PartialFileStream : Stream
    {
        private readonly FileStream _inner;
        private readonly long _length;
        private long _position;

        public PartialFileStream(string path, long offset, long length)
        {
            _inner = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            _inner.Seek(offset, SeekOrigin.Begin);
            _length = length;
        }

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => _length;
        public override long Position
        {
            get => _position;
            set => throw new NotSupportedException();
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            long remaining = _length - _position;
            if (remaining <= 0) return 0;
            int toRead = (int)Math.Min(count, remaining);
            int read = _inner.Read(buffer, offset, toRead);
            _position += read;
            return read;
        }

        public override void Flush() { }
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        protected override void Dispose(bool disposing)
        {
            if (disposing) _inner.Dispose();
            base.Dispose(disposing);
        }
    }
}
