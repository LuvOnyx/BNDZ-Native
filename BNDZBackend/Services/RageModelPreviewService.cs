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

            var ytdPaths = DiscoverYtdPaths(fi.FullName);
            long ytdTicks = 0;
            long ytdLen = 0;
            foreach (var yp in ytdPaths)
            {
                try
                {
                    var yfi = new FileInfo(yp);
                    ytdTicks ^= yfi.LastWriteTimeUtc.Ticks;
                    ytdLen += yfi.Length;
                }
                catch { /* ignore */ }
            }

            var cacheKey = $"{fi.FullName}|{fi.Length}|{fi.LastWriteTimeUtc.Ticks}|{ytdLen}|{ytdTicks}|glb4-nm";
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
                var mesh = ExtractMesh(ext, bytes, fi.Name, ytdPaths);
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
    /// <summary>
    /// Sibling .ytd plus nearby dictionaries (same folder, parent, stream/ peers).
    /// </summary>
    private static List<string> DiscoverYtdPaths(string modelPath)
    {
        var found = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        void Add(string? p)
        {
            if (string.IsNullOrWhiteSpace(p) || !File.Exists(p)) return;
            var full = Path.GetFullPath(p);
            if (seen.Add(full)) found.Add(full);
        }

        var sibling = Path.ChangeExtension(modelPath, ".ytd");
        Add(sibling);

        var dir = Path.GetDirectoryName(modelPath);
        var baseName = Path.GetFileNameWithoutExtension(modelPath) ?? "";
        if (!string.IsNullOrEmpty(dir) && Directory.Exists(dir))
        {
            try
            {
                foreach (var ytd in Directory.EnumerateFiles(dir, "*.ytd"))
                {
                    var leaf = Path.GetFileNameWithoutExtension(ytd) ?? "";
                    if (string.Equals(leaf, baseName, StringComparison.OrdinalIgnoreCase)
                        || leaf.StartsWith(baseName, StringComparison.OrdinalIgnoreCase)
                        || baseName.StartsWith(leaf, StringComparison.OrdinalIgnoreCase)
                        || leaf.Contains(baseName, StringComparison.OrdinalIgnoreCase))
                        Add(ytd);
                }
            }
            catch { /* optional */ }

            // Parent folder + stream peer (common FiveM resource layout)
            var parent = Directory.GetParent(dir)?.FullName;
            if (!string.IsNullOrEmpty(parent))
            {
                Add(Path.Combine(parent, baseName + ".ytd"));
                var streamPeer = Path.Combine(parent, "stream", baseName + ".ytd");
                Add(streamPeer);
                try
                {
                    var streamDir = Path.Combine(parent, "stream");
                    if (Directory.Exists(streamDir))
                    {
                        foreach (var ytd in Directory.EnumerateFiles(streamDir, "*.ytd").Take(12))
                        {
                            var leaf = Path.GetFileNameWithoutExtension(ytd) ?? "";
                            if (leaf.StartsWith(baseName, StringComparison.OrdinalIgnoreCase)
                                || baseName.StartsWith(leaf, StringComparison.OrdinalIgnoreCase))
                                Add(ytd);
                        }
                    }
                }
                catch { /* optional */ }
            }
        }

        return found;
    }

    private static MeshExtract ExtractMesh(string ext, byte[] data, string name, IReadOnlyList<string> ytdPaths)
    {
        var mesh = ext switch
        {
            "ydr" => FromDrawable(LoadYdr(data, name), mesh: null),
            "ydd" => FromYdd(data, name),
            "yft" => FromYft(data, name),
            "ybn" => FromYbn(data, name),
            _ => new MeshExtract(),
        };

        foreach (var ytd in ytdPaths)
            TryAttachYtd(mesh, ytd);

        BuildYtdAtlasIfNeeded(mesh);
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
        var first = mesh.Indices.Count;
        AppendBounds(mesh, ybn.Bounds, Matrix.Identity);
        if (mesh.Indices.Count - first >= 3)
            mesh.Primitives.Add(new MeshPrimitive
            {
                FirstIndex = first,
                IndexCount = mesh.Indices.Count - first,
                MaterialIndex = mesh.EnsureMaterial("bounds", null),
            });
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

        // Harvest embedded dictionary into named texture pool first.
        if (drawable is Drawable dEmb && dEmb.ShaderGroup?.TextureDictionary != null)
            IngestTextureDict(mesh, dEmb.ShaderGroup.TextureDictionary);

        foreach (var model in models)
        {
            if (model?.Geometries == null) continue;
            foreach (var geom in model.Geometries)
            {
                var matIndex = ResolveMaterialIndex(mesh, geom?.Shader);
                AppendGeometry(mesh, geom, matIndex);
            }
        }

        return mesh;
    }

    private static int ResolveMaterialIndex(MeshExtract mesh, ShaderFX? shader)
    {
        var (diff, bump, spec) = ResolveShaderTextures(shader);
        var matName = !string.IsNullOrWhiteSpace(diff) ? diff! : "rage_default";
        byte[]? diffPng = null;
        byte[]? bumpPng = null;
        byte[]? specPng = null;
        if (!string.IsNullOrWhiteSpace(diff) && mesh.NamedTextures.TryGetValue(diff!, out var d))
            diffPng = d;
        else if (!string.IsNullOrWhiteSpace(diff))
        {
            foreach (var kv in mesh.NamedTextures)
            {
                if (string.Equals(kv.Key, diff, StringComparison.OrdinalIgnoreCase))
                { diffPng = kv.Value; matName = kv.Key; break; }
            }
        }
        if (!string.IsNullOrWhiteSpace(bump) && mesh.NamedTextures.TryGetValue(bump!, out var b))
            bumpPng = b;
        if (!string.IsNullOrWhiteSpace(spec) && mesh.NamedTextures.TryGetValue(spec!, out var s))
            specPng = s;
        return mesh.EnsureMaterial(matName, diffPng, bumpPng, specPng);
    }

    private static (string? Diffuse, string? Bump, string? Spec) ResolveShaderTextures(ShaderFX? shader)
    {
        var parameters = shader?.ParametersList?.Parameters;
        var hashes = shader?.ParametersList?.Hashes;
        if (parameters == null || parameters.Length == 0) return (null, null, null);

        string? diffuse = null;
        string? bump = null;
        string? spec = null;
        string? firstTex = null;
        var count = Math.Min(parameters.Length, hashes?.Length ?? parameters.Length);
        for (int i = 0; i < count; i++)
        {
            var p = parameters[i];
            if (p?.DataType != 0 || p.Data is not TextureBase tb) continue;
            var name = tb.Name;
            if (string.IsNullOrWhiteSpace(name)) continue;
            firstTex ??= name;
            uint h = 0;
            if (hashes != null && i < hashes.Length) h = (uint)hashes[i];

            if (h == (uint)ShaderParamNames.DiffuseSampler
                || h == (uint)ShaderParamNames.DiffuseSampler2
                || h == (uint)ShaderParamNames.DiffuseSampler3
                || h == (uint)ShaderParamNames.DiffuseSamplerPoint
                || name.Contains("diff", StringComparison.OrdinalIgnoreCase)
                || name.Contains("albedo", StringComparison.OrdinalIgnoreCase)
                || name.EndsWith("_d", StringComparison.OrdinalIgnoreCase)
                || name.EndsWith("_diff", StringComparison.OrdinalIgnoreCase))
                diffuse ??= name;
            else if (h == (uint)ShaderParamNames.BumpSampler
                || h == (uint)ShaderParamNames.BumpSampler2
                || h == (uint)ShaderParamNames.DetailBumpSampler
                || h == (uint)ShaderParamNames.DetailNormalSampler
                || name.Contains("bump", StringComparison.OrdinalIgnoreCase)
                || name.Contains("normal", StringComparison.OrdinalIgnoreCase)
                || name.EndsWith("_n", StringComparison.OrdinalIgnoreCase)
                || name.EndsWith("_norm", StringComparison.OrdinalIgnoreCase))
                bump ??= name;
            else if (h == (uint)ShaderParamNames.SpecSampler
                || name.Contains("spec", StringComparison.OrdinalIgnoreCase)
                || name.EndsWith("_s", StringComparison.OrdinalIgnoreCase)
                || name.EndsWith("_spec", StringComparison.OrdinalIgnoreCase))
                spec ??= name;
        }
        return (diffuse ?? firstTex, bump, spec);
    }

    private static void AppendGeometry(MeshExtract mesh, DrawableGeometry? geom, int materialIndex)
    {
        if (geom?.VertexData == null || geom.IndexBuffer?.Indices == null) return;
        var vd = geom.VertexData;
        if (vd.VertexCount <= 0 || vd.VertexBytes == null || vd.Info == null) return;

        var flags = vd.Info.Flags;
        var hasPos = (flags & (1 << 0)) != 0;
        if (!hasPos) return;
        var hasNorm = (flags & (1 << 3)) != 0;
        var hasUv = (flags & (1 << 6)) != 0;

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

        var firstIndex = mesh.Indices.Count;
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
                    mesh.UVs.Add(new Vector2(h.X, 1f - h.Y));
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

        var indexCount = mesh.Indices.Count - firstIndex;
        if (indexCount >= 3)
            mesh.Primitives.Add(new MeshPrimitive { FirstIndex = firstIndex, IndexCount = indexCount, MaterialIndex = materialIndex });
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
                IngestTextureDict(mesh, ytd.TextureDict);
        }
        catch
        {
            /* texture is optional for geometry preview */
        }
    }

    private static void IngestTextureDict(MeshExtract mesh, TextureDictionary dict)
    {
        try
        {
            var textures = dict.Textures?.data_items;
            if (textures == null || textures.Length == 0) return;
            foreach (var tex in textures)
            {
                if (tex == null || string.IsNullOrWhiteSpace(tex.Name)) continue;
                if (mesh.NamedTextures.ContainsKey(tex.Name)) continue;
                var png = EncodeTexturePng(tex);
                if (png != null)
                    mesh.NamedTextures[tex.Name] = png;
            }

            // Back-fill any materials that were created before textures arrived.
            for (int i = 0; i < mesh.Materials.Count; i++)
            {
                var mat = mesh.Materials[i];
                if (mat.PngBytes != null) continue;
                if (mesh.NamedTextures.TryGetValue(mat.Name, out var bytes))
                    mesh.Materials[i] = mat with { PngBytes = bytes };
                else
                {
                    foreach (var kv in mesh.NamedTextures)
                    {
                        if (string.Equals(kv.Key, mat.Name, StringComparison.OrdinalIgnoreCase))
                        {
                            mesh.Materials[i] = mat with { PngBytes = kv.Value, Name = kv.Key };
                            break;
                        }
                    }
                }
            }
        }
        catch
        {
            /* optional */
        }
    }

    private static byte[]? EncodeTexturePng(Texture pick)
    {
        try
        {
            var rgba = DDSIO.GetPixels(pick, 0);
            if (rgba == null || rgba.Length < 4) return null;
            var w = pick.Width;
            var h = pick.Height;
            if (w <= 0 || h <= 0 || rgba.Length < w * h * 4) return null;

            using var bmp = new SKBitmap(w, h, SKColorType.Rgba8888, SKAlphaType.Premul);
            System.Runtime.InteropServices.Marshal.Copy(rgba, 0, bmp.GetPixels(), w * h * 4);
            using var img = SKImage.FromBitmap(bmp);
            using var data = img.Encode(SKEncodedImageFormat.Png, 85);
            return data.ToArray();
        }
        catch
        {
            return null;
        }
    }

    /// <summary>
    /// Pack used material textures into a single atlas when 2–8 textured materials exist.
    /// Remaps UVs so a single glTF material can still show multi-slot YTD content.
    /// </summary>
    private static void BuildYtdAtlasIfNeeded(MeshExtract mesh)
    {
        var used = mesh.Materials
            .Select((m, i) => (m, i))
            .Where(t => t.m.PngBytes is { Length: > 0 })
            .ToList();
        if (used.Count < 2 || used.Count > 8) return;
        if (mesh.Primitives.Count == 0) return;

        try
        {
            var decoded = new List<(int matIndex, SKBitmap bmp)>();
            foreach (var (m, i) in used)
            {
                using var data = SKData.CreateCopy(m.PngBytes!);
                var bmp = SKBitmap.Decode(data);
                if (bmp != null) decoded.Add((i, bmp));
            }
            if (decoded.Count < 2)
            {
                foreach (var (_, bmp) in decoded) bmp.Dispose();
                return;
            }

            var cols = (int)Math.Ceiling(Math.Sqrt(decoded.Count));
            var rows = (int)Math.Ceiling(decoded.Count / (double)cols);
            var cellW = decoded.Max(d => d.bmp.Width);
            var cellH = decoded.Max(d => d.bmp.Height);
            // Cap atlas size for sidebar GPU memory
            cellW = Math.Min(cellW, 512);
            cellH = Math.Min(cellH, 512);
            var atlasW = cols * cellW;
            var atlasH = rows * cellH;
            using var atlas = new SKBitmap(atlasW, atlasH, SKColorType.Rgba8888, SKAlphaType.Premul);
            using (var canvas = new SKCanvas(atlas))
            {
                canvas.Clear(SKColors.Transparent);
                var uvRects = new Dictionary<int, (float u0, float v0, float u1, float v1)>();
                for (int n = 0; n < decoded.Count; n++)
                {
                    var (matIndex, bmp) = decoded[n];
                    var col = n % cols;
                    var row = n / cols;
                    var x = col * cellW;
                    var y = row * cellH;
                    var dest = new SKRect(x, y, x + Math.Min(bmp.Width, cellW), y + Math.Min(bmp.Height, cellH));
                    canvas.DrawBitmap(bmp, dest);
                    // glTF V is flipped relative to Skia top-left — encode rect in glTF UV space
                    float u0 = (float)x / atlasW;
                    float u1 = (float)(x + Math.Min(bmp.Width, cellW)) / atlasW;
                    float vTop = (float)y / atlasH;
                    float vBot = (float)(y + Math.Min(bmp.Height, cellH)) / atlasH;
                    // After our earlier V flip, atlas remap: u' = u0 + u*(u1-u0), v' = (1-vBot) + v*(vBot-vTop) wait —
                    // UVs already flipped (v_gltf = 1 - v_rage). Map into cell in glTF space:
                    float v0 = 1f - vBot;
                    float v1 = 1f - vTop;
                    uvRects[matIndex] = (u0, v0, u1, v1);
                }

                // Remap UVs for vertices belonging to textured materials
                foreach (var prim in mesh.Primitives)
                {
                    if (!uvRects.TryGetValue(prim.MaterialIndex, out var rect)) continue;
                    var (u0, v0, u1, v1) = rect;
                    var seen = new HashSet<int>();
                    for (int ii = prim.FirstIndex; ii < prim.FirstIndex + prim.IndexCount && ii < mesh.Indices.Count; ii++)
                    {
                        var vi = mesh.Indices[ii];
                        if (!seen.Add(vi) || vi < 0 || vi >= mesh.UVs.Count) continue;
                        var uv = mesh.UVs[vi];
                        mesh.UVs[vi] = new Vector2(
                            u0 + Math.Clamp(uv.X, 0f, 1f) * (u1 - u0),
                            v0 + Math.Clamp(uv.Y, 0f, 1f) * (v1 - v0));
                    }
                    prim.MaterialIndex = 0; // collapse onto atlas material
                }
            }

            using var img = SKImage.FromBitmap(atlas);
            using var enc = img.Encode(SKEncodedImageFormat.Png, 85);
            var atlasPng = enc.ToArray();
            mesh.Materials.Clear();
            mesh.Materials.Add(new MeshMaterial("ytd_atlas", atlasPng));
            foreach (var prim in mesh.Primitives)
                prim.MaterialIndex = 0;

            foreach (var (_, bmp) in decoded) bmp.Dispose();
        }
        catch
        {
            /* keep multi-material without atlas */
        }
    }

    private static void WriteGlb(string path, MeshExtract mesh)
    {
        if (mesh.Primitives.Count == 0 && mesh.Indices.Count >= 3)
            mesh.Primitives.Add(new MeshPrimitive { FirstIndex = 0, IndexCount = mesh.Indices.Count, MaterialIndex = mesh.EnsureMaterial("rage_default", null) });
        if (mesh.Materials.Count == 0)
            mesh.EnsureMaterial("rage_default", null);

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

        var imageOffsets = new List<(int off, int len, byte[] png)>();
        // Track which image slot is diffuse / normal / rough for each material
        var matDiffImg = new int[mesh.Materials.Count];
        var matNormImg = new int[mesh.Materials.Count];
        var matSpecImg = new int[mesh.Materials.Count];
        Array.Fill(matDiffImg, -1);
        Array.Fill(matNormImg, -1);
        Array.Fill(matSpecImg, -1);

        void AddImage(byte[]? png, int matIndex, Action<int> assign)
        {
            if (png is not { Length: > 0 }) return;
            var off = o;
            var slot = imageOffsets.Count;
            imageOffsets.Add((off, png.Length, png));
            o = Align4(o + png.Length);
            assign(slot);
        }

        for (int mi = 0; mi < mesh.Materials.Count; mi++)
        {
            var mat = mesh.Materials[mi];
            var mii = mi;
            AddImage(mat.PngBytes, mi, slot => matDiffImg[mii] = slot);
            AddImage(mat.NormalPngBytes, mi, slot => matNormImg[mii] = slot);
            AddImage(mat.SpecPngBytes, mi, slot => matSpecImg[mii] = slot);
        }

        var bin = new byte[o];
        Buffer.BlockCopy(posBytes, 0, bin, posOff, posBytes.Length);
        Buffer.BlockCopy(normBytes, 0, bin, normOff, normBytes.Length);
        Buffer.BlockCopy(uvBytes, 0, bin, uvOff, uvBytes.Length);
        Buffer.BlockCopy(indexBytes, 0, bin, idxOff, indexBytes.Length);
        foreach (var (off, len, png) in imageOffsets)
            Buffer.BlockCopy(png, 0, bin, off, len);

        var bufferViews = new List<object>
        {
            new { buffer = 0, byteOffset = posOff, byteLength = posBytes.Length, target = 34962 },
            new { buffer = 0, byteOffset = normOff, byteLength = normBytes.Length, target = 34962 },
            new { buffer = 0, byteOffset = uvOff, byteLength = uvBytes.Length, target = 34962 },
        };
        // One bufferView per primitive index slice
        var primIndexViewStart = bufferViews.Count;
        var indexStride = useShort ? 2 : 4;
        foreach (var prim in mesh.Primitives)
        {
            bufferViews.Add(new
            {
                buffer = 0,
                byteOffset = idxOff + prim.FirstIndex * indexStride,
                byteLength = prim.IndexCount * indexStride,
                target = 34963,
            });
        }
        var imageViewStart = bufferViews.Count;
        foreach (var (off, len, _) in imageOffsets)
            bufferViews.Add(new { buffer = 0, byteOffset = off, byteLength = len });

        var accessors = new List<object>
        {
            new
            {
                bufferView = 0, componentType = 5126, count = mesh.Positions.Count, type = "VEC3",
                max = new[] { maxX, maxY, maxZ }, min = new[] { minX, minY, minZ },
            },
            new { bufferView = 1, componentType = 5126, count = mesh.Normals.Count, type = "VEC3" },
            new { bufferView = 2, componentType = 5126, count = mesh.UVs.Count, type = "VEC2" },
        };
        var primAccessorStart = accessors.Count;
        for (int i = 0; i < mesh.Primitives.Count; i++)
        {
            accessors.Add(new
            {
                bufferView = primIndexViewStart + i,
                componentType = useShort ? 5123 : 5125,
                count = mesh.Primitives[i].IndexCount,
                type = "SCALAR",
            });
        }

        var images = new List<object>();
        var textures = new List<object>();
        for (int i = 0; i < imageOffsets.Count; i++)
        {
            images.Add(new { bufferView = imageViewStart + i, mimeType = "image/png" });
            textures.Add(new { source = i });
        }

        var materials = new List<object>();
        for (int mi = 0; mi < mesh.Materials.Count; mi++)
        {
            var mat = mesh.Materials[mi];
            var diffIdx = matDiffImg[mi];
            var normIdx = matNormImg[mi];
            var specIdx = matSpecImg[mi];
            var pbr = new Dictionary<string, object?>
            {
                ["metallicFactor"] = specIdx >= 0 ? 0.35 : 0.05,
                ["roughnessFactor"] = specIdx >= 0 ? 0.45 : 0.72,
            };
            if (diffIdx >= 0)
                pbr["baseColorTexture"] = new { index = diffIdx };
            else
                pbr["baseColorFactor"] = new[] { 0.78, 0.80, 0.84, 1.0 };

            var matObj = new Dictionary<string, object?>
            {
                ["name"] = mat.Name,
                ["doubleSided"] = true,
                ["pbrMetallicRoughness"] = pbr,
            };
            if (normIdx >= 0)
                matObj["normalTexture"] = new { index = normIdx };
            if (specIdx >= 0)
                matObj["occlusionTexture"] = new { index = specIdx }; // approximate gloss/spec cue
            materials.Add(matObj);
        }

        var primitives = new List<object>();
        for (int i = 0; i < mesh.Primitives.Count; i++)
        {
            var prim = mesh.Primitives[i];
            var matIdx = Math.Clamp(prim.MaterialIndex, 0, materials.Count - 1);
            primitives.Add(new
            {
                attributes = new Dictionary<string, int>
                {
                    ["POSITION"] = 0,
                    ["NORMAL"] = 1,
                    ["TEXCOORD_0"] = 2,
                },
                indices = primAccessorStart + i,
                material = matIdx,
            });
        }

        var root = new Dictionary<string, object?>
        {
            ["asset"] = new { version = "2.0", generator = "BNDZ RAGE preview" },
            ["scene"] = 0,
            ["scenes"] = new object[] { new { nodes = new[] { 0 } } },
            ["nodes"] = new object[] { new { mesh = 0, name = "rage_preview" } },
            ["meshes"] = new object[] { new { primitives } },
            ["materials"] = materials,
            ["buffers"] = new object[] { new { byteLength = bin.Length } },
            ["bufferViews"] = bufferViews,
            ["accessors"] = accessors,
        };
        if (textures.Count > 0) root["textures"] = textures;
        if (images.Count > 0) root["images"] = images;

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
            if (!doc.RootElement.TryGetProperty("accessors", out var acc) || acc.GetArrayLength() < 1)
                return (0, 0);
            var verts = acc[0].GetProperty("count").GetInt32();
            var tris = 0;
            // Sum SCALAR index accessors (skip POS/NORM/UV = 0..2)
            for (int i = 3; i < acc.GetArrayLength(); i++)
            {
                if (acc[i].TryGetProperty("type", out var t) && t.GetString() == "SCALAR")
                    tris += acc[i].GetProperty("count").GetInt32() / 3;
            }
            return (verts, tris);
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

    private sealed class MeshPrimitive
    {
        public int FirstIndex { get; set; }
        public int IndexCount { get; set; }
        public int MaterialIndex { get; set; }
    }

    private sealed record MeshMaterial(string Name, byte[]? PngBytes, byte[]? NormalPngBytes = null, byte[]? SpecPngBytes = null);

    private sealed class MeshExtract
    {
        public List<Vector3> Positions { get; } = new();
        public List<Vector3> Normals { get; } = new();
        public List<Vector2> UVs { get; } = new();
        public List<int> Indices { get; } = new();
        public List<MeshPrimitive> Primitives { get; } = new();
        public List<MeshMaterial> Materials { get; } = new();
        public Dictionary<string, byte[]> NamedTextures { get; } = new(StringComparer.OrdinalIgnoreCase);

        public int EnsureMaterial(string name, byte[]? png, byte[]? normalPng = null, byte[]? specPng = null)
        {
            for (int i = 0; i < Materials.Count; i++)
            {
                if (string.Equals(Materials[i].Name, name, StringComparison.OrdinalIgnoreCase))
                {
                    var cur = Materials[i];
                    Materials[i] = cur with
                    {
                        PngBytes = cur.PngBytes ?? png,
                        NormalPngBytes = cur.NormalPngBytes ?? normalPng,
                        SpecPngBytes = cur.SpecPngBytes ?? specPng,
                    };
                    return i;
                }
            }
            Materials.Add(new MeshMaterial(name, png, normalPng, specPng));
            return Materials.Count - 1;
        }
    }
#endif
}
