# BNDZ Studio Parity — Engines Under Existing UIs

**Strategy (locked):** Keep the Figma/ProDesign Design Board chrome and Photoshop Photo Studio chrome.
Replace fake Fabric / hand-rolled canvas2d **tool cores** with real engines from GitHub.
Do **not** mark a tool done because an icon, menu, or checkbox exists.

**Excalidraw:** Never shipped in this repo (only a SuperCmd keyword). Design Board stays Figma-class vector — not a whiteboard swap.

---

## Definition of done (per tool)

A tool is done only when **all** are true:

1. Interaction matches Figma or Photoshop (click / drag / Shift / Alt / Space / Enter / Esc)
2. Inspector / options bar changes the live result (not defaults-only)
3. Undo / redo restores correctly
4. Cursor + status update
5. Hosted in BNDZ: keys do not leak to the file list
6. Hand-tested; note date in the audit log below

Checkbox theater is forbidden. Unchecked = not done.

---

## Engine provenance

| Engine | Path | License | Role |
|--------|------|---------|------|
| [OpenPencil](https://github.com/open-pencil/open-pencil) | `external/open-pencil` | MIT | Design Board vector core (scene-graph, pen, CanvasKit) under existing Figma chrome |
| [OpenShop](https://github.com/SysAdminDoc/Openshop) | `external/openshop` | MIT | Photo Studio raster core (layers, brushes, pen, PSD) under existing PS chrome |

BNDZ hosts keep React wrappers: `DesignBoardPlugin.tsx`, `BndzPhotoStudio.tsx`, key bridge, pop-out, open/save IPC.
No sidecar admin UIs; no iframe of foreign default chrome as the product face.

---

## Design Board (Figma chrome + OpenPencil engine)

**Chrome (keep):** [`public/editors/bndz-design-board.html`](public/editors/bndz-design-board.html), [`src/components/plugins/DesignBoardPlugin.tsx`](src/components/plugins/DesignBoardPlugin.tsx)

**Engine mount:** workspace `#engine-frame` → `editors/engines/openpencil/` (OpenPencil Vue host). Fabric remains only for `?engine=fabric` fallback.

### Tool audit (unchecked until hand-proof)

- [ ] Move / Select (multi, deep, marquee)
- [ ] Frame (F) — clip + resize
- [ ] Rectangle (R) / Ellipse (O) — Shift 1:1, Alt from center
- [ ] **Pen (P)** — click nodes, drag bend handles, convert point, close on first, Enter finish, Esc cancel, edit after create
- [ ] Line / Arrow — A→B, Shift 45°, editable ends, live stroke color/width
- [ ] Pencil — freehand + stroke model
- [ ] Text (T)
- [ ] Image / Place
- [ ] Hand / Zoom
- [ ] Fill / Stroke inspector live-wired to engine (not Fabric-only state)
- [ ] Strip or real-wire fake prototype Cut/Fade/Slide chrome

---

## Photo Studio (PS chrome + OpenShop engine)

**Chrome (keep):** [`public/editors/bndz-photo-studio.html`](public/editors/bndz-photo-studio.html), [`src/components/preview/BndzPhotoStudio.tsx`](src/components/preview/BndzPhotoStudio.tsx)

**Engine mount:** React host bar + iframe `editors/engines/openshop/` (OpenShop embed protocol `openshop:*`). Legacy canvas2d studio: `?engine=legacy` → `bndz-photo-studio.html`.

### Tool audit (unchecked until hand-proof)

- [ ] Move
- [ ] Marquee / Lasso / Wand
- [ ] Brush / Pencil / Eraser (size, opacity, flow, tips)
- [ ] FG / BG live (flyout actually opens + paints next stroke)
- [ ] Gradient
- [ ] Pen / path family
- [ ] Layers (blend, opacity, mask)
- [ ] Clone / Heal
- [ ] Type
- [ ] Crop / Transform
- [x] Host open image / save PNG/JPEG / overwrite path

---

## Host / pop-out

- [x] Pop-out full-bleed; hard-kill matching `--plugin-window` before spawn; toast on fail
- [x] Key bridge traps studio shortcuts (`editorIframeKeys` + Design Board → OpenPencil forward)
- [x] `scripts/build-bndz-native.ps1` hard-kills `BNDZShell` / `BNDZ` before copy (throws if still locked)
- [x] `http://bndz.local` treated as secure for Web Crypto (OpenShop / CanvasKit)

---

## Audit log

| Date | Surface | Tool | Result | Notes |
|------|---------|------|--------|-------|
| 2026-08-14 | Design Board / OpenPencil | engine ready + setTool(pen) + setStyle | PASS (smoke) | `scripts/smoke-studio-engines.mjs` — 15 host tools mapped; status `style · OpenPencil` |
| 2026-08-14 | Photo Studio / OpenShop | embed hello/export + 34 tools | PASS (smoke) | Local `vendor/` Fabric/ag-psd/jsPDF; runtime capabilities exportFormats=7 |
| _(user hand-proof)_ | Design Board | Pen nodes/bends Figma test | pending | Place 4 nodes, drag handles, close, undo, inspector stroke |
| _(user hand-proof)_ | Photo Studio | Brush FG/BG | pending | FG flyout → next stroke; soft vs hard tip |

---

## Build order

1. Hard-kill → `npm run build` → Debug backend → `build-bndz-native.ps1`
2. Design Board: OpenPencil under chrome → Pen audit first
3. Photo Studio: OpenShop under chrome → Brush + FG/BG audit first
4. Pop-out + keys
5. Only then tick boxes above
