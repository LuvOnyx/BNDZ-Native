# BNDZ-Native

**Repo:** [LuvOnyx/BNDZ-Native](https://github.com/LuvOnyx/BNDZ-Native)  
**Classic / official product:** [LuvOnyx/BNDZ-1.0](https://github.com/LuvOnyx/BNDZ-1.0) — leave that line alone.

**Ship binary:** **`BNDZShell`** only — WinUI greenfield hosting one full BNDZUI WebView2 face with in-process backend. See [BNDZ_NATIVE.md](BNDZ_NATIVE.md).

`FilesMerge/` (Files WinUI hybrid + `--backend-host` sidecar) is **archived reference** — not the launch gate, not the primary run target.

## Architecture (locked)

| Layer | Owns |
|-------|------|
| **BNDZShell** (WinUI) | Caption, tray, single `CraftPaneHost` (`?nativeShell=1`) |
| **BNDZCore / BndzIpcHost** | In-process services + IPC (no WPF `MainWindow` UI, no `--backend-host` sidecar) |
| **React (`src/`)** | Full BNDZUI — list, preview, plugins dock, Automation, Spatial, Config |

**Rejected as product:** FilesMerge hybrid as ship surface; HWND embed of classic `BNDZ.exe`; multi-WebView chrome islands.

## Build & run (Windows)

Requires **.NET 10 SDK** + **Windows App SDK**. Linux cannot compile WinUI XAML.

```powershell
# Primary: BNDZ-Native
powershell -File scripts/build-bndz-native.ps1
scripts\run-bndz-native.cmd
```

Backend / React assets only (every product turn):

```powershell
npm run build
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
```

| Launcher | Role |
|----------|------|
| `scripts\run-bndz-native.cmd` | **Product** — `BNDZShell.exe` |
| `scripts\run-classic.cmd` | Classic WPF reference |
| `scripts\run-files-merge.cmd` | **Archived** FilesMerge hybrid |

## Requirements

| Component | Notes |
|-----------|--------|
| Windows 10/11 x64 | WinUI shell + backend |
| .NET 10 + WASDK | BNDZShell |
| .NET 8 (Windows targeting) | BNDZBackend / BNDZCore |
| Node / npm | React asset build → `BNDZBackend/Assets/ui` (+ shell Assets) |
| WebView2 | Full BNDZUI face |

## License

Files under `FilesMerge/` — MIT (files-community/Files), archived reference. BNDZ product code outside that tree — BNDZ license/structure.

© BNDZ. All rights reserved.
