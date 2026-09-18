# BNDZ — Launch Ready Plan (locked)

**Status:** **NOT launch-ready** — mid-execution. Tabs/Home/About/ops QC green; Wave F code done; E ops suite coded; **C4 drag-ghost craft code landed** (Windows click-through still ☐); `fm-launch-readiness.md` is **0 signed rows**. Next = Windows DnD matrix 46–58 after C4, then A2 / E4 / D2–D3.  
**Quality bar:** [`.cursor/rules/above-and-beyond.mdc`](../.cursor/rules/above-and-beyond.mdc) + BNDZ project rules (native host, Uiverse craft, `npm` + Debug `dotnet` every product turn)  
**Protect:** OLE / inbound–outbound DnD spine — surgical only; re-verify matrix 46–58 after any touch  
**Ship binary:** **BNDZ-Native only** — `BNDZShell` via `scripts/run-bndz-native.cmd` / `BNDZShell.exe`. FilesMerge and classic WPF `MainWindow` are reference/archive — not the launch gate target.

---

## Audit verdict (2026-09-18) — did we finish?

**No.** Strong code progress on Waves A / E / F / **C4** and chrome polish, but launch cannot be claimed until:

| Blocker | State |
|---------|--------|
| **C4** inbound list FluidDrag + outside OLE ghost craft | **Code landed** — Windows verify ☐ |
| **`fm-launch-readiness.md`** | **~112 ☐ / 0 ☑** on real Windows |
| **DnD matrix 46–58** | Unsigned; must re-run after C4 |
| **E4.1–E4.14** UAC / collisions / Shell Integration | Code suite ≠ live verify |
| **A2 absorb smoke** | Remaps coded; Windows host-tab open still ☐ |
| **D2** Shift+RMB / terminal first paint / menu dupes | Windows ☐ |
| **A1 residue** | Hub clean; FilesMerge catalog scrubbed; absorb embeds off PluginStatCard; plugin `.tsx` files still in tree (quarantine/delete later) |

**Parked correctly (do not start):** [`to-do-future-upgrades.md`](../to-do-future-upgrades.md), external npm/zip plugins, selling pillars.

---

## Decisions locked

| # | Decision |
|---|----------|
| **1.A** | **Remove RAM Staging** from the product surface this pass (Hub, Command Deck, menus, Workspace Tools, Hub cards, automation nodes). **No replacement RAM feature.** Ghost/cold UI that only lived under Staging leaves the Hub with it. Checks **34/99** in readiness already retargeted (Drop Stack / install gating) — do not reopen Staging to satisfy the gate. |
| **1.B** | **Launch = BNDZ-Native.** Sign readiness on `BNDZShell`. Do not expand FilesMerge / classic WPF as ship surface. |
| **2** | **All tracks** — do not thin to one pillar. Run Waves **A–F** as one Launch Ready program. |
| **3** | **DnD CRITICAL:** Do not break inbound/outbound drag-and-drop. Outside-ghost + inbound FluidDrag polish allowed under C3/C4 rules. Spine protected; verify matrix 46–58 after any near-DnD touch. |
| **4** | **Anti-fake:** IPC wiring / “build succeeded” ≠ pass. Windows ☐→☑ only after user-visible proof on Native. |

---

## What you asked for (nothing thinned)

Your brief maps to **five** launch pillars. Every one is in scope:

| Your words | Plan pillar | Wave |
|------------|-------------|------|
| Filler plugins lazily added — remove ones that aren’t big-company / professional; absorb features into related hosts | **Plugin catalog hygiene** | A |
| Performance and reliability — list & scroll speed, menu appearance, and similar | **Perf + reliability** | C |
| Polish / professionalize UI so nothing looks like a web app — professional native file manager | **Native FM UI craft** | B |
| Icons and assets correctly used and looking good | **Icons & assets** | B |
| Transfer **collision** modals (same name, disk full, …); Windows **admin/UAC** when needed; Settings **Shell Integration** admin path verified | **Ops dialogs + elevation** | E |
| “And so on” (ship bar: menus, transfers, terminal, About/Register, defaults, signed checklist, DnD proof) | **Ship gate & remaining polish** | D |
| **CRITICAL:** inbound/outbound DnD must not break; outside-ghost polish OK (committed baseline can be restored) | **DnD protect** | C3 + C4 + global |
| Quick boot + honest index finished | **Boot + index** | F |

---

## Wave A — Filler plugins: absorb, remove, professionalize

### A0 — Already done (do not redo)

Hub remaps in [`src/data/PluginRegistryContext.tsx`](../src/data/PluginRegistryContext.tsx) `RETIRED_PLUGIN_REMAP`:

Drop Magnets → Batch Rename · Compare → Folder Sync · Transcode → Metadata · Semantic Desk → Visual Filters · Policy/Inbound/Capture → Drop Stack · ZK Vault → Project Sandbox · Ghost-Link → RAM Staging · Library Health/Reality → Storage Cleanup · (earlier) Verb Forge → Shell Menus · Capacity → Storage Cleanup  

Defaults: System Properties, Fast Search, Visual Filters only · `FIRST_USE_PLUGINS = []` · no open-to-install.

### A1 — Remove (not big-company / not launch-worthy)

| Surface | Action |
|---------|--------|
| **RAM Staging** (`ram-staging`) + Ghost Hub/Deck/menu chrome | **Remove** from Hub catalog, bottom panel, Command Deck tools, shell menu presets, Workspace Tools tabs, Continuum compose board, Hub view cards. Remap any saved `ram-staging` / `ghost-link` installs to **uninstall / drop** (or a no-op host redirect that does not re-expose Staging). Delete or quarantine install/driver IPC UX. Update [`docs/fm-launch-readiness.md`](fm-launch-readiness.md) checks **34** and **99** (they currently assume RAM staging). |
| **Design Board** (`design-board`) | **Remove from Hub for launch** — hosted Fabric/OpenPencil iframe is not a native FM plugin. Keep code behind a “later” flag or archive; do not market as a Hub install. |

### A1 residue scrub (still required before launch honesty)

Hub catalog no longer installs Staging / Design Board — **but residue remains in the tree**. Close before D3:

| Residue | Action |
|---------|--------|
| `RamStagingPlugin.tsx` / `GhostLinkPlugin.tsx` / `DesignBoardPlugin.tsx` | Quarantine or delete; must not reappear via Hub / Deck / menus |
| `BNDZUI` RAM zone list / `ramStaging*` IPC / path remaps | Scrub user-visible chrome; keep dead IPC only if harmless and unreachable |
| FilesMerge `BndzPluginCatalog` still listing `ram-staging` | **Done** — ghost-link / ram-staging removed from DefaultInstalled + Marketplace + Deck map |
| Ghost→RAM “must-move” rows in `PLUGINS-TODO-BEFORE-LAUNCH.MD` | Strike — superseded by 1.A remove (do not professionalize Staging) |
| Nested absorb children using `PluginStatCard` SaaS strips | **Partial** — RealityCheck / SemanticDesk → `PluginOpsMeter`; Ram/Ghost still quarantined |

- [x] FilesMerge catalog no longer resurrects Staging / Ghost Link
- [x] Nested absorb embeds (RealityCheck / SemanticDesk) off `PluginStatCard`
- [ ] A1 residue scrub complete (plugin `.tsx` quarantine/delete + BNDZUI RAM chrome)
- [x] No `PluginStatCard` farm in RealityCheck / SemanticDesk absorb children

| Leftover **Ghost-*** user-facing strings | Scrub product copy (menus, Deck, automation labels, transfer queue names) even where code embeds remain. |

### A2 — Absorb verification (features moved, not lost)

Per [`PLUGINS-TODO-BEFORE-LAUNCH.MD`](../PLUGINS-TODO-BEFORE-LAUNCH.MD) must-move lists — **code-smoke verified 2026-09-14** (Windows click-through still deferred):

| Retired id → host | Surface found |
|-------------------|---------------|
| `drop-magnet` → Batch Rename | Magnets tab + `DropMagnetPlugin` |
| `transcode-rack` → Metadata | Encode tab |
| `semantic-desk` → Visual Filters | Smart groups |
| `policy-packs` / `inbound-volume` / `capture-inbox` → Drop Stack | Policies + Intake tabs |
| `compare` → Folder Sync | Diff surfaces |
| `zk-vault` → Project Sandbox | Vault tab + `ZkVaultPlugin` embedded |
| `library-health` / `reality-check` / `capacity-solver` → Storage Cleanup | Health + Capacity tabs |
| Remaps | `RETIRED_PLUGIN_REMAP` in `PluginRegistryContext.tsx` |

- **Exception:** Ghost → RAM Staging absorb is **superseded by A1 remove** — do not professionalize Staging; remove it.
- [x] Code audit: remaps + host tabs present (Magnets/Encode/Intake/Policies/Capacity/Health/Diff/Vault/Groups)
- [ ] Windows UI smoke: open each host tab once after install remap hydrate

### A3 — Keep + professionalize (big-company hosts)

Each remaining Hub plugin must read as **one product**, not dumped tabs or SaaS cards:

| Host | Story |
|------|--------|
| System Properties | Native inspector (default) |
| Fast Search | Instant find (default) |
| Visual Filters | Filters + smart groups (default) |
| Shell Menus | In-app + Explorer weave + verbs — ops rail + tab story (A3 craft) |
| Icon Studio | Icon libraries / apply — ops rail (no step-pill chrome) (A3 craft) |
| Batch Rename | Rename + magnets — ops rail; nested Magnets bare chrome (A3 craft) |
| Drop Stack | Intake & stage — ops rail + browse stage (A3 craft); nested Captures/Policies without double chrome |
| Metadata | Facts + encode — ops rail; nested Encode meter (no stat farm) (A3 craft) |
| Storage Cleanup | One ops surface — overview meter + large-file list (A3 craft); Capacity/Health as sections |
| Folder Sync | Sync + densified preview + Diff bare chrome (A3 craft) |
| Catalog | Virtual folders — ops rail + catalog naming (A3 craft) |
| Action Log | Undo/redo timeline — ops rail, one product name (A3 craft) |
| Mesh / Remote | Power-user SSH/SFTP (optional install) |
| Project Sandbox | Safe workspaces — live rail + session stage + history timeline + vault unlock strip (A3 craft) |
| Branching Time | Folder timeline — native snapshot rail (A3 craft pass 2026-09-14); peek tip / restore; VSS + shadows |

**Bar:** Uiverse-level craft, real PNG/SVG where panels need them, empty/loading/error states, no `PluginStatCard` SaaS farm, Above and Beyond asset rules.

### A4 — About + Register

Already called out in plugins todo — finish launch-grade brand craft (fix broken `/bndz-light.png` refs; use real assets under `public/`).

### A5 — Explicitly later (do not fake-ship)

Archive plugin · Text Editor / **Notes** plugin · external signed npm/zip plugin packages · Rain-Explorer / QuickLook / filessh vendoring — **out of Launch Ready**.

Parked post-launch product ideas (list checkboxes all views, Folder Options, Notes, Batch rename→Batch) live in [`to-do-future-upgrades.md`](../to-do-future-upgrades.md) — **do not start until Launch Ready is signed closed**.

---

## Wave B — Native FM UI + icons/assets (not a web app)

### B1 — Native file-manager chrome

- List / tree / toolbar / status: Explorer-native density; no generic dashboard cards in core FM  
- Soft squircles / BNDZ tokens — not pill clusters or purple SaaS skins  
- Bottom plugin panel: craft empty state + install gating (installed-only Deck actions)  
- Size Map / About / Register / Extension Hub: distinctive plaques — not dialog skins  
- Menubar + context hover consistency after shell weave  
- Configuration “Shell Integration” copy matches real weave behavior  

### B2 — Icons and assets (your explicit ask)

- Taskbar / exe **multi-resolution ICO** (16–256), fill/zoom glyph — verify crisp at 16/32/48  
- About / Register / Hub: **correct brand PNGs** present and wired (no missing `bndz-light.png`)  
- Toolbar / plugin / empty-state: SVG/PNG from `public/launcher-icons` + generated craft where needed  
- No emoji/Unicode as the whole visual language  
- Icon pop-in: warm cache on revisit; folder thumb → shell fallback; no poison cache on transient miss  

### B3 — Menu appearance

- Shift+RMB full OS menu still works  
- No duplicate Open / Properties / Share rows after weave  
- Menubar / context hover colors consistent  
- Shell Menus plugin UI must not reintroduce dump “Shell extensions” folder into the live menu  

### B progress (honest)

| Row | Code | Windows |
|-----|------|---------|
| B1 native chrome density / no SaaS cards in core FM | Advanced | ☐ click-through |
| B2 multi-res taskbar ICO (16–256) present | [x] | ☐ crisp at 16/32/48 on Native |
| B2 About/Register brand plaque (not missing PNG) | [x] craft pass | ☐ visual QC on Native |
| B2 list icons warm / no pop-in on revisit | Partial | ☐ folder+file warm proof |
| B3 Shift+RMB + no duplicate Open/Properties/Share | Weave coded | ☐ |
| B3 menubar/context hover consistency | [x] | ☐ |
| Context-menu plaques | Parked (`PLAQUE_CONTEXT_MENU_ENABLED=false`) — **not** launch blocker |

---

## Wave C — Performance and reliability

### C1 — List and scroll speed

- Virtualization always on (threshold 1) — paint visible rows only  
- Scroll fling: target fps ≈ monitor Hz with warm icons; keep glass/craft (no gutting UI to fake FPS) — [`to-do-gpu-hz-perf.md`](../to-do-gpu-hz-perf.md)  
- Icon IPC concurrency while scrolling; viewport-priority decode  
- SharedBuffer / progressive listing path stays first paint  
- Details ↔ other views: no layout jump (header spacer already present — verify)  

### C2 — Interaction reliability

- Tombstones / optimistic move-delete: clear on host omit; no flicker-back  
- Small copy/move: toast + list refresh feel instant  
- Fast Search: keyboard nav + Enter snappy; empty / no-Everything messaging  
- Terminal: **Native** Local PowerShell first paint — WinUI `NativeTerminalHost` / TermControl overlay over plugin hole (not detached `wt`); geometry fills hole; ConPTY buffer+ACK  
- Outbound ghost mechanics (RegisterClassExW + single premultiply) + tree drag bake — **code landed**; Windows wallpaper follow still verify  
- **C4 code landed:** inbound list FluidDrag + outside OLE ghost craft — Windows matrix 46–58 next  
- Sidebar cold-boot LMB (Caption/NC) — code fix landed; **re-verify** on Native cold start  
- `CraftPaneHost` IDropTarget reclaim after Chromium first paint — known OLE fragility; include in matrix 46–58 notes (do not rewrite spine) 

### C3 — DnD protect (non-negotiable) — CRITICAL

**Do not tamper with or break inbound / outbound drag-and-drop.** Working OLE/DnD is launch-critical; we are committed so a bad polish pass can be reverted — still treat the spine as protected.

| Allowed | Forbidden |
|---------|-----------|
| Polish **outside** drag ghosts (cursor-outside-border GDI craft, tree-row ghost craft) | Rewriting CraftPaneHost OLE, Drop / self-refuse / effect resolve, FE handoff / `bndz-ole-drag-handoff`, FluidDrag multi fan, dual-path dedupe |
| **Inbound list ghost** via existing `FluidDragStack` + read-only hover path sample | Second Win32 inbound overlay fighting Explorer; changing Drop commit |
| Surgical CSS / ghost clone paint after matrix still green | “Cleanup” refactors of drop delivery, escalate, or commit bus |
| Re-verify readiness **46–58** after any touch near DnD | Shipping DnD changes without Windows matrix proof |

Files treated as protect zones (surgical only): `BNDZUI.tsx`, `dragController.ts`, FluidDrag stack, `fileDragSession` / cleanup / drop dest, `fileDropBus`, host `WebView2DropTargetService` / OLE deliver path.

### C4 — Drag ghost craft (inbound list + outside design) — CODE LANDED

**Paint + hover enrichment only; spine protected.** Windows click-through still required.

#### C4.1 — Outside OLE ghost design upgrade — **done (code)**

[`BndzOutboundDragGhostOverlay.cs`](../BNDZBackend/Services/BndzOutboundDragGhostOverlay.cs) `BuildCardBitmap`: soft shadow pad, rim, Midnight gradient, shell LARGEICON, magenta move / emerald copy, multi stack + count chip; FE `.bndz-drag-ghost-op-move` → `#a855f7`.

#### C4.2 — Inbound list drag ghost — **done (code)**

| Step | Change |
|------|--------|
| Host | DragEnter caches CF_HDROP sample ≤10 + count; `EXTERNAL_FILES_DRAG_HOVER` carries `{ paths, count, copy }`; `EXTERNAL_FILES_DRAG_LEAVE` on leave. Drop / self-refuse / effect unchanged. |
| FE | `bndz-external-drag-hover` → `armFluidDrag` when no outbound session; disarm on leave / drop / fail / magnet. |
| Reuse | `fluidDragBridge` + `FluidDragStack` — no second ghost |
| Parity | Native `BndzIpcHost` enriched; classic MainWindow coords-only (archive) |

#### C4.3 — After C4 code lands

- Tick Active rows in [`to-do.md`](../to-do.md)  
- Re-note DnD matrix **46–58**  
- Fresh `npm run build` + Debug `dotnet`  
- Then resume Windows-gated A2 / E4 / D2–D3 sign-off  

---

## Wave E — Collision modals + Windows admin / UAC + Shell Integration

Big-company FMs never fail silently on transfer collisions or permission walls. Launch Ready requires a **complete ops-dialog suite**, elevation that actually shows Windows Allow/Cancel, and Settings Shell Integration toggles proven under admin.

### E1 — Transfer / FS collision modal suite

**Today:** name-collision UI exists (`FileConflictModal` in [`ModalProvider.tsx`](../src/components/ModalProvider.tsx) — Replace / Keep both / Skip / Cancel all + apply-to-all), wired from host `onConflict` in file ops.

**Must exist and be wired for launch** (native BNDZ dialog craft — not raw `window.alert`):

| Situation | User gets | Actions (typical) |
|-----------|-----------|-------------------|
| **Same name** at destination (file or folder) | Side-by-side conflict sheet (already started) | Replace, Keep both, Skip, Cancel all; Apply to all |
| **Not enough disk space** | Clear capacity error (need vs free) | Cancel; optional “Open cleanup” if Storage Cleanup installed |
| **Access denied / needs admin** | Explain + offer elevate | Cancel; **Run as administrator** / retry elevated (Windows UAC) |
| **File in use** (sharing violation) | Locked-file message | Skip, Retry, Cancel |
| **Path too long** | MAX_PATH / long-path messaging | Skip, Cancel; rename hint if applicable |
| **Read-only / destination not writable** | Permission/read-only sheet | Skip, Cancel; elevate if policy allows — **code: `readOnly` kind** |
| **Invalid name / reserved device names** | Validation toast/modal | Fix name / Cancel — **code: `invalidName` + rename guard** |
| **Copy/move folder into itself** (or descendant) | Block with clear reason | OK |
| **Partial failure** mid-batch | Summary of failed items | Retry failed, Skip rest, Open log |

**Wire rules:** copy, move, drag-drop commit (internal), and queue jobs must surface the same suite — not only the rename dialog. Drag-drop **commit** may show collisions; do **not** break the DnD pipeline to add them (hook conflict callback on existing transfer path).

### E2 — Windows OS admin allow (UAC)

When an operation truly needs elevation:

1. Detect `needsElevation` / access denied (existing `PrivilegePolicyService`, `promptElevationIfNeeded` in [`nativeDialog.ts`](../src/lib/nativeDialog.ts), IPC `onElevationRequired`).
2. Show BNDZ confirm → **Windows UAC Allow/Cancel** via relaunch/elevated helper (not a fake in-app “admin” checkbox).
3. After Allow, retry the pending op or apply pending shell settings (`--apply-shell --elevated` pattern already used).
4. After Cancel, leave a clear status — no silent no-op.

**Must cover:** protected-folder writes, HKLM / all-users shell deploy, always-run-elevated opt-in, any Settings action that returns `needsElevation: true`.

### E3 — Settings → Shell Integration — admin path verified

For each Shell Integration control that mutates the OS shell:

| Verify | Pass criteria |
|--------|----------------|
| Toggle while **not** elevated | App prompts → UAC → elevated apply → setting sticks after restart/refresh |
| Toggle while **already** elevated | Applies without false “needs admin” loop |
| Cancel at UAC | Prior state restored / honest failure message; no corrupt half-registry |
| Config copy | Matches real weave behavior (no lying “no admin required” when HKLM needed) |
| Context Menus plugin Deploy | HKCU path works without admin; all-users path elevates correctly |

Do not ship Shell Integration as “looks wired” — run the toggles on Windows and record pass/fail in launch readiness (add rows if missing).

### E4 — Launch-readiness additions (Wave E)

Rows **E4.1–E4.14** in [`docs/fm-launch-readiness.md`](fm-launch-readiness.md). Sign on real **BNDZ-Native** for: name collision; folder conflict; disk-full; in-use; path-too-long; read-only; invalid name; access-denied → UAC Allow/Cancel; into-self; partial batch; Shell Integration elevate round-trip.

---

## Wave D — Ship gate (“and so on”)

### D0 — Ship binary lock

- [ ] Gate runs only on **BNDZ-Native** (`scripts/run-bndz-native.cmd` / `BNDZShell.exe`)
- [ ] Do not treat FilesMerge or classic WPF as launch proof
- [ ] Readiness header / D3 wording matches Native-only

### D1 — Defaults / chrome already expected at launch

- Command Deck **off** by default on Native  
- Midnight default theme; branch bar / mini tree defaults per product prefs  
- Default plugins: Properties, Fast Search, Visual Filters only  
- Command Deck actions = **installed plugins only** (never auto-install on click)  
- Config change re-syncs install state (never freeze first hydrate)  
- Omnibar must not resurrect a Plugins/Smart Tools strip that fights Deck gating  

### D2 — Close open [`to-do.md`](../to-do.md) Launch-ready polish rows

| Row | Code | Windows |
|-----|------|---------|
| Shift+RMB full OS menu; no duplicate Open/Properties/Share | Weave coded | ☐ |
| Terminal Native TermControl first-open paint + geometry | Code landed | ☐ |
| Fast Search empty/keyboard | [x] | spot-check ☐ |
| Transfer toast / list refresh snappiness | [x] | spot-check ☐ |
| Bottom panel empty + install gating | [x] | ☐ (#99) |
| Sidebar cold-boot LMB | Fix landed | ☐ re-verify |
| About/Register brand craft | [x] | ☐ visual QC |
| Taskbar/tray multi-res ICO crisp 16/32/48 | Asset landed | ☐ (#92) |

### D3 — Sign [`docs/fm-launch-readiness.md`](fm-launch-readiness.md)

- All **100** core checks + **E4.1–E4.14** on real Windows **BNDZ-Native**  
- Checks **34/99** already retargeted (Drop Stack / install gating) — confirm gate text matches product  
- Anti-fake: IPC wiring alone ≠ pass; list drag/marquee regressions block launch  
- After C4: re-sign DnD **46–58** before closing D3  

### D4 — Build / verify every product turn

```bash
npm run build
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
```

Plus native shell build when Shell surfaces change (`scripts/build-bndz-native.ps1` when Shell code changes).

### D5 — Windows Sign-Off Protocol (required to claim Launch Ready)

1. Run **BNDZ-Native** on a real Windows machine (not Linux CI alone).  
2. Work the checklist in [`fm-launch-readiness.md`](fm-launch-readiness.md) top-to-bottom; flip ☐→☑ only after user-visible proof.  
3. For DnD: paste `ole-dnd.log` snippets (`outbound-ghost show`, inbound deliver) into the PR / notes.  
4. For UAC: record Allow **and** Cancel paths for Shell Integration + one protected-folder transfer.  
5. Perf: measure scroll with Perf HUD (Ctrl+Shift+Alt+P) if available — target ≈ display Hz with warm icons.  
6. Freeze: after matrix green, no near-DnD polish without re-running 46–58.  

### D6 — Packaging (launch-adjacent — do not skip forever)

Not required to flip every readiness row, but required before public “ship”:

- [ ] Installer / unpackaged distribute path documented for Native  
- [ ] Authenticode / SmartScreen plan (or explicit “unsigned beta” disclaimer)  
- [ ] Clean VM: WebView2 runtime present; first-run trial/About honest  

---

## Execution order (all tracks — how we run it)

```text
DONE   A1 Hub drop Staging/Design Board (residue scrub still open)
DONE   A3 host craft / E1 ops suite / F boot+index (code)
DONE   Tabs / Home rename / About de-AI / ops elevation QC
DONE   C4  Outside OLE ghost craft + inbound list FluidDrag ghost (code)
NEXT   Post-C4 DnD matrix 46–58 + ole-dnd.log proof (Windows)
THEN   Finish A1 residue (quarantine plugin .tsx + BNDZUI RAM chrome)
THEN   A2 Windows absorb smoke (each host tab once)
THEN   E4.1–E4.14 live UAC / collision / Shell Integration
THEN   D2 leftovers (Shift+RMB, terminal, ICO, cold-boot LMB)
THEN   D3 sign full readiness on BNDZ-Native
THEN   D6 packaging / Authenticode (public ship)
```

**Parallelism rule:** Anything touching `BNDZUI.tsx` / drag stack / OLE serializes under **DnD protect**. C4 before claiming DnD green. D3 only after C4 + E live evidence.

---

## Out of scope for this Launch Ready program

- Net-new Hub filler / selling skins dressed as new plugins  
- Archive + Notes (later — see `to-do-future-upgrades.md`)  
- External plugin package marketplace runtime  
- DnD architecture rewrite (ghost polish ≠ rewrite)  
- Replacement RAM disk feature after Staging removal  
- Context-menu plaque wire (density pass parked)  
- Calendar estimates  

---



---

## Wave F — Quick boot + search index finish (added 2026-09-14)

Explorer-grade cold start and an honest “index finished” state. Belongs in Launch Ready — not parked future work.

**Spacedrive indexing:** never the live product index. Spacedrive remains UX/reference (`src/spacedrive/port/*` toolbars/views only). Optional `sd-server` packaging leftovers are not wired into search. Live Fast Search + status chip = **`BndzFileIndexService`** → `%LocalAppData%/BNDZ/Index/files.db` via `INDEX_PROGRESS` / `jobComplete`. Wave F’s “never finishes” bug was BNDZ multi-root progress semantics — not Spacedrive.

### F1 — Explorer-quick boot
- [x] Overlap / defer non-critical boot work so first list paint feels Explorer-snappy
- [x] Native shell: idle-defer font pack + armed automations (same pattern as FilesHost) — do not contend with first `GET_DIR_CONTENTS` / settings
- [x] Do not start default library indexing until `INDEX_PROGRESS` callback is wired (avoid silent progress + boot disk contention)
- [x] Keep `BNDZ_UI_READY` / pending IPC queue — never drop listings for speed
- [x] Stretch: defer IpcHost settings/history/idle-scanner boot I/O via post-ctor `Task.Run` (first list paint unblocked); more work on `BNDZ_UI_READY`

### F2 — Search index reaches a real finished state
**Symptom:** status chip spins / “never finishes”; no 100% / Complete affordance.

**Root cause (code):**
1. `done` is **per location**, not per multi-root job (`IndexDefaultLocations` loops Desktop/Docs/… each emitting `Done=true`)
2. UI clears the chip on every per-root `done`, then the next root restarts the spinner
3. Every process start full-rescans defaults — ignores fresh `locations.last_indexed`
4. No percent / job-complete field; chip has no Complete state
5. Ctor starts indexing before `ProgressCallback` is assigned → early events dropped

**Must fix:**
- [x] Job-scoped `jobComplete` (or equivalent) after all default roots in a pass
- [x] Skip fresh roots on startup (TTL on `last_indexed`); forced reindex from Settings still full
- [x] UI: keep chip across per-root `done`; show **Indexed · N** briefly on `jobComplete`
- [x] Start deferred default index only after IPC progress bridge is live
- [x] Docs/copy: this is BNDZ file index, not Spacedrive’s indexer
- [x] Standalone `IndexLocation` also emits `jobComplete` so single-folder index does not leave a forever spinner

## Definition of Launch Ready

All of the following must be true — **none optional**:

1. Hub is smaller and professional — fillers gone; **A1 residue scrubbed**; absorbs smoke-verified; Staging/Design Board not marketed  
2. Core FM feels native on **BNDZ-Native** — list/scroll/menus/transfers/terminal meet polish bar  
3. Icons/assets correct and crisp (taskbar 16/32/48 + in-app warm icons)  
4. Perf/reliability: large-folder scroll ≈ Hz + optimistic ops + search empty states hold up  
5. **Collision + elevation suite** live-verified (E4.1–E4.14) including Shell Integration Allow/Cancel  
6. **C4 ghosts shipped** + **DnD matrix 46–58** re-signed after C4; inbound + outbound proof in `ole-dnd.log`  
7. `fm-launch-readiness.md` signed on Windows **BNDZ-Native** with honest ☐/☑ (100 + E4)  
8. Above and Beyond + BNDZ build gates green on every product turn  
9. Packaging path clear (D6) before public distribution — or explicit “unsigned Native beta” label  

---

## Immediate next execution slice (when you say go)

1. **Windows** — Post-C4 DnD matrix **46–58** + `ole-dnd.log` (outbound-ghost show; inbound FluidDrag arm; no commit regression)  
2. **A1 residue finish** — quarantine/delete RamStaging / GhostLink / DesignBoard `.tsx` + scrub BNDZUI RAM chrome  
3. **A2** Windows absorb smoke + **E4** live UAC/collision + **D2/D3** sign-off  

Do **not** restart A1 Hub removal, E1 gap audit, or C4 craft from scratch — those are done; residue + Windows verify remain.

---

## E1 gap audit (recorded at A1 start — historical)

| Situation | Exists today? | Launch gap |
|-----------|---------------|------------|
| Same-name collision | Yes — default/background engine is **bndz** so `FileConflictModal` owns collisions; explicit `native`/`windows` engine keeps Explorer UI | Done (default + BackgroundProcessing → bndz) |
| Disk full | Yes — failed-job modal shows need vs free (host enrich + drive probe); Storage Cleanup / Skip / Retry / Open log | Windows live verify on full volume |
| Access denied → UAC | Partial — elevate + stash/replay for last local transfer | Windows live verify UAC Allow/Cancel |
| File in use | Yes — classified modal with working Skip / Retry / Open log | Mid-batch continue (engine) optional |
| Folder into itself | Yes — list DnD + Copy/Move To + paste guards; host bndz engine also rejects | Windows live verify remaining |
| Path too long | Yes — rename/shorten hint + Open destination + working Skip / Retry / Open log | Windows live verify |
| Partial batch failure | Yes — per-item continue + `PartialTransferException` → job `failedPaths[]`; Retry resubmits only failed sources | Done |
| Shell Integration admin | Mostly yes | Windows live verify toggles (E3) |

### E progress (this pass)
- [x] Transfer error classifier (`transferErrorKind.ts`) — disk full / in-use / path too long / access denied / intoSelf
- [x] Failed-job ops dialogs in BNDZUI (dedicated modal, not toast-only)
- [x] Folder-into-self reject — list DnD + Copy/Move To + paste + host bndz guard (OLE untouched)
- [x] Bndz engine folder same-name → `FileConflictModal` (skip / replace / keep both)
- [x] Elevation: stash last local transfer in **localStorage** + replay after admin relaunch
- [x] Transfer UAC no longer stamps `bndz-shell-apply-pending` (only `--apply-shell` relaunches do)
- [x] Host `PrivilegePolicyService` classifies diskFull / sharingViolation / pathTooLong / accessDenied
- [x] Disk-full need-vs-free capacity line (parse host Need/have + drive probe + MarkFailed enrich)
- [x] Partial-batch suite — ops modal even when summary is unclassified; Retry failed / Skip rest / Open Action Log
- [x] Path-too-long Skip/Open destination/Retry UX (Skip no longer a no-op)
- [x] CheckSpaceBeforeCopy defaults on for bndz engine preflight
- [x] E4.1–E4.14 checklist rows in `fm-launch-readiness.md` (incl. readOnly / invalidName)
- [ ] Windows live verify: Shell Integration toggles + UAC Allow/Cancel matrix
- [ ] Windows live verify: disk-full / path-too-long / into-self / read-only / invalid-name click-through

### C progress (this pass)
- [x] VirtualizedFileList default threshold = 1 (always virtualize) — code audit
- [x] Outside-app OLE ghost — premultiplied BGRA for UpdateLayeredWindow + failure logging (QC: single premultiply)
- [x] Tree drag ghost — bake live `.nav-tree-row` computed paint
- [x] **C4.1** Outside OLE ghost **design upgrade** (shadow, rim, shell icon, magenta move; FE badge sync)
- [x] **C4.2** Inbound list FluidDrag ghost (DragEnter path sample → `armFluidDrag`; Drop untouched)
- [x] A1 FilesMerge catalog + RealityCheck/SemanticDesk PluginStatCard scrub (plugin `.tsx` quarantine still open)
- [ ] Windows scroll FPS ≈ display Hz with warm icons (Perf HUD when available)
- [ ] Windows confirm outbound ghost follows on wallpaper (`ole-dnd.log`)
- [ ] Windows confirm inbound list ghost arms over list without double-ghost / commit regression
- [ ] Post-C4 re-sign DnD matrix 46–58

### D progress (this pass)
- [x] Build gate recipe still `npm run build` + Debug `dotnet` after product turns
- [ ] D0 Native-only ship binary lock documented + followed
- [ ] D2 Windows: Shift+RMB / terminal / ICO / cold-boot LMB / About QC
- [ ] D3 Sign `fm-launch-readiness.md` on real Windows **BNDZ-Native**
- [ ] D5 Sign-off protocol followed (logs + Allow/Cancel evidence)
- [ ] D6 Packaging / Authenticode (or unsigned-beta label)

**DnD protect:** A1/E do not touch OLE spine; **C4** is paint + read-only hover enrichment only (no Drop/effect/handoff rewrite).
