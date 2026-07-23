using System;
using System.Collections.Generic;
using System.Windows.Input;
using NHotkey;
using NHotkey.Wpf;

namespace BNDZ.Services;

/// <summary>
/// OS-global hotkeys (work even when WebView lacks focus) via NHotkey.Wpf.
/// </summary>
public sealed class GlobalHotkeyService : IDisposable
{
    public const string ShowHideId = "bndz.showHide";
    public const string CommandPaletteId = "bndz.commandPalette";
    public const string GlobalSearchId = "bndz.globalSearch";

    private readonly HashSet<string> _registered = new(StringComparer.OrdinalIgnoreCase);
    private bool _disposed;

    public event Action<string>? HotkeyPressed;

    public void ApplyFromSettings(string? showHide, string? commandPalette, string? globalSearch)
    {
        RegisterOrClear(ShowHideId, showHide);
        RegisterOrClear(CommandPaletteId, commandPalette);
        RegisterOrClear(GlobalSearchId, globalSearch);
    }

    public bool Register(string id, string? gesture)
    {
        if (string.IsNullOrWhiteSpace(id)) return false;
        Unregister(id);
        if (string.IsNullOrWhiteSpace(gesture)) return true;

        if (!TryParseGesture(gesture, out var key, out var mods))
            return false;

        try
        {
            HotkeyManager.Current.AddOrReplace(id, key, mods, OnHotkey);
            _registered.Add(id);
            return true;
        }
        catch
        {
            return false;
        }
    }

    public void Unregister(string id)
    {
        if (!_registered.Remove(id)) return;
        try { HotkeyManager.Current.Remove(id); } catch { }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        foreach (var id in _registered)
        {
            try { HotkeyManager.Current.Remove(id); } catch { }
        }
        _registered.Clear();
    }

    private void RegisterOrClear(string id, string? gesture)
    {
        if (string.IsNullOrWhiteSpace(gesture))
            Unregister(id);
        else
            Register(id, gesture);
    }

    private void OnHotkey(object? sender, HotkeyEventArgs e)
    {
        e.Handled = true;
        HotkeyPressed?.Invoke(e.Name);
    }

    public static bool TryParseGesture(string gesture, out Key key, out ModifierKeys mods)
    {
        key = Key.None;
        mods = ModifierKeys.None;
        if (string.IsNullOrWhiteSpace(gesture)) return false;

        var parts = gesture.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length == 0) return false;

        for (var i = 0; i < parts.Length - 1; i++)
        {
            switch (parts[i].ToLowerInvariant())
            {
                case "ctrl":
                case "control":
                    mods |= ModifierKeys.Control;
                    break;
                case "alt":
                    mods |= ModifierKeys.Alt;
                    break;
                case "shift":
                    mods |= ModifierKeys.Shift;
                    break;
                case "win":
                case "windows":
                case "meta":
                    mods |= ModifierKeys.Windows;
                    break;
                default:
                    return false;
            }
        }

        var keyName = parts[^1];
        if (keyName.Length == 1 && char.IsDigit(keyName[0]))
            keyName = "D" + keyName;
        if (!Enum.TryParse(keyName, true, out key) || key == Key.None)
            return false;
        return true;
    }
}
