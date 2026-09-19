# Plaque quality checklist

## Gate rule
Gather → review board → checklist pass → wire. Keepers only.

## Checklist
1. **Origin:** extracted or purpose-made for this wave (not leftover Hexigon / stub SVG)
2. **No people:** illustrations must be object/chrome only (folders, disks, UI, tabs)
3. **Craft:** readable at empty `lg` (~112px) and dialog `sm` (~44px)
4. **Native FM feel:** quiet functional art — not SaaS marketing heroes
5. **Tabs:** soft Explorer-like chips (rounded top, flush bottom) + strip rail
6. **Menus:** stay gated (`PLAQUE_CONTEXT_MENU_ENABLED=false`) until density pass
7. **Budget:** prefer SVG; brand mark may stay PNG
8. **`<img>` safe:** no live `currentColor` / CSS vars in wired keepers (accent baked)

## Wave 0 — FAIL
| Asset | Result |
|-------|--------|
| Handmade idle/panel/grain/menu SVGs | FAIL → `rejected/` |
| Reused Hexigon PNGs as “new art” | FAIL → `candidates/legacy-hexigon/` |
| unDraw art with people/skin tones | FAIL → `candidates/undraw-with-people/` (32) |

## Wave 1 keepers — PASS (approved + wired)
| Role | Keeper |
|------|--------|
| Folder empty | `folder-empty-dark.svg` / `folder-empty-light.svg` (Gravity UI) |
| Error | `fm-modal-error-*.png` (modal hero; Gravity error SVG retained as legacy) |
| Not found | `not-found-*.svg` (Gravity UI) |
| Search empty | `search-empty-*.svg` (Gravity UI) |
| Access / question | `access-denied-*.svg` (Gravity UI) |
| Panel idle | `unable-display-*.svg` (Gravity UI) |
| Idle / empty tray | `disk-dark.svg` / `disk-light.svg` (Gravity UI) — System Properties idle |
| Warn | `fm-modal-warn-*.png` (modal hero; SVG `warning.svg` retained as legacy) |
| Panel host / Preview idle | `unable-to-display-dark.svg` / `unable-to-display-light.svg` (Gravity UI) |
| Transfer | `fm-transfer-dark.svg` / `fm-transfer-light.svg` (custom dual-tray transfer) |
| Tabs empty | `tab-empty.svg` (custom FM chips) |
| Tab chrome | instrument chips `tab-active*.svg`, `tab-inactive*.svg`, `tab-strip*.svg` (bottom slit in CSS) |
| Brand | `brand-mark.png` |
| History | `history-dark.svg` (Gravity UI clipboard — Action History empty) |
| Quarantined web/office | `candidates/web-office/` (former unDraw/unable-display dumps) |

## QC session (2026-09-15)
| Check | Result | Evidence |
|-------|--------|----------|
| Skin/people scan on keepers | **PASS** | 0 skin hits; 32 quarantined |
| BndzPlaque path resolve | **PASS** | All tone paths exist |
| Tab CSS path resolve | **PASS** | strip + active/inactive L/D |
| currentColor bake for `<img>` | **PASS** | 15 SVGs baked to `#0078d4` |
| Real-size matrix xs→xl | **PASS** | `qc.html` dark + light |
| Soft FM tab strip mock | **PASS** | 40px rail dark + light |
| Objects-only empties | **PASS** | folder/search/tabs/transfer |
| Context menus | **GATED** | still off |
| `npm run build` | **PASS** | green |
| Debug `dotnet build` | **PASS** | 0 warn / 0 err |

Board: `public/plaques/qc.html`

### Follow-up (2026-09-15)
- Quarantined people art in `warning.svg` / `void.svg` → `candidates/undraw-with-people/`.
- Replaced wired warn keeper with object-only `document-warning.svg` published as `warning.svg`.

### Follow-up (2026-09-18) — PNG glass keepers + modal dress-up

Agreed: most-seen empties + modal heroes ship as **PNG** (SVG glass quarantined — fidelity bar too high for hand SVG).

| Surface | Keeper | Result |
|---------|--------|--------|
| Preview Inspector idle | `fm-glass-panel-dark/light.png` via `tone="panel"` | **PASS** |
| System Properties idle | `fm-glass-idle-dark/light.png` via `tone="idle"` | **PASS** |
| Warning / recycle confirm | `fm-modal-warn-*.png` via `tone="warn"` | **PASS** |
| Destructive / permanent delete | `fm-modal-error-*.png` via `tone="error"` | **PASS** |
| Modal atmospheric wash | `fm-modal-wash-{info,warn,destructive}.png` in `NativeDialogShell` | **PASS** — soft opacity overlay |

SVG glass idle/panel → `candidates/superseded-glass-svg/`. Gravity idle/panel remain in `candidates/superseded-gravity-idle/`.

| Check | Result |
|-------|--------|
| Origin | Purpose-made BNDZ PNG craft (refs inspirational only) |
| No people | PASS (object/chrome) |
| `<img>` safe | PASS |
| NativeDialogShell wash + md plaque hero | wired for alert tones |
### Pre-check session (2026-09-18) — Fluent extract wave

| Check | Result |
|-------|--------|
| Wired `BndzPlaque` paths resolve (`public/plaques`) | **PASS** |
| PNG keepers true alpha (corner α=0) | **PASS** idle/panel/warn/error |
| `public` ↔ `Assets/ui/plaques` sync | **PASS** |
| Wash = CSS only (no PNG plate behind heroes) | **PASS** |
| People / skin heuristic | **PASS** — yellow warning triangles trip flesh heuristic (~88%); visual review = object only |
| `npm run build` + Debug `dotnet` | **PASS** |
| Native visual QC (delete confirm + empties click-through) | ☐ Windows |

Board: `public/plaques/idle-qc-2026-09-18.html`

### Follow-up (2026-09-18) — extract Fluent Emoji 3D (stop AI regen)

AI generation kept baking plates / wrong props. Switched to **extracted** Microsoft Fluent Emoji 3D (MIT) cutouts with real alpha.

| Surface | Keeper | Source |
|---------|--------|--------|
| Idle (Properties) | `fm-glass-idle-*.png` | Fluent `Information` |
| Panel (Preview) | `fm-glass-panel-*.png` | Fluent `Magnifying glass tilted left` |
| Warn (Recycle delete) | `fm-modal-warn-*.png` | Composite: Wastebasket + Warning |
| Error (Permanent delete) | `fm-modal-error-*.png` | Fluent `Warning` alone (no trash) |
| Modal wash | CSS radial gradients in `NativeDialogShell` | no PNG plate |

AI keepers → `candidates/superseded-ai-gen/`. Raw extracts → `candidates/fluent-emoji-3d/`.

| Check | Result |
|-------|--------|
| True alpha (corner 0) | PASS |
| No people | PASS |
| License | MIT (Fluent Emoji) + attribution in ATTRIBUTION.md |

### Follow-up (2026-09-18) — more Fluent empties

| Surface | Keeper | Source |
|---------|--------|--------|
| Folder empty | `fm-folder-empty-*.png` | Fluent Open file folder |
| Search empty | `fm-search-empty-*.png` | Fluent Magnifying glass tilted right |
| Question / access | `fm-question-*.png` | Fluent Prohibited |

Gravity SVGs → `candidates/superseded-gravity-empties/`.

### Follow-up (2026-09-18) — subject disambiguation

| Tone | Keeper subject | Notes |
|------|----------------|-------|
| panel | Fluent Framed picture | Preview idle — **not** a loupe |
| search | Fluent Magnifier | Search empty only |
| question | Fluent Red question mark | Help/conflict — **not** prohibited/deny |
| warn | Wastebasket + Warning **side-by-side** | Trash fully readable; warning is companion badge |
| error | Warning alone | Permanent delete — no trash |

### Follow-up (2026-09-18) — blue question + pin gather

- `fm-question-*.png` tinted to BNDZ `#0078D4` blue.
- Further plaque art **PINNED** — see `project-notes.md` (user gathering PC assets). Do not grind more AI/Fluent swaps until resume cue.
