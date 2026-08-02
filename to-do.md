# BNDZ Agent To-Do — Mandatory Stabilization (Phases 1–8)

**Status:** DONE — Phases 1–8 complete; Phase 9+ selling pillars shipped (see `to-do-selling-points.md`).

**Plan reference:** `.cursor/plans/fm_stabilization_pass_3a642e90.plan.md` (Phases 1–8 detail)

**Build gate (required after every implementation turn):**
```bash
npm run build
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
```

---

## Phase 1 — Spatial glass constellation cards
- [ ] Replace `bndz-rack-pin` with `bndz-pin-module` (WorkspaceLaunchCard DNA) in Spatial only
- [ ] Files: `SpatialCanvasCard.tsx`, `SpatialPipCard.tsx`, `SpatialSpringBoard.tsx`, `index.css` (~8370–8513)
- [ ] Unify v1/v2 spatial card paths to one component
- [ ] Wire `--mouse-x` / `--mouse-y` spotlight on pointer move

## Phase 2 — Single-click inspector (Spatial + Automation)
- [ ] Spatial: 4px drag threshold before drag; pointerup without movement selects; explicit `onClick` fallback
- [ ] Automation: `onNodeClick` → `setSelectedNodeId`; clear `nodeDraggingRef` before selection sync
- [ ] Files: `BndzSpatialCanvasView.tsx`, `SpatialInspector.tsx`, `BndzAutomationView.tsx`

## Phase 3 — Automation wiring polish
- [ ] Fix `.bndz-rack-module { overflow: hidden }` clipping React Flow handles
- [ ] Default edges: stroke, glow, `smoothstep`, animated active pipelines
- [ ] Files: `index.css`, `BndzAutomationView.tsx`

## Phase 4 — Desktop drag-drop commit
- [ ] Dual-path: WPF `PreviewDrop` + Chromium `file:` fallback (`PostNavigationFileDrop`)
- [ ] Never leave `Effects=None` on file drags; surface `EXTERNAL_FILES_DROP_FAILED`
- [ ] Coord/hit-test fallback using last `EXTERNAL_DRAG_HOVER_REPORT`
- [ ] Files: `MainWindow.xaml.cs`, `ExternalDropHelper.cs`, `main.tsx`, `BNDZUI.tsx`

## Phase 5 — Tombstone optimistic UI
- [ ] `pendingFsOpsRef` registry: hide tombstoned paths through refetch/FS events until job completes
- [ ] Rollback tombstone + toast on failure; extend to move ops
- [ ] Files: `BNDZUI.tsx`, `MainWindow.xaml.cs`, `transferIpc.ts`

## Phase 6 — List icon reliability
- [ ] Folder thumb null → shell icon fallback
- [ ] `entity.type === directory` before path heuristics (folders with dots in name)
- [ ] `iconRequestQueue`: reject promise on eviction
- [ ] Files: `ThumbnailIcon.tsx`, `shellPaths.ts`, `iconRequestQueue.ts`, `nativeIconService.ts`

## Phase 7 — Details view layout parity
- [ ] Fixed `w-[230px]` toolbar slot for all view modes
- [ ] Render `.bndz-list-header-bar-spacer` in Grid/List/Columns when sort headers on
- [ ] Files: `BNDZUI.tsx`, `index.css`

## Phase 8 — Native FM feel (targeted)
- [ ] List row pointer cursor; no web-button chrome on file rows
- [ ] Transfer progress in queue panel only (not blocking center toasts)
- [ ] Keep GPU `translate3d` on scroller only

## Phase 8 — Build + manual verification
- [ ] `npm run build` succeeds
- [ ] `dotnet build` Debug succeeds (quit BNDZ.exe if copy locked)
- [ ] Desktop → list drop works
- [ ] Delete/move: no reappear flicker
- [ ] Spatial/Automation: single-click inspector
- [ ] Details ↔ Grid ↔ List: no layout jump
- [ ] Folder icons always render

---

## For future agents

- **Do not** claim Phase 9+ selling points are done when only backend stubs/plugins exist.
- **Do not** ship UI/CSS without fresh `npm run build` + Debug `dotnet build`.
- **Selling-point roadmap:** see `to-do-selling-points.md` (8 category-defining pillars — Session View, Heat/Ghost, Rack Signal Path, etc.). Parity backlog: `to-do-future-upgrades.md`.
