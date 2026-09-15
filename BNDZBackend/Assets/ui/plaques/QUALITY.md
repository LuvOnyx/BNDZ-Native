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

## Wave 0 — FAIL
| Asset | Result |
|-------|--------|
| Handmade idle/panel/grain/menu SVGs | FAIL → `rejected/` |
| Reused Hexigon PNGs as “new art” | FAIL → `candidates/legacy-hexigon/` |
| unDraw art with people/skin tones | FAIL → `candidates/undraw-with-people/` |

## Wave 1 keepers — PASS (approved to wire)
| Role | Keeper |
|------|--------|
| Folder empty | `folder-empty-dark.svg` / `folder-empty-light.svg` (Gravity UI) |
| Error | `error-dark.svg` / `error-light.svg` (Gravity UI) |
| Not found | `not-found-*.svg` (Gravity UI) |
| Search empty | `search-empty-*.svg` (Gravity UI) |
| Access / question | `access-denied-*.svg` (Gravity UI) |
| Panel idle | `unable-display-*.svg` (Gravity UI) |
| Idle / no data | `no-data.svg` (unDraw, no people) |
| Warn | `warning.svg` (unDraw, no people) |
| Transfer | `data-transfer.svg` (unDraw, no people) |
| Tabs empty | `tab-empty.svg` (custom FM chips, no people) |
| Tab chrome | `tab-active*.svg`, `tab-inactive*.svg`, `tab-strip*.svg` (custom soft FM shape) |
| Brand | `brand-mark.png` |

People-containing unDraw (`opened-tabs`, `close-tab`, etc.) are **not** wired.
