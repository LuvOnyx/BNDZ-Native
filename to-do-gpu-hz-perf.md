# BNDZ Native Feel — GPU / Hz / Scroll Performance

**Bar:** Whole-app frame rate tracks monitor refresh (120/144/240 Hz). No “web app” paint lag.

## Current host GPU posture (already strong)

WebView2 Chromium flags in `MainWindow.xaml.cs`:
- `--enable-gpu` / `--enable-gpu-rasterization` / `--enable-gpu-compositing` / `--enable-zero-copy`
- `--enable-features=CanvasOopRasterization`
- `--disable-frame-rate-limit` → no Chromium 60fps soft-cap
- `--disable-smooth-scrolling` → Explorer-like 1:1 wheel
- `--ignore-gpu-blocklist`
- Opaque `DefaultBackgroundColor` (no white compositor flash)

## What still limited Hz (and what we changed)

| Bottleneck | Fix |
|---|---|
| Adaptive list density rewritten CSS vars mid-scroll | Default **off**; no row height transitions |
| Virtualization only after 80 rows | Threshold **1** — always virtualize |
| Gradient hover / glass blur over scrolling content | Solid hover; blur only in glass mode; blur killed while `html.bndz-scrolling` |
| Icon decode on virtual remount | `decoding="async"`; drop type-badge drop-shadow |
| Icon IPC during scroll | Queue concurrency **1** while scrolling (viewport jobs still prioritized) |

## Measure

Ctrl+Shift+Alt+P → Perf HUD shows **fps**, scroll active/idle, icon/thumb cache hits.

Target: fps ≈ monitor Hz while flinging a large folder list with icons warm.

## Still deferred (higher invasiveness)

- Serve icons via `bndz.local` URL stream instead of base64 IPC
- WebView2 `CompositionController` / DPI `RasterizationScale`
- ImageBitmap icon decode pipeline
