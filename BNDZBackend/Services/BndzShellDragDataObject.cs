using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using Vanara.PInvoke;
using Vanara.Windows.Shell;
using static Vanara.PInvoke.Shell32;
using static Vanara.PInvoke.User32;
using ComIDataObject = System.Runtime.InteropServices.ComTypes.IDataObject;

namespace BNDZ.Services;

/// <summary>
/// Explorer-grade outbound drag payload — desktop / Explorer reject plain WinForms CF_HDROP
/// during DragOver (GiveFeedback effect=0 → DoDragDrop hr=DROP effect=NONE).
/// </summary>
internal static class BndzShellDragDataObject
{
    private sealed class ComReleaseLifetime : IDisposable
    {
        private object? _obj;
        public ComReleaseLifetime(object com) => _obj = com;
        public void Dispose()
        {
            if (_obj is null) return;
            try { Marshal.ReleaseComObject(_obj); } catch { /* ignore */ }
            _obj = null;
        }
    }

    internal static bool TryCreateShellDragPayload(
        string[] paths,
        out ComIDataObject dataObject,
        out IDisposable? lifetime,
        out string kind)
    {
        dataObject = null!;
        lifetime = null;
        kind = "";
        if (paths is not { Length: > 0 }) return false;

        ShellItem[]? items = null;
        try
        {
            items = paths.Select(static p => new ShellItem(p)).ToArray();
            if (items.Length == 0) return false;

            var groups = new Dictionary<string, List<ShellItem>>(StringComparer.OrdinalIgnoreCase);
            foreach (var item in items)
            {
                var key = ParentKey(item);
                if (!groups.TryGetValue(key, out var list))
                {
                    list = new List<ShellItem>();
                    groups[key] = list;
                }
                list.Add(item);
            }

            var chosen = groups.Values.OrderByDescending(g => g.Count).First();
            if (chosen.Count < items.Length)
            {
                OleDndLog($"shell-drag mixed-parent count={items.Length} using={chosen.Count}");
                foreach (var item in items)
                {
                    if (!chosen.Contains(item))
                        item.Dispose();
                }
                items = chosen.ToArray();
            }

            var parent = items[0].Parent as ShellFolder;
            if (parent is null)
            {
                OleDndLog("shell-drag no-parent — wpf fallback");
                return false;
            }

            using (parent)
            {
                // SHCreateDataObject — GetChildrenUIObjects + ole32 DoDragDrop hung modal drag (no QCD).
                if (!TryCreateViaShellFolder(parent, items, out var shData, out var shLife))
                {
                    OleDndLog("shell-drag shcreate failed — wpf fallback");
                    return false;
                }
                dataObject = shData!;
                lifetime = shLife;
                kind = "shell-shcreate";
                OleDndLog($"shell-drag shcreate count={paths.Length}");
                return true;
            }
        }
        catch (Exception ex)
        {
            OleDndLog($"shell-drag fail {ex.Message}");
            try
            {
                if (items is { Length: > 0 }
                    && items[0].Parent is ShellFolder rescueParent
                    && TryCreateViaShellFolder(rescueParent, items, out var rescue, out var rescueLife))
                {
                    dataObject = rescue!;
                    lifetime = rescueLife;
                    kind = "shell-shcreate";
                    return true;
                }
            }
            catch { /* ignore nested */ }
            return false;
        }
        finally
        {
            if (items is not null)
            {
                foreach (var it in items)
                    it.Dispose();
            }
        }
    }

    /// <summary>
    /// SHCreateDataObject with the item's real parent folder — desktop-as-parent rejected valid items.
    /// </summary>
    private static bool TryCreateViaShellFolder(
        ShellFolder parentFolder,
        ShellItem[] items,
        out ComIDataObject? dataObject,
        out IDisposable? lifetime)
    {
        dataObject = null;
        lifetime = null;
        if (items is not { Length: > 0 }) return false;
        try
        {
            if (!SHGetIDListFromObject(parentFolder, out var folderPidl).Succeeded)
                return false;

            using (folderPidl)
            {
                var pidls = items.Select(static i => i.PIDL).ToArray();
                if (!SHCreateDataObject(folderPidl, pidls, null, out var obj).Succeeded || obj is null)
                    return false;

                var com = (ComIDataObject)obj;
                dataObject = WrapWithPreferredEffect(com);
                lifetime = new ComReleaseLifetime(obj);
                var parentName = "";
                try { parentName = parentFolder.ParsingName ?? parentFolder.Name ?? ""; } catch { /* ignore */ }
                OleDndLog($"shell-drag shcreate count={items.Length} parent={parentName}");
                return true;
            }
        }
        catch (Exception ex)
        {
            OleDndLog($"shell-drag shcreate fail {ex.Message}");
            return false;
        }
    }

    private static ComIDataObject WrapWithPreferredEffect(ComIDataObject inner)
    {
        var target = inner is BndzOleDataObjectOverlay existing
            ? existing
            : new BndzOleDataObjectOverlay(inner);

        try
        {
            var cf = (short)RegisterClipboardFormat("Preferred DropEffect");
            var hGlobal = Marshal.AllocHGlobal(4);
            Marshal.WriteInt32(hGlobal, 1 | 2); // DROPEFFECT_COPY | DROPEFFECT_MOVE
            var fmt = new FORMATETC
            {
                cfFormat = cf,
                ptd = IntPtr.Zero,
                dwAspect = DVASPECT.DVASPECT_CONTENT,
                lindex = -1,
                tymed = TYMED.TYMED_HGLOBAL,
            };
            var medium = new STGMEDIUM
            {
                tymed = TYMED.TYMED_HGLOBAL,
                unionmember = hGlobal,
                pUnkForRelease = null,
            };
            target.SetData(ref fmt, ref medium, true);
        }
        catch (Exception ex)
        {
            OleDndLog($"shell-drag preferred-effect {ex.Message}");
        }

        return target;
    }

    private static string ParentKey(ShellItem item)
    {
        try
        {
            var parent = item.Parent;
            if (parent is null) return "";
            using (parent)
                return parent.ParsingName ?? parent.Name ?? "";
        }
        catch
        {
            return "";
        }
    }

    private static void OleDndLog(string message)
    {
        try { WebView2DropTargetService.AppendOleDndLogPublic(message); }
        catch { /* ignore */ }
    }
}
