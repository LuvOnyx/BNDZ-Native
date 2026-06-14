# BNDZ Launcher

BNDZ Launcher is a **vanilla [Flow Launcher](https://github.com/Flow-Launcher/Flow.Launcher)** build (MIT) with:

- A custom plugin (`Flow.Launcher.Plugin.BNDZ`) — no core namespace/assembly renames
- Output-only white-labeling (exe name, icons, display strings in staged files)
- Named-pipe IPC to BNDZ File Manager

## Architecture

```
{install}/
  BNDZ.exe                         ← file manager (listens on pipe)
  BNDZLauncher/
    BNDZ.Launcher.exe              ← renamed Flow.Launcher.exe (assembly stays Flow.Launcher)
    Plugins/
      Flow.Launcher.Plugin.BNDZ/   ← keyword: bndz
```

### IPC protocol (`\\.\pipe\BNDZ.Launcher.IPC`)

JSON line messages from the plugin to BNDZ:

| action | fields | effect |
|--------|--------|--------|
| `show` | — | Focus BNDZ file manager |
| `open_path` | `path` | Open/navigate to path in BNDZ |

If BNDZ is not running, the plugin falls back to launching `BNDZ.exe` with `--open-path`.

## Build (strict order)

1. **Vanilla Flow** (core must compile unchanged):

```powershell
cd external\Flow.Launcher
dotnet build Flow.Launcher.sln -c Release
```

2. **BNDZ integration** (plugin + white-label staging):

```powershell
.\scripts\build-bndz-launcher.ps1
```

3. **BNDZ backend** (IPC server):

```powershell
cd BNDZBackend
dotnet build -c Release
```

## What we do NOT change in Flow source

- `Flow.Launcher.*` namespaces
- `SolutionAssemblyInfo.cs` (vanilla)
- `Constant.FlowLauncher` process/internal identifiers
- Localization generator inputs

## Safe white-labeling (staged output only)

`scripts/build-bndz-launcher.ps1` calls `scripts/apply-bndz-launcher-branding.ps1` after build:

- Renames `Flow.Launcher.exe` → `BNDZ.Launcher.exe`
- Copies BNDZ icon to `Images/app.png`, `Images/app.ico`, plugin `bndz.png`
- Replaces `Flow Launcher` → `BNDZ Launcher` in all staged `*.xaml` language files
- Patches embedded strings in `Flow.Launcher.dll` (welcome hero text, etc.)

Re-apply branding without rebuilding Flow:

```powershell
.\scripts\apply-bndz-launcher-branding.ps1 -LauncherDir "BNDZBackend\Assets\BNDZLauncher"
```

This updates icons (`Images/app.ico`, `app.png`), patches `BNDZ.Launcher.exe` taskbar icon, fixes settings strings in `Languages/*.xaml`, and patches compiled DLL strings.

For **tray icon** (embedded in `Flow.Launcher.dll`), run a full rebuild once so icons are compiled in:

```powershell
.\scripts\build-bndz-launcher.ps1
```


Then restart BNDZ Launcher (quit tray icon → relaunch from BNDZ or run `BNDZ.Launcher.exe` again).

## Unified BNDZ experience

BNDZ File Manager and BNDZ Launcher are configured as **one system**:

| Feature | Where |
|---------|--------|
| Enable/disable launcher | Configuration → General → **BNDZ Launcher** |
| Global hotkey (default `Alt + Space`) | Same tab — synced to `BNDZLauncher/UserData/Settings/Settings.json` |
| Theme sync | Same tab — maps BNDZ theme or generates `BndzSync.xaml` from custom colors |
| Hide launcher tray | Same tab — BNDZ tray is the single entry point |
| Exit together | Same tab — quitting BNDZ stops the launcher |
| Open launcher | Tools → BNDZ Launcher, `Ctrl+Shift+L` (in BNDZ), or global hotkey |
| Open file manager from launcher | Type `bndz` or `bndz C:\path` |

Launcher settings live in **portable mode** under `{install}/BNDZLauncher/UserData/` (not `%AppData%\FlowLauncher`), so they travel with the BNDZ install.

## Attribution

Flow Launcher — Copyright (c) Flow-Launcher contributors. MIT License.

Source: `external/Flow.Launcher/`
