# BNDZ Native FM — Next Plan (Depth & Consistency)

**Status:** READY  
**After:** `to-do-native-fm.md` Phases A–H complete on `cursor/native-fm-be-native-c12d`  
**Bar:** same AGENTS.md / native-host rule — be native, not hybrid

---

## Goal

Close the deferred gaps from the first native-FM pass so shell ownership is consistent in every surface (tabs, Spatial, undo, Details columns, MTP), not only the critical path.

---

## Phase 1 — Host chrome menus (tabs / overflow)

- [ ] Route `TabContextMenu` through `HostContextMenuService` (paints outside WebView clip)
- [ ] Keep BNDZ actions; optional merge of shell verbs only where paths exist
- [ ] Files: `TabContextMenu.tsx`, `ipcBridge.showHostContextMenu`, `BNDZUI.tsx`

## Phase 2 — Unified undo story

- [ ] Document dual stacks clearly in UI (Action Log vs Explorer Ctrl+Z)
- [ ] Prefer Action Log undo for ops BNDZ recorded; surface “Open Explorer undo” tip when native shell aborted
- [ ] Gate empty-state copy from engine
- [ ] Files: `BNDZUI.runUndoRedo`, `ActionHistoryDialog`, `FileOperationPreferences`

## Phase 3 — Conflict parity on silent/background native ops

- [ ] When `nativeShellShowProgress` is off, still surface collisions (BNDZ conflict modal or shell UI)
- [ ] Map shell abort → toast + Action Log consistency
- [ ] Files: `NativeShellFileOperationService`, `MainWindow.HandleExecuteFsOperationAsync`

## Phase 4 — OLE-only secondary surfaces

- [ ] Spatial Canvas / PortalComposer: drop HTML5 `Files`/`text/plain` for FS pins; accept via `fileDropBus` / pointer OLE end
- [ ] Keep HTML5 solely for UI reorder (tree keys, sidebar sections)
- [ ] Files: `BndzSpatialCanvasView.tsx`, `PortalComposer.tsx`, `fileDropBus.ts`

## Phase 5 — Details = Property Store

- [ ] Map custom/`PROPERTYKEY` ids on host; batch metadata for viewport rows
- [ ] Optional default Details columns from store (Authors, Dimensions, Duration already on)
- [ ] Files: `NativeShellService`, `extendedMetadataCache.ts`, `CustomColumnCell.tsx`, `listColumns.ts`

## Phase 6 — MTP & pin consistency

- [ ] Delete/rename via shell when not read-only
- [ ] Unify Rapid Access pin vs GhostLink/magnet semantics in product language
- [ ] Files: `PortableDeviceService`, `ShellContextMenuService`, Rapid Access / magnets

## Phase 7 — Search & index feel

- [ ] Pooled SQLite connections for FTS
- [ ] Empty-state: unindexed vs no hits vs Everything missing
- [ ] Scoped FS walk only; never global cold walk
- [ ] Files: `BndzFileIndexService`, `EverythingSearchService`, `BndzIndexEmptyState.tsx`

## Phase 8 — Quarantine dead host sources

- [ ] Move compile-removed launcher / `FilePreviewMetaService` sources to `_retired/` or delete
- [ ] Confirm csproj Compile Remove list matches disk mental model
- [ ] Files: `BNDZ.csproj`, retired services

## Phase 9 — Prompt purge sweep

- [ ] Replace remaining `window.prompt` / `confirm` on FM-adjacent plugins with ModalProvider / `requestNativeConfirm`
- [ ] Files: FindPlugin, BatchRename, InstalledApps, ConfigurationDialog (non-critical last)

---

## Execution order

1 → 4 → 3 → 2 → 5 → 7 → 6 → 9 → 8

## Done criteria

- Tab menus never clipped by WebView
- Spatial pin from Explorer uses same OLE commit path as list
- Conflicts never silent when progress dialogs off
- Details metadata batch feels instant on large folders
- No `/api/fs` or fake browser stubs remain in any product path
- Fresh `npm run build` + Debug `dotnet` every ship turn

## Related

- Completed: `to-do-native-fm.md`
- Selling pillars: `to-do-selling-points.md`
- Parity backlog: `to-do-future-upgrades.md`
