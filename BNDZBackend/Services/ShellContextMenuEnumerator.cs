using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using Vanara.PInvoke;
using Vanara.Windows.Shell;
using static Vanara.PInvoke.Shell32;
using static Vanara.PInvoke.User32;
using static Vanara.PInvoke.Gdi32;

namespace BNDZ.Services;

/// <summary>
/// Enumerates and invokes real Windows shell context-menu commands (IContextMenu),
/// including third-party shell extensions and cascaded OS items (New, Send to, Pin to Start, …).
/// </summary>
internal static class ShellContextMenuEnumerator
{
    private const uint CmdFirst = 1;
    private const uint CmdLast = 0x7FFF;
    private const int MaxPopupDepth = 2;

    public sealed class EnumeratedItem
    {
        public string Id { get; init; } = "";
        public string Label { get; init; } = "";
        public string? Verb { get; init; }
        public uint CommandId { get; init; }
        public bool Separator { get; init; }
        public bool IsPrimary { get; init; }
        /// <summary>shell = third-party / extension; builtin = classic verbs we already render in BNDZ.</summary>
        public string Kind { get; init; } = "shell";
        /// <summary>data:image/png;base64,… from the shell menu HBITMAP when available.</summary>
        public string? IconBase64 { get; set; }
        /// <summary>Cascaded submenu children (New, Send to, etc.).</summary>
        public List<EnumeratedItem>? Children { get; init; }
    }

    public static List<EnumeratedItem> Enumerate(string path)
        => Enumerate(new[] { path });

    public static List<EnumeratedItem> Enumerate(IReadOnlyList<string> paths)
    {
        var normalized = NormalizeMany(paths);
        if (normalized.Count == 0) return new();

        try
        {
            return WithContextMenu(normalized, (cm, hMenu) =>
            {
                // Fast path for merge menus: NORMAL only (no EXTENDEDVERBS) and no
                // InitAllPopups — cascading children are filled lazily in WalkMenu.
                // Full Explorer parity remains on Shift+right-click (live shell popup).
                var hr = cm.QueryContextMenu(hMenu, 0, CmdFirst, CmdLast,
                    CMF.CMF_NORMAL | CMF.CMF_EXPLORE | CMF.CMF_CANRENAME);
                if (hr.Failed) return new List<EnumeratedItem>();

                var cm2 = cm as IContextMenu2;
                var cm3 = cm as IContextMenu3;
                // Structure: fast path (root + first cascade only). Icons: always on those levels
                // so WinRAR/7-Zip parents get bitmaps without InitAllPopups.
                var items = WalkMenu(cm, cm2, cm3, hMenu, depth: 0, extractIcons: false);
                items = DedupeByCanonicalVerb(items);
                items = FillCascadeParentIconsFromChildren(items);
                return CompactSeparators(items);
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ShellCtx] Enumerate failed: {ex.Message}");
            return new();
        }
    }

    public static bool Invoke(string path, uint commandOffset, string? verbHint = null)
        => Invoke(new[] { path }, commandOffset, verbHint);

    public static bool Invoke(IReadOnlyList<string> paths, uint commandOffset, string? verbHint = null)
    {
        var normalized = NormalizeMany(paths);
        if (normalized.Count == 0) return false;

        try
        {
            return WithContextMenu(normalized, (cm, hMenu) =>
            {
                var hr = cm.QueryContextMenu(hMenu, 0, CmdFirst, CmdLast,
                    CMF.CMF_NORMAL | CMF.CMF_EXPLORE | CMF.CMF_CANRENAME | CMF.CMF_EXTENDEDVERBS);
                if (hr.Failed) return false;

                var cm2 = cm as IContextMenu2;
                var cm3 = cm as IContextMenu3;
                InitAllPopups(cm2, cm3, hMenu, 0);

                if (commandOffset == 0) return false;

                var byId = new CMINVOKECOMMANDINFOEX((int)commandOffset);
                cm.InvokeCommand(byId);
                return true;
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ShellCtx] Invoke failed: {ex.Message}");
            return false;
        }
    }

    private static List<EnumeratedItem> WalkMenu(
        IContextMenu cm,
        IContextMenu2? cm2,
        IContextMenu3? cm3,
        HMENU hMenu,
        int depth,
        bool extractIcons = true)
    {
        var items = new List<EnumeratedItem>();
        var count = GetMenuItemCount(hMenu);
        for (var i = 0; i < count; i++)
        {
            var state = (MenuFlags)GetMenuState(hMenu, (uint)i, MenuFlags.MF_BYPOSITION);
            if ((state & MenuFlags.MF_SEPARATOR) != 0)
            {
                items.Add(new EnumeratedItem { Separator = true, Kind = "shell" });
                continue;
            }

            if ((state & MenuFlags.MF_POPUP) != 0)
            {
                if (depth >= MaxPopupDepth) continue;

                var label = GetMenuItemLabel(hMenu, i);
                if (string.IsNullOrWhiteSpace(label) || label == "…")
                    continue;

                var sub = GetSubMenu(hMenu, i);
                if (sub == HMENU.NULL) continue;

                // Some extensions only fill children after WM_INITMENUPOPUP.
                // Fast merge path: init only the first cascade level to keep open snappy.
                if (extractIcons || depth == 0) {
                    TryInitPopup(cm2, cm3, sub, i);
                }
                var children = (extractIcons || depth == 0)
                    ? WalkMenu(cm, cm2, cm3, sub, depth + 1, extractIcons)
                    : new List<EnumeratedItem>();
                children = CompactSeparators(children);
                // Always pull bitmaps for root + first cascade (even on fast structure path).
                var wantIcon = depth <= 1;
                if (children.Count == 0)
                {
                    // Rare: popup header is itself an invokable command (owner-draw / delayed).
                    var popupCmd = GetMenuItemID(hMenu, i);
                    if (popupCmd != 0 && popupCmd != unchecked((uint)-1) && popupCmd >= CmdFirst && popupCmd <= CmdLast)
                    {
                        var offset = popupCmd - CmdFirst;
                        var verb = TryGetVerb(cm, offset);
                        var kind = IsBuiltinVerb(verb) ? "builtin" : "shell";
                        var id = !string.IsNullOrEmpty(verb) ? verb! : $"shellcmd:{offset}";
                        items.Add(new EnumeratedItem
                        {
                            Id = id,
                            Label = label,
                            Verb = string.IsNullOrEmpty(verb) ? id : verb,
                            CommandId = offset,
                            Kind = kind,
                            IconBase64 = wantIcon ? TryExtractMenuItemIconBase64(hMenu, i) : null,
                        });
                    }
                    continue;
                }

                items.Add(new EnumeratedItem
                {
                    Id = $"submenu:{label.ToLowerInvariant()}",
                    Label = label,
                    Kind = "shell",
                    IconBase64 = wantIcon ? TryExtractMenuItemIconBase64(hMenu, i) : null,
                    Children = children,
                });
                continue;
            }

            var cmdId = GetMenuItemID(hMenu, i);
            if (cmdId == 0 || cmdId == unchecked((uint)-1) || cmdId < CmdFirst || cmdId > CmdLast)
                continue;

            var leafLabel = GetMenuItemLabel(hMenu, i);
            if (string.IsNullOrWhiteSpace(leafLabel) || leafLabel == "…")
                continue;

            var leafOffset = cmdId - CmdFirst;
            var leafVerb = TryGetVerb(cm, leafOffset);
            var leafKind = IsBuiltinVerb(leafVerb) ? "builtin" : "shell";
            var leafId = !string.IsNullOrEmpty(leafVerb)
                ? leafVerb!
                : $"shellcmd:{leafOffset}";

            items.Add(new EnumeratedItem
            {
                Id = leafId,
                Label = leafLabel,
                Verb = string.IsNullOrEmpty(leafVerb) ? leafId : leafVerb,
                CommandId = leafOffset,
                IsPrimary = string.Equals(leafVerb, "open", StringComparison.OrdinalIgnoreCase),
                Kind = leafKind,
                IconBase64 = depth <= 1 ? TryExtractMenuItemIconBase64(hMenu, i) : null,
            });
        }

        return items;
    }

    /// <summary>
    /// Owner-draw cascade headers (HBMMENU_CALLBACK) often have no HBITMAP while children do.
    /// Promote the first child bitmap onto the parent so WinRAR/7-Zip parents match children.
    /// </summary>
    private static List<EnumeratedItem> FillCascadeParentIconsFromChildren(List<EnumeratedItem> items)
    {
        foreach (var item in items)
        {
            if (item.Children is { Count: > 0 } && string.IsNullOrEmpty(item.IconBase64))
            {
                foreach (var child in item.Children)
                {
                    if (!string.IsNullOrEmpty(child.IconBase64))
                    {
                        item.IconBase64 = child.IconBase64;
                        break;
                    }
                }
            }
            if (item.Children is { Count: > 0 })
                FillCascadeParentIconsFromChildren(item.Children);
        }
        return items;
    }

    private static void InitAllPopups(IContextMenu2? cm2, IContextMenu3? cm3, HMENU hMenu, int depth)
    {
        if (depth > MaxPopupDepth) return;
        var count = GetMenuItemCount(hMenu);
        for (var i = 0; i < count; i++)
        {
            var state = (MenuFlags)GetMenuState(hMenu, (uint)i, MenuFlags.MF_BYPOSITION);
            if ((state & MenuFlags.MF_POPUP) == 0) continue;
            var sub = GetSubMenu(hMenu, i);
            if (sub == HMENU.NULL) continue;
            TryInitPopup(cm2, cm3, sub, i);
            InitAllPopups(cm2, cm3, sub, depth + 1);
        }
    }

    private static void TryInitPopup(IContextMenu2? cm2, IContextMenu3? cm3, HMENU sub, int position)
    {
        try
        {
            if (cm3 != null)
            {
                cm3.HandleMenuMsg2(
                    (uint)WindowMessage.WM_INITMENUPOPUP,
                    (IntPtr)sub,
                    (IntPtr)position,
                    out _);
                return;
            }

            cm2?.HandleMenuMsg((uint)WindowMessage.WM_INITMENUPOPUP, (IntPtr)sub, (IntPtr)position);
        }
        catch
        {
            // Best-effort — some hosts reject synthetic init without a message pump.
        }
    }

    private static T WithContextMenu<T>(string path, Func<IContextMenu, HMENU, T> work)
        => WithContextMenu(new[] { path }, work);

    private static T WithContextMenu<T>(IReadOnlyList<string> paths, Func<IContextMenu, HMENU, T> work)
    {
        if (paths == null || paths.Count == 0)
            throw new ArgumentException("No paths for context menu.", nameof(paths));

        var shellItems = new List<ShellItem>(paths.Count);
        try
        {
            foreach (var path in paths)
                shellItems.Add(new ShellItem(path));

            // Multi-select IContextMenu requires a shared parent folder (Explorer rule).
            var parent = shellItems[0].Parent as ShellFolder;
            if (parent == null)
                throw new InvalidOperationException("No parent shell folder.");

            using (parent)
            {
                var cm = parent.GetChildrenUIObjects<IContextMenu>(HWND.NULL, shellItems.ToArray());
                if (cm == null)
                    throw new InvalidOperationException("IContextMenu unavailable.");

                var hMenu = CreatePopupMenu();
                try
                {
                    return work(cm, hMenu);
                }
                finally
                {
                    if (hMenu != HMENU.NULL)
                        DestroyMenu(hMenu);
                    Marshal.ReleaseComObject(cm);
                }
            }
        }
        finally
        {
            foreach (var it in shellItems)
                it.Dispose();
        }
    }

    private static List<string> NormalizeMany(IReadOnlyList<string>? paths)
    {
        var list = new List<string>();
        if (paths == null) return list;
        foreach (var raw in paths)
        {
            var path = Normalize(raw);
            if (string.IsNullOrEmpty(path)) continue;
            if (!File.Exists(path) && !Directory.Exists(path)) continue;
            if (!list.Contains(path, StringComparer.OrdinalIgnoreCase))
                list.Add(path);
        }
        // Same-parent only for multi-select shell menus.
        if (list.Count > 1)
        {
            var parent = Path.GetDirectoryName(list[0].TrimEnd('\\', '/')) ?? "";
            list = list.Where(p =>
            {
                var d = Path.GetDirectoryName(p.TrimEnd('\\', '/')) ?? "";
                return string.Equals(d, parent, StringComparison.OrdinalIgnoreCase);
            }).ToList();
        }
        return list;
    }

    private static string GetMenuItemLabel(HMENU hMenu, int index)
    {
        var sb = new StringBuilder(512);
        var len = GetMenuString(hMenu, (uint)index, sb, sb.Capacity, MenuFlags.MF_BYPOSITION);
        if (len <= 0) return "";
        return sb.ToString().Replace("&", "").Trim();
    }

    /// <summary>
    /// Pull the shell-provided menu bitmap (Git / Cursor / etc.) into a data-URL for the WebView menu.
    /// Uses ShellArgbPngEncoder to preserve alpha and avoid black-square halos on 32bpp DIBSECTIONs.
    /// Stock HBMMENU_* values are skipped — they are not real HBITMAPs.
    /// </summary>
    private static string? TryExtractMenuItemIconBase64(HMENU hMenu, int index)
    {
        try
        {
            var mii = new MENUITEMINFO
            {
                cbSize = (uint)Marshal.SizeOf<MENUITEMINFO>(),
                fMask = MenuItemInfoMask.MIIM_BITMAP | MenuItemInfoMask.MIIM_CHECKMARKS,
            };
            if (!GetMenuItemInfo(hMenu, (uint)index, true, ref mii))
                return null;

            var hbmp = mii.hbmpItem != HBITMAP.NULL
                ? mii.hbmpItem
                : mii.hbmpUnchecked != HBITMAP.NULL
                    ? mii.hbmpUnchecked
                    : mii.hbmpChecked;
            if (hbmp == HBITMAP.NULL || IsStockMenuBitmap(hbmp))
                return null;

            // Use ShellArgbPngEncoder — preserves 32bpp alpha via GetObject scan-line copy
            // instead of Image.FromHbitmap which flattens alpha into an opaque/black plate.
            var raw = ShellArgbPngEncoder.EncodeHBitmapPngBase64((IntPtr)hbmp);
            if (string.IsNullOrEmpty(raw))
                return null;

            return "data:image/png;base64," + raw;
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ShellCtx] Icon extract failed: {ex.Message}");
            return null;
        }
    }

    /// <summary>HBMMENU_CALLBACK (-1) and HBMMENU_SYSTEM…POPUP* (1–11) are not GDI bitmaps.</summary>
    private static bool IsStockMenuBitmap(HBITMAP hbmp)
    {
        var v = ((IntPtr)hbmp).ToInt64();
        return v is >= -1 and <= 11;
    }

    private static string? TryGetVerb(IContextMenu cm, uint offset)
    {
        var buf = Marshal.AllocHGlobal(512);
        try
        {
            var hr = cm.GetCommandString((nuint)offset, GCS.GCS_VERBW, default, buf, 256);
            if (hr.Succeeded)
            {
                var v = Marshal.PtrToStringUni(buf)?.Trim();
                if (!string.IsNullOrEmpty(v)) return v;
            }

            hr = cm.GetCommandString((nuint)offset, GCS.GCS_VERBA, default, buf, 256);
            if (hr.Succeeded)
            {
                var v = Marshal.PtrToStringAnsi(buf)?.Trim();
                if (!string.IsNullOrEmpty(v)) return v;
            }
        }
        catch { }
        finally
        {
            Marshal.FreeHGlobal(buf);
        }
        return null;
    }

    /// <summary>
    /// Verbs BNDZ already paints in the custom menu (must stay aligned with
    /// <c>BUILT_IN_CONTEXT_VERBS</c> in <c>src/lib/contextMenuActions.ts</c>).
    /// Share / Give access / Send to / Copy path / Pin were missing and caused
    /// Shift+RMB weave duplicates when shell extensions re-registered them.
    /// </summary>
    private static bool IsBuiltinVerb(string? verb)
    {
        if (string.IsNullOrWhiteSpace(verb)) return false;
        var v = verb.Trim().ToLowerInvariant();
        // Drop shell32 namespace prefixes (Windows.ModernShare → modernshare, etc.)
        var bare = v.Contains('.') ? v[(v.LastIndexOf('.') + 1)..] : v;
        return bare is
            "open" or "edit" or "openas" or "openwith" or "cut" or "copy" or "paste"
            or "delete" or "trash" or "rename" or "properties" or "settings"
            or "link" or "print" or "runas"
            or "share" or "modernshare" or "grantaccess" or "sendto"
            or "copyaspath" or "copypath"
            or "pintohome" or "pintostartscreen" or "pintotaskbar";
    }

    /// <summary>
    /// Canonical (culture/label-invariant) key for verbs that Explorer only ever shows once,
    /// even though a shell extension or a localized handler can enumerate the same command
    /// twice (e.g. the OS "Open" plus a third-party "Open" echo, or "Properties" duplicated
    /// by a non-English label). Returns null for opaque/extension-only verbs, which are never
    /// merged here — only known canonical builtin verbs are deduped.
    /// </summary>
    private static string? CanonicalVerbKey(string? verb)
    {
        if (string.IsNullOrWhiteSpace(verb)) return null;
        var v = verb.Trim().ToLowerInvariant();
        var bare = v.Contains('.') ? v[(v.LastIndexOf('.') + 1)..] : v;
        // Alias families that Shell32/WinRT spell differently for the same UI command.
        if (bare is "openas" or "openwith") return "openwith";
        if (bare is "share" or "modernshare") return "share";
        if (bare is "copyaspath" or "copypath") return "copypath";
        if (bare is "delete" or "trash") return "delete";
        if (bare is "grantaccess") return "grantaccess";
        if (bare is "sendto") return "sendto";
        return IsBuiltinVerb(bare) ? bare : null;
    }

    /// <summary>
    /// Dedupe the live shell menu by canonical verb (not label text), so Open/Properties/etc.
    /// aren't doubled when a shell extension re-registers a builtin verb or supplies a
    /// non-English label for the same command id. Recurses into cascaded submenus (Send to,
    /// New, …) so nested duplicates are caught too. Opaque extension commands without a
    /// recognized verb are never merged — only the first occurrence of each canonical verb
    /// at a given menu level survives, preserving the shell's original ordering/priority.
    /// </summary>
    private static List<EnumeratedItem> DedupeByCanonicalVerb(List<EnumeratedItem> items)
    {
        var result = new List<EnumeratedItem>(items.Count);
        var seenVerbs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var item in items)
        {
            if (item.Separator)
            {
                result.Add(item);
                continue;
            }

            if (item.Children is { Count: > 0 })
            {
                result.Add(new EnumeratedItem
                {
                    Id = item.Id,
                    Label = item.Label,
                    Verb = item.Verb,
                    CommandId = item.CommandId,
                    Separator = item.Separator,
                    IsPrimary = item.IsPrimary,
                    Kind = item.Kind,
                    IconBase64 = item.IconBase64,
                    Children = DedupeByCanonicalVerb(item.Children),
                });
                continue;
            }

            var canonicalVerb = CanonicalVerbKey(item.Verb);
            if (canonicalVerb != null && !seenVerbs.Add(canonicalVerb))
                continue; // already have this canonical command at this menu level

            result.Add(item);
        }
        return result;
    }

    private static List<EnumeratedItem> CompactSeparators(List<EnumeratedItem> items)
    {
        var outList = new List<EnumeratedItem>();
        foreach (var item in items)
        {
            if (item.Separator)
            {
                if (outList.Count == 0 || outList[^1].Separator) continue;
                outList.Add(item);
                continue;
            }
            outList.Add(item);
        }
        while (outList.Count > 0 && outList[^1].Separator)
            outList.RemoveAt(outList.Count - 1);
        return outList;
    }

    private static string Normalize(string path)
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
}
