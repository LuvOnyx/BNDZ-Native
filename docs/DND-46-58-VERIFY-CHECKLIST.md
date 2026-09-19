# DnD matrix 46–58 — short Windows verify (post-C4)

**When:** After any near-DnD change, and before claiming Launch Ready.  
**Binary:** `scripts\run-bndz-native.cmd` / `BNDZ.exe` only (not FilesMerge).  
**Evidence:** Flip ☐→☑ in [`fm-launch-readiness.md`](fm-launch-readiness.md) only with user-visible proof. Capture `%LocalAppData%\BNDZ\ole-dnd.log` snippets where noted.

## Prep (2 min)

1. Cold-start Native; open a folder with mixed files + one subfolder (e.g. Desktop or Downloads).
2. Clear or note tail of `ole-dnd.log` so new lines are obvious.
3. Have Explorer open on the same volume (for same-volume MOVE) and wallpaper visible.

## Matrix (sign each row)

| # | Action | Pass looks like | Log / note |
|---|--------|-----------------|------------|
| **46** | Drag one file within list to another folder row | Ghost follows; drop moves/copies; source leaves list | Internal |
| **47** | Multi-select 3+ files; drag | Fan / stack ghost; all move together | Internal |
| **48** | Drop on a **folder row** in the list | Item lands inside that folder | Internal |
| **49** | Drop on a **tree** folder | Tree accepts; navigate or move as designed; no tree collapse | Internal |
| **50** | Drop on **tab bar** | Tab switch / open-in-tab behavior stable; no crash | Internal |
| **51** | Drag file from **Desktop → BNDZ list** | Inbound ghost/FluidDrag over list; drop commits; file appears | `DeliverExternalDropJson` / `FE_DEBUG inbound-drop` or host-fallback |
| **52** | Drag file from **BNDZ → Desktop/wallpaper** | Outside OLE ghost visible (craft card); drop lands on desktop | `outbound-ghost show` |
| **53** | Drag file from **BNDZ → Explorer** window | Ghost + successful drop in Explorer | Outbound OLE |
| **54** | Start marquee, then try drag | Marquee does not break subsequent drag | Regression |
| **55** | Ctrl+marquee additive select, then drag | Selection preserved into drag | Regression |
| **56** | Empty-space click | Selection clears | Baseline |
| **57** | During drag, tooltip / drop hint | Shows sensible target path | UX |
| **58** | After tree drop | Tree expansion state sane; no stuck highlight | Regression |

## C4 craft spot-checks (with 51–52)

| Check | Pass |
|-------|------|
| **Outbound ghost craft** | Soft shadow/rim, shell jumbo icon, magenta move / emerald copy badge — not a bare cursor |
| **Inbound list FluidDrag** | Arms over list; **no double-ghost** with OLE; Drop still commits |
| **Click-through** | While outbound drag over wallpaper, desktop icons remain targetable (ghost is click-through) |

## Fail → stop

- Any missing outbound ghost on wallpaper (52)
- Inbound drop that never reaches React / host fallback spam without file appearing (51)
- Tree collapse or stuck drag after 49/58
- Double-ghost (FluidDrag + OLE) on inbound

## After signing

1. Update rows 46–58 in `fm-launch-readiness.md`.
2. Note build/commit SHA + date in the playbook evidence section.
3. Resume D2 live: Shift+RMB dupes, terminal G1–G3, cold-boot LMB (`WINDOWS-TEST-PLAYBOOK.md` §2).
