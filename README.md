# BNDZ 1.0 — Windows File Manager

BNDZ is a modern, dual-pane file manager for Windows 10/11 with native shell integration, rich previews, extension plugins, and deep customization.

## Highlights

- **Dual-pane workspace** with tabs, column resize, and synced navigation
- **Native shell** context menus, icons, thumbnails, and file operations
- **Shift + hover tooltips** — instant file metadata without UI clutter
- **Extension Hub** — Folder Sync, Storage Cleanup, Icon Studio, Batch Rename, and more
- **Everything search** integration (`>` prefix in filter bar)
- **Offline licensing** — activate with serial from Help → Register

## Requirements

| Component | Notes |
|-----------|--------|
| Windows 10/11 x64 | Primary target |
| .NET 8 Runtime | Framework-dependent publish |
| WebView2 | Installed automatically by setup |

## Development

```powershell
cd "BNDZ 3.6.2"
npm install
npm run dev          # Web preview + API server
```

Native host:

```powershell
cd BNDZBackend
dotnet run
```

Build UI into backend assets:

```powershell
npm run build
```

## Release packaging

```powershell
npm run package              # Portable ZIP + publish folder
npm run package:installer    # + Inno Setup installer
npm run package:signed       # + Authenticode (set BNDZ_SIGN_* env vars)
npm run package:verify       # Validate artifacts
```

See [docs/LAUNCH.md](docs/LAUNCH.md) for the full launch checklist.

## License keys (vendor)

Generate serials for customers (match `LicenseSecret` in `BNDZBackend/Services/LicenseService.cs`):

```powershell
.\scripts\generate-license.ps1 -Count 10
```

Format: `BNDZ-XXXX-XXXX-CCCC`

## Version

**1.0.0** — Official release

© BNDZ. All rights reserved.
