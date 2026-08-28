using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
#if BNDZ_HAS_CODEWALKER
using CodeWalker.GameFiles;
using CodeWalker.Utils;
using SharpDX;
using SkiaSharp;
#endif

namespace BNDZ.Services;

/// <summary>
/// Converts Rockstar RAGE / FiveM loose mesh assets into WebGL-ready GLB for the sidebar
/// preview panel and Quick Look. CodeWalker.Core (MIT) loads RSC7 — no game install required.
/// When CodeWalker is absent under external/, returns a clear unavailable error.
/// </summary>
public static class RageModelPreviewService
{
    private static readonly ConcurrentDictionary<string, string> Cache = new(StringComparer.OrdinalIgnoreCase);
    private static readonly object Gate = new();

    public static bool IsRageModelExt(string? ext) => NeedsHostConversion(ext);

    /// <summary>
    /// Mesh containers only. There is no standard `.yrs` RAGE type — use ydr/yft/ydd/ybn.
    /// Textures/clips/map meta (.ytd/.ycd/.ymap/.ytyp) are not orbit-previewable alone.
    /// </summary>
    public static bool NeedsHostConversion(string? ext)
    {
        if (string.IsNullOrWhiteSpace(ext)) return false;
        var e = ext.Trim().TrimStart('.').ToLowerInvariant();
        return e is "ydr" or "ybn" or "ydd" or "yft";
    }

    /// <summary>Host convert → cached .glb (format field reports glb). Name kept for IPC compat.</summary>
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

            var siblingYtd = Path.ChangeExtension(fi.FullName, ".ytd");
            long ytdTicks = 0;
            long ytdLen = 0;
            if (File.Exists(siblingYtd))
            {
                var yfi = new FileInfo(siblingYtd);
                ytdTicks = yfi.LastWriteTimeUtc.Ticks;
                ytdLen = yfi.Length;
            }

            var cacheKey = $"{fi.FullName}|{fi.Length}|{fi.LastWriteTimeUtc.Ticks}|{ytdLen}|{ytdTicks}|glb2";
            if (Cache.TryGetValue(cacheKey, out var cached) && File.Exists(cached))
            {
                var (v, t) = PeekGltfStats(cached);
                return (true, cached, "glb", ext, v, t, null);
            }

            lock (Gate)
            {
                if (Cache.TryGetValue(cacheKey, out cached) && File.Exists(cached))
                {
                    var (v2, t2) = PeekGltfStats(cached);
                    return (true, cached, "glb", ext, v2, t2, null);
                }

                var bytes = File.ReadAllBytes(sourcePath);
                var mesh = ExtractMesh(ext, bytes, fi.Name, siblingYtd);
                if (mesh.Positions.Count == 0 || mesh.Indices.Count < 3)
                    return (false, null, null, ext, 0, 0, "No renderable geometry in this RAGE asset");

                EnsureNormals(mesh);

                var dir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "BNDZ", "ModelPreviewCache");
                Directory.CreateDirectory(dir);
                var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(cacheKey)))[..16];
                var outPath = Path.Combine(dir, $"{hash}_{Sanitize(Path.GetFileNameWithoutExtension(fi.Name))}.glb");
                WriteGlb(outPath, mesh);
                Cache[cacheKey] = outPath;
                return (true, outPath, "glb", ext, mesh.Positions.Count, mesh.Indices.Count / 3, null);
            }
        }
        catch (Exception ex)
        {
            return (false, null, null, null, 0, 0, ex.Message);
        }
#endif
    }

#if BNDZ_HAS_CODEWALKER
    private static MeshExtract ExtractMesh(string ext, byte[] data, string name, string siblingYtd)
    {
        var mesh = ext switch
        {
            "ydr" => FromDrawable(LoadYdr(data, name), mesh: null),
            "ydd" => FromYdd(data, name),
            "yft" => FromYft(data, name),
            "ybn" => FromYbn(data, name),
            _ => new MeshExtract(),
        };

        // Prefer sibling .ytd; else keep any embedded drawable dictionary already captured.
        if (File.Exists(siblingYtd) && mesh.PngBytes == null)
            TryAttachYtd(mesh, siblingYtd);

        return mesh;
    }

    private static Drawable? LoadYdr(byte[] data, string name)
    {
        var ydr = new YdrFile { Name = name };
        ydr.Load(data);
        return ydr.Drawable;
    }

    private static MeshExtract FromYdd(byte[] data, string name)
    {
        var ydd = new YddFile { Name = name };
        ydd.Load(data);
        var mesh = new MeshExtract();
        if (ydd.Drawables != null)
        {
            foreach (var d in ydd.Drawables)
                FromDrawable(d, mesh);
        }
        else if (ydd.Dict != null)
        {
            foreach (var d in ydd.Dict.Values)
                FromDrawable(d, mesh);
        }
        return mesh;
    }

    private static MeshExtract FromYft(byte[] data, string name)
    {
        var yft = new YftFile { Name = name };
        yft.Load(data);
        var mesh = new MeshExtract();
        var frag = yft.Fragment;
        if (frag?.Drawable != null) FromDrawable(frag.Drawable, mesh);
        if (frag?.DrawableCloth != null) FromDrawable(frag.DrawableCloth, mesh);
        if (mesh.Positions.Count == 0 && frag?.PhysicsLODGroup != null)
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
                    if (child?.Drawable1 != null) FromDrawable(child.Drawable1, mesh);
                    if (child?.Drawable2 != null) FromDrawable(child.Drawable2, mesh);
                }
                if (mesh.Positions.Count > 0) break;
            }
        }
        return mesh;
    }

    private static MeshExtract FromYbn(byte[] data, string name)
    {
        var ybn = new YbnFile { Name = name };
        ybn.Load(data);
        var mesh = new MeshExtract();
        AppendBounds(mesh, ybn.Bounds, Matrix.Identity);
        return mesh;
    }

    private static MeshExtract FromDrawable(DrawableBase? drawable, MeshExtract? mesh)
    {
        mesh ??= new MeshExtract();
        if (drawable == null) return mesh;
        if (drawable.AllModels == null)
            drawable.BuildAllModels();

        // High LOD only — sidebar preview must stay snappy.
        DrawableModel[]? models = drawable.DrawableModels?.High;
        if (models == null || models.Length == 0)
            models = drawable.AllModels;
        if (models == null) return mesh;

        foreach (var model in models)
        {
            if (model?.Geometries == null) continue;
            foreach (var geom in model.Geometries)
                AppendGeometry(mesh, geom);
        }

        if (mesh.PngBytes == null && drawable is Drawable d
            && d.ShaderGroup?.TextureDictionary != null)
        {
            TryAttachTextureDict(mesh, d.ShaderGroup.TextureDictionary);
        }

        return mesh;
    }

    private static void AppendGeometry(MeshExtract mesh, DrawableGeometry? geom)
    {
        if (geom?.VertexData == null || geom.IndexBuffer?.Indices == null) return;
        var vd = geom.VertexData;
        if (vd.VertexCount <= 0 || vd.VertexBytes == null || vd.Info == null) return;

        var flags = vd.Info.Flags;
        var hasPos = (flags & (1 << 0)) != 0;
        if (!hasPos) return;
        var hasNorm = (flags & (1 << 3)) != 0;
        var hasUv = (flags & (1 << 6)) != 0;

        // Half2 UVs are common on PNCH2 — detect via component type when present.
        var uvIsHalf = false;
        if (hasUv)
        {
            try
            {
                var ctype = vd.Info.GetComponentType(6);
                uvIsHalf = ctype == VertexComponentType.Half2 || ctype == VertexComponentType.Half4;
            }
            catch { /* legacy declarations */ }
        }

        var baseIndex = mesh.Positions.Count;
        for (int i = 0; i < vd.VertexCount; i++)
        {
            var p = vd.GetVector3(i, 0);
            mesh.Positions.Add(new Vector3(p.X, p.Y, p.Z));

            if (hasNorm)
            {
                var n = vd.GetVector3(i, 3);
                mesh.Normals.Add(new Vector3(n.X, n.Y, n.Z));
            }
            else
            {
                mesh.Normals.Add(Vector3.Zero);
            }

            if (hasUv)
            {
                if (uvIsHalf)
                {
                    var h = vd.GetHalf2(i, 6);
                    float u = h.X;
                    float v = h.Y;
                    mesh.UVs.Add(new Vector2(u, 1f - v)); // flip V for glTF
                }
                else
                {
                    var uv = vd.GetVector2(i, 6);
                    mesh.UVs.Add(new Vector2(uv.X, 1f - uv.Y));
                }
            }
            else
            {
                mesh.UVs.Add(Vector2.Zero);
            }
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
            var baseIndex = mesh.Positions.Count;
            foreach (var v in geom.Vertices)
            {
                var p = Vector3.TransformCoordinate(v, world);
                mesh.Positions.Add(p);
                mesh.Normals.Add(Vector3.Zero);
                mesh.UVs.Add(Vector2.Zero);
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

    private static void EnsureNormals(MeshExtract mesh)
    {
        var needs = false;
        for (int i = 0; i < mesh.Normals.Count; i++)
        {
            if (mesh.Normals[i].LengthSquared() < 1e-8f) { needs = true; break; }
        }
        if (!needs) return;

        var accum = new Vector3[mesh.Positions.Count];
        for (int i = 0; i + 2 < mesh.Indices.Count; i += 3)
        {
            var ia = mesh.Indices[i];
            var ib = mesh.Indices[i + 1];
            var ic = mesh.Indices[i + 2];
            if (ia < 0 || ib < 0 || ic < 0
                || ia >= mesh.Positions.Count
                || ib >= mesh.Positions.Count
                || ic >= mesh.Positions.Count) continue;
            var a = mesh.Positions[ia];
            var b = mesh.Positions[ib];
            var c = mesh.Positions[ic];
            var n = Vector3.Cross(b - a, c - a);
            accum[ia] += n;
            accum[ib] += n;
            accum[ic] += n;
        }
        for (int i = 0; i < mesh.Normals.Count; i++)
        {
            if (mesh.Normals[i].LengthSquared() >= 1e-8f) continue;
            var n = accum[i];
            mesh.Normals[i] = n.LengthSquared() < 1e-12f ? Vector3.UnitY : Vector3.Normalize(n);
        }
    }

    private static void TryAttachYtd(MeshExtract mesh, string ytdPath)
    {
        try
        {
            var ytd = new YtdFile { Name = Path.GetFileName(ytdPath) };
            ytd.Load(File.ReadAllBytes(ytdPath));
            if (ytd.TextureDict != null)
                TryAttachTextureDict(mesh, ytd.TextureDict);
        }
        catch
        {
            /* texture is optional for geometry preview */
        }
    }

    private static void TryAttachTextureDict(MeshExtract mesh, TextureDictionary dict)
    {
        try
        {
            var textures = dict.Textures?.data_items;
            if (textures == null || textures.Length == 0) return;
            // Prefer a diffuse-looking name; else first decodable 2D texture.
            Texture? pick = textures.FirstOrDefault(t =>
                t?.Name != null && (
                    t.Name.Contains("diff", StringComparison.OrdinalIgnoreCase)
                    || t.Name.Contains("albedo", StringComparison.OrdinalIgnoreCase)
                    || t.Name.EndsWith("_d", StringComparison.OrdinalIgnoreCase)));
            pick ??= textures.FirstOrDefault(t => t != null);
            if (pick == null) return;

            var rgba = DDSIO.GetPixels(pick, 0);
            if (rgba == null || rgba.Length < 4) return;
            var w = pick.Width;
            var h = pick.Height;
            if (w <= 0 || h <= 0 || rgba.Length < w * h * 4) return;

            using var bmp = new SKBitmap(w, h, SKColorType.Rgba8888, SKAlphaType.Premul);
            System.Runtime.InteropServices.Marshal.Copy(rgba, 0, bmp.GetPixels(), w * h * 4);
            using var img = SKImage.FromBitmap(bmp);
            using var data = img.Encode(SKEncodedImageFormat.Png, 85);
            mesh.PngBytes = data.ToArray();
        }
        catch
        {
            /* optional */
        }
    }

    private static void WriteGlb(string path, MeshExtract mesh)
    {
        var pos = new float[mesh.Positions.Count * 3];
        var norm = new float[mesh.Normals.Count * 3];
        var uv = new float[mesh.UVs.Count * 2];
        float minX = float.MaxValue, minY = float.MaxValue, minZ = float.MaxValue;
        float maxX = float.MinValue, maxY = float.MinValue, maxZ = float.MinValue;
        for (int i = 0; i < mesh.Positions.Count; i++)
        {
            var p = mesh.Positions[i];
            pos[i * 3] = p.X; pos[i * 3 + 1] = p.Y; pos[i * 3 + 2] = p.Z;
            minX = Math.Min(minX, p.X); minY = Math.Min(minY, p.Y); minZ = Math.Min(minZ, p.Z);
            maxX = Math.Max(maxX, p.X); maxY = Math.Max(maxY, p.Y); maxZ = Math.Max(maxZ, p.Z);
            var n = i < mesh.Normals.Count ? mesh.Normals[i] : Vector3.UnitY;
            if (n.LengthSquared() < 1e-12f) n = Vector3.UnitY;
            else n = Vector3.Normalize(n);
            norm[i * 3] = n.X; norm[i * 3 + 1] = n.Y; norm[i * 3 + 2] = n.Z;
            var t = i < mesh.UVs.Count ? mesh.UVs[i] : Vector2.Zero;
            uv[i * 2] = t.X; uv[i * 2 + 1] = t.Y;
        }

        var useShort = mesh.Positions.Count <= 65535;
        byte[] indexBytes;
        if (useShort)
        {
            var shorts = new ushort[mesh.Indices.Count];
            for (int i = 0; i < mesh.Indices.Count; i++)
                shorts[i] = (ushort)mesh.Indices[i];
            indexBytes = new byte[shorts.Length * 2];
            Buffer.BlockCopy(shorts, 0, indexBytes, 0, indexBytes.Length);
        }
        else
        {
            var ints = mesh.Indices.ToArray();
            indexBytes = new byte[ints.Length * 4];
            Buffer.BlockCopy(ints, 0, indexBytes, 0, indexBytes.Length);
        }

        var posBytes = new byte[pos.Length * 4];
        var normBytes = new byte[norm.Length * 4];
        var uvBytes = new byte[uv.Length * 4];
        Buffer.BlockCopy(pos, 0, posBytes, 0, posBytes.Length);
        Buffer.BlockCopy(norm, 0, normBytes, 0, normBytes.Length);
        Buffer.BlockCopy(uv, 0, uvBytes, 0, uvBytes.Length);

        static int Align4(int n) => (n + 3) & ~3;
        int o = 0;
        int posOff = o; o = Align4(o + posBytes.Length);
        int normOff = o; o = Align4(o + normBytes.Length);
        int uvOff = o; o = Align4(o + uvBytes.Length);
        int idxOff = o; o = Align4(o + indexBytes.Length);
        int imgOff = -1;
        int imgLen = 0;
        if (mesh.PngBytes is { Length: > 0 } png)
        {
            imgOff = o;
            imgLen = png.Length;
            o = Align4(o + imgLen);
        }

        var bin = new byte[o];
        Buffer.BlockCopy(posBytes, 0, bin, posOff, posBytes.Length);
        Buffer.BlockCopy(normBytes, 0, bin, normOff, normBytes.Length);
        Buffer.BlockCopy(uvBytes, 0, bin, uvOff, uvBytes.Length);
        Buffer.BlockCopy(indexBytes, 0, bin, idxOff, indexBytes.Length);
        if (imgOff >= 0 && mesh.PngBytes != null)
            Buffer.BlockCopy(mesh.PngBytes, 0, bin, imgOff, imgLen);

        var bufferViews = new List<object>
        {
            new { buffer = 0, byteOffset = posOff, byteLength = posBytes.Length, target = 34962 },
            new { buffer = 0, byteOffset = normOff, byteLength = normBytes.Length, target = 34962 },
            new { buffer = 0, byteOffset = uvOff, byteLength = uvBytes.Length, target = 34962 },
            new { buffer = 0, byteOffset = idxOff, byteLength = indexBytes.Length, target = 34963 },
        };
        if (imgOff >= 0)
            bufferViews.Add(new { buffer = 0, byteOffset = imgOff, byteLength = imgLen });

        var accessors = new List<object>
        {
            new
            {
                bufferView = 0, componentType = 5126, count = mesh.Positions.Count, type = "VEC3",
                max = new[] { maxX, maxY, maxZ }, min = new[] { minX, minY, minZ },
            },
            new { bufferView = 1, componentType = 5126, count = mesh.Normals.Count, type = "VEC3" },
            new { bufferView = 2, componentType = 5126, count = mesh.UVs.Count, type = "VEC2" },
            new
            {
                bufferView = 3,
                componentType = useShort ? 5123 : 5125,
                count = mesh.Indices.Count,
                type = "SCALAR",
            },
        };

        object material;
        object[]? textures = null;
        object[]? images = null;
        if (imgOff >= 0)
        {
            images = new object[] { new { bufferView = 4, mimeType = "image/png" } };
            textures = new object[] { new { source = 0 } };
            material = new
            {
                name = "rage_preview",
                doubleSided = true,
                pbrMetallicRoughness = new
                {
                    baseColorTexture = new { index = 0 },
                    metallicFactor = 0.05,
                    roughnessFactor = 0.72,
                },
            };
        }
        else
        {
            material = new
            {
                name = "rage_preview",
                doubleSided = true,
                pbrMetallicRoughness = new
                {
                    baseColorFactor = new[] { 0.78, 0.80, 0.84, 1.0 },
                    metallicFactor = 0.12,
                    roughnessFactor = 0.55,
                },
            };
        }

        var root = new Dictionary<string, object?>
        {
            ["asset"] = new { version = "2.0", generator = "BNDZ RAGE preview" },
            ["scene"] = 0,
            ["scenes"] = new object[] { new { nodes = new[] { 0 } } },
            ["nodes"] = new object[] { new { mesh = 0, name = "rage_preview" } },
            ["meshes"] = new object[]
            {
                new
                {
                    primitives = new object[]
                    {
                        new
                        {
                            attributes = new Dictionary<string, int>
                            {
                                ["POSITION"] = 0,
                                ["NORMAL"] = 1,
                                ["TEXCOORD_0"] = 2,
                            },
                            indices = 3,
                            material = 0,
                        },
                    },
                },
            },
            ["materials"] = new object[] { material },
            ["buffers"] = new object[] { new { byteLength = bin.Length } },
            ["bufferViews"] = bufferViews,
            ["accessors"] = accessors,
        };
        if (textures != null) root["textures"] = textures;
        if (images != null) root["images"] = images;

        var json = JsonSerializer.Serialize(root);
        var jsonBytes = Encoding.UTF8.GetBytes(json);
        var jsonPad = Align4(jsonBytes.Length) - jsonBytes.Length;
        var binPad = Align4(bin.Length) - bin.Length;
        var total = 12 + 8 + jsonBytes.Length + jsonPad + 8 + bin.Length + binPad;

        using var fs = File.Create(path);
        using var bw = new BinaryWriter(fs);
        bw.Write(0x46546C67); // glTF
        bw.Write(2);
        bw.Write(total);
        bw.Write(jsonBytes.Length + jsonPad);
        bw.Write(0x4E4F534A); // JSON
        bw.Write(jsonBytes);
        for (int i = 0; i < jsonPad; i++) bw.Write((byte)0x20);
        bw.Write(bin.Length + binPad);
        bw.Write(0x004E4942); // BIN
        bw.Write(bin);
        for (int i = 0; i < binPad; i++) bw.Write((byte)0);
    }

    private static (int verts, int tris) PeekGltfStats(string path)
    {
        // Fast path: stats are not stored; estimate from file is skipped — callers use mesh counts on miss.
        // For cache hits, read accessors count from JSON chunk when cheap.
        try
        {
            using var fs = File.OpenRead(path);
            using var br = new BinaryReader(fs);
            if (br.ReadUInt32() != 0x46546C67) return (0, 0);
            br.ReadUInt32();
            br.ReadUInt32();
            var jsonLen = br.ReadInt32();
            br.ReadUInt32();
            var json = Encoding.UTF8.GetString(br.ReadBytes(jsonLen)).TrimEnd('\0', ' ');
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("accessors", out var acc) || acc.GetArrayLength() < 4)
                return (0, 0);
            var verts = acc[0].GetProperty("count").GetInt32();
            var indices = acc[3].GetProperty("count").GetInt32();
            return (verts, indices / 3);
        }
        catch
        {
            return (0, 0);
        }
    }

    private static string Sanitize(string name)
    {
        var chars = name.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '_').ToArray();
        return new string(chars);
    }

    private sealed class MeshExtract
    {
        public List<Vector3> Positions { get; } = new();
        public List<Vector3> Normals { get; } = new();
        public List<Vector2> UVs { get; } = new();
        public List<int> Indices { get; } = new();
        public byte[]? PngBytes { get; set; }
    }
#endif
}
