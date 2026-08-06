# BNDZ Native Shell Spike

**Branch:** `cursor/winui-native-shell-spike-1f6d`  
**Goal:** Leave WebView2 chrome by standing up a **native** Files-*like* shell, then port BNDZ content modules into it — **without** cloning/merging `files-community/Files`.

## Decision locked on this branch

| Do | Don't |
|----|--------|
| Thin native host (sidebar / tabs / omnibar / list / preview) | Soft-fork Files.App |
| Reuse portable domain (`BNDZ.NativeShell.Core`) | Graft React/WebView2 into WinUI |
| Port modules one at a time behind contracts | Big-bang rewrite of all plugins |
| Keep classic BNDZ proportions 17 / 71 / 12 | Copy Files assets or XAML dumps |

XYplorer density remains a **product** choice for later chrome density — not a reason to stay on WebView2.

## Projects

| Project | Role | Build where |
|---------|------|-------------|
| `BNDZ.NativeShell.Core` | Portable FS contracts + `ShellViewModel` | Any OS (`net8.0`) |
| `BNDZ.NativeShell.Core.Tests` | Catalog / VM coverage | Any OS |
| `BNDZ.NativeShell.Host` | **WPF native comparison host** (no WebView2) | Windows (`EnableWindowsTargeting`) |
| `BNDZ.NativeShell` | **WinUI 3 destination shell** | Windows + Windows App SDK |

Existing `BNDZBackend` + React `src/` are **unchanged** on this branch so you can F5 both stacks side by side.

## Run (Windows)

```powershell
# Shared domain + tests (also works on CI Linux)
dotnet test BNDZ.NativeShell.Core.Tests/BNDZ.NativeShell.Core.Tests.csproj -c Debug

# Comparison host — native WPF, zero WebView2
dotnet build BNDZ.NativeShell.Host/BNDZ.NativeShell.Host.csproj -c Debug -p:EnableWindowsTargeting=true
# then run: BNDZ.NativeShell.Host\bin\Debug\net8.0-windows10.0.19041.0\BNDZ.NativeShell.Host.exe

# Destination WinUI shell (needs Windows App SDK workload)
dotnet build BNDZ.NativeShell/BNDZ.NativeShell.csproj -c Debug
```

Main WebView2 app remains:

```powershell
npm run build
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
```

## Module port order

1. **Shell chrome** — tabs, omnibar, sidebar, list, preview layout ✅ (this spike)
2. **Navigation** — drives + folder listing via `IFolderCatalog` / `IDriveCatalog` ✅ (local IO; swap for `ShellFolderEnumerator`)
3. **Preview** — `IPreviewBuilder` ✅ (local metadata; swap for Property Store / `FilePreviewMetaService`)
4. **Shell file ops** — wire `NativeShellFileOperationService` / Vanara `IFileOperation`
5. **Search** — Everything / Windows Search / `BndzFileIndexService`
6. **Plugins** — Command Deck + bottom plugins, starting with Find / Drop Stack / Action Log
7. **Pillars** — RAM Staging, GhostLink, Automation, Spatial, … one service + one native surface at a time

Each step replaces a Core adapter; the shell XAML should not grow IPC/HTML.

## Files reference policy

- Clone `files-community/Files` locally under `external/files` (gitignored) if you want to **look** at layout/omnibar/shelf patterns.
- Port craft into BNDZ XAML/tokens — never paste Files pages or take a runtime dependency on Files.App.
- Same rule as Spacedrive: UX reference only.

## Why two hosts?

- **Host (WPF):** builds with the same Windows-targeting path you already use for `BNDZBackend`, so you can compare “WebView2 main” vs “native XAML” immediately.
- **WinUI:** the intended long-term shell once App SDK packaging/signing is settled.

Both bind the same `ShellViewModel`.
