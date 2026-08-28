# BNDZ Official Launch Checklist

Use this guide before publishing BNDZ 1.0.0 (or later) to end users.

## 1. Build the installer

**Requirements on the build machine:**

- Node.js 20+
- .NET 8 SDK
- [Inno Setup 6](https://jrsoftware.org/isinfo.php) (winget installs to `%LOCALAPPDATA%\Programs\Inno Setup 6\`; build scripts check that path too)
- ~2 GB free disk (NuGet + publish + WebView2 bootstrapper)

```powershell
cd "path\to\BNDZ 3.6.2"
npm run package:installer
```

Outputs:

| Artifact | Path |
|----------|------|
| Publish folder | `dist\publish\win-x64\` |
| Portable ZIP | `dist\BNDZ-win-x64-portable.zip` |
| Installer | `dist\BNDZ-Setup-1.0.0.exe` |

Verify artifacts:

```powershell
.\scripts\verify-release.ps1 -RequireInstaller
```

## 2. Test on a clean VM (no WebView2)

Create a fresh Windows 10/11 VM **without** Microsoft Edge WebView2 Runtime.

### VM smoke test

1. Copy `dist\BNDZ-Setup-1.0.0.exe` to the VM.
2. Run the installer (default options).
3. Confirm the installer shows **“Installing Microsoft Edge WebView2…”** when WebView2 is missing.
4. Launch BNDZ from the Start Menu.
5. Confirm the UI loads (not a blank window).
6. Open **Recycle Bin** from the navigation tree; right-click → **Empty Recycle Bin** → confirm modal.
7. Uninstall via Settings → Apps; confirm clean removal.

### If WebView2 install fails on the VM

- Manual bootstrapper: `installer\redist\MicrosoftEdgeWebview2Setup.exe`
- Or download: https://go.microsoft.com/fwlink/p/?LinkId=2124703

## 3. Code signing (SmartScreen trust)

Unsigned installers trigger Windows SmartScreen warnings ("Windows protected your PC"). For **public retail** distribution outside the Microsoft Store, you still need **Windows Authenticode** signing on `BNDZ.exe` and `BNDZ-Setup-*.exe`.

### Cursor Origin does **not** provide this certificate

[Cursor Origin](https://cursor.com/docs/origin) is Git hosting (repos, PRs, CI integrations with Vercel/Depot/Buildkite). Its "signing keys" are **Ed25519 API keys** for Origin app authentication and webhooks — they are **not** Authenticode / SmartScreen certificates and cannot sign your installer.

Use Origin for code + CI if you want; use one of the paths below for Windows trust.

### Choose a signing path

| Path | SmartScreen | Cost | Best for |
|------|-------------|------|----------|
| **Azure Trusted Signing** | Good (Microsoft-backed) | ~$10/mo | Indie retail, CI-friendly |
| **OV/EV Authenticode cert** | EV fastest reputation | $200–500+/yr | Traditional publisher |
| **Microsoft Store (MSIX)** | Store handles trust | Free re-sign | Store-only distribution |
| **Unsigned** | SmartScreen blocks most users | Free | Dev/internal only |

### Option A — Azure Trusted Signing (recommended)

1. Create an [Azure Trusted Signing](https://learn.microsoft.com/en-us/azure/trusted-signing/) account + certificate profile in Azure Portal.
2. Install tools on the **Windows release machine**:
   ```powershell
   winget install Microsoft.AzureCLI
   dotnet tool install -g --prerelease sign
   az login
   ```
3. Set environment variables (see `scripts/signing.config.example.env`):
   ```powershell
   $env:BNDZ_AZURE_SIGNING_ENDPOINT = "https://eus.codesigning.azure.net/"
   $env:BNDZ_AZURE_SIGNING_ACCOUNT = "YourSigningAccount"
   $env:BNDZ_AZURE_SIGNING_PROFILE = "YourProfile"
   ```
4. Verify: `.\scripts\check-signing-prereqs.ps1`
5. Build and sign: `npm run package:signed`

### Option B — Traditional certificate (PFX or cert store)

Set **one** of:

```powershell
# Certificate in Windows store (thumbprint from certmgr.msc)
$env:BNDZ_SIGN_CERT_THUMBPRINT = "YOUR_THUMBPRINT_HERE"

# Or PFX file (OV/EV from DigiCert, Sectigo, SSL.com, etc.)
$env:BNDZ_SIGN_PFX_PATH = "C:\certs\bndz.pfx"
$env:BNDZ_SIGN_PFX_PASSWORD = "your-password"
```

EV certs often require a hardware token (USB HSM). Plan 1–2 weeks for identity verification.

### Sign the release

```powershell
.\scripts\check-signing-prereqs.ps1
npm run package:signed
```

This signs `BNDZ.exe` **before** packaging and `BNDZ-Setup-1.0.0.exe` after Inno Setup, with SHA-256 + RFC3161 timestamp.

### Verify signature

```powershell
Get-AuthenticodeSignature "dist\BNDZ-Setup-1.0.0.exe"
Get-AuthenticodeSignature "dist\publish\win-x64\BNDZ.exe"
```

Status should be **Valid**. After EV or wide distribution, SmartScreen reputation accumulates.

### Origin + CI (optional)

Connect [Depot](https://depot.dev/blog/depot-in-cursor-origin) or Buildkite from your Origin repo's Apps tab for CI. Add a **Windows** pipeline step that runs `npm run package:signed` with signing secrets in CI — Origin itself does not sign binaries.

## 4. Pre-launch QA (recommended)

- [ ] First-run tutorial spotlights align with sidebar, filter bar, workspace, toolbar
- [ ] Virtualized navigation tree with deep folder expansion
- [ ] Everything search (`>` prefix) when Everything is installed
- [ ] Icon Studio: no IPC timeout spam after library edits
- [ ] Dual pane + column resize persistence
- [ ] Settings export/import on a second machine
- [ ] Install + uninstall on clean VM without WebView2

## 5. Distribution

Upload to your release channel:

- `BNDZ-Setup-1.0.0.exe` (primary)
- `BNDZ-win-x64-portable.zip` (optional, unsigned portable)

Generate customer license serials (must use the same `BNDZ_LICENSE_SECRET` as the retail build and Cloudflare Worker `LICENSE_HMAC_SECRET`).
`scripts/build-release.ps1` **fails** Release packaging if secrets are missing — it embeds:

- `BNDZ_LICENSE_SECRET` → `LicenseSecretEmbedded.Release.cs` (gitignored)
- `BNDZ_TOKEN_HMAC_SECRET` → `LicenseTokenSecretEmbedded.Release.cs` (gitignored; must match Worker `TOKEN_HMAC_SECRET`)

Activation is **online** (Cloudflare Worker + D1): one Windows PC per serial. Deactivate frees the seat. See `services/bndz-license-api/README.md`.

```powershell
$env:BNDZ_LICENSE_SECRET = "your-retail-secret-here"
$env:BNDZ_TOKEN_HMAC_SECRET = "your-token-hmac-secret-here"
npm run license:generate
# or: .\scripts\generate-license.ps1 -Count 25
```

Optional migration of older keys minted under a previous secret:

```powershell
$env:BNDZ_LICENSE_SECRET_LEGACY = "previous-secret"
```

Include in release notes:

- .NET 8 runtime bundled in the installer (self-contained publish)
- WebView2 installed automatically by the setup package
- Windows 10/11 x64
- 14-day trial; online serial activation required after trial (1 PC per serial)
- EULA shown during setup; Privacy + third-party licenses in Help → About

### Auto-update manifest (optional)

Host a `version.json` (see `docs/version.json.example`) and set `updateCheckUrl` in BNDZ settings or ship a default in your retail config backup. Users can check from **Help → Check for Updates** or **About BNDZ**.

## 6. Build commands reference

| Command | Description |
|---------|-------------|
| `npm run build` | Frontend only → `BNDZBackend/Assets/ui` |
| `npm run package` | Publish + portable ZIP |
| `npm run package:installer` | Above + Inno Setup installer |
| `npm run package:signed` | Installer + Authenticode signing |
| `npm run license:generate` | Generate BNDZ-XXXX-XXXX-CCCC serials |
| `.\scripts\verify-release.ps1` | Validate publish/installer artifacts |
| `.\scripts\sign-release.ps1 -Files @(...)` | Sign arbitrary files |

