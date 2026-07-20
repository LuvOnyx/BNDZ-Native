// Debug / fallback. Release may overwrite via build-release with a real token HMAC secret.
// Must match Cloudflare Worker secret TOKEN_HMAC_SECRET for offline token verification.
namespace BNDZ.Services;

internal static class LicenseTokenSecretEmbedded
{
    public const string Value = "";
}
