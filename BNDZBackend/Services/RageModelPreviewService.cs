using System.Collections.Concurrent;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
#if BNDZ_HAS_CODEWALKER
using CodeWalker.GameFiles;
using SharpDX;
#endif

namespace BNDZ.Services;

/// <summary>
/// Converts Rockstar RAGE assets (.ydr / .ybn / .ydd / .yft) into OBJ meshes for the WebGL preview pipeline.
/// Uses CodeWalker.Core (MIT) for RSC7 resource load — no game install required for loose files.
/// When CodeWalker is not present under external/, conversion returns a clear unavailable error.
/// </summary>
public static class RageModelPreviewService
{
    private static readonly ConcurrentDictionary<string, string> Cache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object Gate = new();

    public static bool IsRageModelExt(string? ext)
    {
        if (string.IsNullOrWhiteSpace(ext)) return false;
        var e = ext.Trim().TrimStart('.').ToLowerInvariant();
        return e is "ydr" or "ybn" or "ydd" or "yft" or "ycd";
    }

    public static bool NeedsHostConversion(string? ext)
    {
        if (string.IsNullOrWhiteSpace(ext)) return false;
        var e = ext.Trim().TrimStart('.').ToLowerInvariant();
        return e is "ydr" or "ybn" or "ydd" or "yft";
    }

    public static (bool ok, string? previewPath, string? format, string? kind, int vertices, int triangles, string? error)
        TryGetPreviewObj(string sourcePath)
    {
#if !BNDZ_HAS_CODEWALKER
        return (false, null, null, null, 0, 0,
            "RAGE preview requires CodeWalker.Core under external/CodeWalker (run scripts/build-bndz-native.ps1).");
#else
        try
        {
            if (string.IsNullOrWhiteSpace(sourcePath) || !File.Exists(sourcePath))
                return (false, null, null, null, 0, 0, "File not found");

            var fi = new FileInfo(sourcePath);
            var ext = (fi.Extension ?? "").TrimStart('.').ToLowerInvariant();
            if (!NeedsHostConversion(ext))
                return (false, null, null, null, 0, 0, "Not a convertible RAGE model");

            var cacheKey = $"{fi.FullName}|{fi.Length}|{fi.LastWriteTimeUtc.Ticks}";
            if (Cache.TryGetValue(cacheKey, out var cached) && File.Exists(cached))
            {
                var (v, t) = CountObj(cached);
                return (true, cached, "obj", ext, v, t, null);
            }

            lock (Gate)
            {
                if (Cache.TryGetValue(cacheKey, out cached) && File.Exists(cached))
                {
                    var (v2, t2) = CountObj(cached);
                    return (true, cached, "obj", ext, v2, t2, null);
                }

                var bytes = File.ReadAllBytes(sourcePath);
                var mesh = ExtractMesh(ext, bytes, fi.Name);
                if (mesh.Vertices.Count == 0 || mesh.Indices.Count < 3)
                    return (false, null, null, ext, 0, 0, "No renderable geometry in this RAGE asset");

                var dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "BNDZ", "ModelPreviewCache");
                Directory.CreateDirectory(dir);
                var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(cacheKey)))[..16];
                var outPath = Path.Combine(dir, $"{hash}_{Sanitize(Path.GetFileNameWithoutExtension(fi.Name))}.obj");
                WriteObj(outPath, mesh);
                Cache[cacheKey] = outPath;
                return (true, outPath, "obj", ext, mesh.Vertices.Count, mesh.Indices.Count / 3, null);
            }
        }
        catch (Exception ex)
        {
            return (false, null, null, null, 0, 0, ex.Message);
        }
#endif
    }

#if BNDZ_HAS_CODEWALKER
    private static MeshExtract ExtractMesh(string ext, byte[] data, string name)
    {
        return ext switch
        {
            "ydr" => FromDrawable(LoadYdr(data, name)),
            "ydd" => FromYdd(data, name),
            "yft" => FromYft(data, name),
            "ybn" => FromYbn(data, name),
            _ => new MeshExtract(),
        };
    }

    private static Drawable? LoadYdr(byte[] data, string name)
    {
        var ydr = new YdrFile();
        ydr.Name = name;
        ydr.Load(data);
        return ydr.Drawable;
    }

    private static MeshExtract FromYdd(byte[] data, string name)
    {
        var ydd = new YddFile();
        ydd.Name = name;
        ydd.Load(data);
        var mesh = new MeshExtract();
        if (ydd.Drawables != null)
        {
            foreach (var d in ydd.Drawables)
                AppendDrawable(mesh, d);
        }
        else if (ydd.Dict != null)
        {
            foreach (var d in ydd.Dict.Values)
                AppendDrawable(mesh, d);
        }
        return mesh;
    }

    private static MeshExtract FromYft(byte[] data, string name)
    {
        var yft = new YftFile();
        yft.Name = name;
        yft.Load(data);
        var mesh = new MeshExtract();
        var frag = yft.Fragment;
        if (frag?.Drawable != null) AppendDrawable(mesh, frag.Drawable);
        if (frag?.DrawableCloth != null) AppendDrawable(mesh, frag.DrawableCloth);
        // Vehicle/prop fragments often keep part meshes under PhysicsLOD children.
        if (mesh.Vertices.Count == 0 && frag?.PhysicsLODGroup != null)
        {
            foreach (var lod in new[]
                     {
                         frag.PhysicsLODGroup.PhysicsLOD1,
                         frag.PhysicsLODGroup.PhysicsLOD2,
                         frag.PhysicsLODGroup.PhysicsLOD3,
                     })
            {
                var children = lod?.Children?.data_items;
                if (children == null) continue;
                foreach (var child in children)
                {
                    if (child?.Drawable1 != null) AppendDrawable(mesh, child.Drawable1);
                    if (child?.Drawable2 != null) AppendDrawable(mesh, child.Drawable2);
                }
                if (mesh.Vertices.Count > 0) break;
            }
        }
        return mesh;
    }

    private static MeshExtract FromYbn(byte[] data, string name)
    {
        var ybn = new YbnFile();
        ybn.Name = name;
        ybn.Load(data);
        var mesh = new MeshExtract();
        AppendBounds(mesh, ybn.Bounds, Matrix.Identity);
        return mesh;
    }

    private static MeshExtract FromDrawable(Drawable? drawable)
    {
        var mesh = new MeshExtract();
        AppendDrawable(mesh, drawable);
        return mesh;
    }

    private static void AppendDrawable(MeshExtract mesh, DrawableBase? drawable)
    {
        if (drawable == null) return;
        // Read() usually builds this; call defensively for any loader path that skips it.
        if (drawable.AllModels == null)
            drawable.BuildAllModels();

        // Prefer High LOD only — stacking Med/Low/VLow bloated previews and hid detail.
        DrawableModel[]? models = drawable.DrawableModels?.High;
        if (models == null || models.Length == 0)
            models = drawable.AllModels;
        if (models == null || models.Length == 0) return;

        foreach (var model in models)
        {
            if (model?.Geometries == null) continue;
            foreach (var geom in model.Geometries)
                AppendGeometry(mesh, geom);
        }
    }

    private static void AppendGeometry(MeshExtract mesh, DrawableGeometry? geom)
    {
        if (geom?.VertexData == null || geom.IndexBuffer?.Indices == null) return;
        var vd = geom.VertexData;
        if (vd.VertexCount <= 0 || vd.VertexBytes == null || vd.Info == null) return;

        // Component 0 = Position when the declaration flag bit is set.
        var hasPos = (vd.Info.Flags & 1) != 0;
        if (!hasPos) return;

        var baseIndex = mesh.Vertices.Count;
        for (int i = 0; i < vd.VertexCount; i++)
        {
            var p = vd.GetVector3(i, 0);
            mesh.Vertices.Add(new Vector3(p.X, p.Y, p.Z));
        }

        var indices = geom.IndexBuffer.Indices;
        for (int i = 0; i + 2 < indices.Length; i += 3)
        {
            mesh.Indices.Add(baseIndex + indices[i]);
            mesh.Indices.Add(baseIndex + indices[i + 1]);
            mesh.Indices.Add(baseIndex + indices[i + 2]);
        }
    }

    private static void AppendBounds(MeshExtract mesh, Bounds? bounds, Matrix world)
    {
        if (bounds == null) return;

        if (bounds is BoundComposite composite)
        {
            var children = composite.Children?.data_items;
            if (children == null) return;
            for (int i = 0; i < children.Length; i++)
            {
                var child = children[i];
                var xform = Matrix.Identity;
                if (composite.ChildrenTransformation1 != null && i < composite.ChildrenTransformation1.Length)
                    xform = composite.ChildrenTransformation1[i].ToMatrix();
                AppendBounds(mesh, child, xform * world);
            }
            return;
        }

        if (bounds is BoundGeometry geom && geom.Vertices != null && geom.Polygons != null)
        {
            var baseIndex = mesh.Vertices.Count;
            foreach (var v in geom.Vertices)
            {
                var p = Vector3.TransformCoordinate(v, world);
                mesh.Vertices.Add(p);
            }
            foreach (var poly in geom.Polygons)
            {
                if (poly is BoundPolygonTriangle tri)
                {
                    mesh.Indices.Add(baseIndex + tri.GetVertexIndex(0));
                    mesh.Indices.Add(baseIndex + tri.GetVertexIndex(1));
                    mesh.Indices.Add(baseIndex + tri.GetVertexIndex(2));
                }
            }
        }
    }

    private static void WriteObj(string path, MeshExtract mesh)
    {
        var sb = new StringBuilder(mesh.Vertices.Count * 48 + mesh.Indices.Count * 16);
        sb.AppendLine("# BNDZ RAGE preview mesh");
        sb.AppendLine("o rage_preview");
        var inv = CultureInfo.InvariantCulture;
        foreach (var v in mesh.Vertices)
            sb.Append("v ").Append(v.X.ToString(inv)).Append(' ').Append(v.Y.ToString(inv)).Append(' ').Append(v.Z.ToString(inv)).AppendLine();
        for (int i = 0; i + 2 < mesh.Indices.Count; i += 3)
        {
            // OBJ is 1-based
            var a = mesh.Indices[i] + 1;
            var b = mesh.Indices[i + 1] + 1;
            var c = mesh.Indices[i + 2] + 1;
            sb.Append("f ").Append(a).Append(' ').Append(b).Append(' ').Append(c).AppendLine();
        }
        File.WriteAllText(path, sb.ToString(), Encoding.ASCII);
    }

    private static (int verts, int tris) CountObj(string path)
    {
        int v = 0, f = 0;
        foreach (var line in File.ReadLines(path))
        {
            if (line.StartsWith("v ", StringComparison.Ordinal)) v++;
            else if (line.StartsWith("f ", StringComparison.Ordinal)) f++;
        }
        return (v, f);
    }

    private static string Sanitize(string name)
    {
        var chars = name.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '_').ToArray();
        return new string(chars);
    }

    private sealed class MeshExtract
    {
        public List<Vector3> Vertices { get; } = new();
        public List<int> Indices { get; } = new();
    }
#endif
}
