# BNDZ Launch Ready - terminal + list QA checklist (2026-09-20)

## Must-pass before installer
1. Open Local terminal — shell text visible (not a black hole)
2. Click **Close** — app must NOT crash; return to Remote hosts UI (Send files chrome OK after teardown)
3. Close ? Open again — new shell mounts with text
4. Open ? **? Remote** ? reopen — warm session (mid-prompt)
5. Open ? switch Fast Search / Visual Filters / System Properties ? back — no crash, no stuck overlay
6. Open ? pop-out ? close pop-out — session returns to bottom panel
7. Rapid: Open ? Close ? Open ? plugin switch ? Close (×3)
8. Downloads Group by Type — folder Names white (not grey); classic FOLDERS/IMAGES strip chrome
9. Empty folder or user home: RMB canvas ? New Folder ? **one** row, rename selected, list scrolls to top
10. New Folder twice — second is "New folder (2)", no duplicate rows

## Known fixed causes (do not regress)
- FE hole must not publish `visible:false` on undersized ResizeObserver blips while active
- Open hide-grace only for undersized *show*; intentional plugin-leave hide always parks
- TryMount must not gate on ActualWidth/ActualHeight
- Close: kill native first, then switch to hosts (avoid Park-warm then Close-kill)
- Listing: dedupe by name (optimistic stub + watcher Created)

Installer: unblocked — Launch Ready code gates PASS (`npm run launch-ready`, 2026-09-21).
