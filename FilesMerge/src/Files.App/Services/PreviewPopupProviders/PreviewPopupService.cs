// Copyright (c) Files Community
// Licensed under the MIT License.

namespace Files.App.Services.PreviewPopupProviders
{
	/// <inheritdoc cref="IPreviewPopupService"/>
	internal sealed partial class PreviewPopupService : ObservableObject, IPreviewPopupService
	{
		public async Task<IPreviewPopupProvider?> GetProviderAsync()
		{			
			// Prefer BNDZ Quick Preview / Photo Studio over third-party peek tools.
			if (await BndzPreviewPopupProvider.Instance.DetectAvailability())
				return BndzPreviewPopupProvider.Instance;
			if (await QuickLookProvider.Instance.DetectAvailability())
				return await Task.FromResult<IPreviewPopupProvider>(QuickLookProvider.Instance);
			if (await SeerProProvider.Instance.DetectAvailability())
				return await Task.FromResult<IPreviewPopupProvider>(SeerProProvider.Instance);
			if (await PowerToysPeekProvider.Instance.DetectAvailability())
				return await Task.FromResult<IPreviewPopupProvider>(PowerToysPeekProvider.Instance);
			else
				return null;
		}
	}
}
