using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace BNDZ.Services
{
    /// <summary>Builds a multi-resolution window/taskbar icon from the official BNDZ square-master PNG.</summary>
    public static class AppIconService
    {
        private static readonly int[] IconSizes = { 16, 20, 24, 32, 48, 60, 64, 128, 256 };

        /// <summary>Writes multi-size ICO to disk from a square master PNG.</summary>
        public static void SaveIcoToDisk(string pngPath, string icoPath)
        {
            using var source = Image.FromFile(pngPath);
            using var fs = File.Create(icoPath);
            WriteIco(source, fs);
        }

        /// <summary>
        /// Ensures Assets/BNDZ.ico exists. No-ops if the file is already present — the ICO is
        /// pre-baked into the EXE via ApplicationIcon and must never be overwritten from the wide
        /// light banner at startup. Only regenerates if the file is missing (first-install edge case),
        /// and only from the square master (bndz-square.png or bndz-app.png), never from BNDZ-light.png.
        /// </summary>
        public static void EnsureApplicationIco()
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string icoPath = Path.Combine(baseDir, "Assets", "BNDZ.ico");

                // ICO already present — preserve it; do NOT overwrite from any PNG.
                if (File.Exists(icoPath)) return;

                // Regenerate only from the square master, never the wide light banner.
                string? png = ResolveSquareMasterPng(baseDir);
                if (png == null) return;
                Directory.CreateDirectory(Path.GetDirectoryName(icoPath)!);
                SaveIcoToDisk(png, icoPath);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AppIconService] EnsureApplicationIco failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Loads window icon from Assets/BNDZ.ico first. Falls back to building from the
        /// square master PNG if the ICO is somehow absent. Never rebuilds from BNDZ-light.png.
        /// </summary>
        public static void ApplyToWindow(Window window)
        {
            if (window == null) return;
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string icoPath = Path.Combine(baseDir, "Assets", "BNDZ.ico");

                // Prefer the pre-built multi-frame ICO. BitmapImage often picks a poor/single
                // frame from .ico files — use IconBitmapDecoder and the largest frame so the
                // taskbar/title-bar glyph stays full-size (Windows downscales as needed).
                if (File.Exists(icoPath))
                {
                    var decoder = new IconBitmapDecoder(
                        new Uri(icoPath, UriKind.Absolute),
                        BitmapCreateOptions.None,
                        BitmapCacheOption.OnLoad);
                    BitmapFrame? best = null;
                    foreach (var frame in decoder.Frames)
                    {
                        if (best == null || frame.PixelWidth > best.PixelWidth)
                            best = frame;
                    }
                    if (best != null)
                    {
                        window.Icon = best;
                        return;
                    }
                }

                // Fallback: build from square master PNG (never the wide banner).
                string? png = ResolveSquareMasterPng(baseDir);
                if (png != null)
                    window.Icon = CreateMultiSizeIcon(png);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AppIconService] Failed: {ex.Message}");
            }
        }

        /// <summary>
        /// Prefers bndz-square.png (square app icon master) over the wide light/dark banners.
        /// Used only as a fallback when BNDZ.ico is absent.
        /// </summary>
        private static string? ResolveSquareMasterPng(string baseDir)
        {
            var assets = Path.Combine(baseDir, "Assets");
            foreach (var name in new[] { "bndz-square.png", "bndz-app.png" })
            {
                var p = Path.Combine(assets, name);
                if (File.Exists(p)) return p;
            }
            return null;
        }

        public static ImageSource CreateMultiSizeIcon(string pngPath)
        {
            using var source = Image.FromFile(pngPath);
            using var ms = new MemoryStream();
            WriteIco(source, ms);
            ms.Position = 0;
            return BitmapFrame.Create(ms, BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
        }

        private static void WriteIco(Image source, Stream output)
        {
            var entries = new List<(int size, byte[] data)>();
            foreach (int size in IconSizes)
            {
                using var bmp = Resize(source, size, size);
                using var pngMs = new MemoryStream();
                bmp.Save(pngMs, System.Drawing.Imaging.ImageFormat.Png);
                entries.Add((size, pngMs.ToArray()));
            }

            using var bw = new BinaryWriter(output);
            bw.Write((ushort)0);
            bw.Write((ushort)1);
            bw.Write((ushort)entries.Count);

            int offset = 6 + 16 * entries.Count;
            foreach (var (size, data) in entries)
            {
                bw.Write((byte)(size >= 256 ? 0 : size));
                bw.Write((byte)(size >= 256 ? 0 : size));
                bw.Write((byte)0);
                bw.Write((byte)0);
                bw.Write((ushort)1);
                bw.Write((ushort)32);
                bw.Write(data.Length);
                bw.Write(offset);
                offset += data.Length;
            }
            foreach (var (_, data) in entries)
                bw.Write(data);
        }

        private static Bitmap Resize(Image src, int w, int h)
        {
            var bmp = new Bitmap(w, h, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            using var g = Graphics.FromImage(bmp);
            g.Clear(System.Drawing.Color.Transparent);
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.SmoothingMode = SmoothingMode.HighQuality;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;

            bool taskbarSlot = w <= 60;
            bool wideBanner = src.Width > src.Height * 1.35f;
            // Square squircle marks already include the plate — don't double-frame.
            bool finishedAppIcon = Math.Abs(src.Width - src.Height) <= src.Width * 0.08f;

            if (taskbarSlot && !finishedAppIcon)
            {
                float pad = w * 0.05f;
                using var plate = new GraphicsPath();
                float r = w * 0.22f;
                plate.AddArc(pad, pad, r, r, 180, 90);
                plate.AddArc(w - pad - r, pad, r, r, 270, 90);
                plate.AddArc(w - pad - r, h - pad - r, r, r, 0, 90);
                plate.AddArc(pad, h - pad - r, r, r, 90, 90);
                plate.CloseFigure();
                using var bg = new SolidBrush(System.Drawing.Color.FromArgb(235, 18, 22, 30));
                g.FillPath(bg, plate);
            }

            float scale;
            if (finishedAppIcon)
            {
                // Square finished marks: cover-crop so the glyph fills taskbar/desktop slots.
                float zoom = taskbarSlot
                    ? (w <= 16 ? 1.72f : w <= 24 ? 1.58f : w <= 32 ? 1.45f : w <= 48 ? 1.32f : 1.18f)
                    : 1.08f;
                scale = Math.Max(w / (float)src.Width, h / (float)src.Height) * zoom;
            }
            else if (taskbarSlot)
                scale = Math.Max(w / (float)src.Width, h / (float)src.Height) * (w <= 24 ? 1.55f : w <= 48 ? 1.42f : 1.28f);
            else if (wideBanner)
                scale = Math.Max(w / (float)src.Width, h / (float)src.Height) * (taskbarSlot ? 1.08f : 1f);
            else
                scale = Math.Max((w * 0.94f) / src.Width, (h * 0.94f) / src.Height);

            float drawW = src.Width * scale;
            float drawH = src.Height * scale;
            float x = (w - drawW) / 2f;
            float y = (h - drawH) / 2f;
            g.DrawImage(src, x, y, drawW, drawH);
            return bmp;
        }
    }
}
