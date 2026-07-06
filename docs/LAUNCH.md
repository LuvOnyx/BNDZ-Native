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

Unsigned installers trigger Windows SmartScreen warnings. For production distribution, use an **OV** or **EV** Authenticode certificate.

### Obtain a certificate

| Type | SmartScreen | Typical use |
|------|-------------|-------------|
| **EV** | Fastest reputation build-up | Public downloads, best UX |
| **OV** | Slower warm-up | Internal / beta releases |
| Self-signed | Always warned | Dev only |

Recommended vendors: DigiCert, Sectigo, SSL.com (compare EV code signing pricing).

EV certs often require a hardware token (USB HSM). Plan 1–2 weeks for identity verification.

### Sign the release

Set **one** of:

```powershell
# Certificate in Windows store (thumbprint from certmgr.msc)
$env:BNDZ_SIGN_CERT_THUMBPRINT = "YOUR_THUMBPRINT_HERE"

# Or PFX file
$env:BNDZ_SIGN_PFX_PATH = "C:\certs\bndz.pfx"
$env:BNDZ_SIGN_PFX_PASSWORD = "your-password"
```

Build and sign:

```powershell
npm run package:signed
```

This signs `BNDZ.exe` and `BNDZ-Setup-1.0.0.exe` with SHA-256 + timestamp (DigiCert by default).

### Verify signature

```powershell
Get-AuthenticodeSignature "dist\BNDZ-Setup-1.0.0.exe"
Get-AuthenticodeSignature "dist\publish\win-x64\BNDZ.exe"
```

Status should be **Valid**. After EV signing, distribute the same build widely so SmartScreen reputation accumulates.

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

Generate customer license serials (must use the same `BNDZ_LICENSE_SECRET` as the retail build):

```powershell
$env:BNDZ_LICENSE_SECRET = "your-retail-secret-here"
npm run license:generate
# or: .\scripts\generate-license.ps1 -Count 25
```

Include in release notes:

- .NET 8 runtime bundled in the installer (self-contained publish)
- WebView2 installed automatically by the setup package
- Windows 10/11 x64
- 14-day trial; serial activation required after trial
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

