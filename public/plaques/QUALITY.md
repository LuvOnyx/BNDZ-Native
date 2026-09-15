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
| Error | `error-dark.svg` / `error-light.svg` (Gravity UI) |
| Not found | `not-found-*.svg` (Gravity UI) |
| Search empty | `search-empty-*.svg` (Gravity UI) |
| Access / question | `access-denied-*.svg` (Gravity UI) |
| Panel idle | `unable-display-*.svg` (Gravity UI) |
| Idle / no data | `no-data.svg` (unDraw, no people, accent baked) |
| Warn | `warning.svg` ← `document-warning.svg` (object only; people `warning`/`void` quarantined) |
| Transfer | `data-transfer.svg` (unDraw, no people, accent baked) |
| Tabs empty | `tab-empty.svg` (custom FM chips) |
| Tab chrome | `tab-active*.svg`, `tab-inactive*.svg`, `tab-strip*.svg` |
| Brand | `brand-mark.png` |
| History | `history-dark.svg` (Gravity UI clipboard — Action History empty) |

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
