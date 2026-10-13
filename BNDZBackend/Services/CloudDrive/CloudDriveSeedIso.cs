using System.Buffers.Binary;
using System.Text;

namespace BNDZ.Services.CloudDrive;

/// <summary>
/// NoCloud cidata ISO (ISO9660 + SUSP "SP" + Rock Ridge "NM").
/// Linux mounts the real filenames (user-data, meta-data, network-config).
/// The volume id is cidata so cloud-init picks the disk up.
/// </summary>
public static class CloudDriveSeedIso
{
    public const int Sector = 2048;

    public static void Write(string path, IReadOnlyList<(string Name, byte[] Data)> files)
    {
        if (string.IsNullOrWhiteSpace(path))
            throw new InvalidOperationException("Seed path is empty.");
        if (files == null || files.Count == 0)
            throw new InvalidOperationException("Seed ISO needs at least one file.");

        var dir = Path.GetDirectoryName(path);
        if (!string.IsNullOrEmpty(dir))
            Directory.CreateDirectory(dir);

        var payloads = new List<(string Name, byte[] Data, string IsoId)>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var file in files)
        {
            var name = (file.Name ?? "").Trim();
            if (name.Length == 0 || name.Contains('/') || name.Contains('\\') || name.Contains(';') || name == "." || name == "..")
                throw new InvalidOperationException("Seed file name is not usable.");
            if (!seen.Add(name))
                throw new InvalidOperationException("Seed file name is repeated.");
            var data = file.Data ?? Array.Empty<byte>();
            payloads.Add((name, data, name + ";1"));
        }

        var fileSectors = 0;
        foreach (var file in payloads)
            fileSectors += SectorsFor(file.Data.Length);

        const int rootSector = 20;
        var dataSector = rootSector + 1;
        var volumeSectors = dataSector + fileSectors;

        var extents = new List<(string Name, byte[] Data, string IsoId, int Extent)>();
        var cursor = dataSector;
        foreach (var file in payloads)
        {
            extents.Add((file.Name, file.Data, file.IsoId, cursor));
            cursor += SectorsFor(file.Data.Length);
        }

        var records = new List<byte[]>
        {
            DirRecord(rootSector, Sector, 0x02, new byte[] { 0x00 }, SuspDot()),
            DirRecord(rootSector, Sector, 0x02, new byte[] { 0x01 }, SuspNm("", 4)),
        };
        foreach (var file in extents)
            records.Add(DirRecord((uint)file.Extent, (uint)file.Data.Length, 0x00, Encoding.ASCII.GetBytes(file.IsoId), SuspNm(file.Name, 0)));

        var rootBytes = new byte[Sector];
        var at = 0;
        foreach (var rec in records)
        {
            if (at + rec.Length > Sector)
                throw new InvalidOperationException("Seed directory does not fit in one sector.");
            Buffer.BlockCopy(rec, 0, rootBytes, at, rec.Length);
            at += rec.Length;
        }

        var image = new byte[volumeSectors * Sector];
        WritePvd(image, volumeSectors);
        WriteTerminator(image);
        WritePathTable(image, 18, littleEndian: true);
        WritePathTable(image, 19, littleEndian: false);
        Buffer.BlockCopy(rootBytes, 0, image, rootSector * Sector, Sector);
        foreach (var file in extents)
        {
            if (file.Data.Length == 0) continue;
            Buffer.BlockCopy(file.Data, 0, image, file.Extent * Sector, file.Data.Length);
        }

        File.WriteAllBytes(path, image);
    }

    private static int SectorsFor(int length)
    {
        if (length <= 0) return 1;
        return (length + Sector - 1) / Sector;
    }

    private static void WritePvd(byte[] image, int volumeSectors)
    {
        var pvd = image.AsSpan(16 * Sector, Sector);
        pvd.Clear();
        pvd[0] = 1;
        Encoding.ASCII.GetBytes("CD001").CopyTo(pvd.Slice(1, 5));
        pvd[6] = 1;
        Pad(pvd.Slice(8, 32), "");
        Pad(pvd.Slice(40, 32), "cidata");
        Both32(pvd, 80, (uint)volumeSectors);
        Both16(pvd, 120, 1);
        Both16(pvd, 124, 1);
        Both16(pvd, 128, Sector);
        Both32(pvd, 132, 10);
        BinaryPrimitives.WriteUInt32LittleEndian(pvd.Slice(140, 4), 18);
        BinaryPrimitives.WriteUInt32BigEndian(pvd.Slice(148, 4), 19);
        var root = DirRecord(20, Sector, 0x02, new byte[] { 0x00 }, Array.Empty<byte>());
        if (root.Length != 34)
            throw new InvalidOperationException("Primary volume root record must be 34 bytes.");
        root.CopyTo(pvd.Slice(156, 34));
        WriteAscii(pvd.Slice(190, 128), "BNDZ_CLOUD_DRIVE");
        WriteDate17(pvd.Slice(813, 17));
        pvd[881] = 1;
    }

    private static void WriteTerminator(byte[] image)
    {
        var term = image.AsSpan(17 * Sector, Sector);
        term.Clear();
        term[0] = 255;
        Encoding.ASCII.GetBytes("CD001").CopyTo(term.Slice(1, 5));
        term[6] = 1;
    }

    private static void WritePathTable(byte[] image, int sector, bool littleEndian)
    {
        var table = image.AsSpan(sector * Sector, Sector);
        table.Clear();
        table[0] = 1;
        table[1] = 0;
        if (littleEndian)
        {
            BinaryPrimitives.WriteUInt32LittleEndian(table.Slice(2, 4), 20);
            BinaryPrimitives.WriteUInt16LittleEndian(table.Slice(6, 2), 1);
        }
        else
        {
            BinaryPrimitives.WriteUInt32BigEndian(table.Slice(2, 4), 20);
            BinaryPrimitives.WriteUInt16BigEndian(table.Slice(6, 2), 1);
        }
        table[8] = 0;
        table[9] = 0;
    }

    private static byte[] DirRecord(uint extent, uint dataLength, byte flags, byte[] isoId, byte[] susp)
    {
        var idLen = isoId.Length;
        var pad = (idLen % 2 == 0) ? 1 : 0;
        var len = 33 + idLen + pad + susp.Length;
        if ((len % 2) != 0) len++;
        var rec = new byte[len];
        rec[0] = (byte)len;
        rec[1] = 0;
        Both32(rec, 2, extent);
        Both32(rec, 10, dataLength);
        rec[18] = 126;
        rec[19] = 10;
        rec[20] = 7;
        rec[25] = flags;
        Both16(rec, 28, 1);
        rec[32] = (byte)idLen;
        Buffer.BlockCopy(isoId, 0, rec, 33, idLen);
        if (susp.Length > 0)
            Buffer.BlockCopy(susp, 0, rec, 33 + idLen + pad, susp.Length);
        return rec;
    }

    private static byte[] SuspDot()
    {
        var sp = new byte[] { (byte)'S', (byte)'P', 7, 1, 0xBE, 0xEF, 0 };
        var nm = SuspNm("", 2);
        var both = new byte[sp.Length + nm.Length];
        Buffer.BlockCopy(sp, 0, both, 0, sp.Length);
        Buffer.BlockCopy(nm, 0, both, sp.Length, nm.Length);
        return both;
    }

    private static byte[] SuspNm(string name, byte flags)
    {
        var raw = Encoding.ASCII.GetBytes(name);
        var buf = new byte[5 + raw.Length];
        buf[0] = (byte)'N';
        buf[1] = (byte)'M';
        buf[2] = (byte)buf.Length;
        buf[3] = 1;
        buf[4] = flags;
        if (raw.Length > 0)
            Buffer.BlockCopy(raw, 0, buf, 5, raw.Length);
        return buf;
    }

    private static void Both16(Span<byte> dest, int offset, ushort value)
    {
        BinaryPrimitives.WriteUInt16LittleEndian(dest.Slice(offset, 2), value);
        BinaryPrimitives.WriteUInt16BigEndian(dest.Slice(offset + 2, 2), value);
    }

    private static void Both32(Span<byte> dest, int offset, uint value)
    {
        BinaryPrimitives.WriteUInt32LittleEndian(dest.Slice(offset, 4), value);
        BinaryPrimitives.WriteUInt32BigEndian(dest.Slice(offset + 4, 4), value);
    }

    private static void Pad(Span<byte> dest, string text)
    {
        dest.Fill((byte)' ');
        var raw = Encoding.ASCII.GetBytes(text);
        raw.AsSpan(0, Math.Min(raw.Length, dest.Length)).CopyTo(dest);
    }

    private static void WriteAscii(Span<byte> dest, string text)
    {
        dest.Fill((byte)' ');
        var raw = Encoding.ASCII.GetBytes(text);
        raw.AsSpan(0, Math.Min(raw.Length, dest.Length)).CopyTo(dest);
    }

    private static void WriteDate17(Span<byte> dest)
    {
        Encoding.ASCII.GetBytes("2026100700000000").CopyTo(dest);
        dest[16] = 0;
    }
}
