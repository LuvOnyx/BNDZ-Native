# BNDZ-Native — shell notes

**Product shell:** `BNDZShell/` — WinUI 3 greenfield, branded **BNDZ-Native**.  
**Architecture:** one full BNDZUI face via `CraftPaneHost` (`?nativeShell=1`) + in-process `BndzIpcHost` / `BndzEmbeddedBackendHost`. See root `BNDZ_NATIVE.md`.

**Launch gate:** `scripts/run-bndz-native.cmd` / `BNDZShell.exe` only. Do not sign readiness on FilesMerge or classic WPF.

## Not the product path

| Artifact | Role |
|----------|------|
| `FilesMerge/` + `BNDZ.exe --backend-host` | Archived hybrid (architecture #3 experiment) — reference only |
| `BndzEmbedHost` / `--embedded` | Historical A/B HWND glue — reference only |
| `BNDZ.exe --native-shell` | Earlier WPF banner experiment |
| `BNDZ.NativeShell.*` | Spike / progressive port — not the primary host |
| Classic WPF `MainWindow` | `scripts/run-classic.cmd` reference |

## Build

```powershell
powershell -File scripts/build-bndz-native.ps1
scripts\run-bndz-native.cmd
```

WinUI build is **Windows-only** (.NET 10 + WASDK).

Archived FilesMerge (do not use for launch proof):

```powershell
powershell -File scripts/build-files-bndz-merge.ps1
scripts\run-files-merge.cmd
```
