# List header + marquee polish (Launch)

**Date:** 2026-07-19  
**Branch:** `Launch`  
**Goal:** Make details-view sort headers feel like a premium native Windows file manager control—not a web table—and remove the marquee crosshair so selection stays calm and intentional.

---

## Intent

BNDZ is positioning as an official native File Explorer *replacement*. Chrome in the list view must read as OS-grade UI: depth, restraint, and material—not flat Tailwind strips, generic pills, or “SaaS dashboard” headers.

Success looks like:

- Drag-selecting files never changes the cursor to a crosshair.
- Sort headers feel like a single machined control bar with inset segments.
- Active sort is obvious at a glance without shouting.
- Theme accent and surface tokens still drive color (no hard-coded one-off brand purple / cream / newspaper looks).

---

## 1. Marquee pointer

### Current behavior

- `.bndz-file-list-scroll` gets `cursor-crosshair` while marquee is active (`BNDZUI.tsx`).
- Marquee gutters / pads / trails set `cursor: crosshair` in `index.css`.

### Target behavior

- Keep the **default pointer** for the entire marquee gesture (idle, press, drag, release).
- Do not introduce grab / cell / special cursors for marquee surfaces.
- Marquee rectangle, hit testing, Shift/Ctrl selection semantics, and drag-vs-marquee intent logic stay unchanged.

### Implementation notes

- Remove `cursor-crosshair` class toggle on the list scroll container.
- Remove or neutralize `cursor: crosshair` rules on `.bndz-list-col-gutter`, `.bndz-list-marquee-trail`, `.bndz-list-marquee-pad`, and `.bndz-file-list-scroll.cursor-crosshair`.
- Prefer `cursor: inherit` / omit cursor so parent list defaults apply.

### Out of scope

- Changing marquee geometry, thresholds, or selection algorithms.
- Changing file-drag cursors (move/copy) outside marquee.

---

## 2. Sort headers — segmented native bar

### Direction (chosen)

**Segmented toolbar (option B)**, elevated to feel native and distinctive—not a plain HTML table header and not disconnected pill chips.

Discrete pill chips (option A) were rejected for launch: with reorder grips + resize handles + many columns, chips fragment the bar and read more “web component” than shell chrome.

### Visual design

Treat `.fs-list-header` as one continuous **shell control**:

1. **Bar shell**
   - Slightly recessed tray (subtle inset shadow + hairline top highlight).
   - Soft vertical material gradient using `--surface` / theme mixes—already partially present; refine so it feels milled, not flat `#222`.
   - Tight horizontal padding so segments sit inside the tray, not flush to the window edge.

2. **Segments (each column)**
   - Inset cells with small radius (`--bndz-radius-sm`), quiet internal padding.
   - Separators: soft 1px hairlines or micro-gaps—not heavy `|` / `#333` borders competing with grid lines.
   - Sortable segments: pointer cursor; hover lifts fill with a restrained accent mix (`color-mix` with `--accent`), not a harsh `#2a2a2a` slab.

3. **Active sort segment**
   - Distinct “selected segment” treatment: muted accent wash + thin accent underline or inset edge (Fluent-adjacent, BNDZ-specific).
   - Sort direction uses a compact chevron / caret glyph (CSS or small icon), not raw `▲`/`▼` text that looks like a demo page.
   - Inactive sortable columns show no direction glyph (current behavior).

4. **Chrome that must remain usable**
   - Reorder grip: still hover-revealed, still grab cursor.
   - Resize handle: still on the segment’s trailing edge; may use a thin accent wash on hover (already similar).
   - Column drag reorder drop indicators (before/after) preserved and restyled only if they clash with new segment chrome.
   - Icon gutter column stays a non-interactive spacer segment (no sort affordance).

5. **What “sexy / native replacement” means here**
   - Depth via light/shadow (1–2px), not glow stacks or neon.
   - Typography stays small and quiet (`~11px`), medium weight on active label only if needed.
   - No oversized rounded-full pills, no multi-layer drop shadows, no emoji, no purple-on-white defaults.
   - Must still look correct under `html[data-theme]` / appearance variants.

### Interaction (unchanged)

- Click sortable segment → `toggleSort` (respect view lock + press-moved threshold).
- Drag grip → reorder columns.
- Drag resize handle → column width.
- Right-click header → column picker.

### Implementation touchpoints

- Markup/classes: `src/components/BNDZUI.tsx` (details header block ~grid header).
- Styles: `src/index.css` (`.fs-list-header`, new segment classes e.g. `.bndz-list-col-header`, active/hover, theme overrides under `html[data-theme]`).
- Prefer CSS classes over long Tailwind utility strings for the new material so themes can override cleanly.

### Out of scope

- Changing sort algorithms or default sort settings.
- Redesigning list rows, filter chips, or search toolbar in this pass.
- Light-mode-only experiments beyond theme token correctness.

---

## 3. Follow-up after this lands

Once headers + marquee pointer ship on `Launch`, do a short product pass for other launch forget-ables (status bar, empty states, selection chrome consistency, first-run polish)—separate from this spec.

---

## 4. Verification

1. Details view: drag marquee on empty list chrome and between columns → cursor stays default; selection still works.
2. Click Name / Size / Modified → sort toggles; active segment styling tracks current column + direction.
3. Hover / drag reorder grip and resize handle still work.
4. Switch theme / accent → header bar and active segment still read correctly.
5. Toggle vertical grid lines setting → header separators don’t double-ugly with row grid lines.

---

## 5. Non-goals

- Rewriting list virtualization or column model.
- Matching Explorer pixel-for-pixel (inspiration, not clone).
- Shipping option A pill chips.
`)