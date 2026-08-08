// Copyright (c) BNDZ — typed helpers over BndzBackendClient.

using System.Text.Json;

namespace Files.App.Utils.Bndz;

internal static class BndzIpcHelpers
{
	public static async Task<JsonElement?> InvokePayloadAsync(string type, object? payload = null, int timeoutMs = 15000, CancellationToken ct = default)
	{
		try
		{
			using var doc = await BndzBackendClient.InvokeAsync(type, payload, Math.Min(timeoutMs, 120000), ct).ConfigureAwait(false);
			if (doc is null)
				return null;
			var root = doc.RootElement.Clone();
			if (root.TryGetProperty("payload", out var p))
				return p.Clone();
			return root;
		}
		catch
		{
			return null;
		}
	}

	public static string? GetString(JsonElement el, string name)
	{
		if (!el.TryGetProperty(name, out var p))
			return null;
		return p.ValueKind switch
		{
			JsonValueKind.String => p.GetString(),
			JsonValueKind.Number => p.ToString(),
			JsonValueKind.True => "true",
			JsonValueKind.False => "false",
			_ => p.ToString(),
		};
	}

	public static bool GetBool(JsonElement el, string name, bool fallback = false)
	{
		if (!el.TryGetProperty(name, out var p))
			return fallback;
		return p.ValueKind switch
		{
			JsonValueKind.True => true,
			JsonValueKind.False => false,
			JsonValueKind.String => bool.TryParse(p.GetString(), out var b) && b,
			_ => fallback,
		};
	}
}

/// <summary>Selection / folder context pushed into WinUI plugin pages.</summary>
internal sealed record BndzPluginSelection(
	string? FolderPath,
	IReadOnlyList<string> Paths,
	IReadOnlyList<string> Names,
	IReadOnlyList<string> Types)
{
	public static BndzPluginSelection Empty { get; } = new(null, [], [], []);

	public int Count => Paths.Count;
	public bool HasFolderSelected => Types.Any(t => string.Equals(t, "directory", StringComparison.OrdinalIgnoreCase));
	public string? FirstPath => Paths.Count > 0 ? Paths[0] : null;
	public string? FirstName => Names.Count > 0 ? Names[0] : null;
	public string? FirstExt => FirstPath is null ? null : SystemIO.Path.GetExtension(FirstPath);
}
