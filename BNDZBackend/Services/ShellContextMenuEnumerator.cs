using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
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
/// including third-party shell extensions (Git, Cursor, MobaXterm, etc.).
/// </summary>
internal static class ShellContextMenuEnumerator
{
    private const uint CmdFirst = 1;
    private const uint CmdLast = 0x7FFF;

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
        public string? IconBase64 { get; init; }
    }

    public static List<EnumeratedItem> Enumerate(string path)
    {
        path = Normalize(path);
        if (string.IsNullOrEmpty(path)) return new();
        if (!File.Exists(path) && !Directory.Exists(path)) return new();

        try
        {
            return WithContextMenu(path, (cm, hMenu) =>
            {
                var hr = cm.QueryContextMenu(hMenu, 0, CmdFirst, CmdLast,
                    CMF.CMF_NORMAL | CMF.CMF_EXPLORE | CMF.CMF_CANRENAME);
                if (hr.Failed) return new List<EnumeratedItem>();

                TryForwardInitMessages(cm, hMenu);

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

                    // Skip popup submenu headers (need message pump for full expand).
                    if ((state & MenuFlags.MF_POPUP) != 0)
                        continue;

                    var cmdId = GetMenuItemID(hMenu, i);
                    if (cmdId == 0 || cmdId == unchecked((uint)-1) || cmdId < CmdFirst || cmdId > CmdLast)
                        continue;

                    var label = GetMenuItemLabel(hMenu, i);
                    if (string.IsNullOrWhiteSpace(label) || label == "…")
                        continue;

                    var offset = cmdId - CmdFirst;
                    var verb = TryGetVerb(cm, offset);
                    var kind = IsBuiltinVerb(verb) ? "builtin" : "shell";
                    var id = !string.IsNullOrEmpty(verb)
                        ? verb
                        : $"shellcmd:{offset}";

                    items.Add(new EnumeratedItem
                    {
                        Id = id,
                        Label = label,
                        Verb = string.IsNullOrEmpty(verb) ? id : verb,
                        CommandId = offset,
                        IsPrimary = string.Equals(verb, "open", StringComparison.OrdinalIgnoreCase),
                        Kind = kind,
                        IconBase64 = TryExtractMenuItemIconBase64(hMenu, i),
                    });
                }

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
    {
        path = Normalize(path);
        if (string.IsNullOrEmpty(path)) return false;

        try
        {
            return WithContextMenu(path, (cm, hMenu) =>
            {
                var hr = cm.QueryContextMenu(hMenu, 0, CmdFirst, CmdLast,
                    CMF.CMF_NORMAL | CMF.CMF_EXPLORE);
                if (hr.Failed) return false;

                // Always re-query then invoke by menu-identifier offset (stable for this QueryContextMenu).
                // Verb string is kept for logging / future; opaque shellcmds always use offset.
                _ = verbHint;
                if (commandOffset == 0 && string.IsNullOrWhiteSpace(verbHint)) return false;

                if (commandOffset > 0)
                {
                    var byId = new CMINVOKECOMMANDINFOEX((int)commandOffset);
                    cm.InvokeCommand(byId);
                    return true;
                }

                return false;
            });
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[ShellCtx] Invoke failed: {ex.Message}");
            return false;
        }
    }

    private static T WithContextMenu<T>(string path, Func<IContextMenu, HMENU, T> work)
    {
        using var item = new ShellItem(path);
        var parent = item.Parent;
        if (parent == null)
            throw new InvalidOperationException("No parent shell folder.");

        using (parent)
        {
            var cm = parent.GetChildrenUIObjects<IContextMenu>(HWND.NULL, item);
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

    private static void TryForwardInitMessages(IContextMenu cm, HMENU hMenu)
    {
        try
        {
            if (cm is not IContextMenu2 cm2) return;
            var count = GetMenuItemCount(hMenu);
            for (var i = 0; i < count; i++)
            {
                var state = (MenuFlags)GetMenuState(hMenu, (uint)i, MenuFlags.MF_BYPOSITION);
                if ((state & MenuFlags.MF_POPUP) == 0) continue;
                var sub = GetSubMenu(hMenu, i);
                if (sub == HMENU.NULL) continue;
                cm2.HandleMenuMsg((uint)WindowMessage.WM_INITMENUPOPUP, (IntPtr)sub, (IntPtr)i);
            }
        }
        catch
        {
            // Best-effort
        }
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

            using var src = Image.FromHbitmap((IntPtr)hbmp);
            using var scaled = new Bitmap(16, 16, PixelFormat.Format32bppArgb);
            using (var g = Graphics.FromImage(scaled))
            {
                g.Clear(Color.Transparent);
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.DrawImage(src, new Rectangle(0, 0, 16, 16));
            }

            using var ms = new MemoryStream();
            scaled.Save(ms, ImageFormat.Png);
            return "data:image/png;base64," + Convert.ToBase64String(ms.ToArray());
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
            var hr = cm.GetCommandString((IntPtr)offset, GCS.GCS_VERBW, default, buf, 256);
            if (hr.Succeeded)
            {
                var v = Marshal.PtrToStringUni(buf)?.Trim();
                if (!string.IsNullOrEmpty(v)) return v;
            }

            hr = cm.GetCommandString((IntPtr)offset, GCS.GCS_VERBA, default, buf, 256);
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

    private static bool IsBuiltinVerb(string? verb)
    {
        if (string.IsNullOrWhiteSpace(verb)) return false;
        return verb.ToLowerInvariant() is
            "open" or "edit" or "openas" or "openwith" or "cut" or "copy" or "paste"
            or "delete" or "rename" or "properties" or "link" or "print" or "runas";
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
