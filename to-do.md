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
- [x] No drag ghost outside app border (only finger cursor) — **RegisterClassExW + premultiplied BGRA for UpdateLayeredWindow**; Windows click-through to confirm `ole-dnd.log` `outbound-ghost show`
- [x] Outside OLE ghost **design upgrade** (C4.1) — soft squircle shadow/rim, shell jumbo icon, magenta move badge; FE move badge off AI blue
- [x] Inbound **list** drag ghost (C4.2) — DragEnter path sample → `armFluidDrag` / FluidDragStack; disarm on leave/drop; Drop/effect untouched
- [x] Tree drag ghosts ugly — bake live `.nav-tree-row` computed paint (gradients/indent) onto body clone
- [x] Left sidebar unclickable after init until list selection — NC region off + Caption strip only (re-verify cold boot LMB)
- [x] Desktop → list inbound — **2026-09-06 root cause:** `push=True` ≠ PushTargets>0; drops never reached React. Fix: `SetExternalDropDeliver` + `DeliverExternalDropJson` + ExecuteScript inject + host MOVE/COPY fallback after 750ms if sources still exist. Proof in `%LocalAppData%/BNDZ/ole-dnd.log`: expect `DeliverExternalDropJson dropCb=True`, `Inject`, `FE_DEBUG inbound-drop` (or `inbound-host-fallback ok`).
- [ ] After C4: re-verify DnD matrix 46–58 (inbound list ghost + outside craft)
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
- [x] Result list keyboard nav + Enter open (dirs navigate; files open via bndz-open-in-bndz) + PageUp/PageDown
- [x] Empty / no-Everything engine fallback messaging

### Toolbar / chrome
- [x] Remove macOS traffic-light dots from Toolbar Designer preview
- [x] Toolbar Designer preview matches live toolbar density/spacing

### Transfers / feel
- [x] Adaptive hot poll while jobs run
- [x] Copy/move toast + list refresh feel instantaneous on small ops

### Remote / terminal
- [x] Local ConPTY → in-panel xterm (not HWND / not detached wt)
- [x] Terminal frame fills panel so prompt isn’t clipped under chrome
- [x] Verify Local PowerShell prompt paints on first open (host buffer+ACK + FitAddon geometry; Windows click-through to confirm)

### Plugins / surfaces (continue sweeping)
- [x] Notifications tab uses BNDZ Checkbox (not raw accent inputs)
- [x] Extension Hub (PluginStoreDialog) redesigned — glass/squircle craft, aurora backdrop, shimmer CTA, animated catalog rows, grouped sections, capability items, version timeline card
- [ ] Advanced plugins as **external installable packages** (npm/zip distribution, isolated runtime, signature check) — planned for a future BNDZ release; current hub manages built-in + JSON-imported manifests only. Do **not** vendor Rain-Explorer / QuickLook / filessh into `external/` for launch.
- [x] Visual Filters empty/default state craft
- [x] Tag Manager / Action History empty states → BndzPlaque (history / idle / folder)
- [x] Bottom plugin panel empty state + install gating still correct
- [x] Tab right-click menu + Tabs settings still honor height/font/style/colors with plaque chrome
- [x] Instrument tab chrome: taller/wider defaults, chamfer chips, CSS bottom color slit (`--bndz-tab-slit`)
- [x] Colored tabs keep full-bleed / plaque silhouette (accent = slit + tint only — no small-chip regression)
- [x] Continuum user strings → Home (Hub / Pillar Board untouched)
- [x] About / Register de-AI (no sparkles / generic blue links)
- [x] Shell cascade parent icons (`ContextSubmenu.iconSrc` + enumerator depth≤1 extract + child fallback)
- [x] Context menu zero-shift open: await shell verbs (~160ms budget) + reserved cascade/tools skeletons
- [x] Menubar / context hover colors consistent after menu merge (`bndz-menubar-row` → `var(--accent)`)
- [x] Configuration dialog Shell Integration copy matches weave behavior
- [x] Uninstalled plugin toast points to Extension Hub (not “Plugin Store”)
- [x] Multi-res `BNDZ.ico` (16–256 incl. 20/24/60) synced public ↔ ApplicationIcon; gen script relative + 9 sizes
- [x] Wave A2 absorb remaps + host tabs in code (Magnets/Encode/Intake/Policies/Capacity/Health/Diff/Vault/Groups) — **Windows smoke still required**
- [x] A1 residue scrub — plugin `.tsx` quarantined; Wave3 Ghost/RAM pages deleted; ContextMenuView stage props removed; **Windows confirm** no resurrect
- [x] **Missing idle art:** Preview Inspector + System Properties plaques picked/wired (Native visual QC still ☐)
- [x] D0 ship binary = BNDZ-Native only (docs/scripts lock; readiness signed on Native, not FilesMerge)
- [ ] D2/D3 Windows sign-off: Shift+RMB no dupes; Native terminal first paint; E4.1–E4.14; DnD 46–58; full `fm-launch-readiness.md`
- [ ] D2 taskbar ICO crisp at 16/32/48; About/Register visual QC; sidebar cold-boot LMB re-verify
- [ ] D5 Sign-off protocol (ole-dnd.log + UAC Allow/Cancel evidence)
- [ ] D6 Packaging / Authenticode (or explicit unsigned-beta label)

### Native plaques / illustrations (modals · panels · list tabs · menus)

**Process (mandatory):** gather/extract → `public/plaques/review.html` board → `QUALITY.md` pass → only then wire. No more stub SVG / reused Hexigon as “done.”

**Asset pipeline**
- [x] Reject wave-0 handmade fillers (`rejected/`) + park reused Hexigon as `candidates/legacy-hexigon/` (FAIL as new art)
- [x] Extract web packs into `candidates/`: Gravity UI (MIT, 20), unDraw (100+, includes tabs/browsers), chrome-tabs geometry (MIT), curated illlustrations (CC0)
- [x] Review board + attribution: `public/plaques/review.html`, `QUALITY.md`, `ATTRIBUTION.md`
- [x] Visual keep/kill pass on board (no-people + soft FM tabs) (empties, errors, search, **tabs/chrome**, panels, transfer, menu density)
- [x] Promote keepers to kebab names under `public/plaques/` (recolor to BNDZ tokens where needed)
- [x] Wave-2 FM object plaques: `fm-idle-*`, `fm-panel-*`, `fm-transfer-*`; quarantine web/office dumps to `candidates/web-office/`
- [x] `PluginEmptyState` tone-from-icon (stop blanket `unable-display` reuse)
- [x] Only after pass: re-point `BndzPlaque` / surfaces; keep `PLAQUE_CONTEXT_MENU_ENABLED=false` until menu density pass
- [x] **Preview panel idle plaque** — Fluent magnifier PNG (`fm-glass-panel-*`); Gravity/AI superseded
- [x] **System Properties idle plaque** — Fluent Information PNG (`fm-glass-idle-*`)
- [x] **Modal warn/error heroes** — Fluent Warning (+ Wastebasket for recycle warn); true alpha; CSS wash
- [x] **Folder / search / question empties** — Fluent Open folder / Magnifier / blue `?` (question tinted `#0078D4`)
- [ ] Preview + bottom-plugin empty surfaces re-QC on Native after plaque swap (dark+light click-through)
- [ ] **PINNED** — user gathering better PC plaque/empty/modal cutouts; resume via `project-notes.md` → Plaque art section (do not grind AI/Fluent swaps until then)

**Modals / dialogs / panels / tabs**
- [x] Re-wire only after keeper promotion (current UI still on legacy paths — treat as temporary)
- [x] Empty-strip / no-tab affordance from **passed** tab assets (`tab-empty.svg`)
- [ ] Context menus: wire **iff** density pass; else Icons8 + CSS

**Done when:** keepers pass QUALITY; tabs included; builds green; no DnD/list regression.
- Preview idle + System Properties idle plaques specifically signed after replace/pick.


Shipped earlier:
- Action History + Tag Manager BNDZ theme redesign
- Context menus: menubar font/size, `#007acc` hover tones
- Sidebar LMB / Caption strip
- Desktop outbound MOVE + inbound delivery
