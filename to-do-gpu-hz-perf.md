# BNDZ Native Feel — GPU / Hz / Scroll Performance

**Bar:** Real GPU-backed paint at monitor Hz. Keep the UI (blur, gradients, shadows). Do **not** strip visuals to fake FPS.

## Honest GPU path (required)

WebView2 Chromium paints via D3D11/ANGLE on the user’s GPU when the adapter allows it. Host flags in `MainWindow.xaml.cs`:

- `--enable-gpu` / `--enable-gpu-rasterization` / `--enable-gpu-compositing` / `--enable-zero-copy`
- `--enable-features=CanvasOopRasterization`
- `--disable-frame-rate-limit` → compositor can follow monitor Hz (not Chromium’s soft 60 cap)
- `--disable-smooth-scrolling` → Explorer-like 1:1 wheel
- `--ignore-gpu-blocklist`
- Opaque `DefaultBackgroundColor` (no white compositor flash)
- WPF `RenderOptions.ProcessRenderMode = Default` (never force software host chrome)

**Flags alone are not proof.** Perf HUD merges:

1. Host CDP `SystemInfo.getInfo` (`GET_GPU_STATUS`) — devices, `gpu_compositing`, ANGLE `glRenderer`
2. Client WebGL `WEBGL_debug_renderer_info` — unmasked renderer string

Green **GPU / Direct3D11** (or D3D12) + named NVIDIA/AMD/Intel adapter = real hardware. Red **SOFTWARE** / SwiftShader / Basic Render Driver = cutting corners (driver/blocklist/remote session) — fix the environment, don’t gut CSS.

## What we keep for Hz without gutting UI

| Lever | Policy |
|---|---|
| Always-on virtualization | Threshold **1** — only paint visible rows |
| Icon decode | `decoding="async"` |
| Icon IPC while scrolling | Concurrency **2** (viewport jobs still prioritized); `html.bndz-scrolling` is HUD-only |
| Blur / gradients / shadows / adaptive density | **Kept** — GPU should composite them |

## Measure

Ctrl+Shift+Alt+P → Perf HUD: **fps**, **gpu** (GPU vs SOFTWARE), **adapter**, scroll active/idle, icon/thumb caches.

Target: fps ≈ monitor Hz while flinging a large folder with warm icons **and** glass/hover chrome still on.

## Still deferred (higher invasiveness)

- Serve icons via `bndz.local` URL stream instead of base64 IPC
- WebView2 `CompositionController` / DPI `RasterizationScale`
- ImageBitmap icon decode pipeline
