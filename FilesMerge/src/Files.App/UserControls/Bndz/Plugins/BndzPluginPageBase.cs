// Copyright (c) BNDZ - shared WinUI chrome builders for native plugin pages.

using CommunityToolkit.WinUI;
using Files.App.Utils.Bndz;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Windows.UI.Text;

namespace Files.App.UserControls.Bndz.Plugins;

internal interface IBndzPluginPage
{
	string PluginId { get; }
	void ApplySelection(BndzPluginSelection selection);
}

internal abstract class BndzPluginPageBase : UserControl, IBndzPluginPage
{
	protected BndzPluginSelection Selection { get; private set; } = BndzPluginSelection.Empty;
	protected TextBlock StatusText { get; private set; } = null!;
	protected TextBlock ContextText { get; private set; } = null!;
	protected Grid BodyHost { get; private set; } = null!;

	public abstract string PluginId { get; }
	protected abstract string Title { get; }
	protected abstract string Subtitle { get; }

	protected BndzPluginPageBase()
	{
		Content = BuildShell();
		Loaded += (_, _) => OnPageLoaded();
	}

	private UIElement BuildShell()
	{
		var root = new Grid { Padding = new Thickness(12, 10, 12, 10) };
		root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
		root.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
		root.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });

		var header = new StackPanel { Spacing = 2, Margin = new Thickness(0, 0, 0, 8) };
		header.Children.Add(new TextBlock
		{
			Text = Title,
			FontSize = 15,
			FontWeight = new FontWeight(600),
			Foreground = (Brush)Application.Current.Resources["BndzInkBrush"],
		});
		header.Children.Add(new TextBlock
		{
			Text = Subtitle,
			FontSize = 11,
			Foreground = (Brush)Application.Current.Resources["BndzInkMutedBrush"],
			TextWrapping = TextWrapping.WrapWholeWords,
		});
		Grid.SetRow(header, 0);
		root.Children.Add(header);

		ContextText = new TextBlock
		{
			FontSize = 11,
			Foreground = (Brush)Application.Current.Resources["BndzAccentBrush"],
			Margin = new Thickness(0, 0, 0, 6),
			TextTrimming = TextTrimming.CharacterEllipsis,
		};
		Grid.SetRow(ContextText, 1);
		root.Children.Add(ContextText);

		BodyHost = new Grid();
		Grid.SetRow(BodyHost, 2);
		root.Children.Add(BodyHost);

		StatusText = new TextBlock
		{
			FontSize = 11,
			Foreground = (Brush)Application.Current.Resources["BndzInkMutedBrush"],
			VerticalAlignment = VerticalAlignment.Bottom,
			Margin = new Thickness(0, 6, 0, 0),
		};
		return root;
	}

	protected void SetBody(FrameworkElement content)
	{
		BodyHost.Children.Clear();
		var grid = new Grid();
		grid.RowDefinitions.Add(new RowDefinition { Height = new GridLength(1, GridUnitType.Star) });
		grid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
		Grid.SetRow(content, 0);
		grid.Children.Add(content);
		StatusText.Margin = new Thickness(0, 8, 0, 0);
		Grid.SetRow(StatusText, 1);
		grid.Children.Add(StatusText);
		BodyHost.Children.Add(grid);
	}

	protected Button MakeChipButton(string label, RoutedEventHandler onClick)
	{
		var btn = new Button
		{
			Content = label,
			Style = (Style)Application.Current.Resources["BndzChipButtonStyle"],
			Margin = new Thickness(0, 0, 6, 6),
		};
		btn.Click += onClick;
		return btn;
	}

	protected static TextBox MakeField(string placeholder, string? text = null)
	{
		return new TextBox
		{
			PlaceholderText = placeholder,
			Text = text ?? string.Empty,
			MinWidth = 160,
			Margin = new Thickness(0, 0, 8, 6),
		};
	}

	protected void SetStatus(string message) => StatusText.Text = message;

	public void ApplySelection(BndzPluginSelection selection)
	{
		Selection = selection;
		ContextText.Text = FormatContext(selection);
		OnSelectionChanged();
	}

	protected virtual void OnPageLoaded() { }
	protected virtual void OnSelectionChanged() { }

	protected static string FormatContext(BndzPluginSelection s)
	{
		if (s.Count <= 0)
			return string.IsNullOrWhiteSpace(s.FolderPath) ? "Folder: (none) · No selection" : $"Folder: {s.FolderPath} · No selection";
		var names = string.Join(", ", s.Names.Take(3));
		if (s.Count > 3)
			names += $" +{s.Count - 3}";
		return string.IsNullOrWhiteSpace(s.FolderPath)
			? $"Selected ({s.Count}): {names}"
			: $"{s.FolderPath} · {s.Count} selected · {names}";
	}

	protected async Task RunBusyAsync(string busyLabel, Func<Task> work)
	{
		SetStatus(busyLabel);
		try
		{
			await work().ConfigureAwait(true);
		}
		catch (Exception ex)
		{
			SetStatus($"Error: {ex.Message}");
		}
	}
}
