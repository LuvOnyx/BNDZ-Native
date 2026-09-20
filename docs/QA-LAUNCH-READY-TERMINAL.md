# BNDZ Launch Ready — terminal QA checklist (2026-09-20)

## Must-pass before installer
1. Open Local terminal — shell text visible
2. Click **Close** — app must NOT crash; return to Remote hosts UI
3. Close → Open again — new shell mounts
4. Open → **← Remote** → reopen — warm session (mid-prompt)
5. Open → switch Fast Search / Visual Filters / System Properties → back — no crash, no stuck overlay
6. Open → pop-out → close pop-out — session returns to bottom panel
7. Rapid: Open → Close → Open → plugin switch → Close (x3)
8. Downloads Group by Type — folder Names white (not grey); FOLDERS/IMAGES strips flush while scrolling
9. Empty folder: RMB canvas → New Folder → select/scroll

## Code gates (verified in tree)
- ParkTermHwnd + DisposeTerm share `_parkGate`
- Close soft-collapses + clears session before dispose
- FE leaves terminal tab before Close
- Open clears `_parkedInactive` after Close

Installer: deferred until Mikey signs off this list.
