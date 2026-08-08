// Copyright (c) BNDZ — Spacebar Quick Preview / Photo Studio for FilesMerge blend.

namespace Files.App.Services.PreviewPopupProviders;

/// <summary>
/// Always-available BNDZ Spacebar preview. Opens Photo Studio / Quick Preview
/// in the hosted React preview pane instead of QuickLook/Seer.
/// </summary>
internal sealed class BndzPreviewPopupProvider : IPreviewPopupProvider
{
	public static BndzPreviewPopupProvider Instance { get; } = new();

	/// <summary>Raised with (path, open). Toggle closes when the same path is pressed again.</summary>
	public static event Action<string, bool>? PreviewRequested;

	private string? _openPath;

	public Task TogglePreviewPopupAsync(string path)
	{
		var closing = !string.IsNullOrEmpty(_openPath)
			&& string.Equals(_openPath, path, StringComparison.OrdinalIgnoreCase);
		_openPath = closing ? null : path;
		PreviewRequested?.Invoke(path, !closing);
		return Task.CompletedTask;
	}

	public Task SwitchPreviewAsync(string path)
	{
		_openPath = path;
		PreviewRequested?.Invoke(path, true);
		return Task.CompletedTask;
	}

	public Task<bool> DetectAvailability() => Task.FromResult(true);
}
