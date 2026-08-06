# Native shell spike — route

artifact_note: comparison branch implementation brief (not a ce-unified-plan)

## Problem

WebView2 chrome reads “web-appy.” Files looks modern/native. Merging Files while keeping BNDZ’s React UI is a contradiction.

## Route (implemented on this branch)

1. Stop putting new chrome investment into WebView2 for this experiment.
2. Do not graft web UI into a Files clone.
3. Spike a thin native shell (Files **topology**, BNDZ **brand/proportions**) and port content behind contracts.

## Delivered

- `BNDZ.NativeShell.Core` — portable domain
- `BNDZ.NativeShell.Host` — WPF native host (no WebView2)
- `BNDZ.NativeShell` — WinUI 3 destination host
- Tests for catalog + navigation VM
- Port roadmap in `docs/native-shell/README.md`

## Out of scope (intentionally)

- Soft-fork of files-community/Files
- Porting Automation / Spatial / full plugin marketplace in this spike
- Deleting the existing WebView2 product on `main`
