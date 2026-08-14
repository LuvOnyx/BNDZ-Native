# BNDZ Studio Parity Plan — Photoshop + Figma (exact tools + UI)

**Goal:** Photo Studio and Design Board should feel like real Photoshop / Figma — not toolbar skins with shallow handlers. Every listed tool must match the source app’s interaction model (drag rules, modifiers, options bar, undo, cursor, status feedback).

**Bar for “done” on a tool**
1. Interaction matches source app (click / drag / Shift / Alt / Space)
2. Options bar / inspector controls actually change the result
3. Undo / redo restores correctly
4. Cursor + status text update
5. Works while hosted in BNDZ (keys don’t leak to the file list)

**Current reality (2026-08-13 Design Board deepen)**
- Photo Studio: Dark/Light theme + host toggle; tip library wired into paint; Line Shift-snap + weight/arrows + **Pixels/Shape/Path modes + anti-alias**; heal stamps; gradient kinds; contiguous flood; blur/sharpen/smudge kernels; **dark checkerboard**, **workspace presets (localStorage)**, **menu ↑↓ Enter Esc**, **SVG tool glyphs**, **layer footer Dup/Merge/Flatten**, **expanded Preferences**, **brush preset grid**, **HSB color flyout dark polish**.
- Design Board: booleans, distribute, auto-layout + **min/max + per-side pad + counter-axis + absolute children**, stroke dash/cap/join, components (**reset override / swap / nested instance**), variables, **prototype Link modal + On click/Dbl + Cut/Fade/Slide + multi-hotspot run + Esc exit**; **outline stroke**, **constraints on frame resize**, **pixel grid + snap + 1/10px nudge**, **cosmetic presence chips**, **local color/text/effect styles**, **rulers + drag-to-guide**, **View menu snap/rulers**; **deep select**, **pen edit points**, **image fill/fit/crop**, **multi-page paste**, **per-corner radius**, **comment threads**; **gradient stop editor** (solid/linear/radial, add/move/remove stops); **typography** underline/strike/truncate + liga/tnum/smcp lite; **export panel** (1×/2×/3×, selection vs page, SVG viewBox crop).
- Photo Studio Core/Pro pass: collapsible panels + localStorage; opacity/fill/blend compositing; layer masks + paint-on-mask; Gaussian/Unsharp/Noise/Sharpen/Find Edges; Select Modify; Image Size/Canvas Size/Rotate/Flip; Fill/Stroke/Free Transform; rulers/guides/grid/snap; Layer Style lite; searchable shortcuts; crop delete-vs-hide; Move auto-select.
- Photo Studio (2026-08-13 cont.): **gradient stop editor** (add/move/remove, FG→BG, reverse); **adjustment layers lite** (Bright/Contrast, Levels, Curves lite, HSL, B&W, Exposure, Photo Filter, Invert, Posterize — recompute stack); **File New/Open/Save/Export/Close** dark dialogs; **custom dark `<select>` dropdowns**.
- Still Later: Select Subject AI, true PSD round-trip, Figma **variants** / **real multiplayer**.

---

## Phase 0 — UI foundation (both apps)

### Photo Studio UI (must include Dark Mode)
- [x] **Theme system:** Light (classic PS gray) + **Dark** (PS 2024-style dark gray `#2a2a2a` / `#383838` / `#1e1e1e`)
- [x] Persist theme in host settings / studio localStorage; host bar toggle
- [x] Title bar, menu bar, options bar, toolbar, panels, status bar all theme-aware
- [x] Scrollbars, inputs, selects, range sliders, checkboxes restyled for dark
- [x] Checkerboard for transparency updates for dark (subtler contrast)
- [x] Modal / dialog chrome: rounded dark panels, focus rings, primary/secondary/danger buttons
- [x] Dropdown menus: hover-chain, keyboard ↑↓ Enter Esc, separators, checkmarks, shortcuts column
- [x] Flyouts (tool groups, brush presets, color picker) match panel language
- [x] Context menus: same visual language as menus; edge-aware positioning
- [x] Toast / status: non-spammy, theme-aware, never covers options bar permanently
- [x] High-DPI icons / crisp tool glyphs (replace muddy unicode where needed)
- [x] Options bar always reflects active tool (no empty / stale controls)
- [x] Panels: Layers, Channels, Paths, Properties, Adjustments, Histogram, Navigator — collapsible, remember open state
- [x] Workspace presets: Essentials / Painting / Photography / Graphic Design (panel layouts)

### Design Board UI (Figma-like dark is default; polish pass)
- [x] Top bar menus with working items + shortcut columns
- [x] Floating tool rail with tooltips, active glow, overflow for secondary tools
- [x] Left: Pages + Layers (eye/lock/rename/drag reorder)
- [x] Right inspector sections: Position, Layout, Appearance, Stroke, Effects, Typography, Export
- [x] Zoom control ( %, Fit, Selection, 50/100/200 )
- [x] Multiplayer-looking presence chips optional (cosmetic only unless wired)
- [x] Modals: Export, Rename, Preferences — consistent dark craft
- [x] Context menu parity with Edit/Object menus

### Shared host chrome (React)
- [x] Photo Studio host bar: theme toggle, Undo/Redo, Save PNG/JPG, Overwrite, Save As, Close
- [x] Design Board host bar: Undo/Redo, Export, Expand/Dock, New; Esc docks
- [x] Key bridge remains rock-solid (Delete, tools, Ctrl combos)

---

## Phase 1 — Exact tool interaction specs (priority “must feel right”)

### A. Line tool (your example) — **both apps**

#### Figma Line (Design Board) — exact behavior
- [x] Click-drag creates a 2-point line from press → release
- [x] **Shift** constrains to 0° / 45° / 90° (and reflections)
- [x] Stroke color / weight / cap (butt / round / square) / dash from inspector
- [x] Endpoints editable after create (select + drag handles)
- [x] Rotation / length via inspector or handles
- [x] Snap to objects / pixel grid when Snap on (Design Board snap-to-grid on move/nudge)
- [x] Arrowheads optional (separate Arrow tool or stroke arrowheads)
- [x] Undo creates/deletes whole line object

#### Photoshop Line (Photo Studio) — exact behavior
- [x] Shape tool mode: **Shape / Path / Pixels** (options bar)
- [x] Drag on canvas; **Shift** = 45° increments
- [x] **Alt** = draw from center (where applicable for shapes; line from midpoint if we support)
- [x] Weight (px), color (FG), arrowheads start/end (options bar)
- [x] Anti-alias toggle for Pixels mode
- [x] Creates shape layer (Shape) or raster on active layer (Pixels) or work path (Path)
- [x] Options bar live preview of weight

### B. Other “exact behavior” tools — Figma (Design Board)

#### Move / Select (V)
- [x] Click select, Shift multi-add, drag marquee multi-select
- [x] Drag move; Shift constrains axis
- [x] Alt duplicate while drag
- [x] Resize/rotate handles; Shift keep aspect; Alt from center
- [x] Deep select (Ctrl/Cmd click through groups) — phase 2 if needed

#### Frame (F)
- [x] Drag to create frame; clips children
- [x] Nested frames; rename; fill background
- [x] Auto-layout later (Phase 3); Phase 1 = clip + background + resize

#### Rectangle (R) / Ellipse (O)
- [x] Drag create; Shift = 1:1; Alt = from center
- [x] Corner radius (rect) independent / uniform
- [x] Fill + stroke + independent opacity

#### Pen (P)
- [x] Click = corner point; click-drag = bezier handles (Figma-style)
- [x] Enter / double-click finish; Esc cancel
- [x] Close path by clicking first point
- [x] Bend tool / edit points after create (Phase 2 minimum viable: corner points + simple curves)

#### Text (T)
- [x] Click places text object; type immediately
- [x] Font family / size / weight / line height / letter spacing / align
- [x] Double-click to edit; Esc commit

#### Pencil
- [x] Freehand vector/path with smoothing slider
- [x] Stroke properties shared with line

#### Hand (H) / Zoom
- [x] Space temporary hand; scroll pan; Ctrl+scroll zoom to cursor
- [x] Zoom tool optional; Fit / Selection / 100%

#### Image / Place
- [x] Drag area then pick file, or Place into frame
- [x] Fill modes: fill / fit / crop (Phase 2)

### C. Other “exact behavior” tools — Photoshop (Photo Studio)

#### Brush (B) — real brush engine (not one round tip)
- [x] Tip shapes: Round Soft, Round Hard, Calligraphy, Spatter, Square, Airbrush
- [x] Size, Hardness, Opacity, Flow, Spacing
- [x] Blend mode on brush (Normal/Multiply/Screen/Overlay) must affect pixels
- [x] Brush preset panel with preview stamps (not 3 toast buttons)
- [x] `[` `]` size; Shift+`[` `]` hardness
- [x] Soft stamp path already started — extend into tip library + spacing

#### Pencil (B variant)
- [x] Hard 1px-capable aliased strokes; no softness

#### Eraser (E)
- [x] Brush / Pencil / Block modes
- [x] Opacity/flow; background eraser later

#### Clone Stamp (S)
- [x] Alt-click set source; aligned toggle; show source overlay crosshair
- [x] Source follows brush with offset

#### Gradient (G)
- [x] Linear / Radial / Angle / Reflected / Diamond
- [x] FG→BG, custom stops editor (Phase 2) — add/move/remove stops; drag uses stops
- [x] Reverse, dither, mode, opacity
- [x] Drag preview line; Shift constrain angle

#### Paint Bucket (G)
- [x] Contiguous toggle, tolerance, anti-alias, all-layers sample
- [x] Fill selection if present

#### Marquee (M)
- [x] Rect / Ellipse; Shift = 1:1; Alt = from center
- [x] Feather; anti-alias; new/add/subtract/intersect modes

#### Lasso (L)
- [x] Freehand; Polygonal (click corners); Magnetic later Phase 2

#### Crop (C)
- [x] Drag crop; rule-of-thirds overlays; Enter apply / Esc cancel
- [x] Delete cropped pixels vs hide (option)

#### Type (T)
- [x] Click for point text; drag for paragraph box (Phase 2)
- [x] Commit with Enter (Ctrl+Enter) / Esc cancel
- [x] Font size, color = FG

#### Move (V)
- [x] Move layer or selection contents; arrow nudge 1 / Shift 10
- [x] Auto-select layer option

#### Eyedropper (I)
- [x] Sample to FG; Alt sample BG; sample size 1/3/5 px
- [x] Updates color flyout + recent colors

#### Hand (H) / Zoom (Z)
- [x] Space hand; Ctrl+Space zoom; Ctrl+0 fit; Ctrl+1 100%

---

## Phase 2 — Full Photoshop tool inventory (implement to real behavior)

Mark each: **Core** (must), **Pro** (deepen), **Later** (parity backlog).

### Select & Mask
| Tool | Priority | Exact behavior notes |
|------|----------|----------------------|
| Rectangular Marquee | Core | Shift ratio, Alt center, mode add/sub |
| Elliptical Marquee | Core | same |
| Single Row/Column | Pro | 1px selection |
| Lasso | Core | freehand close |
| Polygonal Lasso | Core | click segments, dbl-click close |
| Magnetic Lasso | Later | edge detection |
| Object Selection | Later | subject-ish heuristic |
| Quick Selection | Pro | grow region by color/tone |
| Magic Wand | Core | tolerance, contiguous, sample all layers |
| Select Subject / Sky | Later | AI optional |
| Select and Mask workspace | Later | refine edge UI |

### Crop & Slice
| Tool | Priority | Notes |
|------|----------|-------|
| Crop | Core | overlays, ratio presets, straighten, delete vs hide pixels |
| Perspective Crop | Pro | 4-corner warp crop |
| Slice / Slice Select | Later | web slices |

### Measurement / sample
| Tool | Priority | Notes |
|------|----------|-------|
| Eyedropper | Core | |
| Color Sampler | Pro | up to 4 markers + info panel |
| Ruler | Pro | measure line + straighten |
| Note | Later | annotation pins |
| Count | Later | |

### Retouch
| Tool | Priority | Notes |
|------|----------|-------|
| Spot Healing | Pro | content-aware patch neighborhood |
| Healing Brush | Pro | sampled heal blend |
| Patch | Pro | source/dest patch |
| Content-Aware Move | Later | |
| Red Eye | Later | simple pupil darken OK for Pro |

### Painting
| Tool | Priority | Notes |
|------|----------|-------|
| Brush | Core | tip library + dynamics |
| Pencil | Core | |
| Mixer Brush | Later | true smear/mix |
| Color Replacement | Pro | hue replace under brush |
| Clone Stamp | Core | aligned |
| Pattern Stamp | Pro | tile pattern from defined pattern |
| History Brush | Pro | paint from snapshot |
| Art History Brush | Later | stylized history |

### Erase / Fill
| Tool | Priority | Notes |
|------|----------|-------|
| Eraser | Core | brush/pencil/block |
| Background Eraser | Pro | |
| Magic Eraser | Pro | wand-like erase |
| Gradient | Core | |
| Paint Bucket | Core | |
| 3D Material Drop | Later | drop or remove |

### Focus / tone
| Tool | Priority | Notes |
|------|----------|-------|
| Blur / Sharpen / Smudge | Pro | real kernel / liquify-lite smudge |
| Dodge / Burn / Sponge | Pro | tonal brush, not fake overlays only |

### Vector / type / shapes
| Tool | Priority | Notes |
|------|----------|-------|
| Pen family | Pro | bezier paths, convert point |
| Path Selection / Direct Selection | Pro | |
| Type H/V / Type Mask | Core/Pro | |
| Shape tools (rect/ellipse/triangle/polygon/line/custom) | Core | Shape/Path/Pixels modes |
| Custom Shape library | Later | |

### Navigate
| Tool | Priority | Notes |
|------|----------|-------|
| Hand / Rotate View / Zoom | Core | |

### Layers / Adjustments / Filters (menus + panels)
- [x] New / Dup / Delete / Group / Merge Down / Merge Visible / Flatten
- [x] Layer opacity + fill + blend modes (real compositing)
- [x] Layer mask create/enable/disable
- [x] Adjustment layers: Brightness/Contrast, Levels/Curves (lite), HSL, B&W, Exposure, Photo Filter, Invert, Posterize
- [x] Filters: Gaussian Blur, Unsharp, Noise, Sharpen, Find Edges (minimum set)
- [x] Edit: Fill, Stroke, Free Transform, Content-Aware Fill (lite), Preferences
- [x] Image: Image Size, Canvas Size, Rotate, Flip, Mode (RGB only OK)
- [x] Select: All/Deselect/Reselect/Inverse/Modify Expand/Contract/Feather
- [x] View: Rulers, Guides, Grid, Snap, Screen modes

### Photo Studio modals / dropdowns (upgrade list)
- [x] File New / Open / Save / Export / Close (dark PS chrome dialogs; file pick via host/local bridge)
- [x] Color Picker (HSB square + hue + RGB/HEX) — dark theme
- [x] Brush Preset picker (grid of tip previews)
- [x] Layer Style dialog (shadow/glow/stroke) — real parameters
- [x] Image Size / Canvas Size dialogs with units
- [x] Fill / Stroke dialogs
- [x] Preferences (theme, history states, cursor, GPU toggle placeholder)
- [x] Keyboard Shortcuts reference (searchable)
- [x] All `<select>` menus restyled; no native ugly white popups in dark mode if avoidable (custom `.ps-dd` dropdowns)

---

## Phase 3 — Full Figma tool / feature inventory (Design Board)

### Tools (toolbar)
| Tool | Priority | Exact behavior |
|------|----------|----------------|
| Move (V) | Core | select/move/resize/rotate |
| Frame (F) | Core | artboard + clip |
| Section | Later | organizational section |
| Rectangle (R) | Core | |
| Line (L) | Core | **exact Figma line** (Phase 1) |
| Arrow | Core | line + heads |
| Ellipse (O) | Core | |
| Polygon / Star | Core | sides / ratio inspector |
| Pen (P) | Core → Pro | bezier |
| Pencil | Core | smoothing |
| Text (T) | Core | |
| Hand (H) | Core | |
| Comment | Pro | pins + thread UI lite ✅ |
| Place Image | Core | |
| Slice / Scale | Later | export slices / scale tool |

### Object operations (must work like Figma)
- [x] Boolean: Union / Subtract / Intersect / Exclude
- [x] Flatten selection
- [x] Outline stroke
- [x] Group / Ungroup / Frame selection
- [x] Bring to front / forward / backward / back
- [x] Flip H/V; rotate 90/180
- [x] Lock / Unlock; Hide / Show
- [x] Duplicate (Ctrl+D); Copy/Paste/Paste here/Paste to replace
- [x] Align + distribute (selection vs parent frame)
- [x] Tidy up / smart selection bounds

### Inspector (Figma Design panel)
- [x] X/Y/W/H; constrain proportions
- [x] Rotation; corner radius (per-corner TL/TR/BL/BR)
- [x] Fill: solid, linear/radial gradient (**stop editor**: add/move/remove + live apply), image fill, multiple fills (solid/gradient path; multi-fill stack Later)
- [x] Stroke: weight, align inside/center/outside, dash, cap, join, multiple strokes
- [x] Effects: drop shadow, inner shadow, blur (layer/background)
- [x] Opacity + blend mode
- [x] Typography full stack (**underline / strikethrough**, **truncate …**, **liga/tnum/smcp lite**, LH/LS)
- [x] Export: **1×/2×/3× PNG**, SVG (**viewBox crop fidelity**), selection vs page panel (PDF later)

### Layout systems
- [x] **Auto Layout** (Core for “real Figma”): direction, gap, padding, hug/fill, wrapping
- [x] Auto Layout deepen: **per-side padding (T/R/B/L)**, **counter-axis align** (start/center/end), **absolute children** (skip reflow)
- [x] Constraints (left/right/top/bottom/center/scale) when parent resizes
- [x] Min/max size (Pro)

### Components & design system (Pro → Later)
- [x] Create Component / Instance
- [x] Overrides; detach
- [x] Reset override · Swap instance · Nested instance place (Pro deepen)
- [ ] Variants (Later)
- [x] Local styles: color / text / effect styles (color + text + effect styles + variables)
- [x] Variables (color vars wired)

### Canvas UX
- [x] Multi-page + paste across pages
- [x] Pixel grid / snap / nudge
- [x] Rulers + guides drag
- [x] Multiplayer cursors optional cosmetic (presence chips; not live cursors — Later for real sync)
- [x] Prototyping links (Link modal, On click / Dbl, Cut/Fade/Slide transitions, multi-hotspot run mode + Esc exit; variants/real multiplayer Later)

---

## Phase 4 — Smoothness / quality bar (both)

- [x] 60fps pan/zoom on large docs; no layout thrash
- [x] History capped + memory-safe snapshots
- [x] Cursor accuracy under DPI scaling
- [x] No key leaks to FM list while studio focused
- [x] Autosave / crash recovery (Design Board localStorage; Photo Studio optional PSD-lite JSON later)
- [x] Export fidelity: PNG/JPEG/SVG correctness
- [x] Accessibility: focus states, Esc closes menus/modals consistently
- [x] Automated smoke checklist script (open tool, drag, undo, export) — `scripts/smoke-studio-parity.py`

---

## Suggested build order (execute in sequence)

1. **Photo Studio Dark Mode + menu/modal restyle** (UI credibility)
2. **Line tool exact (Figma + PS)** — prove the “exact behavior” standard
3. **Brush tip library + blend modes that paint correctly**
4. **Figma stroke model (align/cap/dash) + boolean ops**
5. **Marquee/lasso/crop/type polish to exact modifiers**
6. **Gradient stop editor + Paint Bucket contiguous/tolerance**
7. **Pen bezier (both apps as appropriate)**
8. **Layers compositing correctness (blend/opacity/mask)**
9. **Auto Layout (Figma)**
10. **Retouch tools (heal/clone deepen)**
11. **Components / styles (Figma)**
12. **Long-tail / Later tools**

---

## Acceptance examples (how we’ll judge “exact”)

### Line (Figma)
- Drag 100px horizontal line → length 100, angle 0
- Hold Shift while dragging diagonally → snaps to 45°
- Change stroke 8px round cap → visible caps update live
- Undo removes the object; Redo restores position/stroke

### Line (Photoshop)
- Shape mode creates editable shape layer with stroke weight
- Pixels mode rasterizes onto active layer with anti-alias option
- Shift constrains angle; options bar weight changes next draw AND can update current shape when selected

### Brush (Photoshop)
- Soft round vs calligraphy tip leave visibly different stamps
- Opacity 40% + overlapping strokes accumulate correctly
- Blend Multiply darkens underlying pixels (not just CSS-looking overlay)

### Rectangle (Figma)
- Shift = square; Alt = from center; radius slider rounds corners live

---

## Tracking

Use this file as the source of truth. When implementing, check boxes in-place and note date/commit. Do not mark a tool done if only the icon/label exists.

**Related code**
- `public/editors/bndz-photo-studio.html`
- `public/editors/bndz-design-board.html`
- Hosts: `src/components/preview/BndzPhotoStudio.tsx`, `src/components/plugins/DesignBoardPlugin.tsx`
