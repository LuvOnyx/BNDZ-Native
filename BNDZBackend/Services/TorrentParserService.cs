using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace BNDZ.Services;

public sealed class TorrentParserService
{
    public TorrentInfoResult Parse(string path)
    {
        path = NormalizePath(path);
        if (!File.Exists(path))
            return new TorrentInfoResult { Error = "File not found" };

        try
        {
            var data = File.ReadAllBytes(path);
            var root = Bencode.Decode(data) as Dictionary<string, object>;
            if (root == null)
                return new TorrentInfoResult { Error = "Invalid torrent file" };

            var info = root.TryGetValue("info", out var infoObj) ? infoObj as Dictionary<string, object> : null;
            if (info == null)
                return new TorrentInfoResult { Error = "Missing info dictionary" };

            var result = new TorrentInfoResult
            {
                Announce = root.TryGetValue("announce", out var ann) ? ann as string : null,
                Comment = root.TryGetValue("comment", out var com) ? com as string : null,
                CreatedBy = root.TryGetValue("created by", out var cb) ? cb as string : null,
                PieceLength = info.TryGetValue("piece length", out var pl) ? Convert.ToInt64(pl) : 0,
            };

            if (info.TryGetValue("name", out var nameObj))
                result.Name = nameObj as string ?? "Unknown";

            if (info.TryGetValue("pieces", out var piecesObj) && piecesObj is byte[] pieces)
                result.PieceCount = pieces.Length / 20;

            var files = new List<TorrentFileDto>();
            long total = 0;

            if (info.TryGetValue("files", out var filesObj) && filesObj is List<object> fileList)
            {
                foreach (var f in fileList)
                {
                    if (f is not Dictionary<string, object> fd) continue;
                    var length = fd.TryGetValue("length", out var len) ? Convert.ToInt64(len) : 0;
                    var pathParts = new List<string>();
                    if (fd.TryGetValue("path", out var pathObj) && pathObj is List<object> parts)
                    {
                        foreach (var p in parts)
                            if (p is string s) pathParts.Add(s);
                    }
                    var filePath = string.Join("/", pathParts);
                    files.Add(new TorrentFileDto { Path = filePath, Size = length });
                    total += length;
                }
            }
            else if (info.TryGetValue("length", out var singleLen))
            {
                var length = Convert.ToInt64(singleLen);
                files.Add(new TorrentFileDto { Path = result.Name ?? "", Size = length });
                total = length;
            }

            result.Files = files;
            result.TotalSize = total;
            result.FileCount = files.Count;
            return result;
        }
        catch (Exception ex)
        {
            return new TorrentInfoResult { Error = ex.Message };
        }
    }

    private static string NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        if (path.StartsWith("/")) path = path[1..];
        return path.Replace('/', '\\');
    }

    public sealed class TorrentFileDto
    {
        public string Path { get; set; } = "";
        public long Size { get; set; }
    }

    public sealed class TorrentInfoResult
    {
        public string? Name { get; set; }
        public string? Announce { get; set; }
        public string? Comment { get; set; }
        public string? CreatedBy { get; set; }
        public long PieceLength { get; set; }
        public int PieceCount { get; set; }
        public long TotalSize { get; set; }
        public int FileCount { get; set; }
        public List<TorrentFileDto> Files { get; set; } = new();
        public string? Error { get; set; }
    }
}

internal static class Bencode
{
    public static object? Decode(byte[] data) => Decode(data, 0, out _);

    private static object? Decode(byte[] data, int start, out int end)
    {
        if (start >= data.Length) { end = start; return null; }
        char c = (char)data[start];

        if (c == 'i')
        {
            int e = start + 1;
            while (e < data.Length && data[e] != 'e') e++;
            var numStr = Encoding.ASCII.GetString(data, start + 1, e - start - 1);
            end = e + 1;
            return long.Parse(numStr);
        }

        if (c == 'l')
        {
            var list = new List<object>();
            int pos = start + 1;
            while (pos < data.Length && data[pos] != (byte)'e')
            {
                list.Add(Decode(data, pos, out pos)!);
            }
            end = pos + 1;
            return list;
        }

        if (c == 'd')
        {
            var dict = new Dictionary<string, object>();
            int pos = start + 1;
            while (pos < data.Length && data[pos] != (byte)'e')
            {
                var key = Decode(data, pos, out pos) as string ?? "";
                var val = Decode(data, pos, out pos)!;
                dict[key] = val;
            }
            end = pos + 1;
            return dict;
        }

        if (char.IsDigit(c))
        {
            int colon = start;
            while (colon < data.Length && data[colon] != ':') colon++;
            var len = int.Parse(Encoding.ASCII.GetString(data, start, colon - start));
            end = colon + 1 + len;
            return Encoding.UTF8.GetString(data, colon + 1, len);
        }

        end = start + 1;
        return null;
    }
}
