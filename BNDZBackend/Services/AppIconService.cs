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
    /// <summary>Builds a multi-resolution window/taskbar icon from the official BNDZ PNG assets.</summary>
    public static class AppIconService
    {
        private static readonly int[] IconSizes = { 16, 20, 24, 32, 48, 60, 64, 128, 256 };

        /// <summary>Writes multi-size ICO to disk for ApplicationIcon embedding in the .exe.</summary>
        public static void SaveIcoToDisk(string pngPath, string icoPath)
        {
            using var source = Image.FromFile(pngPath);
            using var fs = File.Create(icoPath);
            WriteIco(source, fs);
        }

        public static void EnsureApplicationIco()
        {
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string icoPath = Path.Combine(baseDir, "Assets", "BNDZ.ico");
                string? png = ResolveBrandPng(baseDir);
                if (png == null) return;
                SaveIcoToDisk(png, icoPath);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AppIconService] EnsureApplicationIco failed: {ex.Message}");
            }
        }

        public static void ApplyToWindow(Window window)
        {
            if (window == null) return;
            try
            {
                string baseDir = AppDomain.CurrentDomain.BaseDirectory;
                string? path = ResolveBrandPng(baseDir);
                if (path == null) return;

                window.Icon = CreateMultiSizeIcon(path);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"[AppIconService] Failed: {ex.Message}");
            }
        }

        /// <summary>Prefer the classic light brand PNG, then dark.</summary>
        private static string? ResolveBrandPng(string baseDir)
        {
            var assets = Path.Combine(baseDir, "Assets");
            foreach (var name in new[] { "BNDZ-light.png", "BNDZ-dark.png" })
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
            // Full app icons (square squircle PNGs) already include the plate — don't double-frame.
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
                // Square finished marks: cover-crop so the glyph fills taskbar/desktop
                // slots (contain left the brand looking tiny in Explorer/taskbar).
                float zoom = taskbarSlot
                    ? (w <= 16 ? 1.55f : w <= 24 ? 1.42f : w <= 32 ? 1.32f : w <= 48 ? 1.22f : 1.12f)
                    : 1.06f;
                scale = Math.Max(w / (float)src.Width, h / (float)src.Height) * zoom;
            }
            else if (taskbarSlot)
                scale = Math.Max(w / (float)src.Width, h / (float)src.Height) * (w <= 24 ? 1.42f : w <= 48 ? 1.32f : 1.22f);
            else if (wideBanner)
                // Wide light banner: cover-crop into the square ICO slot so the
                // folder glyph fills the chrome (same idea as object-cover in UI).
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
