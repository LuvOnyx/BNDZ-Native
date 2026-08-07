# BNDZ-Native

**Repo:** [LuvOnyx/BNDZ-Native](https://github.com/LuvOnyx/BNDZ-Native)  
**Classic / official:** [LuvOnyx/BNDZ-1.0](https://github.com/LuvOnyx/BNDZ-1.0) — leave that product alone.

This repository is the **native + full BNDZ** line. It exists so classic BNDZ and the WinUI direction cannot be mixed by mistake.

## Target architecture (locked)

```text
WinUI / Files-derived shell  →  chrome, tabs, file list, navigation
BNDZBackend (full)           →  ALL services, IPC, plugins brain — no stubs
BNDZ React surfaces          →  hosted panes only (Automation, Spatial, plugins,
                                Command Deck, preview tools) — NOT the entire
                                classic FM layout nested inside Files
```

**Not the end state:** HWND-painting classic `BNDZ.exe` inside Files content (`BndzEmbedHost`). That was an A/B glue experiment only.

## Seed history

This repo was seeded from `BNDZ-1.0` branch `cursor/winui-native-shell-spike-1f6d` (FilesMerge vendor + full BNDZBackend + classic sources). Treat `FilesMerge/` as the WinUI shell starting point; evolve toward hosted BNDZ panes + full backend, not nested full-window embed.

## Build notes

- Classic BNDZ assets/backend: `npm run build` + `dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true`
- Files / WinUI shell: Windows only — .NET 10 + Windows App SDK (`FilesMerge/`, see `scripts/build-files-bndz-merge.ps1`)

## Separation rule

- Product work for **native direction** → this repo only  
- Product work for **classic official BNDZ** → `BNDZ-1.0` only  
