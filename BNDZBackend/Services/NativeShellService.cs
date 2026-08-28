using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Runtime.InteropServices;
using Vanara.PInvoke;
using Vanara.Windows.Shell;

namespace BNDZ.Services
{
    public class NativeShellService
    {
        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

        public NativeShellService()
        {
        }

        public string GetNativeThumbnailBase64(string filePath, int pixelSize = 512)
        {
            try
            {
                if (string.IsNullOrEmpty(filePath))
                    return "";

                // Pure content extract — L1/L2 CAS ownership lives in BndzHostCaches.ResolveThumbnailBase64.
                // Never fall back to ExtractAssociatedIcon here: that returns type glyphs and would
                // poison the thumbnail CAS so every .png/.mp4 looked "thumbnailed" as a letter icon.
                // Bounded so IPC always answers (shell GetImage can hang on system paths).
                return MediaThumbnailService.ExtractBase64Bounded(filePath, pixelSize) ?? "";
            }
            catch
            {
                /* fall through */
            }
            return "";
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct SHFILEINFO
        {
            public IntPtr hIcon;
            public int iIcon;
            public uint dwAttributes;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string szDisplayName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 80)]
            public string szTypeName;
        }

        [DllImport("shell32.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr SHGetFileInfo(
            string pszPath,
            uint dwFileAttributes,
            ref SHFILEINFO psfi,
            uint cbFileInfo,
            uint uFlags);

        [DllImport("shell32.dll", CharSet = CharSet.Auto, EntryPoint = "SHGetFileInfo")]
        private static extern IntPtr SHGetFileInfoPidl(
            IntPtr pidl,
            uint dwFileAttributes,
            ref SHFILEINFO psfi,
            uint cbFileInfo,
            uint uFlags);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        private static extern int SHParseDisplayName(
            string pszName,
            IntPtr pbc,
            out IntPtr ppidl,
            uint sfgaoIn,
            out uint psfgaoOut);

        private const uint SHGFI_ICON = 0x000000100;
        private const uint SHGFI_LARGEICON = 0x000000000;
        private const uint SHGFI_USEFILEATTRIBUTES = 0x000000010;
        private const uint SHGFI_PIDL = 0x000000008;
        private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;

        private static string BitmapToBase64Png(Bitmap bitmap) =>
            ShellArgbPngEncoder.EncodeBitmapPngBase64(bitmap);

        /// <summary>PIDL-based icon fetch — handles CLSIDs, shell: known folders, drives, and
        /// real paths with per-folder custom icons. The universal path for shell namespace items.</summary>
        private string GetIconViaPidl(string parsingName)
        {
            foreach (var candidate in PidlishNames(parsingName))
            {
                IntPtr pidl = IntPtr.Zero;
                try
                {
                    int hr = SHParseDisplayName(candidate, IntPtr.Zero, out pidl, 0, out _);
                    if (hr != 0 || pidl == IntPtr.Zero)
                        continue;

                    var shfi = new SHFILEINFO();
                    SHGetFileInfoPidl(pidl, 0, ref shfi, (uint)Marshal.SizeOf(shfi), SHGFI_ICON | SHGFI_LARGEICON | SHGFI_PIDL);
                    var png = HIconToBase64(shfi.hIcon);
                    if (!string.IsNullOrEmpty(png))
                        return png;
                }
                catch
                {
                    /* try next candidate */
                }
                finally
                {
                    if (pidl != IntPtr.Zero) Marshal.FreeCoTaskMem(pidl);
                }
            }
            return "";
        }

        private static IEnumerable<string> PidlishNames(string parsingName)
        {
            if (string.IsNullOrEmpty(parsingName)) yield break;
            yield return parsingName;
            // Some hosts parse better with the shell::: prefix.
            if (parsingName.StartsWith("::{", StringComparison.Ordinal)
                && !parsingName.StartsWith("shell:::", StringComparison.OrdinalIgnoreCase))
                yield return "shell:" + parsingName;
        }

        private string HIconToBase64(IntPtr hIcon)
        {
            if (hIcon == IntPtr.Zero) return "";
            try
            {
                // Alpha-preserving encode — never Icon.ToBitmap + MakeTransparent (white plates).
                return ShellArgbPngEncoder.EncodeHIconPngBase64(hIcon);
            }
            finally
            {
                ShellWin32.SafeDestroyIcon(hIcon);
            }
        }

        private string GetIconViaShell32(string path, bool isDirectory)
        {
            var shfi = new SHFILEINFO();
            uint flags = SHGFI_ICON | SHGFI_LARGEICON;
            uint attrs = 0;
            bool isVirtual = ShellPathResolver.IsShellVirtualPath(path)
                || path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase);
            // USEFILEATTRIBUTES forces a generic folder glyph and skips custom/special
            // folder icons — only use it when the path may not exist on disk yet.
            if (isDirectory && !isVirtual && !Directory.Exists(path))
            {
                flags |= SHGFI_USEFILEATTRIBUTES;
                attrs = FILE_ATTRIBUTE_DIRECTORY;
            }

            SHGetFileInfo(path, attrs, ref shfi, (uint)Marshal.SizeOf(shfi), flags);
            return HIconToBase64(shfi.hIcon);
        }

        public string GetNativeShellIconBase64(string filePath, bool isDirectory = false, int pixelSize = 48)
        {
            if (string.IsNullOrEmpty(filePath))
                return "";

            filePath = ShellPathResolver.ResolveForShell(filePath);
            if (string.IsNullOrEmpty(filePath))
                return "";

            int size = Math.Clamp(pixelSize <= 0 ? 48 : pixelSize, 16, 512);

            bool isVirtual = ShellPathResolver.IsShellVirtualPath(filePath)
                || filePath.StartsWith("shell:", StringComparison.OrdinalIgnoreCase);

            // Drive roots need the real volume icon, not a generic folder glyph
            if (System.Text.RegularExpressions.Regex.IsMatch(filePath, @"^[A-Za-z]:\\?$"))
                isDirectory = false;

            if (!isDirectory && !isVirtual)
                isDirectory = Directory.Exists(filePath);

            // Zoomed grid/list: IShellItemImageFactory at display size (Files Extra Large / jumbo).
            // Avoid SHGFI_LARGEICON upscaling blur when tiles are huge.
            if (size >= 48)
            {
                try
                {
                    using var item = new ShellItem(filePath);
                    // Prefer crisp icon extract at exact pixel size.
                    var hi = TryGetShellImageBase64(
                        item,
                        ShellItemGetImageOptions.IconOnly | ShellItemGetImageOptions.ResizeToFit,
                        size);
                    if (!string.IsNullOrEmpty(hi))
                        return hi;
                    // Directories: IconOnly only — ThumbnailOnly/any yields white folder plates at jumbo.
                    // Soft-fail to PIDL/SHGFI below rather than stretch a blank thumb.
                    if (!isDirectory && size >= 128)
                    {
                        var thumb = TryGetShellImageBase64(
                            item,
                            ShellItemGetImageOptions.ThumbnailOnly | ShellItemGetImageOptions.ResizeToFit,
                            size);
                        if (!string.IsNullOrEmpty(thumb))
                            return thumb;
                        var any = TryGetShellImageBase64(
                            item,
                            ShellItemGetImageOptions.ResizeToFit,
                            size);
                        if (!string.IsNullOrEmpty(any))
                            return any;
                    }
                }
                catch { /* fall through */ }
            }

            // Universal path: PIDL parse handles CLSIDs, shell: folders, drives, custom folder icons
            var pidlIcon = GetIconViaPidl(filePath);
            if (!string.IsNullOrEmpty(pidlIcon))
            {
                if (size < 64)
                    return pidlIcon;
                // Upscale-free path already tried above; keep PIDL as last-resort type glyph.
            }

            // String-path SHGetFileInfo on ::{clsid} often returns the generic white document —
            // skip it for virtual namespaces and go straight to ShellItem / fail empty.
            if (!isVirtual)
            {
                var shellIcon = GetIconViaShell32(filePath, isDirectory);
                if (!string.IsNullOrEmpty(shellIcon) && size < 64)
                    return shellIcon;
            }

            try
            {
                using var item = new ShellItem(filePath);
                var imageBase64 = TryGetShellImageBase64(
                    item,
                    ShellItemGetImageOptions.IconOnly | ShellItemGetImageOptions.ResizeToFit,
                    size);
                if (!string.IsNullOrEmpty(imageBase64))
                    return imageBase64;
            }
            catch { }

            if (isVirtual)
                return "";

            try
            {
                if (!isDirectory && File.Exists(filePath))
                {
                    using var icon = Icon.ExtractAssociatedIcon(filePath);
                    if (icon != null)
                        return ShellArgbPngEncoder.EncodeHIconPngBase64(icon.Handle);
                }
            }
            catch { }

            // Last resort: whatever PIDL/SHGFI returned (may upscale — better than empty).
            if (!string.IsNullOrEmpty(pidlIcon))
                return pidlIcon;
            if (!isVirtual)
            {
                var shellIcon = GetIconViaShell32(filePath, isDirectory);
                if (!string.IsNullOrEmpty(shellIcon))
                    return shellIcon;
            }

            return "";
        }

        public System.Collections.Generic.Dictionary<string, string> GetExtendedMetadata(string filePath)
        {
            var meta = new System.Collections.Generic.Dictionary<string, string>();
            try
            {
                if (string.IsNullOrEmpty(filePath) || (!File.Exists(filePath) && !Directory.Exists(filePath))) return meta;
                
                var isDir = Directory.Exists(filePath);

                // Fetch security info
                try {
                    if (isDir) {
                        var di = new DirectoryInfo(filePath);
                        var ds = di.GetAccessControl();
                        meta["Owner"] = ds.GetOwner(typeof(NTAccount))?.ToString() ?? "Unknown";
                        meta["ACL Rule"] = SummarizeAcl(ds);
                        meta["Created"] = di.CreationTime.ToString("g");
                        meta["Modified"] = di.LastWriteTime.ToString("g");
                        meta["Accessed"] = di.LastAccessTime.ToString("g");
                    } else {
                        var fi = new FileInfo(filePath);
                        var fs = fi.GetAccessControl();
                        meta["Owner"] = fs.GetOwner(typeof(NTAccount))?.ToString() ?? "Unknown";
                        meta["ACL Rule"] = SummarizeAcl(fs);
                        meta["File Size"] = fi.Length.ToString();
                        meta["Created"] = fi.CreationTime.ToString("g");
                        meta["Modified"] = fi.LastWriteTime.ToString("g");
                        meta["Accessed"] = fi.LastAccessTime.ToString("g");
                        meta["Archive"] = (fi.Attributes & FileAttributes.Archive) == FileAttributes.Archive ? "true" : "false";
                        meta["ReadOnly"] = (fi.Attributes & FileAttributes.ReadOnly) == FileAttributes.ReadOnly ? "true" : "false";
                        meta["System"] = (fi.Attributes & FileAttributes.System) == FileAttributes.System ? "true" : "false";
                        meta["Hidden"] = (fi.Attributes & FileAttributes.Hidden) == FileAttributes.Hidden ? "true" : "false";
                    }
                } catch { }

                using var item = new ShellItem(filePath);
                var props = item.Properties;

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Image.Dimensions, out var dims) && dims is string dimStr)
                {
                    meta["Dimensions"] = dimStr;
                    var parts = dimStr.Split('×', 'x', 'X');
                    if (parts.Length == 2
                        && int.TryParse(parts[0].Trim(), out var w)
                        && int.TryParse(parts[1].Trim(), out var h)
                        && h > 0)
                    {
                        meta["Aspect Ratio"] = $"{w}:{h} ({(w / (double)h):0.##}:1)";
                    }
                }

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Photo.DateTaken, out var dateTaken) && dateTaken is DateTime dtTaken)
                    meta["Date Taken"] = dtTaken.ToString("g");
                else if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Photo.DateTaken, out dateTaken) && dateTaken != null)
                    meta["Date Taken"] = dateTaken.ToString() ?? "";

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Photo.CameraModel, out var camera) && camera != null)
                    meta["Camera Model"] = camera.ToString() ?? "";
                else if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Photo.CameraManufacturer, out var maker) && maker != null)
                    meta["Camera Model"] = maker.ToString() ?? "";

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Photo.FNumber, out var fnum) && fnum != null)
                    meta["F-Stop"] = fnum is double fd ? $"f/{fd:0.#}" : fnum.ToString() ?? "";

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Photo.ExposureTime, out var exposure) && exposure != null)
                    meta["Exposure Time"] = exposure.ToString() ?? "";

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Photo.FocalLength, out var focal) && focal != null)
                    meta["Focal Length"] = focal is double fl ? $"{fl:0.#} mm" : focal.ToString() ?? "";

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Photo.ISOSpeed, out var iso) && iso != null)
                    meta["ISO Speed"] = iso.ToString() ?? "";

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Media.Duration, out var duration) && duration is ulong dur)
                    meta["Duration"] = TimeSpan.FromTicks((long)dur).ToString(@"hh\:mm\:ss");

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Audio.EncodingBitrate, out var bitRate) && bitRate is uint br)
                    meta["Audio Bitrate"] = $"{br / 1000} kbps";

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Audio.SampleRate, out var sampleRate) && sampleRate is uint sr)
                    meta["Sample Rate"] = $"{sr} Hz";

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Audio.SampleSize, out var sampleSize) && sampleSize is uint bits)
                    meta["Bit Depth"] = $"{bits} bit";

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Audio.ChannelCount, out var channels) && channels is uint ch)
                    meta["Channels"] = ch.ToString();

                if (!isDir && File.Exists(filePath))
                {
                    try
                    {
                        var vi = System.Diagnostics.FileVersionInfo.GetVersionInfo(filePath);
                        if (!string.IsNullOrWhiteSpace(vi.FileVersion))
                            meta["File Version"] = vi.FileVersion;
                        else if (!string.IsNullOrWhiteSpace(vi.ProductVersion))
                            meta["File Version"] = vi.ProductVersion;
                    }
                    catch { }
                }

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Author, out var authors) && authors is string[] authorList && authorList.Length > 0)
                    meta["Authors"] = string.Join(", ", authorList);

                if (!isDir)
                    MediaTagMetadataService.Enrich(meta, filePath);

            }
            catch {}
            return meta;
        }

        /// <summary>
        /// Batch extended metadata for visible list rows. Caps at <paramref name="max"/>,
        /// skips missing paths, and reuses <see cref="GetExtendedMetadata"/> per path.
        /// </summary>
        public Dictionary<string, Dictionary<string, string>> GetExtendedMetadataBatch(IEnumerable<string> paths, int max = 64)
        {
            var results = new Dictionary<string, Dictionary<string, string>>(StringComparer.OrdinalIgnoreCase);
            if (paths == null || max <= 0) return results;

            var taken = 0;
            foreach (var raw in paths)
            {
                if (taken >= max) break;
                if (string.IsNullOrWhiteSpace(raw)) continue;
                var path = raw.Trim();
                if (!File.Exists(path) && !Directory.Exists(path)) continue;
                try
                {
                    results[path] = GetExtendedMetadata(path);
                    taken++;
                }
                catch
                {
                    // Skip failures — callers still have per-path fallback.
                }
            }
            return results;
        }

        private static string SummarizeAcl(FileSystemSecurity security)
        {
            try
            {
                var tokens = new System.Collections.Generic.SortedSet<string>(StringComparer.OrdinalIgnoreCase);
                foreach (FileSystemAccessRule rule in security.GetAccessRules(true, true, typeof(NTAccount)))
                {
                    if (rule.AccessControlType != AccessControlType.Allow) continue;
                    var rights = rule.FileSystemRights;
                    if ((rights & FileSystemRights.FullControl) != 0)
                    {
                        tokens.Clear();
                        tokens.UnionWith(new[] { "F", "R", "W", "X" });
                        break;
                    }
                    if ((rights & (FileSystemRights.ReadData | FileSystemRights.Read | FileSystemRights.ListDirectory)) != 0)
                        tokens.Add("R");
                    if ((rights & (FileSystemRights.WriteData | FileSystemRights.Write | FileSystemRights.CreateFiles | FileSystemRights.CreateDirectories | FileSystemRights.AppendData)) != 0)
                        tokens.Add("W");
                    if ((rights & (FileSystemRights.ExecuteFile | FileSystemRights.ReadAndExecute)) != 0)
                        tokens.Add("X");
                    if ((rights & FileSystemRights.Delete) != 0)
                        tokens.Add("D");
                    if ((rights & FileSystemRights.Modify) != 0)
                    {
                        tokens.Add("R");
                        tokens.Add("W");
                    }
                }
                return tokens.Count > 0 ? string.Join(" ", tokens) : "—";
            }
            catch
            {
                return "—";
            }
        }

        private static string TryGetShellImageBase64(ShellItem item, ShellItemGetImageOptions flags, int pixelSize = 256)
        {
            try
            {
                int size = Math.Clamp(pixelSize, 16, 1024);
                using var hbmp = item.GetImage(new SIZE(size, size), flags);
                if (hbmp == null || hbmp.IsInvalid)
                    return "";
                // Scan0 / 32bpp ARGB — never hbmp.ToBitmap() (GDI FromHbitmap flattens alpha).
                return ShellArgbPngEncoder.EncodeHBitmapPngBase64(hbmp.DangerousGetHandle());
            }
            catch
            {
                return "";
            }
        }

        private static bool TryGetProperty(PropertyStore props, Ole32.PROPERTYKEY key, out object? value)
        {
            value = null;
            try
            {
                if (props.TryGetValue(key, out value))
                    return value != null;
            }
            catch { }
            return false;
        }
    }
}
