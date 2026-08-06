# BNDZ × Files merge — A/B branch

**Branch:** `cursor/winui-native-shell-spike-1f6d`  
**Vs:** `main` = classic WebView2 BNDZ

## Intent

Full Files (native WinUI FM) **merged with** full BNDZ content/UI on a side branch so you can decide which direction you prefer.

## How the merge works

1. `FilesMerge/` — vendored [files-community/Files](https://github.com/files-community/Files) (MIT), branded **BNDZ (Files Merge)**
2. Toolbar **BNDZ Workspace** — embeds real `BNDZ.exe --embedded` (complete product) into the Files content area via HWND reparent
3. **Files View** — back to native Files list/sidebar/omnibar

Classic BNDZ remains on this branch too (`scripts\run-classic.cmd`) for direct compare without switching git branches.

## Build (Windows only for Files)

```powershell
powershell -File scripts/build-files-bndz-merge.ps1
scripts\run-files-merge.cmd    # Files chrome + BNDZ Workspace button
scripts\run-classic.cmd        # classic BNDZ
```

Needs **.NET 10 SDK** + Windows App SDK (Files `global.json`).

## Not on main

This merge stays on the feature branch until you choose to adopt it.
