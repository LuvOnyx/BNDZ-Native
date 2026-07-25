using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using MediaColor = System.Windows.Media.Color;
using MediaFontFamily = System.Windows.Media.FontFamily;

namespace BNDZ.Services;

/// <summary>
/// Host-owned context menu that paints outside the main BNDZ window.
/// WebView2 DOM menus are clipped to the WebView HWND — this WPF menu is not.
/// </summary>
public static class HostContextMenuService
{
    public sealed class Item
    {
        public string Id { get; init; } = "";
        public string Label { get; init; } = "";
        public bool Separator { get; init; }
        public bool Disabled { get; init; }
        public bool Danger { get; init; }
        public bool Bold { get; init; }
    }

    /// <summary>
    /// Show a WPF ContextMenu at screen coordinates. Invokes <paramref name="onFinished"/>
    /// with the selected command id, or null if dismissed.
    /// </summary>
    public static void Show(
        Window owner,
        int screenX,
        int screenY,
        IReadOnlyList<Item> items,
        Action<string?> onFinished)
    {
        if (owner == null || items == null || items.Count == 0)
        {
            onFinished(null);
            return;
        }

        owner.Dispatcher.Invoke(() =>
        {
            string? chosen = null;
            var finished = false;
            void Finish(string? id)
            {
                if (finished) return;
                finished = true;
                try { onFinished(id); } catch { /* ignore */ }
            }

            var menu = new ContextMenu
            {
                Placement = PlacementMode.AbsolutePoint,
                HorizontalOffset = screenX,
                VerticalOffset = screenY,
                IsOpen = false,
                StaysOpen = false,
                HasDropShadow = true,
            };

            ApplyBndzChrome(menu);

            foreach (var item in items)
            {
                if (item.Separator)
                {
                    menu.Items.Add(new Separator());
                    continue;
                }

                var mi = new MenuItem
                {
                    Header = item.Label,
                    IsEnabled = !item.Disabled,
                    Tag = item.Id,
                    FontWeight = item.Bold ? FontWeights.SemiBold : FontWeights.Normal,
                    Foreground = item.Danger
                        ? new SolidColorBrush(MediaColor.FromRgb(0xF0, 0xA0, 0xA0))
                        : new SolidColorBrush(MediaColor.FromRgb(0xE8, 0xEA, 0xED)),
                };
                mi.Click += (_, _) =>
                {
                    chosen = mi.Tag as string;
                    menu.IsOpen = false;
                };
                menu.Items.Add(mi);
            }

            menu.PlacementTarget = owner;
            menu.Closed += (_, _) => Finish(chosen);

            menu.Opened += (_, _) =>
            {
                try
                {
                    menu.UpdateLayout();
                    var h = menu.ActualHeight;
                    var w = menu.ActualWidth;
                    var wa = SystemParameters.WorkArea;
                    var x = (double)screenX;
                    var y = (double)screenY;
                    if (y + h > wa.Bottom - 4)
                        y = Math.Max(wa.Top + 4, screenY - h);
                    if (x + w > wa.Right - 4)
                        x = Math.Max(wa.Left + 4, wa.Right - w - 4);
                    menu.HorizontalOffset = x;
                    menu.VerticalOffset = y;
                }
                catch { /* best-effort flip */ }
            };

            menu.IsOpen = true;
        });
    }

    private static void ApplyBndzChrome(ContextMenu menu)
    {
        menu.Background = new SolidColorBrush(MediaColor.FromRgb(0x2A, 0x2A, 0x2A));
        menu.BorderBrush = new SolidColorBrush(MediaColor.FromRgb(0x3A, 0x3A, 0x3A));
        menu.BorderThickness = new Thickness(1);
        menu.Padding = new Thickness(4, 6, 4, 6);
        menu.FontFamily = new MediaFontFamily("Segoe UI");
        menu.FontSize = 12;
    }

    [DllImport("user32.dll")]
    private static extern bool ClientToScreen(IntPtr hWnd, ref POINT lpPoint);

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    public static (int X, int Y) ClientToScreenPoint(IntPtr hwnd, int clientX, int clientY)
    {
        var pt = new POINT { X = clientX, Y = clientY };
        ClientToScreen(hwnd, ref pt);
        return (pt.X, pt.Y);
    }
}
