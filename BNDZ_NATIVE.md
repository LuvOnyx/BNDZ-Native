# BNDZ-Native

**Repo:** [LuvOnyx/BNDZ-Native](https://github.com/LuvOnyx/BNDZ-Native)  
**Classic / official:** [LuvOnyx/BNDZ-1.0](https://github.com/LuvOnyx/BNDZ-1.0) — leave that product alone.

This repository is the **native + full BNDZ** line. It exists so classic BNDZ and the WinUI direction cannot be mixed by mistake.

## Target architecture (locked)

```text
WinUI / Files-derived shell  →  chrome, tabs, file list, navigation, dock geometry
BNDZBackend (full)           →  ALL services, IPC, plugins brain — no stubs
BNDZ React surfaces          →  hosted panes: plugins dock (Command Deck + tools),
                                Automation, Spatial, Smart Tools, Hub, Config, preview
```

**Not the end state:** HWND-painting classic `BNDZ.exe` inside Files content (`BndzEmbedHost`). That was an A/B glue experiment only.

## Phase status

| Phase | Focus | Status |
|-------|--------|--------|
| **1** | FilesMerge = primary BNDZ-Native host; Files owns chrome/list; no full-window HWND embed as main UX | **Done** |
| **2** | Full BNDZBackend live via IPC from the WinUI shell (`BNDZ.exe --backend-host` + `BNDZ.Backend.Host` pipe) | **Done** |
| **3** | Host Automation, Spatial, plugins, Command Deck, preview as React panes (`BndzPaneHost`) | **Done** (hybrid — soft-switch, no full reload) |
| **4** | Product polish / ready-to-see: pane→shell navigate/tools, default Plugins+Preview, Smart Tools / Hub / Config panes, branded toggles | **Done** |
| **5** | Hybrid craft: Files geometry + Spatial-class React surfaces, dock resize, prop parity, instant open | **Active (full blend)** |
| **blend** | Files engines + BNDZ panes; no `?filesHost=1` takeover; Properties dock + Spacebar Photo Studio | **On `Files-BNDZ-full-blend`** |

Primary runnable shell: `FilesMerge/` (branded **BNDZ-Native**). See `FilesMerge/README_BNDZ.md`.

On launch the shell starts (or reconnects to) `BNDZ.exe --backend-host`. The host pipe speaks the **full** WebView IPC surface. Omnibar toggles Plugins / Smart Tools / Automation / Spatial / Hub / Config / Preview. The **Plugins** dock is hosted React (Command Deck + plugin bodies) flush into the Files grid row — same craft class as Spatial.

## Seed history

This repo was seeded from `BNDZ-1.0` branch `cursor/winui-native-shell-spike-1f6d` (FilesMerge vendor + full BNDZBackend + classic sources). Treat `FilesMerge/` as the WinUI shell starting point; evolve toward hosted BNDZ panes + full backend, not nested full-window embed.

## Build notes

- One-shot: `powershell -File scripts/build-files-bndz-merge.ps1` then `scripts\run-files-merge.cmd`
- Backend + React assets: `npm run build` + `dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true`
- Files / WinUI shell: Windows only — .NET 10 + Windows App SDK (`FilesMerge/`)
- CLI (`dotnet build`) needs the WinUI XamlCompiler ErrorMessages resource patch (`scripts/patch-xaml-compiler.ps1`); the merge script runs it automatically (works around [WMC9999](https://github.com/microsoft/microsoft-ui-xaml/issues/11157))
- Staged backend lives at `Files.exe`’s sibling folder `bndz-host\` (full WPF tree); the shell resolves that first for `--backend-host`

## Separation rule

- Product work for **native direction** → this repo only  
- Product work for **classic official BNDZ** → `BNDZ-1.0` only  
