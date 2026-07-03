using System;
using System.IO;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace BNDZ.Services
{
    public class IconLibrary
    {
        public string Name { get; set; } = "";
        public List<string> Icons { get; set; } = new List<string>();
    }

    public class IconStudioService
    {
        private readonly IconLibraryPersistenceService _persistence = new();
        [DllImport("shell32.dll")]
        public static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

        private const string LIBRARY_REG_PATH = @"Software\BNDZ\IconStudio\Libraries";
        private static readonly (string Root, string PathToken, bool FilesOnly)[] ContextMenuRoots =
        {
            (@"Software\Classes\Folder\shell\IconStudio", "%1", false),
            (@"Software\Classes\Directory\shell\IconStudio", "%1", false),
            (@"Software\Classes\Directory\Background\shell\IconStudio", "%V", false),
            (@"Software\Classes\*\shell\IconStudio", "%1", true),
        };

        public IconStudioService()
        {
            MigrateFromRegistryIfNeeded();
            EnsureRegistrySetup();
        }

        private void MigrateFromRegistryIfNeeded()
        {
            if (_persistence.Load().Count > 0) return;
            var migrated = new List<IconLibraryDto>();
            try
            {
                using var key = Registry.CurrentUser.OpenSubKey(LIBRARY_REG_PATH);
                if (key == null) return;
                foreach (var libName in key.GetSubKeyNames())
                {
                    using var libKey = key.OpenSubKey(libName);
                    if (libKey == null) continue;
                    var dto = new IconLibraryDto { Id = $"lib_{libName}", Name = libName };
                    var iconsObj = libKey.GetValue("Icons");
                    IEnumerable<string> paths = iconsObj switch
                    {
                        string[] arr => arr,
                        string single => single.Split('|', StringSplitOptions.RemoveEmptyEntries),
                        _ => Array.Empty<string>()
                    };
                    foreach (var p in paths)
                    {
                        if (string.IsNullOrWhiteSpace(p)) continue;
                        dto.Icons.Add(new IconEntryDto
                        {
                            Id = Guid.NewGuid().ToString(),
                            Name = Path.GetFileNameWithoutExtension(p),
                            IcoStr = p.Replace("\\", "/")
                        });
                    }
                    if (dto.Icons.Count > 0) migrated.Add(dto);
                }
                if (migrated.Count > 0) _persistence.Save(migrated);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[IconStudio] Registry migration failed: {ex.Message}");
            }
        }

        private void EnsureRegistrySetup()
        {
            using var key = Registry.CurrentUser.CreateSubKey(LIBRARY_REG_PATH);
            UpdateContextMenu();
        }

        public static string StageIconFile(string sourceIconPath)
        {
            if (string.IsNullOrEmpty(sourceIconPath) || !File.Exists(sourceIconPath)) return sourceIconPath;
            try
            {
                string dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BNDZ64", "applied-icons");
                Directory.CreateDirectory(dir);
                string name = Path.GetFileNameWithoutExtension(sourceIconPath) + ".ico";
                string dest = Path.Combine(dir, name);
                File.Copy(sourceIconPath, dest, overwrite: true);
                return dest;
            }
            catch
            {
                return sourceIconPath;
            }
        }

        /// <summary>Split "C:\icons\x.ico,3" into path + index. Plain paths return index 0.</summary>
        public static (string Path, int Index) ParseIconResource(string raw)
        {
            if (string.IsNullOrEmpty(raw)) return ("", 0);
            int comma = raw.LastIndexOf(',');
            if (comma > 1 && int.TryParse(raw[(comma + 1)..].Trim(), out int idx))
                return (raw[..comma].Trim(), idx);
            return (raw, 0);
        }

        public void ApplyFolderIcon(string folderPath, string iconPath, int iconIndex = 0)
        {
            if (string.IsNullOrEmpty(folderPath) || !Directory.Exists(folderPath)) return;

            // Support "shell32.dll,5" style resources from library entries
            var (parsedPath, parsedIndex) = ParseIconResource(iconPath);
            if (parsedIndex != 0 && iconIndex == 0) { iconPath = parsedPath; iconIndex = parsedIndex; }
            else if (parsedPath != iconPath) iconPath = parsedPath;

            if (!string.IsNullOrEmpty(iconPath) && File.Exists(iconPath)
                && iconPath.EndsWith(".ico", StringComparison.OrdinalIgnoreCase))
                iconPath = StageIconFile(iconPath);

            string iniPath = Path.Combine(folderPath, "desktop.ini");

            // Lift hidden/system attributes if exists so we can write to it
            if (File.Exists(iniPath))
            {
                var attrs = File.GetAttributes(iniPath);
                File.SetAttributes(iniPath, attrs & ~FileAttributes.Hidden & ~FileAttributes.System);
            }

            // Write desktop.ini using standard formatting
            string[] contents = {
                "[.ShellClassInfo]",
                $"IconResource={iconPath},{iconIndex}"
            };
            File.WriteAllLines(iniPath, contents);

            // Re-hide desktop.ini
            File.SetAttributes(iniPath, FileAttributes.Hidden | FileAttributes.System);

            // Make folder system (critical for Windows to process desktop.ini)
            File.SetAttributes(folderPath, File.GetAttributes(folderPath) | FileAttributes.System);

            // Notify Explorer
            SHChangeNotify(0x08000000, 0x0000 | 0x1000, IntPtr.Zero, IntPtr.Zero);
        }

        public void ApplyFileIcon(string filePath, string iconPath)
        {
            if (string.IsNullOrEmpty(filePath) || !File.Exists(filePath)) return;

            string ext = Path.GetExtension(filePath).ToLowerInvariant();
            
            // If it's already a shortcut, just modify it
            if (ext == ".lnk")
            {
                ModifyShortcutIcon(filePath, iconPath);
                SHChangeNotify(0x08000000, 0x0000 | 0x1000, IntPtr.Zero, IntPtr.Zero);
                return;
            }

            // For regular files, we can modify the global DefaultIcon in HKCU\\Software\\Classes
            try
            {
                using var classKey = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{ext}");
                if (classKey != null)
                {
                    string? progId = classKey.GetValue("") as string;
                    string targetKey = string.IsNullOrEmpty(progId) ? ext : progId;
                    
                    using var defaultIconKey = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{targetKey}\DefaultIcon");
                    if (defaultIconKey != null)
                    {
                        defaultIconKey.SetValue("", iconPath + ",0");
                    }
                }
                SHChangeNotify(0x08000000, 0x0000 | 0x1000, IntPtr.Zero, IntPtr.Zero);
            }
            catch { }
        }

        /// <summary>Clear a .lnk file's custom IconLocation so it falls back to the target's icon.</summary>
        public void RestoreShortcutIcon(string lnkPath)
        {
            try
            {
                Type? wscriptShellType = Type.GetTypeFromProgID("WScript.Shell");
                if (wscriptShellType == null) return;
                object shell = Activator.CreateInstance(wscriptShellType)!;
                object shortcut = wscriptShellType.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath })!;
                shortcut.GetType().InvokeMember("IconLocation", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { ",0" });
                shortcut.GetType().InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, shortcut, null);
                SHChangeNotify(0x08000000, 0x1000, IntPtr.Zero, IntPtr.Zero);
            }
            catch { }
        }

        /// <summary>Undo ApplyFileIcon's per-user extension DefaultIcon override.</summary>
        public bool RestoreFileExtensionIcon(string filePath)
        {
            string ext = Path.GetExtension(filePath).ToLowerInvariant();
            if (string.IsNullOrEmpty(ext)) return false;
            try
            {
                string targetKey = ext;
                using (var classKey = Registry.CurrentUser.OpenSubKey($@"Software\Classes\{ext}"))
                {
                    if (classKey?.GetValue("") is string progId && !string.IsNullOrEmpty(progId))
                        targetKey = progId;
                }
                using var parent = Registry.CurrentUser.OpenSubKey($@"Software\Classes\{targetKey}", writable: true);
                parent?.DeleteSubKey("DefaultIcon", false);
                SHChangeNotify(0x08000000, 0x1000, IntPtr.Zero, IntPtr.Zero);
                return true;
            }
            catch { return false; }
        }

        private void ModifyShortcutIcon(string lnkPath, string iconPath)
        {
            try
            {
                Type? wscriptShellType = Type.GetTypeFromProgID("WScript.Shell");
                if (wscriptShellType == null) return;
                
                object shell = Activator.CreateInstance(wscriptShellType)!;
                object shortcut = wscriptShellType.InvokeMember("CreateShortcut", System.Reflection.BindingFlags.InvokeMethod, null, shell, new object[] { lnkPath })!;
                
                shortcut.GetType().InvokeMember("IconLocation", System.Reflection.BindingFlags.SetProperty, null, shortcut, new object[] { iconPath + ",0" });
                shortcut.GetType().InvokeMember("Save", System.Reflection.BindingFlags.InvokeMethod, null, shortcut, null);
            }
            catch { }
        }

        public List<IconLibraryDto> GetPersistedLibraries() => _persistence.Load();

        public object GetLibrariesForFrontend()
        {
            return GetPersistedLibraries().Select(lib => new
            {
                id = string.IsNullOrEmpty(lib.Id) ? $"lib_{lib.Name}" : lib.Id,
                name = lib.Name,
                sourceFolder = lib.SourceFolder,
                icons = lib.Icons.Select(ic => new
                {
                    id = ic.Id,
                    name = ic.Name,
                    icoStr = ic.IcoStr?.Replace("\\", "/") ?? ""
                }).ToList()
            }).ToList();
        }

        public List<IconLibraryDto> ParseLibrariesFromJson(JsonElement librariesArray)
        {
            var dtos = new List<IconLibraryDto>();
            foreach (var lib in librariesArray.EnumerateArray())
            {
                var dto = new IconLibraryDto
                {
                    Id = lib.TryGetProperty("id", out var idEl) ? idEl.GetString() ?? Guid.NewGuid().ToString() : Guid.NewGuid().ToString(),
                    Name = lib.TryGetProperty("name", out var nameEl) ? nameEl.GetString() ?? "Library" : "Library",
                    SourceFolder = lib.TryGetProperty("sourceFolder", out var sfEl) ? sfEl.GetString() : null,
                };

                if (lib.TryGetProperty("icons", out var iconsEl) && iconsEl.ValueKind == JsonValueKind.Array)
                {
                    foreach (var ic in iconsEl.EnumerateArray())
                    {
                        if (ic.ValueKind == JsonValueKind.String)
                        {
                            string path = ic.GetString() ?? "";
                            dto.Icons.Add(new IconEntryDto
                            {
                                Id = Guid.NewGuid().ToString(),
                                Name = Path.GetFileNameWithoutExtension(path),
                                IcoStr = path.Replace("\\", "/")
                            });
                        }
                        else
                        {
                            dto.Icons.Add(new IconEntryDto
                            {
                                Id = ic.TryGetProperty("id", out var iid) ? iid.GetString() ?? Guid.NewGuid().ToString() : Guid.NewGuid().ToString(),
                                Name = ic.TryGetProperty("name", out var iname) ? iname.GetString() ?? "Icon" : "Icon",
                                IcoStr = (ic.TryGetProperty("icoStr", out var ip) ? ip.GetString() : "")?.Replace("\\", "/") ?? ""
                            });
                        }
                    }
                }

                dto.Icons = dto.Icons.Where(i => !string.IsNullOrWhiteSpace(i.IcoStr)).ToList();
                if (!string.IsNullOrWhiteSpace(dto.Name))
                    dtos.Add(dto);
            }

            return dtos;
        }

        /// <summary>Fast path — JSON persistence only (returns immediately).</summary>
        public bool SaveLibrariesFromJson(JsonElement librariesArray)
        {
            var dtos = ParseLibrariesFromJson(librariesArray);
            _persistence.Save(dtos);
            return true;
        }

        /// <summary>Legacy alias — saves then rebuilds shell context menu (slow).</summary>
        public bool SyncLibrariesFromJson(JsonElement librariesArray)
        {
            if (!SaveLibrariesFromJson(librariesArray)) return false;
            RebuildExplorerContextMenu();
            return true;
        }

        /// <summary>Registry / shell menu rebuild — can take several seconds for large libraries.</summary>
        public void RebuildExplorerContextMenu()
        {
            UpdateContextMenu();
        }

        public List<IconLibrary> GetLibraries()
        {
            return GetPersistedLibraries().Select(d => new IconLibrary
            {
                Name = d.Name,
                Icons = d.Icons.Select(i => i.IcoStr.Replace("/", "\\")).Where(File.Exists).ToList()
            }).ToList();
        }

        public void CreateLibrary(string name, List<string> icons)
        {
            var existing = _persistence.Load();
            existing.RemoveAll(l => l.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
            existing.Add(new IconLibraryDto
            {
                Id = $"lib_{name}",
                Name = name,
                Icons = icons.Select(p => new IconEntryDto
                {
                    Id = Guid.NewGuid().ToString(),
                    Name = Path.GetFileNameWithoutExtension(p),
                    IcoStr = p.Replace("\\", "/")
                }).ToList()
            });
            _persistence.Save(existing);
            UpdateContextMenuFromDtos(existing);
        }

        public void DeleteLibrary(string name)
        {
            var existing = _persistence.Load();
            existing.RemoveAll(l => l.Name.Equals(name, StringComparison.OrdinalIgnoreCase));
            _persistence.Save(existing);
            UpdateContextMenuFromDtos(existing);
        }

        private void UpdateContextMenuFromDtos(List<IconLibraryDto> libs)
        {
            UpdateContextMenu();
        }

        // Write "IconStudio" into Explorer right-click menus (files, folders, desktop background)
        private void UpdateContextMenu()
        {
            try
            {
                var libs = GetPersistedLibraries();
                string exePath = System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName
                    ?? System.Reflection.Assembly.GetExecutingAssembly().Location;

                foreach (var (root, pathToken, filesOnly) in ContextMenuRoots)
                {
                    WriteIconStudioMenu(root, pathToken, filesOnly, libs, exePath);
                }
            }
            catch { }
            SHChangeNotify(0x08000000, 0x0000, IntPtr.Zero, IntPtr.Zero);
        }

        private static void WriteIconStudioMenu(
            string menuRoot,
            string pathToken,
            bool filesOnly,
            List<IconLibraryDto> libs,
            string exePath)
        {
            using var folderKey = Registry.CurrentUser.CreateSubKey(menuRoot);
            if (folderKey == null) return;

            folderKey.SetValue("MUIVerb", "Icon Studio");
            folderKey.SetValue("Icon", "imageres.dll,-103");

            string subShellRelative = menuRoot.Replace(@"Software\Classes\", "") + @"\shell";
            folderKey.SetValue("ExtendedSubCommandsKey", subShellRelative);

            using var subShellKey = Registry.CurrentUser.CreateSubKey(subShellRelative);
            if (subShellKey == null) return;

            foreach (var sk in subShellKey.GetSubKeyNames())
            {
                subShellKey.DeleteSubKeyTree(sk, false);
            }

            int idx = 1;
            foreach (var lib in libs)
            {
                string safeName = $"Lib_{idx++}";
                using var libKey = subShellKey.CreateSubKey(safeName);
                if (libKey == null) continue;

                libKey.SetValue("MUIVerb", lib.Name);
                string iconShellRelative = subShellRelative + @"\" + safeName + @"\shell";
                libKey.SetValue("ExtendedSubCommandsKey", iconShellRelative);

                using var iconShellKey = Registry.CurrentUser.CreateSubKey(iconShellRelative);
                if (iconShellKey == null) continue;

                int iconIdx = 1;
                foreach (var icon in lib.Icons)
                {
                    string iconPath = icon.IcoStr.Replace("/", "\\");
                    if (!File.Exists(iconPath)) continue;
                    if (filesOnly && Directory.Exists(iconPath)) continue;

                    string iconName = string.IsNullOrWhiteSpace(icon.Name)
                        ? Path.GetFileNameWithoutExtension(iconPath)
                        : icon.Name;
                    string itemKeyName = $"Icon_{iconIdx++}";

                    using var itemKey = iconShellKey.CreateSubKey(itemKeyName);
                    if (itemKey == null) continue;

                    itemKey.SetValue("", iconName);
                    itemKey.SetValue("Icon", iconPath);

                    using var cmdKey = itemKey.CreateSubKey("command");
                    cmdKey?.SetValue("", $"\"{exePath}\" --apply-icon \"{iconPath}\" \"{pathToken}\"");
                }
            }
        }
    }
}
