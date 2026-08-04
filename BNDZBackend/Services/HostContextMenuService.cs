using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Media;
using MediaColor = System.Windows.Media.Color;
using MediaFontFamily = System.Windows.Media.FontFamily;
using WpfBrush = System.Windows.Media.Brush;
using WpfBrushes = System.Windows.Media.Brushes;
using WpfControl = System.Windows.Controls.Control;
using WpfSystemColors = System.Windows.SystemColors;

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

    private static readonly MediaColor BgColor = MediaColor.FromRgb(0x2A, 0x2A, 0x2A);
    private static readonly MediaColor BorderColor = MediaColor.FromRgb(0x3A, 0x3A, 0x3A);
    private static readonly MediaColor TextColor = MediaColor.FromRgb(0xE8, 0xEA, 0xED);
    private static readonly MediaColor MutedTextColor = MediaColor.FromRgb(0x88, 0x88, 0x88);
    private static readonly MediaColor HoverColor = MediaColor.FromRgb(0x09, 0x47, 0x71);
    private static readonly MediaColor DangerColor = MediaColor.FromRgb(0xF0, 0xA0, 0xA0);

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
                    Foreground = new SolidColorBrush(item.Danger ? DangerColor : TextColor),
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
        var bg = new SolidColorBrush(BgColor);
        var border = new SolidColorBrush(BorderColor);
        var text = new SolidColorBrush(TextColor);
        var hover = new SolidColorBrush(HoverColor);

        menu.Background = bg;
        menu.BorderBrush = border;
        menu.BorderThickness = new Thickness(1);
        menu.Padding = new Thickness(4, 6, 4, 6);
        menu.FontFamily = new MediaFontFamily("Segoe UI");
        menu.FontSize = 12;
        menu.Foreground = text;

        // Default Aero / Fluent MenuItem reserves a left "icon" column that paints
        // SystemColors.ControlBrush (near-white) — looks like blank white tiles in dark chrome.
        menu.Resources[WpfSystemColors.ControlBrushKey] = bg;
        menu.Resources[WpfSystemColors.ControlLightBrushKey] = bg;
        menu.Resources[WpfSystemColors.ControlLightLightBrushKey] = bg;
        menu.Resources[WpfSystemColors.ControlDarkBrushKey] = border;
        menu.Resources[WpfSystemColors.MenuBrushKey] = bg;
        menu.Resources[WpfSystemColors.MenuBarBrushKey] = bg;
        menu.Resources[WpfSystemColors.HighlightBrushKey] = hover;
        menu.Resources[WpfSystemColors.MenuHighlightBrushKey] = hover;
        menu.Resources[WpfSystemColors.HighlightTextBrushKey] = text;
        menu.Resources[WpfSystemColors.MenuTextBrushKey] = text;
        menu.Resources[WpfSystemColors.ControlTextBrushKey] = text;
        menu.Resources[WpfSystemColors.GrayTextBrushKey] = new SolidColorBrush(MutedTextColor);
        menu.Resources[WpfSystemColors.InactiveSelectionHighlightBrushKey] = hover;

        menu.ItemContainerStyle = BuildMenuItemStyle(hover, text);
        menu.Resources[typeof(Separator)] = BuildSeparatorStyle(border);
    }

    /// <summary>
    /// Text-only menu item — no icon column grid (avoids the white strip even when
    /// SystemColor keys are overridden incompletely on some Windows themes).
    /// </summary>
    private static Style BuildMenuItemStyle(WpfBrush hover, WpfBrush text)
    {
        var style = new Style(typeof(MenuItem));
        style.Setters.Add(new Setter(WpfControl.BackgroundProperty, WpfBrushes.Transparent));
        style.Setters.Add(new Setter(WpfControl.ForegroundProperty, text));
        style.Setters.Add(new Setter(WpfControl.PaddingProperty, new Thickness(12, 6, 18, 6)));
        style.Setters.Add(new Setter(WpfControl.BorderThicknessProperty, new Thickness(0)));
        style.Setters.Add(new Setter(MenuItem.IconProperty, null));
        style.Setters.Add(new Setter(WpfControl.TemplateProperty, BuildTextOnlyMenuItemTemplate(hover)));
        return style;
    }

    private static ControlTemplate BuildTextOnlyMenuItemTemplate(WpfBrush hover)
    {
        var template = new ControlTemplate(typeof(MenuItem));

        var border = new FrameworkElementFactory(typeof(Border), "Bd");
        border.SetValue(Border.BackgroundProperty, WpfBrushes.Transparent);
        border.SetValue(Border.PaddingProperty, new TemplateBindingExtension(WpfControl.PaddingProperty));
        border.SetValue(Border.SnapsToDevicePixelsProperty, true);

        var content = new FrameworkElementFactory(typeof(ContentPresenter));
        content.SetValue(ContentPresenter.ContentSourceProperty, "Header");
        content.SetValue(ContentPresenter.RecognizesAccessKeyProperty, true);
        content.SetValue(ContentPresenter.VerticalAlignmentProperty, VerticalAlignment.Center);
        content.SetValue(FrameworkElement.HorizontalAlignmentProperty, System.Windows.HorizontalAlignment.Left);
        border.AppendChild(content);
        template.VisualTree = border;

        var highlight = new Trigger { Property = MenuItem.IsHighlightedProperty, Value = true };
        highlight.Setters.Add(new Setter(Border.BackgroundProperty, hover, "Bd"));
        template.Triggers.Add(highlight);

        var disabled = new Trigger { Property = UIElement.IsEnabledProperty, Value = false };
        disabled.Setters.Add(new Setter(WpfControl.ForegroundProperty, new SolidColorBrush(MutedTextColor)));
        disabled.Setters.Add(new Setter(UIElement.OpacityProperty, 0.55));
        template.Triggers.Add(disabled);

        return template;
    }

    private static Style BuildSeparatorStyle(WpfBrush brush)
    {
        var style = new Style(typeof(Separator));
        style.Setters.Add(new Setter(WpfControl.BackgroundProperty, brush));
        style.Setters.Add(new Setter(WpfControl.MarginProperty, new Thickness(10, 5, 10, 5)));
        style.Setters.Add(new Setter(WpfControl.HeightProperty, 1.0));
        style.Setters.Add(new Setter(WpfControl.TemplateProperty, BuildSeparatorTemplate()));
        return style;
    }

    private static ControlTemplate BuildSeparatorTemplate()
    {
        var template = new ControlTemplate(typeof(Separator));
        var border = new FrameworkElementFactory(typeof(Border));
        border.SetValue(Border.BackgroundProperty, new TemplateBindingExtension(WpfControl.BackgroundProperty));
        border.SetValue(Border.HeightProperty, 1.0);
        border.SetValue(FrameworkElement.MarginProperty, new TemplateBindingExtension(FrameworkElement.MarginProperty));
        border.SetValue(FrameworkElement.SnapsToDevicePixelsProperty, true);
        template.VisualTree = border;
        return template;
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
