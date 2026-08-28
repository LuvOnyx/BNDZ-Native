using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Assimp;
using SkiaSharp;

namespace BNDZ.Services;

/// <summary>
/// Host-side silhouette thumbnails for common 3D mesh formats via AssimpNetter.
/// Interactive Three.js preview stays in the React preview pane.
/// </summary>
public static class AssimpMeshThumbService
{
    private static readonly HashSet<string> MeshExts = new(StringComparer.OrdinalIgnoreCase)
    {
        ".obj", ".fbx", ".gltf", ".glb", ".stl", ".dae", ".3ds", ".ply",
    };

    public static bool IsMeshPath(string filePath)
    {
        var ext = Path.GetExtension(filePath);
        return !string.IsNullOrEmpty(ext) && MeshExts.Contains(ext);
    }

    /// <summary>Returns PNG bytes of a flat orthographic point-cloud silhouette, or null on failure.</summary>
    public static byte[]? TryRenderSilhouette(string filePath, int size = 128)
    {
        if (!IsMeshPath(filePath) || !File.Exists(filePath)) return null;
        try
        {
            using var ctx = new AssimpContext();
            var scene = ctx.ImportFile(
                filePath,
                PostProcessSteps.Triangulate | PostProcessSteps.JoinIdenticalVertices);
            if (scene == null || !scene.HasMeshes) return null;

            float minX = float.MaxValue, minY = float.MaxValue;
            float maxX = float.MinValue, maxY = float.MinValue;
            var points = new List<(float x, float y)>(4096);

            foreach (var mesh in scene.Meshes)
            {
                foreach (var v in mesh.Vertices.Take(8000))
                {
                    points.Add((v.X, v.Y));
                    minX = Math.Min(minX, v.X); maxX = Math.Max(maxX, v.X);
                    minY = Math.Min(minY, v.Y); maxY = Math.Max(maxY, v.Y);
                }
            }
            if (points.Count == 0) return null;

            var cx = (minX + maxX) * 0.5f;
            var cy = (minY + maxY) * 0.5f;
            var span = Math.Max(maxX - minX, maxY - minY);
            if (span < 1e-6f) span = 1f;
            var scale = (size - 16f) / span;

            using var bmp = new SKBitmap(size, size, SKColorType.Rgba8888, SKAlphaType.Premul);
            using var canvas = new SKCanvas(bmp);
            canvas.Clear(new SKColor(18, 20, 26));
            using var paint = new SKPaint
            {
                Color = new SKColor(180, 200, 230, 220),
                IsAntialias = true,
                Style = SKPaintStyle.Fill,
            };

            foreach (var (x, y) in points)
            {
                var sx = (x - cx) * scale + size * 0.5f;
                var sy = size * 0.5f - (y - cy) * scale;
                canvas.DrawCircle(sx, sy, 1.1f, paint);
            }

            using var img = SKImage.FromBitmap(bmp);
            using var data = img.Encode(SKEncodedImageFormat.Png, 85);
            return data?.ToArray();
        }
        catch (Exception ex)
        {
            Debug.WriteLine($"[AssimpThumb] {filePath}: {ex.Message}");
            return null;
        }
    }
}
