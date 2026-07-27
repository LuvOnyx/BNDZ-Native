using System.Diagnostics;
using System.IO;
using System.Text;
using System.Windows;
using WpfDataFormats = System.Windows.DataFormats;

namespace BNDZ.Services;

/// <summary>
/// Extracts filesystem paths from an OLE/WPF drag-drop payload (Explorer, WinRAR, etc.).
/// Call on Drop — some sources only materialize CF_HDROP when GetData is invoked.
/// </summary>
internal static class ExternalDropHelper
{
    private const string FileGroupDescriptorW = "FileGroupDescriptorW";
    private const string FileContents = "FileContents";

    /// <summary>True during DragOver when payload is likely Explorer/desktop files (before CF_HDROP materializes).</summary>
    public static bool IsLikelyExternalFileDrag(System.Windows.IDataObject? data)
    {
        if (data == null) return false;
        try
        {
            if (data.GetDataPresent(WpfDataFormats.FileDrop, autoConvert: true)) return true;
            if (data.GetDataPresent(WpfDataFormats.FileDrop, autoConvert: false)) return true;
            if (data.GetDataPresent("FileGroupDescriptorW", autoConvert: false)) return true;
            if (data.GetDataPresent("FileNameW", autoConvert: true)) return true;
            if (data.GetDataPresent("FileName", autoConvert: true)) return true;
            if (data.GetDataPresent("Shell IDList Array", autoConvert: false)) return true;
            foreach (var fmt in data.GetFormats(autoConvert: false))
            {
                if (string.IsNullOrWhiteSpace(fmt)) continue;
                var f = fmt.ToUpperInvariant();
                if (f.Contains("FILE") || f.Contains("SHELL IDLIST") || f.Contains("FILEDESCRIPTOR"))
                    return true;
            }
        }
        catch { /* best-effort */ }
        return false;
    }

    public static string[] ExtractPaths(System.Windows.IDataObject? data)
    {
        if (data == null) return Array.Empty<string>();

        var paths = new List<string>();

        // Prefer CF_HDROP. WinRAR often extracts archive members to %TEMP% when GetData runs.
        try
        {
            if (data.GetDataPresent(WpfDataFormats.FileDrop, autoConvert: true))
            {
                var raw = data.GetData(WpfDataFormats.FileDrop, autoConvert: true);
                if (raw is string[] files)
                {
                    foreach (var f in files)
                    {
                        if (!string.IsNullOrWhiteSpace(f))
                            paths.Add(f);
                    }
                }
                else if (raw is System.Collections.Specialized.StringCollection coll)
                {
                    foreach (string? f in coll)
                    {
                        if (!string.IsNullOrWhiteSpace(f))
                            paths.Add(f!);
                    }
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ExternalDrop] FileDrop: {ex.Message}");
        }

        if (paths.Count > 0)
            return DedupPaths(paths, requireExists: false);

        // Single-file shell formats
        foreach (var format in new[] { "FileNameW", "FileName" })
        {
            try
            {
                if (!data.GetDataPresent(format, autoConvert: true)) continue;
                var raw = data.GetData(format, autoConvert: true);
                if (raw is string s && !string.IsNullOrWhiteSpace(s))
                {
                    paths.Add(s);
                    break;
                }
                if (raw is string[] arr)
                {
                    paths.AddRange(arr.Where(x => !string.IsNullOrWhiteSpace(x)));
                    break;
                }
            }
            catch { /* try next */ }
        }

        if (paths.Count > 0)
            return DedupPaths(paths, requireExists: false);

        // Virtual file drops (some archives): FileGroupDescriptorW + FileContents → temp files
        try
        {
            var virtualPaths = MaterializeVirtualFiles(data);
            if (virtualPaths.Count > 0)
                return DedupPaths(virtualPaths, requireExists: true);
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ExternalDrop] Virtual files: {ex.Message}");
        }

        return Array.Empty<string>();
    }

    /// <summary>Formats present on the OLE payload — for drop-failure diagnostics.</summary>
    public static string[] GetAvailableFormats(System.Windows.IDataObject? data)
    {
        if (data == null) return Array.Empty<string>();
        try
        {
            return data.GetFormats(autoConvert: false) ?? Array.Empty<string>();
        }
        catch
        {
            return Array.Empty<string>();
        }
    }

    private static List<string> MaterializeVirtualFiles(System.Windows.IDataObject data)
    {
        var result = new List<string>();
        if (!data.GetDataPresent(FileGroupDescriptorW, autoConvert: false))
            return result;

        if (data.GetData(FileGroupDescriptorW) is not MemoryStream descriptorStream)
            return result;

        var bytes = descriptorStream.ToArray();
        if (bytes.Length < 4) return result;

        var count = BitConverter.ToInt32(bytes, 0);
        if (count <= 0 || count > 64) return result;

        // FILEGROUPDESCRIPTORW: DWORD cItems + FILEDESCRIPTORW[cItems]
        // FILEDESCRIPTORW is 592 bytes on x64 with wide names (cFileName[260])
        const int FileDescriptorWSize = 592;
        var tempRoot = Path.Combine(Path.GetTempPath(), "BNDZDrop", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(tempRoot);

        for (var i = 0; i < count; i++)
        {
            var offset = 4 + i * FileDescriptorWSize;
            if (offset + FileDescriptorWSize > bytes.Length) break;

            // cFileName starts at offset+72 in FILEDESCRIPTORW (after dwFlags…ftLastWriteTime)
            var nameBytes = new byte[520]; // 260 WCHAR
            Buffer.BlockCopy(bytes, offset + 72, nameBytes, 0, Math.Min(520, bytes.Length - offset - 72));
            var name = Encoding.Unicode.GetString(nameBytes).TrimEnd('\0');
            if (string.IsNullOrWhiteSpace(name)) continue;
            // Skip directory entries in the descriptor
            var flags = BitConverter.ToInt32(bytes, offset);
            const int FdAttribute = 0x4;
            const int FileAttributeDirectory = 0x10;
            if ((flags & FdAttribute) != 0)
            {
                var attrs = BitConverter.ToInt32(bytes, offset + 28);
                if ((attrs & FileAttributeDirectory) != 0) continue;
            }

            try
            {
                object? contentObj = null;
                // Prefer indexed FileContents when multiple items
                try
                {
                    contentObj = data.GetData(FileContents, autoConvert: false);
                }
                catch { }

                // Some providers expose FileContents as an array / stream for index 0 only.
                Stream? contentStream = contentObj as Stream;
                if (contentStream == null && contentObj is MemoryStream ms)
                    contentStream = ms;

                if (contentStream == null && i == 0)
                {
                    // Retry GetData with format that includes index via COM — best-effort for single-item drops
                    try { contentStream = data.GetData("FileContents") as Stream; } catch { }
                }

                if (contentStream == null) continue;

                var safeName = Path.GetFileName(name.Replace('/', '\\'));
                if (string.IsNullOrWhiteSpace(safeName)) safeName = $"dropped-{i}";
                var outPath = Path.Combine(tempRoot, safeName);
                using (var fs = File.Create(outPath))
                {
                    contentStream.CopyTo(fs);
                }
                result.Add(outPath);
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"[ExternalDrop] Materialize '{name}': {ex.Message}");
            }
        }

        return result;
    }

    private static string[] DedupPaths(IEnumerable<string> paths, bool requireExists) =>
        paths
            .Select(p => p.Trim().Trim('"'))
            .Where(p => p.Length > 0 && IsPlausiblePath(p) && (!requireExists || File.Exists(p) || Directory.Exists(p)))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();

    private static bool IsPlausiblePath(string p)
    {
        if (p.Length < 2) return false;
        // Drive-rooted Windows paths and UNC shares
        if (p.Length >= 3 && char.IsLetter(p[0]) && p[1] == ':' && (p[2] == '\\' || p[2] == '/')) return true;
        if (p.StartsWith(@"\\", StringComparison.Ordinal)) return true;
        return File.Exists(p) || Directory.Exists(p);
    }
}
