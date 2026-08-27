using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using ComIDataObject = System.Runtime.InteropServices.ComTypes.IDataObject;

namespace BNDZ.Services;

/// <summary>
/// Writable overlay around a shell-owned <see cref="ComIDataObject"/>.
/// Shell <c>GetChildrenUIObjects</c> payloads often reject <c>SetData</c>, which makes
/// <c>IDragSourceHelper::InitializeFromBitmap</c> a no-op — so we store drag-image
/// (and other) formats here while still serving CF_HDROP / ShellIDList from the inner object.
/// </summary>
internal sealed class BndzOleDataObjectOverlay : ComIDataObject
{
    private readonly ComIDataObject _inner;
    private readonly List<OwnedFormat> _owned = new();
    private readonly object _gate = new();

    private sealed class OwnedFormat
    {
        public FORMATETC Format;
        public STGMEDIUM Medium;
    }

    public BndzOleDataObjectOverlay(ComIDataObject inner)
    {
        _inner = inner ?? throw new ArgumentNullException(nameof(inner));
    }

    public ComIDataObject Inner => _inner;

    public void GetData(ref FORMATETC format, out STGMEDIUM medium)
    {
        lock (_gate)
        {
            foreach (var owned in _owned)
            {
                if (!FormatsMatch(owned.Format, format)) continue;
                medium = CloneMedium(owned.Medium);
                return;
            }
        }
        _inner.GetData(ref format, out medium);
    }

    public void GetDataHere(ref FORMATETC format, ref STGMEDIUM medium)
        => _inner.GetDataHere(ref format, ref medium);

    public int QueryGetData(ref FORMATETC format)
    {
        lock (_gate)
        {
            foreach (var owned in _owned)
            {
                if (FormatsMatch(owned.Format, format))
                    return 0; // S_OK
            }
        }
        return _inner.QueryGetData(ref format);
    }

    public int GetCanonicalFormatEtc(ref FORMATETC formatIn, out FORMATETC formatOut)
        => _inner.GetCanonicalFormatEtc(ref formatIn, out formatOut);

    public void SetData(ref FORMATETC formatIn, ref STGMEDIUM medium, bool release)
    {
        var copyFmt = formatIn;
        var ownedMedium = release ? medium : CloneMedium(medium);

        lock (_gate)
        {
            for (var i = _owned.Count - 1; i >= 0; i--)
            {
                if (!FormatsMatch(_owned[i].Format, copyFmt)) continue;
                ReleaseMedium(ref _owned[i].Medium);
                _owned.RemoveAt(i);
            }
            _owned.Add(new OwnedFormat { Format = copyFmt, Medium = ownedMedium });
        }

        try
        {
            var fwd = medium;
            _inner.SetData(ref formatIn, ref fwd, false);
        }
        catch
        {
            /* read-only shell object — overlay owns the format */
        }
    }

    public IEnumFORMATETC EnumFormatEtc(DATADIR direction)
    {
        if (direction != DATADIR.DATADIR_GET)
            return _inner.EnumFormatEtc(direction);

        var formats = new List<FORMATETC>();
        lock (_gate)
        {
            foreach (var owned in _owned)
                formats.Add(owned.Format);
        }

        try
        {
            var innerEnum = _inner.EnumFormatEtc(direction);
            if (innerEnum != null)
            {
                var buf = new FORMATETC[32];
                while (true)
                {
                    var fetchedArr = new int[1];
                    innerEnum.Next(buf.Length, buf, fetchedArr);
                    var fetched = fetchedArr[0];
                    if (fetched <= 0) break;
                    for (var i = 0; i < fetched; i++)
                    {
                        var f = buf[i];
                        var dup = false;
                        foreach (var existing in formats)
                        {
                            if (FormatsMatch(existing, f)) { dup = true; break; }
                        }
                        if (!dup) formats.Add(f);
                    }
                    if (fetched < buf.Length) break;
                }
                try { Marshal.ReleaseComObject(innerEnum); } catch { /* ignore */ }
            }
        }
        catch
        {
            /* inner enum failed — still expose overlay formats */
        }

        return new FormatEtcEnum(formats.ToArray());
    }

    public int DAdvise(ref FORMATETC pFormatetc, ADVF advf, IAdviseSink adviseSink, out int connection)
        => _inner.DAdvise(ref pFormatetc, advf, adviseSink, out connection);

    public void DUnadvise(int connection) => _inner.DUnadvise(connection);

    public int EnumDAdvise(out IEnumSTATDATA enumAdvise)
        => _inner.EnumDAdvise(out enumAdvise);

    private static bool FormatsMatch(FORMATETC a, FORMATETC b)
        => a.cfFormat == b.cfFormat
           && a.dwAspect == b.dwAspect
           && a.lindex == b.lindex
           && (a.tymed & b.tymed) != 0;

    private static STGMEDIUM CloneMedium(STGMEDIUM src)
    {
        if (src.tymed == TYMED.TYMED_NULL || src.unionmember == IntPtr.Zero)
            return src;

        if (src.tymed == TYMED.TYMED_HGLOBAL)
        {
            var size = GlobalSize(src.unionmember);
            if (size == UIntPtr.Zero)
                return src;
            var dest = GlobalAlloc(0x0002 /* GMEM_MOVEABLE */, size);
            if (dest == IntPtr.Zero) return src;
            var srcPtr = GlobalLock(src.unionmember);
            var destPtr = GlobalLock(dest);
            try
            {
                if (srcPtr != IntPtr.Zero && destPtr != IntPtr.Zero)
                    CopyMemory(destPtr, srcPtr, size);
            }
            finally
            {
                if (srcPtr != IntPtr.Zero) GlobalUnlock(src.unionmember);
                if (destPtr != IntPtr.Zero) GlobalUnlock(dest);
            }
            return new STGMEDIUM
            {
                tymed = TYMED.TYMED_HGLOBAL,
                unionmember = dest,
                pUnkForRelease = null,
            };
        }

        if (src.tymed == TYMED.TYMED_GDI)
        {
            var copy = CopyImage(src.unionmember, 0 /* IMAGE_BITMAP */, 0, 0, 0x0008 /* LR_CREATEDIBSECTION */);
            return new STGMEDIUM
            {
                tymed = TYMED.TYMED_GDI,
                unionmember = copy != IntPtr.Zero ? copy : src.unionmember,
                pUnkForRelease = null,
            };
        }

        return src;
    }

    private static void ReleaseMedium(ref STGMEDIUM medium)
    {
        try { ReleaseStgMedium(ref medium); }
        catch { /* ignore */ }
        medium = default;
    }

    private sealed class FormatEtcEnum : IEnumFORMATETC
    {
        private readonly FORMATETC[] _items;
        private int _index;

        public FormatEtcEnum(FORMATETC[] items) => _items = items ?? Array.Empty<FORMATETC>();

        public void Clone(out IEnumFORMATETC newEnum)
        {
            newEnum = new FormatEtcEnum((FORMATETC[])_items.Clone()) { _index = _index };
        }

        public int Next(int celt, FORMATETC[] rgelt, int[]? pceltFetched)
        {
            var n = 0;
            while (n < celt && _index < _items.Length)
            {
                rgelt[n++] = _items[_index++];
            }
            if (pceltFetched != null && pceltFetched.Length > 0)
                pceltFetched[0] = n;
            return n == celt ? 0 : 1; // S_OK : S_FALSE
        }

        public int Reset()
        {
            _index = 0;
            return 0;
        }

        public int Skip(int celt)
        {
            _index = Math.Min(_items.Length, _index + celt);
            return _index >= _items.Length && celt > 0 ? 1 : 0;
        }
    }

    [DllImport("ole32.dll")]
    private static extern void ReleaseStgMedium(ref STGMEDIUM pmedium);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalAlloc(uint uFlags, UIntPtr dwBytes);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern UIntPtr GlobalSize(IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr hMem);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalUnlock(IntPtr hMem);

    [DllImport("kernel32.dll", EntryPoint = "RtlCopyMemory")]
    private static extern void CopyMemory(IntPtr dest, IntPtr src, UIntPtr count);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CopyImage(IntPtr hImage, uint type, int cx, int cy, uint flags);
}
