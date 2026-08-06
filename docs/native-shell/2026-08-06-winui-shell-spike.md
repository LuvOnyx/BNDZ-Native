# Native shell spike — dual complete versions

## Problem

Need two builds you can fully test: classic WebView2 BNDZ vs native-shell direction — without dropping BNDZ content/UI.

## Delivered

1. **Classic** — `BNDZ.exe` (unchanged product surface)
2. **Native Shell** — `BNDZ.exe --native-shell` (same full React UI + Files-like host chrome; separate mutex for side-by-side)
3. Launchers: `scripts/run-classic.cmd`, `scripts/run-native-shell.cmd`
4. Build: `scripts/build-compare-versions.ps1`
5. Core/WinUI projects remain for progressive chrome port (not required to test features today)

## Non-goals

- Soft-fork Files.App
- Rewriting all React into XAML before compare
