# BNDZ Future Upgrades (NOT selling points)

**These are worth building eventually** but they do **not** justify buying BNDZ — every competitor or OSS tool already does them or will soon.

Do **not** put these in marketing / "why BNDZ" copy. Track here as engineering backlog after `to-do.md` (Phases 1–8) and after `to-do-selling-points.md`.

---

## Search & index
- [ ] Everything `es.exe` → SDK named pipes
- [ ] MFT/USN incremental index (find-my-file pattern)
- [ ] Hybrid semantic + keyword search (Xplorer/Grove parity)
- [ ] Content `content_id` column in `files.db`

## List & shell
- [ ] TanStack scroll compression / million-row polish
- [ ] Skia icon atlas row renderer
- [ ] Vanara shell column host
- [ ] Live dual-pane diff mirror (XY branch-compare parity)

## Producer / media (partially shipped)
- [ ] BPM/key columns in list index (analysis ships; index columns do not)
- [ ] Chromaprint / acoustic fingerprint column
- [ ] Essentia.js WASM (license review)
- [ ] Shoot culling mode (Facet/CullSnap parity)
- [ ] **FiveM / RAGE preview fidelity** — ✅ GLB + normals/UVs + optional sibling `.ytd` in right preview panel (`GpuModelViewport`). Remaining: `.rpf` archive browse, in-archive orbit, multi-material YTD atlas, bump/spec maps.

## Trust & ops
- [ ] Transfer conflict preview sheet
- [ ] Transfer undo theater / IOperationProgress
- [ ] Tombstones (Phase 5 — stabilization, not selling point)

## Automation & scripting
- [ ] Roslyn `.bndz` script host
- [ ] Action History → macro recorder
- [ ] Hazel-style USN rules (without BNDZ-native composition)

## AI
- [ ] MCP client to external filesystem server (sidecar pattern — forbidden as product story)
- [ ] Generic AI chat about files (Xplorer parity)

---

## Post–Launch Ready — parked product ideas (2026-09-14)

Parked while Launch Ready (Waves A–E + ship gate) closes completely. Do **not** start these until Launch Ready is signed closed. Cross-ref: [`docs/LAUNCH-READY-PLAN.md`](docs/LAUNCH-READY-PLAN.md) A5 (Text Editor later) and [`PLUGINS-TODO-BEFORE-LAUNCH.MD`](PLUGINS-TODO-BEFORE-LAUNCH.MD) Later table.

### List selection checkboxes (all views)
- [ ] Optional **item checkboxes** in front of every list item — user-opted (Appearance / view options), not forced
- [ ] Same behavior for **every list surface**: Details, List, Grid/Icons, and other file views that show selectable items
- [ ] Use the **settings `Checkbox` craft** ([`src/components/ui/checkbox.tsx`](src/components/ui/checkbox.tsx) / `.bndz-ui-checkbox-*`) — not the native `<input type="checkbox">` currently used in details-only gutter
- [ ] Today: details-only `listShowSelectionCheckboxes` in Appearance + `FileListRow` native input — extend + re-skin, do not invent a second selection system
- [ ] Selection model stays id-based (`selectedItems`); checkboxes are an input affordance on top of existing Ctrl/Shift/marquee

### Folder Options (Explorer-class folder/view options)
- [ ] BNDZ **Folder Options** surface (View menu and/or Configuration) modeled on Explorer’s folder/view options shell — not a fake Settings dump
- [ ] Include / extend: show hidden files, show protected/system files, show file extensions, protected OS files, and related list/tree visibility toggles users expect from Explorer
- [ ] Wire to existing settings where they already exist (`showHiddenFiles`, `showSystemFiles`, etc. in Configuration / `treeListItemFilter`) — elevate discoverability and complete gaps; don’t duplicate dead switches
- [ ] Copy must match real filter behavior (no lying toggles)

### Notes plugin (iOS Notes feel + serious editor)
- [ ] Hub plugin **Notes** — iOS Notes–like craft (lists, folders/pinned, soft paper UI) with Notepad++-class power (tabs, find/replace, encoding, syntax where it earns its keep)
- [ ] **Plugin pop-out** supported (`openPluginWindow` / `PluginPopoutShell`) so Notes can float like a real editor
- [ ] Right **preview panel** for `.txt` / plain text (and agreed text types) hosts or deep-links into Notes instead of a disconnected throwaway preview — one efficient editing path
- [ ] Replaces / fulfills the deferred **Text Editor** later item — one product, not a thin Notepad skin + a second editor
- [ ] Reuse existing note store / launcher notes only if they fit; do not ship a half-wired `BndzNotesManager` as the Hub plugin

### Batch (rename Batch Rename → Batch)
- [ ] Rename product surface **Batch Rename** → **Batch** (Hub name, bottom tab, Command Deck, menus, Hub cards) — id can stay `batch-rename` with display name **Batch** if remaps stay simple
- [ ] Extremely approachable for common jobs; advanced options available without feeling like a SaaS form farm
- [ ] **Temporary list checkboxes**: opening Batch (or entering “add to batch” mode) can opt the list into checkbox selection so users tick items into a Batch working set
- [ ] Batch working set drives rename and future batch manipulations (not rename-only forever) — still one host plugin, fold related capability in rather than spawning sibling “Batch XYZ” plugins
- [ ] Magnets / absorb work already in Batch Rename stays; this is rename + UX elevation, not a re-absorb pass
