using System;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Threading.Tasks;

namespace BNDZ.Services;

/// <summary>XYplorer-style binary file compare with hash + first-diff offset.</summary>
public static class FileCompareService
{
    public static Task<object> CompareAsync(string pathA, string pathB, int previewBytes = 64)
    {
        return Task.Run(() =>
        {
            var winA = Normalize(pathA);
            var winB = Normalize(pathB);
            previewBytes = Math.Clamp(previewBytes, 16, 512);

            if (!File.Exists(winA) || !File.Exists(winB))
            {
                return (object)new
                {
                    ok = false,
                    message = "Both paths must be existing files.",
                    pathA = winA,
                    pathB = winB,
                };
            }

            var fiA = new FileInfo(winA);
            var fiB = new FileInfo(winB);
            var sizeA = fiA.Length;
            var sizeB = fiB.Length;
            long firstDiff = -1;
            var identical = sizeA == sizeB;

            if (identical && sizeA > 0)
            {
                const int buf = 1024 * 1024;
                using var sa = new FileStream(winA, FileMode.Open, FileAccess.Read, FileShare.Read, buf, FileOptions.SequentialScan);
                using var sb = new FileStream(winB, FileMode.Open, FileAccess.Read, FileShare.Read, buf, FileOptions.SequentialScan);
                var ba = new byte[buf];
                var bb = new byte[buf];
                long offset = 0;
                var lastRa = 0;
                var lastRb = 0;
                while (true)
                {
                    lastRa = sa.Read(ba, 0, buf);
                    lastRb = sb.Read(bb, 0, buf);
                    var n = Math.Min(lastRa, lastRb);
                    for (var i = 0; i < n; i++)
                    {
                        if (ba[i] != bb[i])
                        {
                            firstDiff = offset + i;
                            identical = false;
                            break;
                        }
                    }
                    if (!identical || lastRa != lastRb || lastRa == 0) break;
                    offset += lastRa;
                }
                if (firstDiff < 0 && lastRa != lastRb) { identical = false; firstDiff = offset; }
            }
            else if (sizeA != sizeB)
            {
                identical = false;
                firstDiff = Math.Min(sizeA, sizeB);
            }

            string HashFile(string p)
            {
                using var sha = SHA256.Create();
                using var fs = File.OpenRead(p);
                return Convert.ToHexString(sha.ComputeHash(fs)).ToLowerInvariant();
            }

            var hashA = HashFile(winA);
            var hashB = HashFile(winB);
            if (hashA != hashB) identical = false;

            byte[] previewA = [], previewB = [];
            if (firstDiff >= 0)
            {
                previewA = ReadPreview(winA, Math.Max(0, firstDiff - previewBytes / 2), previewBytes);
                previewB = ReadPreview(winB, Math.Max(0, firstDiff - previewBytes / 2), previewBytes);
            }

            return new
            {
                ok = true,
                identical,
                pathA = winA,
                pathB = winB,
                sizeA,
                sizeB,
                hashA,
                hashB,
                firstDiffOffset = firstDiff,
                previewA = ToHex(previewA),
                previewB = ToHex(previewB),
            };
        });
    }

    private static byte[] ReadPreview(string path, long offset, int count)
    {
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
            if (offset >= fs.Length) return [];
            fs.Seek(offset, SeekOrigin.Begin);
            var buf = new byte[count];
            var read = fs.Read(buf, 0, count);
            return buf.Take(read).ToArray();
        }
        catch
        {
            return [];
        }
    }

    private static string ToHex(byte[] data) =>
        data.Length == 0 ? "" : string.Join(" ", data.Select(b => b.ToString("x2")));

    private static string Normalize(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        var p = path.Replace('/', '\\').Trim();
        if (p.StartsWith("\\") && p.Length > 2 && p[1] != '\\') p = p.TrimStart('\\');
        return p;
    }
}
