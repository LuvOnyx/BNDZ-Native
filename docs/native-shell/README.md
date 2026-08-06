# BNDZ Native Shell — two complete versions

**Branch:** `cursor/winui-native-shell-spike-1f6d`

## What you can test

| Version | How to launch | What you get |
|---------|---------------|--------------|
| **Classic** | `scripts\run-classic.cmd` or `BNDZ.exe` | Full BNDZ (all plugins, Automation, Spatial, IPC) — WebView2 full-bleed |
| **Native Shell** | `scripts\run-native-shell.cmd` or `BNDZ.exe --native-shell` | **Same full BNDZ UI/content** + Files-like native host chrome banner |

Both share one React build and one `BNDZ.exe`. Native shell uses a **separate single-instance mutex**, so you can run classic and native **side by side**.

## Build (Windows)

```powershell
powershell -File scripts/build-compare-versions.ps1
```

Or manually:

```powershell
npm run build
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
```

## Route (still true)

- Do **not** soft-fork `files-community/Files`
- Native shell today = host chrome + full product WebView (complete testability)
- Next ports: swap React chrome for native sidebar/list/preview via `BNDZ.NativeShell.Core` contracts (`BackendPortMap.cs`)
- `BNDZ.NativeShell` (WinUI) remains the long-term destination shell project

## Projects

| Project | Role |
|---------|------|
| `BNDZBackend` | One exe — classic **or** `--native-shell` |
| `BNDZ.NativeShell.Host` | Launcher trampoline → `BNDZ.exe --native-shell` |
| `BNDZ.NativeShell.Core` | Portable adapters for future chrome ports |
| `BNDZ.NativeShell` | WinUI 3 destination (build on Windows + App SDK) |

## Why WebView stays in native shell (for now)

Porting ~128k LOC of React UI into XAML before you can A/B test would block comparison. This branch gives you **two fully featured builds today**; chrome ownership migrates module-by-module without dropping features.
