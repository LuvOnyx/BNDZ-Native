using System.Windows;
using System.Windows.Controls;

namespace BNDZ.Dialogs;

/// <summary>Host fallback passphrase prompt when Windows Hello is unavailable.</summary>
public sealed class HelloGatePasswordDialog : Window
{
    private readonly PasswordBox _passwordBox;

    public string? Passphrase => _passwordBox.Password;

    public HelloGatePasswordDialog(string folderPath)
    {
        Title = "Unlock protected folder";
        Width = 420;
        Height = 200;
        WindowStartupLocation = WindowStartupLocation.CenterOwner;
        ResizeMode = ResizeMode.NoResize;
        Background = new System.Windows.Media.SolidColorBrush(System.Windows.Media.Color.FromRgb(0x1e, 0x1e, 0x24));

        var root = new StackPanel { Margin = new Thickness(20) };
        root.Children.Add(new TextBlock
        {
            Text = "Enter backup passphrase",
            Foreground = System.Windows.Media.Brushes.White,
            FontSize = 14,
            FontWeight = FontWeights.SemiBold,
            Margin = new Thickness(0, 0, 0, 6),
        });
        root.Children.Add(new TextBlock
        {
            Text = folderPath,
            Foreground = System.Windows.Media.Brushes.Gray,
            FontSize = 11,
            TextWrapping = TextWrapping.Wrap,
            Margin = new Thickness(0, 0, 0, 12),
        });
        _passwordBox = new PasswordBox
        {
            Height = 28,
            Margin = new Thickness(0, 0, 0, 16),
        };
        root.Children.Add(_passwordBox);

        var buttons = new StackPanel { Orientation = System.Windows.Controls.Orientation.Horizontal, HorizontalAlignment = System.Windows.HorizontalAlignment.Right };
        var cancel = new System.Windows.Controls.Button { Content = "Cancel", Width = 80, Margin = new Thickness(0, 0, 8, 0), IsCancel = true };
        cancel.Click += (_, _) => { DialogResult = false; Close(); };
        var ok = new System.Windows.Controls.Button { Content = "Unlock", Width = 80, IsDefault = true };
        ok.Click += (_, _) => { DialogResult = true; Close(); };
        buttons.Children.Add(cancel);
        buttons.Children.Add(ok);
        root.Children.Add(buttons);

        Content = root;
        Loaded += (_, _) => _passwordBox.Focus();
    }
}
