# BNDZ — Launch Ready Plan (locked)

**Status:** Planning locked · execution next  
**Quality bar:** [`.cursor/rules/above-and-beyond.mdc`](../.cursor/rules/above-and-beyond.mdc) + BNDZ project rules (native host, Uiverse craft, `npm` + Debug `dotnet` every product turn)  
**Protect:** OLE / inbound–outbound DnD spine — surgical only; re-verify matrix 46–58 after any touch  

---

## Decisions locked

| # | Decision |
|---|----------|
| **1.A** | **Remove RAM Staging** from the product surface this pass (Hub, Command Deck, menus, Workspace Tools, Hub cards, automation nodes, launch-check rows that assume `/bndz/ram`). **No replacement RAM feature.** Strip ImDisk / AIM install–UAC–driver theater with it. Ghost/cold UI that only lived under Staging leaves the Hub with it (no half-kept “Cold” orphan plugin). |
| **2** | **All tracks** — do not thin to one pillar. Run Waves A–D below as one Launch Ready program (parallel where safe; serialize only where files collide). |

---

## What you asked for (nothing thinned)

Your brief maps to **five** launch pillars. Every one is in scope:

| Your words | Plan pillar | Wave |
|------------|-------------|------|
| Filler plugins lazily added — remove ones that aren’t big-company / professional; absorb features into related hosts | **Plugin catalog hygiene** | A |
| Performance and reliability — list & scroll speed, menu appearance, and similar | **Perf + reliability** | C |
| Polish / professionalize UI so nothing looks like a web app — professional native file manager | **Native FM UI craft** | B |
| Icons and assets correctly used and looking good | **Icons & assets** | B |
| “And so on” (ship bar: menus, transfers, terminal, About/Register, defaults, signed checklist, DnD proof) | **Ship gate & remaining polish** | D |

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

### C3 — DnD protect (non-negotiable)

Do **not** rewrite: CraftPaneHost OLE, WebView2 drop target, FE handoff / `bndz-ole-drag-handoff`, FluidDrag multi fan, dual-path dedupe. Any surgical touch → re-run readiness **46–58**.

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
Wave C   List/scroll perf + reliability + DnD verify-first    ── parallel; serialize on BNDZUI.tsx
Wave D   Polish backlog + sign 100-check gate                 ── last; Windows required for ☐→☑
```

**Parallelism rule:** A1 first (Staging removal), then A2/A3 ∥ B ∥ C on non-overlapping files; anything touching `BNDZUI.tsx` / drag stack serializes under DnD protect; D signs only after A–C evidence.

---

## Out of scope for this Launch Ready program

- Net-new Hub filler / selling skins dressed as new plugins  
- Archive + Text Editor (later)  
- External plugin package marketplace runtime  
- DnD architecture rewrite  
- Replacement RAM disk feature after Staging removal  
- Calendar estimates  

---

## Definition of Launch Ready

1. Hub is smaller and professional — fillers gone; absorbs verified; Staging/Design Board not marketed  
2. Core FM feels native — list/scroll/menus/transfers/terminal meet polish bar  
3. Icons/assets correct and crisp (taskbar + in-app)  
4. Perf/reliability: large-folder scroll + optimistic ops + search empty states hold up  
5. DnD matrix not regressed  
6. `fm-launch-readiness.md` signed on Windows with honest ☐/☑  
7. Above and Beyond + BNDZ build gates green on every product turn  

---

## Immediate next execution slice (when you say go)

1. **A1** — Remove RAM Staging (+ Ghost product chrome) and demote Design Board from Hub  
2. Patch launch-readiness checks 34/99  
3. Ghost string scrub  
4. Then start **A2 smoke + B2 broken About asset + C1 scroll verify** in parallel  
)
