using System.Text.Json;

namespace BNDZShell.Bndz;

/// <summary>
/// Cold-start shell chrome (backdrop / Action Center) before React config hydrates.
/// Persisted under %LocalAppData%/BNDZ/shell-chrome.json.
/// </summary>
internal static class BndzShellChromeSettings
{
	private static readonly JsonSerializerOptions JsonOpts = new()
	{
		PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
		WriteIndented = true,
	};

	public static bool MicaBackdrop { get; private set; } = true;
	public static string BackdropKind { get; private set; } = "mica";
	public static bool NativeActionCenterToasts { get; private set; } = true;

	private static string SettingsPath =>
		Path.Combine(
			Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
			"BNDZ",
			"shell-chrome.json");

	public static void Load()
	{
		try
		{
			var path = SettingsPath;
			if (!File.Exists(path)) return;
			var dto = JsonSerializer.Deserialize<Dto>(File.ReadAllText(path), JsonOpts);
			if (dto is null) return;
			MicaBackdrop = dto.MicaBackdrop ?? true;
			BackdropKind = string.IsNullOrWhiteSpace(dto.BackdropKind) ? "mica" : dto.BackdropKind!.Trim();
			NativeActionCenterToasts = dto.NativeActionCenterToasts ?? true;
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] chrome settings load: {ex.Message}");
		}
	}

	public static void Save(bool? mica = null, string? kind = null, bool? nativeToasts = null)
	{
		if (mica.HasValue) MicaBackdrop = mica.Value;
		if (!string.IsNullOrWhiteSpace(kind)) BackdropKind = kind.Trim();
		if (nativeToasts.HasValue) NativeActionCenterToasts = nativeToasts.Value;
		try
		{
			var dir = Path.GetDirectoryName(SettingsPath);
			if (!string.IsNullOrEmpty(dir))
				Directory.CreateDirectory(dir);
			var dto = new Dto
			{
				MicaBackdrop = MicaBackdrop,
				BackdropKind = BackdropKind,
				NativeActionCenterToasts = NativeActionCenterToasts,
			};
			File.WriteAllText(SettingsPath, JsonSerializer.Serialize(dto, JsonOpts));
		}
		catch (Exception ex)
		{
			System.Diagnostics.Debug.WriteLine($"[BNDZShell] chrome settings save: {ex.Message}");
		}
	}

	private sealed class Dto
	{
		public bool? MicaBackdrop { get; set; }
		public string? BackdropKind { get; set; }
		public bool? NativeActionCenterToasts { get; set; }
	}
}
