# BNDZ Native FM — Explorer Parity Depth Plan

**Status:** COMPLETE (review + polish pass done)  
**Branch:** `cursor/native-fm-be-native-c12d`  
**Bar:** Feel and act as native as Windows File Explorer — WebView2 paints; the shell owns truth.  
**After:** `to-do-native-fm.md` Phases A–H

**Build gate every ship turn:**
```bash
npm run build
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
```

---

## North star (Explorer parity checklist)

| Explorer behavior | BNDZ must |
|-------------------|-----------|
| Right-click menus | Live shell + host chrome outside WebView clip |
| Ctrl+Z / Ctrl+Y | Clear Action Log undo; honest messaging vs shell stack |
| Copy/move collisions | Never silent overwrite — progress on or off |
| Drag from list | Shell drag image + Preferred DropEffect |
| Drop onto any FM surface | One OLE/`fileDropBus` path (not HTML5 Files) |
| Details columns | Property Store metadata, batched |
| Recycle Bin | Original location columns + restore/purge |
| Control Panel / This PC / Network | Browse + open applets correctly |
| Address bar / New | Shell New templates; no browser prompts |
| Search | Instant without Everything; no whole-disk walk |
| Clipboard | CF_HDROP round-trip with Explorer |

---

## Phase 1 — Host chrome menus (tabs / overflow / empty)

- [x] `TabContextMenu` → `IPC.showHostContextMenu` (outside WebView clip)
- [x] Breadcrumb overflow `…` → host menu when native (React fallback only when not native)
- [x] Keep BNDZ action ids; execute via existing handlers
- [x] Files: `TabContextMenu.tsx`, `BreadcrumbTrail.tsx`, `ipcBridge.ts`, `BNDZUI.tsx`
- [ ] Deferred: full menubar / column-picker host menus (large chrome surface; clips less often)

## Phase 2 — Unified undo story

- [x] Action Log is primary undo for BNDZ-recorded ops (native + bndz engines)
- [x] Empty undo: honest toast (no “switch engines” lie); tip about Explorer undo
- [x] Action History dialog labels Action Log vs Explorer shell stack clearly
- [x] Files: `BNDZUI.runUndoRedo`, `ActionHistoryDialog.tsx`

## Phase 3 — Conflict parity when progress is off

- [x] Silent native ops: do **not** set `NoConfirmation` — keep shell collision UI
- [x] Legacy SHFileOperation path: drop `FOF_NOCONFIRMATION` too
- [x] Files: `NativeShellFileOperationService.cs`, `MainWindow.xaml.cs`

## Phase 4 — OLE-only secondary surfaces

- [x] Spatial: prefer `fileDropBus` / pointer OLE; FileList `.path` before `text/plain`
- [x] PortalComposer: `application/bndz-paths` → FileList → `text/plain` last
- [x] RamStaging: FileList before `text/plain`
- [x] Files: `BndzSpatialCanvasView.tsx`, `PortalComposer.tsx`, `RamStagingPlugin.tsx`

## Phase 5 — Details = Property Store (batch)

- [x] Host batch `GET_EXTENDED_METADATA_BATCH` for visible paths
- [x] `extendedMetadataCache` prefetch viewport rows
- [x] Authors column default on; Dimensions/Duration already on
- [x] Files: `NativeShellService.cs`, `MainWindow.xaml.cs`, `ipcBridge.ts`, `extendedMetadataCache.ts`, `customColumns.ts`

## Phase 6 — Namespaces & Control Panel open

- [x] Control Panel / shell **folders**: navigate in-pane; non-folder applets ShellExecute
- [x] Recycle list autosize passes `folderPath` for original columns
- [x] MTP rename via shell parent path (no Win32 `Directory.CreateDirectory` on CLSID)
- [x] Wire `treatPortableDevicesAsReadOnly` for delete/rename
- [x] Files: `BNDZUI.tsx` open handler, `NativeShellFileOperationService.cs`, `portablePaths.ts`

## Phase 7 — Search & index feel

- [x] Boolean global: same skip whole-disk walk as plain search
- [x] Empty engine id `indexed-empty` vs hits
- [x] FE empty-state: `BndzIndexEmptyState` for indexed-empty; Everything-off / Windows Search copy
- [x] Files: `EverythingSearchService.cs`, `BndzIndexEmptyState.tsx`, `BNDZUI.tsx`

## Phase 8 — Prompt purge (FM-critical)

- [x] Replace `window.prompt`/`confirm` on: paste special, Find, InstalledApps, BatchRename, DropStack, Catalog, Filters, Duplicates, Finding tabs, Global Search, layout save, tag comments, UDCs, settings helpers, ContextMenu Hello/Job Ticket
- [x] Use `requestNativeConfirm` / `requestNativePrompt` / ModalProvider
- [x] Files: `nativeDialog.ts`, `ModalProvider.tsx`, plugins, `BNDZUI.tsx`, `ContextMenuView.tsx`, settings helpers

## Phase 9 — Hybrid purge polish

- [x] `readFileContent` never fabricates `// Content of …` stub text
- [x] Fake browser context-menu stub returns `[]` not fake Open/Cut
- [x] `checkPathExists` / share menu / silent `ok: true` FS ops → honest empty/fail outside host
- [x] Files: `ipcBridge.ts`

## Phase 10 — Keyboard & selection Explorer parity

- [x] Delete / Shift+Delete — shell path
- [x] F2 rename, Ctrl+A, type-ahead preserved
- [x] Properties (Alt+Enter) always shell Properties verb
- [x] Files: `BNDZUI.tsx` keyboard map audit

## Phase 11 — Full codebase review & polish

- [x] Review all native-FM diffs for regressions
- [x] Fix blockers/highs found (shell-folder open overreach, MTP rename, breadcrumb host menu, drop priority, prompt purge, Action Log labeling, search empty, portable RO)
- [x] Fresh FE+BE builds

---

## Execution order (completed)

1 → 3 → 2 → 5 → 6 → 7 → 4 → 8 → 9 → 10 → 11

## Done criteria

- [x] No WebView-clipped tab menus on native host
- [x] Breadcrumb overflow uses host menu when native
- [x] No silent overwrite on background transfers (Vanara + legacy)
- [x] Control Panel folders browse; applets open like Explorer
- [x] Metadata columns feel instant (batched)
- [x] Search never walks whole disk on empty global query
- [x] No browser prompt/confirm on core FM paths
- [x] No fake file content / fake menus in product paths
- [x] `npm run build` + Debug `dotnet` green

## Deferred (honest — not blockers for Explorer feel)

- Full menubar / column-picker as host WPF menus
- IDragSourceHelper reliability polish
- Spatial fully OLE-only (HTML5 FileList still transitional bridge)
- Unified shell↔Action Log undo across processes
- FTS connection pooling

## Related

- Completed: `to-do-native-fm.md`
- Selling: `to-do-selling-points.md`
- Parity backlog: `to-do-future-upgrades.md`
