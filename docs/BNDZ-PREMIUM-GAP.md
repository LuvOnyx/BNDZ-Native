# BNDZ Premium Gap — Top-5 File Manager Bar

Living doc. Goal: land BNDZ among the best Windows file managers people actually trust.

**Status (2026-09-21 evening):** reset. Earlier “gap lists” were premature and are **void**.  
**Bar:** Finish the file manager. Stack stays React + WinUI (intentional).  
**Rule:** Research → audit core FM → *then* gaps. No invented top-N lists.

---

## Hard corrections (Mikey — do not drift)

1. **Stack is intentional.** React front + WinUI host. Sharper UI *and* more “web” reading than pure Win32 is a tradeoff we chose. **Do not rip the stack.** Craft inside it.
2. **Top 5 is about the file manager first** — list, tree, tabs, panes, copy/move, rename, search, archives, speed, trust. Stop centering plugins when asking why we aren’t top 5.
3. **No gap list until research + audit are done.** Premature lists = lost sight + holes + aborted work.

---

## Method (order — do not skip)

1. Research what Opus / TC / XYplorer win on for **core file management**.
2. Audit BNDZ **core FM** on the same dimensions (shell only).
3. Derive gaps from that table only.
4. Fold into `BNDZ-V2-PLAYBOOK.md`.

---

## Competitive set

| App | Role |
|-----|------|
| **XYplorer** | Mikey’s daily craft/trust bar |
| **Directory Opus** | Depth / finished product bar |
| **Total Commander** | Speed / honesty / compact bar |
| Windows Explorer | Baseline |

---

## § Research — what top apps win on (core FM)

Sources: vendor highlight/feature pages and manuals (XYplorer.com, docs.dopus.com, ghisler.com). Feel judgments still need live side-by-side later.

### Shared “boringly good” core (all three)

| Dimension | What “good” means |
|-----------|-------------------|
| **Navigate** | Tree + breadcrumbs + tabs that remember place; fast jump between folders |
| **See files** | Details/list (and usually thumbs); sort/group; filter what’s in the current folder |
| **Select** | Multi-select that never fights you (mouse + keyboard) |
| **Copy / move / delete** | Reliable; clear conflict UI; queue or progress you can trust; dual-pane or clear source→dest |
| **Rename** | Inline + serious batch rename |
| **Search** | Fast find that power users actually use (not a toy) |
| **Preview / view** | Quick look at the file without leaving the manager |
| **Archives** | Browse zip (etc.) like folders and/or pack/unpack without a separate app |
| **Drag & drop** | To/from Explorer and Desktop |
| **Speed / trust** | Snappy on big folders; does what it says; hard to break |
| **Density** | Lots of info, little wasted chrome — *within each product’s look* |

### XYplorer (craft / daily trust)

- Tabs (and tab sets) that stick; optional dual pane; Mini Tree; Catalog for one-click places
- Strong **live** (non-indexed) search; dupes; preview / info panel
- Tags, custom columns, deep customization; portable; scripting / user commands for repetition
- Explicit brand: fast, light, hard to break, works as expected

### Directory Opus (finished depth)

- “Lister” = the main window: one or two file displays, tabs per display, shared tree, toolbars, viewer/metadata panes
- Source → destination copy/move (dual display or two windows); rich copy variants; queued ops
- Advanced rename (wildcards, regex, metadata, preview, presets)
- Search: Windows Search / Everything / deep internal Find; sync + dupes in utility panel
- Optional Explorer Replacement (Win+E opens Opus)

### Total Commander (speed / honesty)

- Classic **two panes** always in your face; F5 copy, F6 move/rename, F7 mkdir, F8 delete — muscle memory
- Multi-rename; search; sync / compare; archives; FTP; tabs; quick filter
- Compact chrome; plugins extend formats — but the **core** is the dual-pane operations loop

### Dimension checklist (use this for the BNDZ audit)

1. Tabs + session memory  
2. Dual pane / clear source→destination  
3. Tree + breadcrumbs + favorites/catalog-like jumps  
4. List views (details / thumbs) + sort/group + in-folder filter  
5. Selection model  
6. Copy / move / delete + conflicts + progress  
7. Inline rename + batch rename  
8. Search (power and speed)  
9. Preview / quick view  
10. Archives as first-class  
11. DnD with Explorer/Desktop  
12. Keyboard-driven ops density  
13. Big-folder speed / trust  
14. Overall density of the **main window** (not plugin pages)

---

## § Audit — BNDZ core file manager

*Same 14 dimensions. Shell only. Code-audit of local tree (`BNDZUI` + list/tree/tabs/transfer/preview/archive/keyboard). Hints only from `fm-launch-readiness.md` / `fm-native-dod.md`. Live Windows sign-off still open where noted. Status: done / partial / missing / unknown.*

| # | Dimension | Top-app bar | BNDZ today | Evidence | Status |
|---|-----------|-------------|------------|----------|--------|
| 1 | Tabs + session memory | XY/Opus/TC all strong | Multi-tab per pane; named tabsets; autosave + restore last tabset on startup; lock / reorder / close-others | `BNDZUI` tab APIs; `configContext` `Tabset` / `savedTabsets`; settings `autoSaveTabsetsOnSwitch`, `restoreLastTabsetOnStartup`; address script `save-tabset` | done |
| 2 | Dual pane / source→dest | Opus/TC core; XY optional | Optional dual pane (not always-on). Independent tabs per pane, resizable layout, open folder in opposite pane. Context “Other Pane” copy/move. Diff strip exists. No TC-style F5=copy / F6=move as defaults (F5 = refresh) | `isDualPane` / `dualPaneOpen` in `BNDZUI`; `workspaceLayout` `DUAL_PANE_IDS`; `openFolderInOppositePane`; `DualPaneDiffStrip`; keybinding `Ctrl+\` toggle dual pane, `Alt+P` opposite pane | partial |
| 3 | Tree / breadcrumbs / quick jumps | All | Full nav tree + optional Mini Tree; breadcrumb rail with overflow menu; Rapid access / Drives / Cloud Drives sidebar sections; address omnibar suggestions | `VirtualizedNavTree`; `BreadcrumbTrail`; `LeftSidebar` (Rapid access, Cloud Drives, Drives, Mini Tree, Navigation Tree); `RapidAccessPopup` | done |
| 4 | Views + sort/group + filter | All | Details / list / grid / columns; density slider; sort columns + group-by; kind/tag filter chips; omnibar live in-folder filter text | `VirtualizedFileList`; `viewModeMetrics`; `listGrouping`; `ListFilterChips`; `filterText` in `BNDZUI`; `BndzDensitySlider`; Ctrl+Shift+1–4 view chords; `defaultViewMode` / `listGroupBy` settings | done |
| 5 | Selection | All | Marquee, Ctrl/Shift multi-select, optional checkboxes, selection chrome modes, sticky checkbox / invert options, empty-space deselect | `FileListRow` + marquee pad/lead/trail; `selectionAnchorRef` / `scheduleSelectionChrome`; mouse settings in `settingsBehavior`; launch readiness lists marquee/Ctrl-marquee checks | done |
| 6 | Copy/move/delete + conflicts + progress | All | Cut/copy/paste; delete → Recycle (Shift+Delete permanent); managed transfer queue with progress / pause / cancel; `FileConflictModal` replace / keep both / skip (+ apply to all); destination picker. Live E4 conflict/UAC gates still ☐ | `FileTransferQueuePanel` + `fileTransferQueue`; `ModalProvider` `FileConflictModal`; `IPC.resolveConflict`; `DestinationPickerModal`; `handleDeleteRequest` in `BNDZUI`; backend conflict resolvers in `BndzIpcHost` | partial |
| 7 | Rename (inline + batch) | All (batch depth varies) | Inline rename in list/tree (F2, post-create Explorer-style). Batch rename lives as Hub plugin (`batch-rename`) with preview + IPC `executeBatchRename` — not a first-class shell surface | `InlineRenameInput`; `beginInlineRename` in `BNDZUI`; keybinding F2; DoD P01 create→rename; `BatchRenamePlugin` (plugin, out of shell chrome) | partial |
| 8 | Search | XY/Opus/TC each strong differently | Shell omnibar filters current folder; `> ` prefix kicks Everything / BNDZ index / Windows Search into results; type-ahead jump in list. Deeper Easy/Everything/Advanced UI is the Find plugin (not required for “has FM search”) | `filterText` / `debouncedFilterText` + global prefix path in `BNDZUI`; `typeAheadFind`; Ctrl+F focus filter; `enableEverythingSearch` / indexed settings; Find plugin is extra | done |
| 9 | Preview / quick view | All | Right inspector/preview pane (images, PDF, text/code, media, archives, torrent, 3D when WebGL ok). Spacebar Quick Look overlay (`BndzQuickPreview`). Ctrl+I toggles inspector | `RightPreviewPanel`; `preview/BndzQuickPreview`; Space handler in `BNDZUI`; `isPreviewPanelOpen` / `previewPanelOpen` | done |
| 10 | Archives | TC/Opus strong; XY too | Browse inside zip/rar/7z in preview (tree + folder list + sort); extract / quick-extract dest helpers; drag entries out via temp extract; drop onto archive. Not opened as a normal main-list folder path like TC | `ArchivePreviewPanel`; `archiveTypes` / `archiveExtractDest` / `archiveExtractCache`; `IPC.getArchiveContents`; hit-test archive drop targets in `fileDragSession` | partial |
| 11 | DnD Explorer/Desktop | All | Internal fluid drag + outbound OLE to Desktop/Explorer (WebView2 DragStarting bridge); inbound external drops. DoD still open on drag tooltips (P07) and OLE X-cursor polish (P09/P11); launch DnD rows 46–58 ☐ | `nativeOleFileDrag`; `fileDragSession`; `WebView2DragStartingBridge.cs`; `main.tsx` external OLE bridge; `DragGhostPortal` / fluid stack | partial |
| 12 | Keyboard ops density | TC king; others strong | Rebindable map: palette, filter, preview, dual pane, F5 refresh, F2 rename, Ctrl+C/X/V, undo/redo, new folder, Delete; view chords; Tab between panes. Explorer-like density — not TC F5/F6/F7/F8 operation loop | `keybindings.ts` `KEYBINDING_ACTIONS`; `settingsWiring` `buildKeyboardMap`; `KeyboardShortcutsTab`; handlers in `BNDZUI` | partial |
| 13 | Big-folder speed / trust | All claim it | Virtualized list + tree (`@tanstack/react-virtual`); streamed dir chunks (`dirListingStream` / `BNDZ_DIR_LISTING`); icon/thumb prefetch caps. Live gates (cold start, 10k scroll, 30‑min session) still ☐ — trust not signed | `VirtualizedFileList`; `VirtualizedNavTree`; `dirListingStream`; listing prefetch in `BNDZUI`; `fm-launch-readiness` #1/#20/#100 | partial |
| 14 | Main-window density | XY/Opus/TC each coherent | React + WinUI stack kept (intentional). Core chrome had a density / flatten pass; craft stays inside this stack — not “make it Win32” | Stack note + prior density pass on list/tree/chrome; `BndzDensitySlider` / plaques for shell surfaces | note |

---

## § Gaps (derived)

*Blank. Derive from the audit table above only — do not pre-write.*

---

## Parked (known — not a substitute for the audit)

| Item | Note |
|------|------|
| Marketplace fake (install/uninstall/update) | Real product hole; Mikey confirmed. Handle after core FM compare — don’t let it eat this doc. |
| Cleanup redesign | V2 playbook (+ WinZenith option). |
| Capacity tab in Cleanup | **Ditch** — filler. |
| Voided premature gap lists | Discarded. |

---

## Evidence log

- 2026-09-21 — Premature lists; Mikey reset: do research + audit; stack intentional; stop plugin-centering; marketplace yes but not a fake top-5 list.
- 2026-09-21 — Research section filled from vendor docs (XY / Opus / TC). BNDZ audit table opened — **not filled yet**.
- 2026-09-21 evening — **Core FM audit filled** (code-audit of shell tree only: `BNDZUI`, list/tree/tabs/transfer/preview/archive/keyboard, plus `fm-launch-readiness.md` / `fm-native-dod.md` as hints). Plugins/Cleanup/marketplace not scored. § Gaps left blank.

---

## Related

| Doc | Role |
|-----|------|
| This file | Research → audit → then gaps |
| `BNDZ-V2-PLAYBOOK.md` | Execution once gaps are real |
| `fm-launch-readiness.md` | Live BNDZShell sign-off gates |
| `fm-native-dod.md` | Native FM DoD open items |
