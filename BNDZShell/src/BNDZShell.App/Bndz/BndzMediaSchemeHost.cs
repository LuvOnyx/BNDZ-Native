// Copyright (c) BNDZ — WinUI host for CAS icon/thumb PNGs (mirrors BndzMediaScheme.Serve).
// WinUI CreateWebResourceResponse requires IRandomAccessStream, not the WPF MemoryStream path.

using System.IO;
using System.Runtime.InteropServices.WindowsRuntime;
using BNDZ.Services;
using Microsoft.Web.WebView2.Core;
using Windows.Storage.Streams;

namespace BNDZShell.Bndz;

/// <summary>
/// Serves <c>bndz-media://cas/{hash}.png</c> from the host CAS disk cache.
/// Must be registered as a custom scheme — folder mapping on bndz.local never fires WebResourceRequested.
/// </summary>
internal static class BndzMediaSchemeHost
{
	private const string CorsHeaders =
		"Access-Control-Allow-Origin: http://bndz.local\r\n" +
		"Access-Control-Allow-Methods: GET, OPTIONS\r\n" +
		"Access-Control-Allow-Headers: *\r\n";

	public static CoreWebView2CustomSchemeRegistration CreateRegistration()
	{
		var scheme = new CoreWebView2CustomSchemeRegistration(BndzMediaScheme.CustomScheme)
		{
			TreatAsSecure = 1,
			HasAuthorityComponent = true,
		};
		scheme.AllowedOrigins.Add("http://bndz.local");
		scheme.AllowedOrigins.Add("https://bndz.local");
		return scheme;
	}

	public static void Serve(CoreWebView2Environment env, CoreWebView2WebResourceRequestedEventArgs e)
	{
		if (string.Equals(e.Request.Method, "OPTIONS", StringComparison.OrdinalIgnoreCase))
		{
			e.Response = env.CreateWebResourceResponse(
				EmptyRas(), 204, "No Content",
				CorsHeaders + "Content-Length: 0");
			return;
		}

		var hash = BndzMediaScheme.ParseHash(e.Request.Uri);
		using var fileStream = BndzMediaDiskCache.Instance.OpenCasStreamByHash(hash ?? "");
		if (fileStream is null)
		{
			e.Response = env.CreateWebResourceResponse(
				EmptyRas(), 404, "Not Found",
				CorsHeaders + "Content-Type: text/plain\r\nContent-Length: 0");
			return;
		}

		var ms = new MemoryStream(capacity: (int)Math.Min(fileStream.Length, 8 * 1024 * 1024));
		fileStream.CopyTo(ms);
		var len = ms.Length;
		ms.Position = 0;
		e.Response = env.CreateWebResourceResponse(
			ms.AsRandomAccessStream(), 200, "OK",
			CorsHeaders +
			"Content-Type: image/png\r\n" +
			$"Content-Length: {len}\r\n" +
			"Cache-Control: public, max-age=31536000, immutable");
	}

	private static IRandomAccessStream EmptyRas()
		=> new MemoryStream().AsRandomAccessStream();
}
