using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using Vanara.PInvoke;
using Vanara.Windows.Shell;
using static Vanara.PInvoke.Shell32;

namespace BNDZ.Services;

public sealed class ShellContextMenuService
{
    public sealed class MenuItemDto
    {
        public string? Id { get; init; }
        public string? Label { get; init; }
        public string? Verb { get; init; }
        public string? Icon { get; init; }
        /// <summary>data:image/png;base64,… when extracted from the live shell menu.</summary>
        public string? IconBase64 { get; init; }
        public bool IsPrimary { get; init; }
        public bool Separator { get; init; }
        /// <summary>shell | builtin</summary>
        public string? Kind { get; init; }
        public uint? CommandId { get; init; }
        /// <summary>Cascaded shell submenu (New, Send to, …).</summary>
        public List<MenuItemDto>? Children { get; init; }

        public static MenuItemDto Sep() => new() { Separator = true };
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct SHFILEOPSTRUCT
    {
        public IntPtr hwnd;
        public uint wFunc;
        public string pFrom;
        public string pTo;
        public ushort fFlags;
        public bool fAnyOperationsAborted;
        public IntPtr hNameMappings;
        public string lpszProgressTitle;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SHFileOperation(ref SHFILEOPSTRUCT fileOp);

    [DllImport("shell32.dll")]
    private static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

    [DllImport("shell32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern bool ShellExecuteEx(ref SHELLEXECUTEINFO lpExecInfo);

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct SHELLEXECUTEINFO
    {
        public int cbSize;
        public uint fMask;
        public IntPtr hwnd;
        [MarshalAs(UnmanagedType.LPTStr)] public string? lpVerb;
        [MarshalAs(UnmanagedType.LPTStr)] public string? lpFile;
        [MarshalAs(UnmanagedType.LPTStr)] public string? lpParameters;
        [MarshalAs(UnmanagedType.LPTStr)] public string? lpDirectory;
        public int nShow;
        public IntPtr hInstApp;
        public IntPtr lpIDList;
        [MarshalAs(UnmanagedType.LPTStr)] public string? lpClass;
        public IntPtr hkeyClass;
        public uint dwHotKey;
        public IntPtr hIcon;
        public IntPtr hProcess;
    }

    private const int SW_SHOW = 5;
    private const uint SEE_MASK_ASYNCOK = 0x00100000;

    private const uint FO_DELETE = 0x0003;
    private const ushort FOF_ALLOWUNDO = 0x0040;
    private const ushort FOF_NOCONFIRMATION = 0x0010;
    private const ushort FOF_SILENT = 0x0004;
    private const uint SHCNE_ASSOCCHANGED = 0x08000000;
    private const uint SHCNF_IDLIST = 0x0000;

    private static string NormalizePath(string path)
    {
        if (string.IsNullOrWhiteSpace(path)) return "";
        if (path.StartsWith("/")) path = path[1..];
        path = path.Replace('/', '\\');
        while (path.Contains("\\\\")) path = path.Replace("\\\\", "\\");
        if (path.StartsWith("\\") && path.Length >= 3 && char.IsLetter(path[1]) && path[2] == ':')
            path = path.TrimStart('\\');
        if (path.Length == 2 && path[1] == ':') path += "\\";
        return path;
    }

    /// <summary>
    /// Show the live Windows shell context menu via Vanara TrackPopupMenu host.
    /// Never opens Explorer — invokes IContextMenu in-process only.
    /// </summary>
    public void ShowNativeContextMenu(IntPtr hwnd, string path, int screenX, int screenY)
        => ShowNativeContextMenu(hwnd, new[] { path }, screenX, screenY);

    /// <summary>Multi-select shell context menu (same-parent items → IShellItemArray).</summary>
    public void ShowNativeContextMenu(IntPtr hwnd, IEnumerable<string> rawPaths, int screenX, int screenY)
    {
        var paths = NormalizeExistingPaths(rawPaths);
        // Same-parent only — IShellItemArray / CreateFromItems requires a shared folder.
        if (paths.Count > 1)
        {
            var parent = Path.GetDirectoryName(paths[0].TrimEnd('\\', '/')) ?? "";
            paths = paths.Where(p =>
            {
                var d = Path.GetDirectoryName(p.TrimEnd('\\', '/')) ?? "";
                return string.Equals(d, parent, StringComparison.OrdinalIgnoreCase);
            }).ToList();
        }
        if (paths.Count == 0) return;

        try
        {
            BndzUiDispatcher.Invoke(() =>
            {
                var items = new List<ShellItem>(paths.Count);
                try
                {
                    foreach (var p in paths)
                        items.Add(new ShellItem(p));

                    using var menu = ShellContextMenu.CreateFromItems(items, out var keepAlive);
                    try
                    {
                        var owner = hwnd != IntPtr.Zero ? new HWND(hwnd) : HWND.NULL;
                        menu.ShowContextMenu(
                            new POINT(screenX, screenY),
                            CMF.CMF_NORMAL | CMF.CMF_EXPLORE | CMF.CMF_CANRENAME | CMF.CMF_EXTENDEDVERBS,
                            onMenuItemClicked: null,
                            hWnd: owner);
                    }
                    finally
                    {
                        keepAlive?.Dispose();
                    }
                }
                finally
                {
                    foreach (var it in items)
                        it.Dispose();
                }
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"ShowNativeContextMenu failed: {ex.Message}");
        }
    }

    public List<MenuItemDto> GetContextMenuItems(string path)
        => GetContextMenuItems(new[] { path });

    public List<MenuItemDto> GetContextMenuItems(IEnumerable<string> rawPaths)
    {
        var paths = NormalizeExistingPaths(rawPaths);
        var items = new List<MenuItemDto>();
        if (paths.Count == 0) return items;

        // Prefer live IContextMenu enumeration (third-party shell extensions + OS cascades).
        var enumerated = ShellContextMenuEnumerator.Enumerate(paths);
        if (enumerated.Count > 0)
        {
            foreach (var e in enumerated)
                items.Add(ToDto(e));
            return items;
        }

        // Fallback if COM enumeration fails (locked path, virtual namespace, etc.)
        var path = paths[0];
        bool isDir = Directory.Exists(path);
        bool isFile = File.Exists(path);
        if (!isDir && !isFile) return items;

        items.Add(new MenuItemDto { Id = "open", Label = "Open", Verb = "open", Icon = "open", IsPrimary = true, Kind = "builtin" });

        if (isFile)
        {
            var ext = Path.GetExtension(path).ToLowerInvariant();
            if (ext is ".txt" or ".md" or ".log" or ".json" or ".xml" or ".csv")
                items.Add(new MenuItemDto { Id = "edit", Label = "Edit", Verb = "edit", Icon = "edit", Kind = "builtin" });
            items.Add(new MenuItemDto { Id = "openas", Label = "Open with...", Verb = "openas", Icon = "open", Kind = "builtin" });
        }

        items.Add(MenuItemDto.Sep());
        items.Add(new MenuItemDto { Id = "cut", Label = "Cut", Verb = "cut", Icon = "cut", Kind = "builtin" });
        items.Add(new MenuItemDto { Id = "copy", Label = "Copy", Verb = "copy", Icon = "copy", Kind = "builtin" });
        items.Add(new MenuItemDto { Id = "paste", Label = "Paste", Verb = "paste", Icon = "paste", Kind = "builtin" });
        items.Add(new MenuItemDto { Id = "delete", Label = "Delete", Verb = "delete", Icon = "trash", Kind = "builtin" });
        items.Add(new MenuItemDto { Id = "rename", Label = "Rename", Verb = "rename", Icon = "rename", Kind = "builtin" });
        items.Add(MenuItemDto.Sep());
        items.Add(new MenuItemDto { Id = "properties", Label = "Properties", Verb = "properties", Icon = "settings", Kind = "builtin" });

        return items;
    }

    private static List<string> NormalizeExistingPaths(IEnumerable<string>? rawPaths)
    {
        var paths = new List<string>();
        if (rawPaths == null) return paths;
        foreach (var p in rawPaths)
        {
            var n = ShellPathResolver.ResolveForShell(NormalizePath(p));
            if (string.IsNullOrEmpty(n)) continue;
            if (!File.Exists(n) && !Directory.Exists(n)) continue;
            if (!paths.Contains(n, StringComparer.OrdinalIgnoreCase))
                paths.Add(n);
        }
        return paths;
    }

    private static MenuItemDto ToDto(ShellContextMenuEnumerator.EnumeratedItem e)
    {
        if (e.Separator) return MenuItemDto.Sep();
        List<MenuItemDto>? children = null;
        if (e.Children is { Count: > 0 })
        {
            children = new List<MenuItemDto>(e.Children.Count);
            foreach (var child in e.Children)
                children.Add(ToDto(child));
        }

        return new MenuItemDto
        {
            Id = e.Id,
            Label = e.Label,
            Verb = e.Verb,
            Icon = e.Children is { Count: > 0 } ? "shell" : (e.Kind == "shell" ? "shell" : (e.Verb ?? "open")),
            IconBase64 = e.IconBase64,
            IsPrimary = e.IsPrimary,
            Kind = e.Kind,
            CommandId = e.CommandId >= 0 ? e.CommandId : null,
            Children = children,
        };
    }

    public bool InvokeVerb(IEnumerable<string> rawPaths, string verb, IntPtr hwnd, bool bypassRecycleBin = false, string? sendToTarget = null)
    {
        var paths = new List<string>();
        foreach (var p in rawPaths)
        {
            var n = ShellPathResolver.ResolveForShell(NormalizePath(p));
            if (!string.IsNullOrEmpty(n) && ShellPathResolver.PathExistsForShell(n))
                paths.Add(n);
        }
        if (paths.Count == 0) return false;

        verb = (verb ?? "").ToLowerInvariant();

        try
        {
            switch (verb)
            {
                case "open":
                    // Fire-and-forget — never block the IPC/UI thread on association launch.
                    var openPaths = paths.ToList();
                    _ = Task.Run(() =>
                    {
                        foreach (var p in openPaths)
                        {
                            try { LaunchShellVerb(p, "open"); }
                            catch (Exception ex) { Debug.WriteLine($"open '{p}': {ex.Message}"); }
                        }
                    });
                    return true;

                case "edit":
                    var editPaths = paths.Where(File.Exists).ToList();
                    _ = Task.Run(() =>
                    {
                        foreach (var p in editPaths)
                        {
                            try { LaunchShellVerb(p, "edit"); }
                            catch (Exception ex) { Debug.WriteLine($"edit '{p}': {ex.Message}"); }
                        }
                    });
                    return true;

                case "openas":
                case "openwith":
                    if (paths.Count > 0)
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = "rundll32.exe",
                            Arguments = $"shell32.dll,OpenAs_RunDLL {paths[0]}",
                            UseShellExecute = true
                        });
                    }
                    return true;

                case "properties":
                    foreach (var p in paths)
                        ShellPropertiesHelper.ShowProperties(p, hwnd);
                    return true;

                case "delete":
                    foreach (var p in paths)
                    {
                        if (bypassRecycleBin)
                        {
                            if (File.Exists(p)) File.Delete(p);
                            else if (Directory.Exists(p)) Directory.Delete(p, true);
                        }
                        else
                        {
                            DeleteToRecycleBin(p, hwnd);
                        }
                    }
                    SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero);
                    return true;

                case "copy":
                case "cut":
                    return SetClipboardFileDrop(paths, cut: verb == "cut");

                case "paste":
                    return PasteFromClipboard(paths[0]);

                case "rename":
                    // No shell verb exists for rename — the frontend inline-rename handles this
                    return false;

                case "sendto":
                    if (paths.Count > 0 && !string.IsNullOrEmpty(sendToTarget))
                        return InvokeSendTo(sendToTarget, paths[0]);
                    return false;

                case "share":
                    return ModernShareHelper.TryShowShareUi(hwnd, paths)
                        || ModernShareHelper.TryShowShareUiForActiveWindow(paths);

                case "grantaccess":
                    // Network sharing ACL UI lives on the Properties dialog Sharing tab.
                    foreach (var p in paths)
                        ShellPropertiesHelper.ShowProperties(p, hwnd);
                    return true;

                case "copy-to-device":
                    if (paths.Count > 0 && !string.IsNullOrEmpty(sendToTarget))
                        return CopyPathsToPortableDevice(paths, sendToTarget);
                    return false;

                default:
                    // Opaque IContextMenu command (third-party shell extension).
                    if (verb.StartsWith("shellcmd:", StringComparison.OrdinalIgnoreCase)
                        && uint.TryParse(verb.AsSpan("shellcmd:".Length), out var cmdOffset))
                    {
                        return ShellContextMenuEnumerator.Invoke(paths, cmdOffset);
                    }

                    // Non-builtin verb — prefer IContextMenu when we have a commandId in the verb payload:
                    // Frontend may send "shellcmd:N" or the raw verb; try IContextMenu first with offset 0 skip.
                    if (!string.IsNullOrEmpty(verb)
                        && verb is not ("open" or "edit" or "openas" or "openwith" or "cut" or "copy"
                            or "paste" or "delete" or "rename" or "properties" or "share" or "sendto" or "copy-to-device"))
                    {
                        // Re-enumerate and match by verb or label is expensive; try ShellExecute verb first.
                        try
                        {
                            LaunchShellVerb(paths[0], verb, hwnd);
                            return true;
                        }
                        catch { }
                    }

                    foreach (var p in paths)
                    {
                        try { LaunchShellVerb(p, verb); } catch { }
                    }
                    return true;
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"InvokeVerb '{verb}' failed: {ex.Message}");
            return false;
        }
    }

    private static void LaunchShellVerb(string path, string verb, IntPtr hwnd = default)
    {
        var info = new SHELLEXECUTEINFO
        {
            cbSize = Marshal.SizeOf<SHELLEXECUTEINFO>(),
            // NEVER SEE_MASK_NOASYNC — that waits for DDE/association activation and freezes
            // the whole BNDZ host when Photos (or any handler) is slow on PNG/ICO open.
            fMask = SEE_MASK_ASYNCOK,
            hwnd = hwnd,
            lpVerb = verb,
            lpFile = path,
            nShow = SW_SHOW,
        };
        if (!ShellExecuteEx(ref info))
        {
            var err = Marshal.GetLastWin32Error();
            Debug.WriteLine($"ShellExecuteEx '{verb}' on '{path}' failed: {err}");
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = path,
                    Verb = verb,
                    UseShellExecute = true
                });
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Process.Start fallback failed: {ex.Message}");
            }
        }
    }

    /// <summary>
    /// Public entry for FM cut/copy: put real filesystem paths on the Windows clipboard
    /// exactly like Explorer (CF_HDROP + Preferred DropEffect).
    /// </summary>
    public bool TrySetShellClipboard(IEnumerable<string> rawPaths, bool cut)
    {
        var paths = new List<string>();
        foreach (var p in rawPaths ?? Array.Empty<string>())
        {
            var n = ShellPathResolver.ResolveForShell(NormalizePath(p));
            if (string.IsNullOrEmpty(n)) continue;
            if (!File.Exists(n) && !Directory.Exists(n)) continue;
            paths.Add(n);
        }
        if (paths.Count == 0) return false;
        return SetClipboardFileDrop(paths, cut);
    }

    /// <summary>Read Explorer-compatible FileDrop clipboard (paths + cut/copy effect).</summary>
    public (List<string> Paths, bool Cut, bool Ok) TryGetShellClipboard()
    {
        try
        {
            return BndzUiDispatcher.Invoke(() =>
            {
                var list = new List<string>();
                bool isCut = false;
                if (!System.Windows.Clipboard.ContainsFileDropList())
                    return (list, false, false);

                foreach (string? f in System.Windows.Clipboard.GetFileDropList())
                {
                    if (string.IsNullOrEmpty(f)) continue;
                    var n = NormalizePath(f);
                    if (!string.IsNullOrEmpty(n)) list.Add(n);
                }
                if (list.Count == 0) return (list, false, false);

                try
                {
                    if (System.Windows.Clipboard.GetDataObject()?.GetData("Preferred DropEffect") is MemoryStream ms)
                    {
                        if (ms.CanSeek) ms.Position = 0;
                        var b = new byte[4];
                        if (ms.Read(b, 0, 4) == 4)
                            isCut = (BitConverter.ToInt32(b, 0) & 2) == 2;
                    }
                }
                catch { /* Prefer DropEffect optional */ }

                return (list, isCut, true);
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"TryGetShellClipboard failed: {ex.Message}");
            return (new List<string>(), false, false);
        }
    }

    /// <summary>Clear Windows FileDrop clipboard after a cut paste (Explorer parity).</summary>
    public bool TryClearShellClipboard()
    {
        try
        {
            return BndzUiDispatcher.Invoke(() =>
            {
                try
                {
                    if (System.Windows.Clipboard.ContainsFileDropList())
                        System.Windows.Clipboard.Clear();
                    return true;
                }
                catch (Exception ex)
                {
                    Debug.WriteLine($"TryClearShellClipboard failed: {ex.Message}");
                    return false;
                }
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"TryClearShellClipboard failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>Put files on the Windows clipboard exactly like Explorer's Copy/Cut.</summary>
    private static bool SetClipboardFileDrop(List<string> paths, bool cut)
    {
        try
        {
            return BndzUiDispatcher.Invoke(() =>
            {
                var data = new System.Windows.DataObject();
                var fileList = new System.Collections.Specialized.StringCollection();
                foreach (var p in paths) fileList.Add(p);
                data.SetFileDropList(fileList);
                // DROPEFFECT_MOVE = 2, DROPEFFECT_COPY|LINK = 5 — Explorer interop convention
                data.SetData("Preferred DropEffect", new MemoryStream(BitConverter.GetBytes(cut ? 2 : 5)));
                // Also set Unicode text so Notepad / browsers / other apps can paste paths.
                try { data.SetText(string.Join(Environment.NewLine, paths)); } catch { /* optional */ }
                System.Windows.Clipboard.SetDataObject(data, true);
                return true;
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"SetClipboardFileDrop failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>Paste clipboard files into the target folder, honoring Explorer's cut/copy effect.</summary>
    private static bool PasteFromClipboard(string targetPath)
    {
        string destDir = Directory.Exists(targetPath) ? targetPath : Path.GetDirectoryName(targetPath) ?? "";
        if (string.IsNullOrEmpty(destDir) || !Directory.Exists(destDir)) return false;

        List<string> sources;
        bool move;
        try
        {
            (sources, move) = BndzUiDispatcher.Invoke(() =>
            {
                var list = new List<string>();
                bool isMove = false;
                if (System.Windows.Clipboard.ContainsFileDropList())
                {
                    foreach (string? f in System.Windows.Clipboard.GetFileDropList())
                        if (!string.IsNullOrEmpty(f)) list.Add(f);
                    try
                    {
                        if (System.Windows.Clipboard.GetDataObject()?.GetData("Preferred DropEffect") is MemoryStream ms)
                        {
                            if (ms.CanSeek) ms.Position = 0;
                            var b = new byte[4];
                            ms.Read(b, 0, 4);
                            isMove = (BitConverter.ToInt32(b, 0) & 2) == 2;
                        }
                    }
                    catch { }
                }
                return (list, isMove);
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"PasteFromClipboard clipboard read failed: {ex.Message}");
            return false;
        }

        if (sources.Count == 0) return false;

        bool any = false;
        foreach (var src in sources)
        {
            try
            {
                string name = Path.GetFileName(src.TrimEnd('\\', '/'));
                string dest = UniqueDestination(Path.Combine(destDir, name));
                if (Directory.Exists(src))
                {
                    if (move && string.Equals(Path.GetPathRoot(src), Path.GetPathRoot(dest), StringComparison.OrdinalIgnoreCase))
                        Directory.Move(src, dest);
                    else
                    {
                        CopyDirectoryRecursive(src, dest);
                        if (move) Directory.Delete(src, true);
                    }
                    any = true;
                }
                else if (File.Exists(src))
                {
                    if (move) File.Move(src, dest);
                    else File.Copy(src, dest);
                    any = true;
                }
            }
            catch (Exception ex)
            {
                Debug.WriteLine($"Paste of '{src}' failed: {ex.Message}");
            }
        }
        if (any) SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, IntPtr.Zero, IntPtr.Zero);
        return any;
    }

    private static string UniqueDestination(string dest)
    {
        if (!File.Exists(dest) && !Directory.Exists(dest)) return dest;
        string dir = Path.GetDirectoryName(dest) ?? "";
        string baseName = Path.GetFileNameWithoutExtension(dest);
        string ext = Path.GetExtension(dest);
        for (int i = 2; i < 1000; i++)
        {
            string candidate = Path.Combine(dir, $"{baseName} ({i}){ext}");
            if (!File.Exists(candidate) && !Directory.Exists(candidate)) return candidate;
        }
        return dest;
    }

    private static void CopyDirectoryRecursive(string src, string dest)
    {
        Directory.CreateDirectory(dest);
        foreach (var file in Directory.GetFiles(src))
            File.Copy(file, Path.Combine(dest, Path.GetFileName(file)), overwrite: false);
        foreach (var dir in Directory.GetDirectories(src))
            CopyDirectoryRecursive(dir, Path.Combine(dest, Path.GetFileName(dir)));
    }

    private static void DeleteToRecycleBin(string path, IntPtr hwnd)
    {
        var from = path + "\0\0";
        var fileop = new SHFILEOPSTRUCT
        {
            hwnd = hwnd,
            wFunc = FO_DELETE,
            pFrom = from,
            pTo = "",
            fFlags = FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT,
        };
        SHFileOperation(ref fileop);
    }

    public List<object> GetShareMenuItems(string path, CloudStorageService cloudStorage)
    {
        path = NormalizePath(path);
        var items = new List<object>();
        if (string.IsNullOrEmpty(path)) return items;
        if (!File.Exists(path) && !Directory.Exists(path)) return items;

        bool isDir = Directory.Exists(path);
        var normPath = path.Replace('/', '\\').TrimEnd('\\') + (isDir ? "\\" : "");

        items.Add(new { id = "share", label = "Share with apps…", kind = "verb", verb = "share", group = "main" });
        if (isDir)
            items.Add(new { id = "grantaccess", label = "Give access to…", kind = "verb", verb = "grantaccess", group = "main" });

        // Connected phones / MTP — copy via shell, no Bluetooth / OneDrive / Nearby required.
        try
        {
            foreach (dynamic node in PortableDeviceService.GetTreeNodes())
            {
                string name = node.name ?? "Phone";
                string devicePath = node.path ?? "";
                if (string.IsNullOrWhiteSpace(devicePath)) continue;
                items.Add(new
                {
                    id = $"device-{name}",
                    label = $"Send to {name}…",
                    kind = "copy-to-device",
                    verb = "copy-to-device",
                    target = (string)devicePath,
                    group = "device",
                });
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"GetShareMenuItems portable devices failed: {ex.Message}");
        }

        try
        {
            var sendToDir = Environment.GetFolderPath(Environment.SpecialFolder.SendTo);
            if (Directory.Exists(sendToDir))
            {
                foreach (var file in Directory.GetFiles(sendToDir).OrderBy(f => Path.GetFileName(f)).Take(12))
                {
                    var ext = Path.GetExtension(file).ToLowerInvariant();
                    if (ext is not ".lnk" and not ".exe") continue;
                    var label = Path.GetFileNameWithoutExtension(file);
                    if (string.IsNullOrWhiteSpace(label)) continue;
                    items.Add(new { id = $"sendto-{label}", label, kind = "sendto", target = file, group = "sendto" });
                }
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"GetShareMenuItems sendto scan failed: {ex.Message}");
        }

        try
        {
            foreach (dynamic prov in cloudStorage.GetProviders())
            {
                string name = prov.name ?? "Cloud";
                string panePath = prov.path ?? "";
                var winPath = NormalizePath(((string)panePath).TrimStart('/'));
                if (string.IsNullOrEmpty(winPath) || !Directory.Exists(winPath)) continue;

                var underCloud = normPath.StartsWith(winPath.TrimEnd('\\') + "\\", StringComparison.OrdinalIgnoreCase)
                    || string.Equals(normPath.TrimEnd('\\'), winPath.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);

                if (underCloud)
                    items.Add(new { id = $"cloud-share-{name}", label = $"Share on {name}…", kind = "verb", verb = "share", group = "cloud" });
                items.Add(new { id = $"cloud-open-{name}", label = $"Open {name}", kind = "open", target = (string)panePath, group = "cloud" });
            }
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"GetShareMenuItems cloud scan failed: {ex.Message}");
        }

        return items;
    }

    private static bool InvokeSendTo(string shortcutPath, string filePath)
    {
        if (!File.Exists(shortcutPath) || string.IsNullOrEmpty(filePath)) return false;
        if (!File.Exists(filePath) && !Directory.Exists(filePath)) return false;
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = shortcutPath,
                Arguments = $"\"{filePath}\"",
                UseShellExecute = true,
            });
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"InvokeSendTo failed: {ex.Message}");
            return false;
        }
    }

    /// <summary>Copy files onto a connected portable device (MTP) via Vanara ShellFolder — no Win32 mkdir.</summary>
    private static bool CopyPathsToPortableDevice(List<string> sources, string deviceFolderPath)
    {
        if (sources.Count == 0 || string.IsNullOrWhiteSpace(deviceFolderPath)) return false;
        try
        {
            NativeShellFileOperationService.CopyToShellDestination(sources, deviceFolderPath);
            return true;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"CopyPathsToPortableDevice failed: {ex.Message}");
            return false;
        }
    }
}
