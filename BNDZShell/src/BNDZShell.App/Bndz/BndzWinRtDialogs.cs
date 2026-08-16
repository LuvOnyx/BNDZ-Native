using Windows.Storage.Pickers;
using WinRT.Interop;

namespace BNDZShell.Bndz;

/// <summary>
/// Modern WinRT file / folder pickers (system FileOpenPicker / FileSavePicker / FolderPicker).
/// </summary>
internal static class BndzWinRtDialogs
{
	public static async Task<string[]> PickOpenFilesAsync(IntPtr hwnd, string? filter, bool multiselect = true)
	{
		var picker = new FileOpenPicker();
		InitializeWithWindow.Initialize(picker, hwnd);
		picker.SuggestedStartLocation = PickerLocationId.DocumentsLibrary;
		picker.ViewMode = PickerViewMode.List;
		ApplyFileTypeFilter(picker.FileTypeFilter, filter);

		try
		{
			if (multiselect)
			{
				var files = await picker.PickMultipleFilesAsync();
				if (files is null || files.Count == 0)
					return Array.Empty<string>();
				return files.Select(f => f.Path).Where(p => !string.IsNullOrWhiteSpace(p)).ToArray();
			}

			var file = await picker.PickSingleFileAsync();
			return file is null || string.IsNullOrWhiteSpace(file.Path)
				? Array.Empty<string>()
				: new[] { file.Path };
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] FileOpenPicker: {ex.Message}");
			return Array.Empty<string>();
		}
	}

	public static async Task<string?> PickSaveFileAsync(IntPtr hwnd, string? defaultPath, string? filter)
	{
		var picker = new FileSavePicker();
		InitializeWithWindow.Initialize(picker, hwnd);
		picker.SuggestedStartLocation = PickerLocationId.DocumentsLibrary;

		var choices = BuildSaveChoices(filter);
		foreach (var (name, exts) in choices)
			picker.FileTypeChoices[name] = exts;

		if (!string.IsNullOrWhiteSpace(defaultPath))
		{
			try
			{
				var name = Path.GetFileName(defaultPath);
				if (!string.IsNullOrWhiteSpace(name))
					picker.SuggestedFileName = name;
			}
			catch { /* suggested name is best-effort */ }
		}

		try
		{
			var file = await picker.PickSaveFileAsync();
			return file?.Path;
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] FileSavePicker: {ex.Message}");
			return null;
		}
	}

	public static async Task<string?> PickFolderAsync(IntPtr hwnd, string? _description = null)
	{
		var picker = new FolderPicker();
		InitializeWithWindow.Initialize(picker, hwnd);
		picker.SuggestedStartLocation = PickerLocationId.ComputerFolder;
		picker.FileTypeFilter.Add("*");

		try
		{
			var folder = await picker.PickSingleFolderAsync();
			return folder?.Path;
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] FolderPicker: {ex.Message}");
			return null;
		}
	}

	private static void ApplyFileTypeFilter(IList<string> target, string? filter)
	{
		target.Clear();
		foreach (var ext in EnumerateExtensions(filter))
		{
			if (!target.Contains(ext, StringComparer.OrdinalIgnoreCase))
				target.Add(ext);
		}
		if (target.Count == 0)
			target.Add("*");
	}

	private static List<(string Name, IList<string> Exts)> BuildSaveChoices(string? filter)
	{
		var result = new List<(string, IList<string>)>();
		if (string.IsNullOrWhiteSpace(filter))
		{
			result.Add(("All files", new List<string> { "." }));
			return result;
		}

		var parts = filter.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
		for (var i = 0; i + 1 < parts.Length; i += 2)
		{
			var name = parts[i];
			var exts = EnumerateExtensions(parts[i + 1])
				.Where(e => e != "*")
				.Select(e => e.StartsWith('.') ? e : "." + e.TrimStart('.'))
				.Distinct(StringComparer.OrdinalIgnoreCase)
				.ToList();
			if (exts.Count == 0)
				exts.Add(".");
			result.Add((name, exts));
		}

		if (result.Count == 0)
			result.Add(("All files", new List<string> { "." }));
		return result;
	}

	/// <summary>Win32 filter → WinRT extensions (".png" or "*").</summary>
	private static IEnumerable<string> EnumerateExtensions(string? filter)
	{
		if (string.IsNullOrWhiteSpace(filter))
		{
			yield return "*";
			yield break;
		}

		foreach (var chunk in filter.Split('|', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
		{
			foreach (var token in chunk.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
			{
				var t = token.Trim();
				var star = t.IndexOf('*');
				if (star < 0) continue;
				var pattern = t[star..].Trim();
				if (pattern is "*.*" or "*")
				{
					yield return "*";
					continue;
				}
				if (pattern.StartsWith("*.", StringComparison.Ordinal))
					yield return "." + pattern[2..];
				else if (pattern.StartsWith('.'))
					yield return pattern;
			}
		}
	}
}
