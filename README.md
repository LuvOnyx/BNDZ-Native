# BNDZ-Native

**Repo:** [LuvOnyx/BNDZ-Native](https://github.com/LuvOnyx/BNDZ-Native)  
**Classic / official product:** [LuvOnyx/BNDZ-1.0](https://github.com/LuvOnyx/BNDZ-1.0) — leave that line alone.

This repo is the **native + full BNDZ** product: a Files-derived WinUI shell, full `BNDZBackend`, and BNDZ React surfaces hosted as panes — not a nested classic WebView2 FM inside Files.

See [BNDZ_NATIVE.md](BNDZ_NATIVE.md) for the locked architecture.

## Architecture (locked #3)

| Layer | Owns |
|-------|------|
| **FilesMerge** (WinUI / Files) | Title bar, tabs, sidebar, omnibar, file list |
| **BNDZBackend** | All services, IPC, plugins brain — no stubs |
| **React (`src/`)** | Hosted panes only: Automation, Spatial, plugins, Command Deck, preview tools |

**Rejected as product:** full-window HWND embed of classic `BNDZ.exe` (`BndzEmbedHost`). Keep for reference only.

## Build & run (Windows)

Requires **.NET 10 SDK** + **Windows App SDK** for the WinUI shell. Linux cannot compile Files XAML.

```powershell
# Primary: BNDZ-Native shell + warm backend assets
powershell -File scripts/build-files-bndz-merge.ps1
scripts\run-files-merge.cmd
```

Backend / React only:

```powershell
npm run build
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
```

Classic `BNDZ.exe` on this machine (reference): `scripts\run-classic.cmd`

## Phase 1–2 (current)

- FilesMerge is the primary host, branded **BNDZ-Native**
- Default UX = native Files chrome + file list (no nested classic FM)
- Shell starts `BNDZ.exe --backend-host` and shows a status chip when the full brain is connected
- Phase 3: hosted React panes (Automation, Spatial, plugins, Command Deck, preview)

## Requirements

| Component | Notes |
|-----------|--------|
| Windows 10/11 x64 | WinUI shell + backend |
| .NET 10 + WASDK | FilesMerge |
| .NET 8 (Windows targeting) | BNDZBackend |
| Node / npm | React asset build → `BNDZBackend/Assets/ui` |
| WebView2 | Hosted panes (Phase 3) and classic reference exe |

## License

Files under `FilesMerge/` — MIT (files-community/Files). BNDZ product code outside that tree — BNDZ license/structure.

© BNDZ. All rights reserved.
