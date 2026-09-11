using System;
using System.Threading.Tasks;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Windows.UI;
using Windows.UI.ViewManagement;
using WinRT.Interop;

namespace BNDZ.NativeShell.Services;

/// <summary>
/// Synchronizes application theme with Windows system theme.
/// Listens for system theme changes and updates application resources accordingly.
/// </summary>
public class ThemeService
{
    private readonly Window _window;
    private readonly UISettings _uiSettings = new UISettings();
    private bool _isListening;

    public ThemeService(Window window)
    {
        _window = window ?? throw new ArgumentNullException(nameof(window));
        _uiSettings = new UISettings();
    }

    /// <summary>
    /// Starts listening for system theme changes.
    /// </summary>
    public void StartListening()
    {
        if (_isListening) return;

        // Set initial theme based on current system settings
        UpdateApplicationTheme();

        // Listen for system theme changes
        _uiSettings.ColorValuesChanged += UiSettings_ColorValuesChanged;
        _isListening = true;
    }

    /// <summary>
    /// Stops listening for system theme changes.
    /// </summary>
    public void StopListening()
    {
        if (!_isListening) return;

        _uiSettings.ColorValuesChanged -= UiSettings_ColorValuesChanged;
        _isListening = false;
    }

    private void UiSettings_ColorValuesChanged(UISettings sender, object args)
    {
        // Update application theme when system theme changes
        UpdateApplicationTheme();
    }

    private void UpdateApplicationTheme()
    {
        try
        {
            // Get system background color
            UIColorType uicolorType = UIColorType.Background;
            Color systemColor = _uiSettings.GetColorValue(uicolorType);

            // Determine if system is using light or dark theme based on background brightness
            bool isLightTheme = GetBrightness(systemColor) > 0.5;

            // Update application theme based on system theme
            if (Application.Current != null)
            {
                if (isLightTheme)
                {
                    // Light theme - use light resources
                    Application.Current.RequestedTheme = ApplicationTheme.Light;
                }
                else
                {
                    // Dark theme - use dark resources
                    Application.Current.RequestedTheme = ApplicationTheme.Dark;
                }
            }

            // Also update any specific theme resources if needed
            UpdateThemeResources(isLightTheme);
        }
        catch (Exception ex)
        {
            // Log error but don't crash - theme sync failure shouldn't break the app
            System.Diagnostics.Debug.WriteLine($"[ThemeService] Failed to update theme: {ex.Message}");
        }
    }

    private double GetBrightness(Color color)
    {
        // Calculate perceived brightness using standard luminance formula
        // https://www.w3.org/TR/AERT/#color-contrast
        double r = color.R / 255.0;
        double g = color.G / 255.0;
        double b = color.B / 255.0;
        return 0.299 * r + 0.587 * g + 0.114 * b;
    }

    private void UpdateThemeResources(bool isLightTheme)
    {
        // Update any theme-specific resources here if needed
        // For example, you could adjust accent colors based on system preferences
        if (Application.Current != null && Application.Current.Resources != null)
        {
            // Example: adjust accent color based on system accent color
            try
            {
                UIColorType accentType = UIColorType.Accent;
                Color systemAccent = _uiSettings.GetColorValue(accentType);

                // Update accent brush if it exists in resources
                if (Application.Current.Resources["SystemAccentBrush"] is Microsoft.UI.Xaml.Media.SolidColorBrush accentBrush)
                {
                    accentBrush.Color = systemAccent;
                }
            }
            catch
            {
                // Ignore errors in resource updates
            }
        }
    }
}