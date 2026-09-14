# BNDZ — Launch Ready Plan (locked)

**Status:** Execution in progress — Waves A1 + E (ops dialogs / elevation / Shell Integration cancel) + B brand/copy scrub landed in code; Windows matrix / UAC live verify deferred  
**Quality bar:** [`.cursor/rules/above-and-beyond.mdc`](../.cursor/rules/above-and-beyond.mdc) + BNDZ project rules (native host, Uiverse craft, `npm` + Debug `dotnet` every product turn)  
**Protect:** OLE / inbound–outbound DnD spine — surgical only; re-verify matrix 46–58 after any touch  

---

## Decisions locked

| # | Decision |
|---|----------|
| **1.A** | **Remove RAM Staging** from the product surface this pass (Hub, Command Deck, menus, Workspace Tools, Hub cards, automation nodes, launch-check rows that assume `/bndz/ram`). **No replacement RAM feature.** Strip ImDisk / AIM install–UAC–driver theater with it. Ghost/cold UI that only lived under Staging leaves the Hub with it (no half-kept “Cold” orphan plugin). |
| **2** | **All tracks** — do not thin to one pillar. Run Waves **A–E** below as one Launch Ready program (parallel where safe; serialize only where files collide). |
| **3** | **DnD CRITICAL:** Do not break inbound/outbound drag-and-drop. Outside-ghost polish is allowed. Spine is protected; bad polish can be reverted from commit history — still verify matrix 46–58 after any near-DnD touch. |

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
| **CRITICAL:** inbound/outbound DnD must not break; outside-ghost polish OK (committed baseline can be restored) | **DnD protect** | C3 + global |

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
| Leftover **Ghost-*** user-facing strings | Scrub product copy (menus, Deck, automation labels, transfer queue names) even where code embeds remain. |

### A2 — Absorb verification (features moved, not lost)

Per [`PLUGINS-TODO-BEFORE-LAUNCH.MD`](../PLUGINS-TODO-BEFORE-LAUNCH.MD) must-move lists — **still open as smoke**, not re-absorb:

- Magnets in Batch Rename · Encode in Metadata · Groups in Visual Filters · Policies/Intake in Drop Stack · Diff in Folder Sync · Vault in Project Sandbox · Health in Storage Cleanup  
- Remaps: installed ids, bottom tabs, Command Deck tool ids  
- **Exception:** Ghost → RAM Staging absorb is **superseded by A1 remove** — do not professionalize Staging; remove it.

### A3 — Keep + professionalize (big-company hosts)

Each remaining Hub plugin must read as **one product**, not dumped tabs or SaaS cards:

| Host | Story |
|------|--------|
| System Properties | Native inspector (default) |
| Fast Search | Instant find (default) |
| Visual Filters | Filters + smart groups (default) |
| Shell Menus | In-app + Explorer weave + verbs |
| Icon Studio | Icon libraries / apply |
| Batch Rename | Rename + magnets |
| Drop Stack | Intake & stage (no RAM disk theater) |
| Metadata | Facts + encode |
| Storage Cleanup | Cleanup + capacity + health |
| Folder Sync | Sync + diff |
| Catalog | Virtual folders |
| Action Log | Undo/redo history |
| Mesh / Remote | Power-user SSH/SFTP (optional install) |
| Project Sandbox | Safe workspaces + vault |
| Branching Time | Folder branches — must look native, not demo |

**Bar:** Uiverse-level craft, real PNG/SVG where panels need them, empty/loading/error states, no `PluginStatCard` SaaS farm, Above and Beyond asset rules.

### A4 — About + Register

Already called out in plugins todo — finish launch-grade brand craft (fix broken `/bndz-light.png` refs; use real assets under `public/`).

### A5 — Explicitly later (do not fake-ship)

Archive plugin · Text Editor plugin · external signed npm/zip plugin packages · Rain-Explorer / QuickLook / filessh vendoring — **out of Launch Ready**.

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
- Terminal: Local PowerShell prompt paints on first open  
- Outbound drag ghost outside border + tree drag ghosts — **verify-first**; fix only with DnD protect rules  

### C3 — DnD protect (non-negotiable) — CRITICAL

**Do not tamper with or break inbound / outbound drag-and-drop.** Working OLE/DnD is launch-critical; we are committed so a bad polish pass can be reverted — still treat the spine as protected.

| Allowed | Forbidden |
|---------|-----------|
| Polish **outside** drag ghosts (cursor-outside-border ghost, tree-row ghost craft) | Rewriting CraftPaneHost OLE, WebView2 drop target, FE handoff / `bndz-ole-drag-handoff`, FluidDrag multi fan, dual-path dedupe |
| Surgical CSS / ghost clone paint after matrix still green | “Cleanup” refactors of drop delivery, escalate, or commit bus |
| Re-verify readiness **46–58** after any touch near DnD | Shipping DnD changes without Windows matrix proof |

Files treated as protect zones (surgical only): `BNDZUI.tsx`, `dragController.ts`, FluidDrag stack, `fileDragSession` / cleanup / drop dest, `fileDropBus`, host `WebView2DropTargetService` / OLE deliver path.

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
| **Read-only / destination not writable** | Permission/read-only sheet | Skip, Cancel; elevate if policy allows |
| **Invalid name / reserved device names** | Validation toast/modal | Fix name / Cancel |
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

Add/sign checks for: name collision modal; disk-full modal; access-denied → UAC Allow; UAC Cancel; Shell Integration toggle elevate round-trip; file-in-use; folder-into-self block.

---

## Wave D — Ship gate (“and so on”)

### D1 — Defaults / chrome already expected at launch

- Command Deck **off** by default (FilesMerge / native as applicable)  
- Midnight default theme; branch bar / mini tree defaults per product prefs  
- Default plugins: Properties, Fast Search, Visual Filters only  

### D2 — Close open [`to-do.md`](../to-do.md) Launch-ready polish rows

Context menu verify · Fast Search empty/keyboard · Toolbar Designer density · transfer snappiness · terminal first paint · Visual Filters empty craft · Tag Manager / Action History spot-check · bottom panel gating · menubar hover · Config shell copy  

### D3 — Sign [`docs/fm-launch-readiness.md`](fm-launch-readiness.md)

- All **100** checks on real Windows `BNDZShell`  
- After Staging removal: rewrite/remove checks **34** and **99** so the gate does not require RAM staging  
- Anti-fake: IPC wiring alone ≠ pass; list drag/marquee regressions block launch  

### D4 — Build / verify every product turn

```bash
npm run build
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
```

Plus native shell build when Shell surfaces change.

---

## Execution order (all tracks — how we run it)

```text
Wave A1  Remove Staging + Design Board Hub + Ghost scrub     ─┐
Wave A2  Absorb smoke on remaining hosts                      ├─ early (unblocks honesty)
Wave A3  Professionalize hosts (Uiverse + assets)            ─┘
Wave B   Native chrome + icons/assets + menus                 ── parallel with A3 where files differ
Wave C   List/scroll perf + reliability; DnD protect          ── parallel; serialize on BNDZUI / drag stack
Wave E   Collision modals + UAC + Shell Integration verify    ── parallel with B/C on dialog/settings files
Wave D   Polish backlog + sign 100-check gate (+ E rows)      ── last; Windows required for ☐→☑
```

**Parallelism rule:** A1 first (Staging removal), then A2/A3 ∥ B ∥ C ∥ E on non-overlapping files; anything touching `BNDZUI.tsx` / drag stack serializes under **DnD protect** (ghost polish OK; spine rewrite forbidden); D signs only after A–C–E evidence.

---

## Out of scope for this Launch Ready program

- Net-new Hub filler / selling skins dressed as new plugins  
- Archive + Text Editor (later)  
- External plugin package marketplace runtime  
- DnD architecture rewrite (ghost polish ≠ rewrite)  
- Replacement RAM disk feature after Staging removal  
- Calendar estimates  

---

## Definition of Launch Ready

1. Hub is smaller and professional — fillers gone; absorbs verified; Staging/Design Board not marketed  
2. Core FM feels native — list/scroll/menus/transfers/terminal meet polish bar  
3. Icons/assets correct and crisp (taskbar + in-app)  
4. Perf/reliability: large-folder scroll + optimistic ops + search empty states hold up  
5. **Collision + elevation suite complete** (name, disk full, in-use, …) and Shell Integration admin path verified on Windows  
6. **Inbound/outbound DnD matrix not regressed** (46–58); outside-ghost polish only if still green  
7. `fm-launch-readiness.md` signed on Windows with honest ☐/☑ (including Wave E rows)  
8. Above and Beyond + BNDZ build gates green on every product turn  

---

## Immediate next execution slice (when you say go)

1. **A1** — Remove RAM Staging (+ Ghost product chrome) and demote Design Board from Hub  
2. Patch launch-readiness checks 34/99  
3. Ghost string scrub  
4. Then parallel: **A2 smoke · B2 About assets · C1 scroll · E1 gap audit** (which collision types are missing vs table) — no DnD spine edits  
)


---

## E1 gap audit (recorded at A1 start)

| Situation | Exists today? | Launch gap |
|-----------|---------------|------------|
| Same-name collision | Partial — `FileConflictModal` on **bndz** engine; default **native** uses Explorer UI | Unify / ensure BNDZ sheet covers folders too when using bndz engine |
| Disk full | Partial — backend can throw; **no dedicated modal**; space pre-check default off | Add capacity modal (need vs free) |
| Access denied → UAC | Partial — elevate relaunch works; **no pending file-op retry** after Allow | Wire retry-after-elevate for transfers |
| File in use | No product modal | Add Skip / Retry / Cancel |
| Folder into itself | Partial — list DnD silent block only | Modal + Copy/Move To / paste guards |
| Path too long | No | Add Skip / Cancel + rename hint |
| Partial batch failure | Partial — toast/queue row | Retry failed / Skip rest / Open log |
| Shell Integration admin | Mostly yes | Windows live verify toggles (E3) |

### E progress (this pass)
- [x] Transfer error classifier (`transferErrorKind.ts`) — disk full / in-use / path too long / access denied
- [x] Failed-job ops dialogs in BNDZUI (dedicated modal, not toast-only)
- [x] Folder-into-self reject reason + warning modal (internal list drop only; OLE untouched)
- [x] Elevation: stash last local transfer + replay after admin relaunch
- [x] Host `PrivilegePolicyService` classifies diskFull / sharingViolation / pathTooLong / accessDenied
- [ ] Windows live verify: Shell Integration toggles + UAC Allow/Cancel matrix
- [ ] Path-too-long Skip/Rename UX beyond dialog
- [ ] Partial-batch Retry failed suite

**DnD protect:** A1/E do not touch OLE spine; only removed RAM-zone product drop interception and Hub/Deck/menu chrome.
