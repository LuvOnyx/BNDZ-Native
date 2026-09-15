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

---

## Active — Outbound drag / Details / Lens (2026-09-05)

Reported after wallpaper OLE verify. Fix in this pass; re-verify before claiming done.

- [x] Wallpaper drop occasionally refreshes whole desktop/Explorer (seen twice) — soft SHChangeNotify only
- [x] Outbound desktop drop copies instead of MOVE on same volume; list does not refresh after folder change — escalate strip + tombstones + delayed sourcesGone
- [ ] No drag ghost outside app border (only finger cursor) — **RegisterClassW+WNDCLASSEX → err=87; fixed RegisterClassExW**
- [ ] Tree drag ghosts ugly — clone real `.nav-tree-row` with computed paint
- [x] Left sidebar unclickable after init until list selection — NC region off + Caption strip only (re-verify cold boot LMB)
- [x] Desktop → list inbound — **2026-09-06 root cause:** `push=True` ≠ PushTargets>0; drops never reached React. Fix: `SetExternalDropDeliver` + `DeliverExternalDropJson` + ExecuteScript inject + host MOVE/COPY fallback after 750ms if sources still exist. Proof in `%LocalAppData%/BNDZ/ole-dnd.log`: expect `DeliverExternalDropJson dropCb=True`, `Inject`, `FE_DEBUG inbound-drop` (or `inbound-host-fallback ok`).
- [x] Details tab (next to Workspace) does not scroll — content cut off at bottom
- [x] LENS `IPC timeout: LENS STAGE RESULT` (recovered after retry) — budget hash + longer IPC + quiet retry
- [x] Desktop icon appears very late after wallpaper drop — FLUSHNOWAIT + actual dest path + deferred pulse

## Launch-ready polish (this thread)

Goal: every UI surface, plugin, menu, and feature feels shippable — keep expanding this list and closing items.

### Context menus
- [x] Weave Windows shell verbs into BNDZ menu by Explorer-like slots (open / clipboard / cascades / tools / footer)
- [x] Remove dump "Shell extensions" folder / end-of-menu bucket
- [x] Dedupe shell labels/verbs against BNDZ built-ins; keep named cascades (7-Zip, Send to, …)
- [x] Re-enable shell merge by default (polish migration v2)
- [ ] Shift+RMB full OS menu still works; verify no duplicate Open/Properties/Share rows

### Fast Search
- [x] Folder scope via path field + … (not duplicate Browse/Add buttons)
- [ ] Result list keyboard nav + Enter open feels Explorer-snappy
- [ ] Empty / no-Everything engine fallback messaging

### Toolbar / chrome
- [x] Remove macOS traffic-light dots from Toolbar Designer preview
- [ ] Toolbar Designer preview matches live toolbar density/spacing

### Transfers / feel
- [x] Adaptive hot poll while jobs run
- [ ] Copy/move toast + list refresh feel instantaneous on small ops

### Remote / terminal
- [x] Local ConPTY → in-panel xterm (not HWND / not detached wt)
- [x] Terminal frame fills panel so prompt isn’t clipped under chrome
- [ ] Verify Local PowerShell prompt paints on first open

### Plugins / surfaces (continue sweeping)
- [x] Notifications tab uses BNDZ Checkbox (not raw accent inputs)
- [x] Extension Hub (PluginStoreDialog) redesigned — glass/squircle craft, aurora backdrop, shimmer CTA, animated catalog rows, grouped sections, capability items, version timeline card
- [ ] Advanced plugins as **external installable packages** (npm/zip distribution, isolated runtime, signature check) — planned for a future BNDZ release; current hub manages built-in + JSON-imported manifests only. Do **not** vendor Rain-Explorer / QuickLook / filessh into `external/` for launch.
- [ ] Visual Filters empty/default state craft
- [ ] Tag Manager / Action History spot-check regressions
- [ ] Bottom plugin panel empty state + install gating still correct
- [ ] Menubar / context hover colors consistent after menu merge
- [ ] Configuration dialog Shell Integration copy matches weave behavior

### Native plaques / illustrations (modals · panels · list tabs · menus)

Quiet functional PNG/SVG plaques so static FM surfaces feel native — not SaaS icon+CSS empties. Reuse Hexigon + brand first; generate/extract only gaps. Adapt into BNDZ tokens (no raw Uiverse dumps). **Leave alone:** list rows, OLE/DnD spine, FluidDrag ghosts, toolbar icon strips.

**Asset pipeline**
- [x] Stage `public/plaques/` — kebab names; Hexigon idle/error/question + brand mark + generated idle/panel/tab grain SVGs
- [x] Shared `BndzPlaque` (`idle` | `warn` | `error` | `brand` | `panel` | `folder`) + CSS sizes (`sm`–`xl`)
- [x] Inventory / quality gate before wiring dense chrome (context menus): candidate `menu-header-candidate.svg` staged; `PLAQUE_CONTEXT_MENU_ENABLED=false` until crisp at menu density

**Modals / dialogs**
- [x] List empty + list load error (`BNDZUI` emptyState)
- [x] Transfer / elevation alert tones via `NativeDialogShell` (Hexigon Error / Question)
- [x] File conflict sheet header plaque (keep file thumbnails)
- [x] About + Register brand plaque polish
- [x] Extension Hub empty (`PluginStoreDialog`)

**Panels**
- [x] `PluginEmptyState` default plaque (all plugin empties inherit)
- [x] Bottom plugin panel “none installed”
- [x] Preview inspector idle
- [x] Index / smart-search empty (`BndzIndexEmptyState`)

**List tabs**
- [x] Tab strip paper/grain craft (`.bndz-chrome-tabstrip`) — subtle material, not marketing heroes
- [ ] Empty-strip / no-tab affordance plaque if strip can appear barren

**Context menus (quality-gated)**
- [ ] Candidate small header / section plaque assets only — wire **iff** they stay readable in dense menus and do not slow open (`menu-header-candidate.svg` waiting on gate)
- [ ] If assets fail the gate: keep Icons8 + CSS; do not force bitmaps

**Done when:** empties/modals/panels/tab strip use `BndzPlaque` (or deliberate skip); `npm run build` + Debug `dotnet` green; no DnD/list regression from plaque work.

Shipped earlier:
- Action History + Tag Manager BNDZ theme redesign
- Context menus: menubar font/size, `#007acc` hover tones
- Sidebar LMB / Caption strip
- Desktop outbound MOVE + inbound delivery
