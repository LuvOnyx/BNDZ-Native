# Plaque quality checklist

## Gate rule
Gather → review board (`review.html`) → checklist pass → then wire. No exceptions.

## Checklist
1. **Origin:** newly extracted or purpose-made for this wave (not leftover Hexigon / stub SVG)
2. **Craft:** professional illustration grade at `lg` empty (~112px) and still readable at `sm` dialog glyph (~44px)
3. **Native FM feel:** quiet functional art — not SaaS marketing hero, not cartoon filler
4. **Theme:** works on dark chrome; light variant available when needed
5. **Tabs:** strip materials + tab chip geometry reviewed at strip height (~28–40px)
6. **Menus:** only if crisp at ~16–28px header; else keep Icons8 (`PLAQUE_CONTEXT_MENU_ENABLED=false`)
7. **Budget:** prefer SVG; PNG when soft material needs it

## Audit — wave 0 (FAIL)
| Asset | Result | Why |
|-------|--------|-----|
| `idle-folder.svg` / `panel-idle.svg` / `tab-strip-grain.svg` / `menu-header-candidate.svg` | FAIL | Handmade, not professional grade → moved to `rejected/` |
| `hexigon-*.png` / `brand-mark.png` | FAIL as “new plaques” | Pre-existing reuse, not extracted/made for this wave → `candidates/legacy-hexigon/` |
| First review screenshot (~8 items) | FAIL | Too few; missing tabs/chrome pack |

## Audit — wave 1 candidates (PENDING visual pass)
| Pack | Count | Status |
|------|-------|--------|
| Gravity UI | 20 | Pending — strong empty/error starting point |
| unDraw | 100+ | Pending — includes `opened-tabs`, `close-tab`, `tabs`, browsers |
| chrome-tabs | 3 | Pending — geometry + strip rail |
| illlustrations curated | ~19 | Pending — secondary only |
| textures | 1 | Pending draft noise — likely needs better extract |

**Next:** open `public/plaques/review.html`, mark keep/kill per role (empty, error, search, tab strip, panel, transfer, menu), then promote keepers to kebab names under `public/plaques/` and wire.
