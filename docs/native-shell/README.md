# BNDZ-Native — native shell notes

**Product shell:** `FilesMerge/` (vendored Files WinUI), branded **BNDZ-Native**.  
**Architecture:** #3 — Files owns chrome/list; full `BNDZBackend`; React as hosted panes. See root `BNDZ_NATIVE.md` and `FilesMerge/README_BNDZ.md`.

## Not the product path

| Artifact | Role |
|----------|------|
| `BndzEmbedHost` / `--embedded` | Historical A/B HWND glue — reference only |
| `BNDZ.exe --native-shell` | Earlier WPF banner experiment — not FilesMerge |
| `BNDZ.NativeShell.*` | Spike / progressive port — not the primary host |

## Build

```powershell
powershell -File scripts/build-files-bndz-merge.ps1
scripts\run-files-merge.cmd
```

WinUI build is **Windows-only** (.NET 10 + WASDK).
