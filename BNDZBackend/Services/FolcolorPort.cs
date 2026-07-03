using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace BNDZ.Services
{
    public static class FolcolorPort
    {
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool WritePrivateProfileStringW(string? lpAppName, string? lpKeyName, string? lpString, string lpFileName);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern uint GetPrivateProfileSectionW(string lpAppName, IntPtr lpReturnedString, uint nSize, string lpFileName);

        [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
        public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

        private const uint SHCNE_ASSOCCHANGED = 0x08000000;
        private const uint SHCNF_IDLIST = 0x0000;

        public static void FormatFolder(string folderPath, string iconPath)
        {
            if (string.IsNullOrEmpty(folderPath) || !Directory.Exists(folderPath)) return;

            string desktopIni = Path.Combine(folderPath, "desktop.ini");
            bool hasIni = File.Exists(desktopIni);
            
            // Apply system flags
            var dirInfo = new DirectoryInfo(folderPath);
            dirInfo.Attributes |= FileAttributes.System | FileAttributes.ReadOnly;

            if (hasIni)
            {
                // Unhide the file so we can edit it
                var fileInfo = new FileInfo(desktopIni);
                fileInfo.Attributes &= ~(FileAttributes.Hidden | FileAttributes.System | FileAttributes.ReadOnly);
            }

            WritePrivateProfileStringW(".ShellClassInfo", "IconResource", $"{iconPath},0", desktopIni);
            WritePrivateProfileStringW(".ShellClassInfo", "IconFile", null, desktopIni);
            WritePrivateProfileStringW(".ShellClassInfo", "IconIndex", null, desktopIni);

            // Hide the desktop.ini
            var newFileInfo = new FileInfo(desktopIni);
            newFileInfo.Attributes |= FileAttributes.Hidden | FileAttributes.System;
        }

        public static void RestoreFolder(string folderPath)
        {
            if (string.IsNullOrEmpty(folderPath) || !Directory.Exists(folderPath)) return;
            string desktopIni = Path.Combine(folderPath, "desktop.ini");

            if (File.Exists(desktopIni))
            {
                var fileInfo = new FileInfo(desktopIni);
                fileInfo.Attributes &= ~(FileAttributes.Hidden | FileAttributes.System | FileAttributes.ReadOnly);

                bool keepIt = false;
                string content = File.ReadAllText(desktopIni).ToLower();
                
                string[] keepFlags = new[] { 
                    "[extshellfolderviews]", "[viewstate]", "iconarea_image=", 
                    "iconarea_text=", "infotip=", "nosharing=", "logo=" 
                };

                if (content.Contains("{")) keepIt = true;
                else
                {
                    foreach (var flag in keepFlags)
                    {
                        if (content.Contains(flag))
                        {
                            keepIt = true;
                            break;
                        }
                    }
                }

                if (keepIt)
                {
                    WritePrivateProfileStringW(".ShellClassInfo", "IconFile", null, desktopIni);
                    WritePrivateProfileStringW(".ShellClassInfo", "IconIndex", null, desktopIni);
                    WritePrivateProfileStringW(".ShellClassInfo", "IconResource", null, desktopIni);

                    IntPtr buffer = Marshal.AllocCoTaskMem(4096);
                    uint res = GetPrivateProfileSectionW(".ShellClassInfo", buffer, 4096, desktopIni);
                    Marshal.FreeCoTaskMem(buffer);
                    
                    if (res == 0)
                        WritePrivateProfileStringW(".ShellClassInfo", null, null, desktopIni);
                    
                    fileInfo.Attributes |= FileAttributes.Hidden | FileAttributes.System;
                }
                else
                {
                    File.Delete(desktopIni);
                    var dirInfo = new DirectoryInfo(folderPath);
                    dirInfo.Attributes &= ~(FileAttributes.System | FileAttributes.ReadOnly);
                }
            }
            else
            {
                var dirInfo = new DirectoryInfo(folderPath);
                dirInfo.Attributes &= ~(FileAttributes.System | FileAttributes.ReadOnly);
            }
        }

        public static void ResetIconCache()
        {
            SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero);
        }
    }
}
