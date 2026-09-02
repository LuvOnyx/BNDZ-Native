using System.Collections.Specialized;
using System.IO;
using System.Windows.Forms;
using ComIDataObject = System.Runtime.InteropServices.ComTypes.IDataObject;

namespace BNDZ.Services;

/// <summary>
/// Builds Explorer-compatible outbound OLE drag payloads.
/// Locked design: owned WinForms <see cref="DataObject"/> with CF_HDROP + Preferred DropEffect.
/// Never pass live shell IDataObject into ole32 DoDragDrop (Drop returns NONE).
/// </summary>
internal static class BndzOutboundDragHelper
{
    internal readonly record struct OutboundDragPayload(
        ComIDataObject Data,
        string Kind,
        IDisposable? Lifetime,
        string[] Paths);

    private static readonly DragDropEffects PreferredCopyMove =
        DragDropEffects.Copy | DragDropEffects.Move;

    internal static OutboundDragPayload CreateDataObjectWithKind(
        IEnumerable<string> rawPaths,
        System.Windows.DragDropEffects preferred = System.Windows.DragDropEffects.Copy | System.Windows.DragDropEffects.Move | System.Windows.DragDropEffects.Link)
    {
        _ = preferred;
        var rejected = new List<string>();
        var distinct = NormalizeExistingPaths(rawPaths, rejected);
        foreach (var bad in rejected)
        {
            System.Diagnostics.Debug.WriteLine($"[OleDrag] payload reject=bad-path {bad}");
            try { WebView2DropTargetService.AppendOleDndLogPublic($"payload reject={bad}"); }
            catch { /* logging must never block drag */ }
        }

        if (distinct.Length == 0)
            throw new InvalidOperationException(
                rejected.Count > 0
                    ? $"No valid filesystem paths for outbound OLE drag (rejected {rejected.Count})."
                    : "No valid filesystem paths for outbound OLE drag.");

        var owned = new DataObject();
        var list = new StringCollection();
        foreach (var p in distinct)
            list.Add(p);
        owned.SetFileDropList(list);
        try
        {
            var effectBytes = BitConverter.GetBytes((int)PreferredCopyMove);
            owned.SetData("Preferred DropEffect", false, new MemoryStream(effectBytes));
        }
        catch { /* optional */ }

        try { WebView2DropTargetService.AppendOleDndLogPublic("payload kind=owned-hdrop"); }
        catch { /* ignore */ }

        return new OutboundDragPayload(owned, "owned-hdrop", Lifetime: null, Paths: distinct);
    }

    /// <summary>Keep only paths that exist on disk — used when arming FILE_DRAG_ACTIVE.</summary>
    internal static string[] FilterExistingPaths(IEnumerable<string> rawPaths, out int rejectedCount)
    {
        var rejected = new List<string>();
        var distinct = NormalizeExistingPaths(rawPaths, rejected);
        rejectedCount = rejected.Count;
        foreach (var bad in rejected)
        {
            try { WebView2DropTargetService.AppendOleDndLogPublic($"FILE_DRAG_ACTIVE reject={bad}"); }
            catch { /* ignore */ }
        }
        return distinct;
    }

    internal static string FormatPathSummary(IReadOnlyList<string> paths, int maxLen = 120)
    {
        if (paths.Count == 0) return "(none)";
        var first = paths[0];
        if (first.Length > maxLen) first = first[..(maxLen - 3)] + "...";
        return paths.Count == 1 ? first : $"{first} +{paths.Count - 1}";
    }

    /// <summary>
    /// Decode URI junk (file%3A / file:///C:/…) and keep only paths that exist on disk.
    /// </summary>
    internal static string? SanitizeExistingPath(string? raw, out string? rejectReason)
    {
        rejectReason = null;
        if (string.IsNullOrWhiteSpace(raw))
        {
            rejectReason = "empty";
            return null;
        }

        var p = raw.Trim().Trim('"');
        try
        {
            if (p.StartsWith("file:", StringComparison.OrdinalIgnoreCase))
            {
                if (Uri.TryCreate(p, UriKind.Absolute, out var uri) && uri.IsFile)
                    p = uri.LocalPath;
                else
                {
                    rejectReason = "file-uri";
                    return null;
                }
            }

            if (p.StartsWith("::{", StringComparison.Ordinal)
                || p.StartsWith("shell:", StringComparison.OrdinalIgnoreCase))
                return p;

            if (p.StartsWith('/'))
                p = p[1..];
            p = p.Replace('/', '\\');
            while (p.Contains("\\\\", StringComparison.Ordinal))
                p = p.Replace("\\\\", "\\", StringComparison.Ordinal);
            if (p.StartsWith('\\') && p.Length >= 3 && char.IsLetter(p[1]) && p[2] == ':')
                p = p.TrimStart('\\');

            p = Path.GetFullPath(p);
            if (p.Length > 2 && PathExistsOnDisk(p))
                return p;

            rejectReason = "missing";
            return null;
        }
        catch (Exception ex)
        {
            rejectReason = ex.GetType().Name;
            return null;
        }
    }

    private static bool PathExistsOnDisk(string path)
    {
        if (File.Exists(path) || Directory.Exists(path)) return true;
        try
        {
            var probe = path.StartsWith(@"\\", StringComparison.Ordinal)
                ? @"\\?\UNC\" + path[2..]
                : @"\\?\" + path;
            return File.Exists(probe) || Directory.Exists(probe);
        }
        catch { return false; }
    }

    private static string[] NormalizeExistingPaths(IEnumerable<string> rawPaths, List<string> rejected)
    {
        var valid = new List<string>();
        foreach (var raw in rawPaths)
        {
            var clean = SanitizeExistingPath(raw, out var reason);
            if (clean == null)
            {
                rejected.Add($"{reason}:{raw}");
                continue;
            }
            valid.Add(clean);
        }
        return valid.Distinct(StringComparer.OrdinalIgnoreCase).ToArray();
    }
}
