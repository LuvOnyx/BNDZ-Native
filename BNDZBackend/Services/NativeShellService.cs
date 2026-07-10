using System;
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

        public string GetNativeThumbnailBase64(string filePath)
        {
            try
            {
                if (string.IsNullOrEmpty(filePath))
                    return "";

                using var item = new ShellItem(filePath);
                var imageBase64 = TryGetShellImageBase64(item, ShellItemGetImageOptions.ResizeToFit);
                if (!string.IsNullOrEmpty(imageBase64))
                    return imageBase64;
            }
            catch
            {
                try
                {
                    var icon = System.Drawing.Icon.ExtractAssociatedIcon(filePath);
                    if (icon != null)
                    {
                        using var bitmap = icon.ToBitmap();
                        using var ms = new MemoryStream();
                        bitmap.MakeTransparent();
                        bitmap.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
                        return Convert.ToBase64String(ms.ToArray());
                    }
                }
                catch { }
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

        [DllImport("user32.dll", SetLastError = true)]
        private static extern bool DestroyIcon(IntPtr hIcon);

        private const uint SHGFI_ICON = 0x000000100;
        private const uint SHGFI_LARGEICON = 0x000000000;
        private const uint SHGFI_USEFILEATTRIBUTES = 0x000000010;
        private const uint SHGFI_PIDL = 0x000000008;
        private const uint FILE_ATTRIBUTE_DIRECTORY = 0x00000010;

        private static string BitmapToBase64Png(Bitmap bitmap)
        {
            using var ms = new MemoryStream();
            bitmap.MakeTransparent();
            bitmap.Save(ms, System.Drawing.Imaging.ImageFormat.Png);
            return Convert.ToBase64String(ms.ToArray());
        }

        private string HIconToBase64(IntPtr hIcon)
        {
            if (hIcon == IntPtr.Zero) return "";
            try
            {
                using var icon = Icon.FromHandle(hIcon);
                using var bitmap = icon.ToBitmap();
                return BitmapToBase64Png(bitmap);
            }
            finally
            {
                DestroyIcon(hIcon);
            }
        }

        /// <summary>PIDL-based icon fetch — handles CLSIDs, shell: known folders, drives, and
        /// real paths with per-folder custom icons. The universal path for shell namespace items.</summary>
        private string GetIconViaPidl(string parsingName)
        {
            IntPtr pidl = IntPtr.Zero;
            try
            {
                int hr = SHParseDisplayName(parsingName, IntPtr.Zero, out pidl, 0, out _);
                if (hr != 0 || pidl == IntPtr.Zero)
                    return "";

                var shfi = new SHFILEINFO();
                SHGetFileInfoPidl(pidl, 0, ref shfi, (uint)Marshal.SizeOf(shfi), SHGFI_ICON | SHGFI_LARGEICON | SHGFI_PIDL);
                return HIconToBase64(shfi.hIcon);
            }
            catch
            {
                return "";
            }
            finally
            {
                if (pidl != IntPtr.Zero) Marshal.FreeCoTaskMem(pidl);
            }
        }

        private string GetIconViaShell32(string path, bool isDirectory)
        {
            var shfi = new SHFILEINFO();
            uint flags = SHGFI_ICON | SHGFI_LARGEICON;
            uint attrs = 0;
            bool isVirtual = ShellPathResolver.IsShellVirtualPath(path)
                || path.StartsWith("shell:", StringComparison.OrdinalIgnoreCase);
            if (isDirectory && !isVirtual)
            {
                flags |= SHGFI_USEFILEATTRIBUTES;
                attrs = FILE_ATTRIBUTE_DIRECTORY;
            }

            SHGetFileInfo(path, attrs, ref shfi, (uint)Marshal.SizeOf(shfi), flags);
            return HIconToBase64(shfi.hIcon);
        }

        public string GetNativeShellIconBase64(string filePath, bool isDirectory = false)
        {
            if (string.IsNullOrEmpty(filePath))
                return "";

            filePath = ShellPathResolver.ResolveForShell(filePath);
            if (string.IsNullOrEmpty(filePath))
                return "";

            bool isVirtual = ShellPathResolver.IsShellVirtualPath(filePath)
                || filePath.StartsWith("shell:", StringComparison.OrdinalIgnoreCase);

            // Drive roots need the real volume icon, not a generic folder glyph
            if (System.Text.RegularExpressions.Regex.IsMatch(filePath, @"^[A-Za-z]:\\?$"))
                isDirectory = false;

            if (!isDirectory && !isVirtual)
                isDirectory = Directory.Exists(filePath);

            // Universal path: PIDL parse handles CLSIDs, shell: folders, drives, custom folder icons
            var pidlIcon = GetIconViaPidl(filePath);
            if (!string.IsNullOrEmpty(pidlIcon))
                return pidlIcon;

            // Fallback: string-path SHGetFileInfo (generic glyphs for nonexistent paths)
            var shellIcon = GetIconViaShell32(filePath, isDirectory && !isVirtual);
            if (!string.IsNullOrEmpty(shellIcon))
                return shellIcon;

            try
            {
                using var item = new ShellItem(filePath);
                var imageBase64 = TryGetShellImageBase64(
                    item,
                    ShellItemGetImageOptions.IconOnly | ShellItemGetImageOptions.ResizeToFit);
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
                    var icon = Icon.ExtractAssociatedIcon(filePath);
                    if (icon != null)
                    {
                        using var bitmap = icon.ToBitmap();
                        return BitmapToBase64Png(bitmap);
                    }
                }
            }
            catch { }

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
                    } else {
                        var fi = new FileInfo(filePath);
                        var fs = fi.GetAccessControl();
                        meta["Owner"] = fs.GetOwner(typeof(NTAccount))?.ToString() ?? "Unknown";
                        meta["ACL Rule"] = SummarizeAcl(fs);
                        meta["File Size"] = fi.Length.ToString();
                        meta["Created"] = fi.CreationTime.ToString();
                        meta["Modified"] = fi.LastWriteTime.ToString();
                        meta["Archive"] = (fi.Attributes & FileAttributes.Archive) == FileAttributes.Archive ? "true" : "false";
                        meta["ReadOnly"] = (fi.Attributes & FileAttributes.ReadOnly) == FileAttributes.ReadOnly ? "true" : "false";
                        meta["System"] = (fi.Attributes & FileAttributes.System) == FileAttributes.System ? "true" : "false";
                        meta["Hidden"] = (fi.Attributes & FileAttributes.Hidden) == FileAttributes.Hidden ? "true" : "false";
                    }
                } catch { }

                using var item = new ShellItem(filePath);
                var props = item.Properties;

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Audio.EncodingBitrate, out var bitRate) && bitRate is uint br)
                    meta["Audio Bitrate"] = $"{br / 1000} kbps";

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Image.Dimensions, out var dims) && dims is string dimStr)
                    meta["Dimensions"] = dimStr;

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Media.Duration, out var duration) && duration is ulong dur)
                    meta["Duration"] = TimeSpan.FromTicks((long)dur).ToString(@"hh\:mm\:ss");

                if (TryGetProperty(props, Ole32.PROPERTYKEY.System.Author, out var authors) && authors is string[] authorList && authorList.Length > 0)
                    meta["Authors"] = string.Join(", ", authorList);

            }
            catch {}
            return meta;
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

        private static string TryGetShellImageBase64(ShellItem item, ShellItemGetImageOptions flags)
        {
            try
            {
                using var hbmp = item.GetImage(new SIZE(256, 256), flags);
                if (hbmp == null || hbmp.IsInvalid)
                    return "";
                using var bitmap = hbmp.ToBitmap();
                return BitmapToBase64Png(bitmap);
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
