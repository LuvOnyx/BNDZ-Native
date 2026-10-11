# BNDZ Premium / Top-5 FM Gap Analysis

Living notes for Explorer-grade native craft vs cheap / gimmicky surfaces.
Dimensional references (not feature checklists):

| Reference | What “premium” means here |
|-----------|---------------------------|
| **XYplorer** | Craft, density, daily trust |
| **Directory Opus** | Premium depth / finished core |
| **Total Commander** | Speed, honesty, fewer solid tools |

**Scope of this pass:** code-audit of local tree only (`PluginRegistryContext`, bottom plugins, sidebar, Mesh/Remote, Cleanup). No live screenshots this pass — label every feeling as **code-audit** unless a later pass adds live proof.

---

## 1. Goal

Answer: what still feels like a SaaS demo or half-product vs a top-5 Windows file manager people trust every day. Prefer keep + finish over replace. Do not gut things Mikey already likes.

---

## 2. Method

1. Inventory Hub plugins + visible modes from source (registry, tab strips, sidebar sections).
2. Scan CSS/JSX for web-appy / marketing patterns (`PluginHeroStrip`, gradients, soft shadows, StatCard farms).
3. Collect trust issues (Cleanup / capacity / DoD / launch readiness open gates).
4. Draft keep / cut / hide without shipping feature code in this pass.

---

## 3. Vs references + diagnosis

### Vs references

| Reference | What we want | Code-audit note (2026-09-21) | Live TBD |
|-----------|--------------|------------------------------|----------|
| **XYplorer** | Craft / density / daily trust | Core list/tree/chrome has had a density pass (`a18b870` “flatten SaaS chrome”). Bottom plugins still open with **PluginHeroStrip** marketing chrome on Cleanup, Find, Filters, Properties, Capacity, Health, Branching Time, etc. — feels denser in FM shell than in plugin landings. Capacity meter historically lied (100% used with free space); fix landed in `3829c62` / Properties ring comment — **trust still needs live prove**. | Live: Properties drive ring, Cleanup Overview, Find Easy vs Everything |
| **Directory Opus** | Premium depth / finished core | Hub still ships **15** living plugins + many absorbed child tabs. Cleanup alone has **7** tabs (Overview, Scan & Clean, Duplicates, Capacity, Apps, Organize, Health). Remote has **7** tabs including Live Share + Temp cloud. Depth is broad; finishing/honesty uneven — Opus-class would hide unfinished tabs. | Live: Remote Hosts→Terminal→leave warm, Cleanup tab walk |
| **Total Commander** | Speed / honesty / fewer solid tools | Default install is tight (Properties, Fast Search, Visual Filters only) — TC-honest. Hub + Command Deck still expose a long catalog. Mesh Live Share is a one-card start/stop surface; Organize is a wizard launch card. Quarantined Ram/Ghost/Design Board still keep `PluginStatCard` farms in `_a1_quarantine` (not Hub, but pattern lives). | Live: cold start, Command Deck with defaults only |

### Diagnosis (inventory-backed)

| Surface | Symptom (code-audit) | Likely solid vs half-done | Premium risk |
|---------|----------------------|---------------------------|--------------|
| **Storage Cleanup** | 7-tab host; Overview wheel + meter; Capacity/Health are full embed children; Organize = marketing card → wizard; Advanced = “Launch Scan & Clean” card | Overview/Duplicates/Capacity/Health: **worked on hard** but trust-sensitive. Organize/Advanced landing: **thin**. Apps: InstalledAppsPanel (real IPC surface). | **P0 trust** — capacity/free-space honesty; too many modes reads gimmicky vs TC |
| **Remote / Mesh** | Tabs: Hosts, Send files, Temp cloud, Shares, Sync, Terminal, Live Share. Terminal has heavy soft-park/HWND craft. Live Share = single card + peer list | Hosts / Terminal / Send: **more solid**. Live Share / Temp cloud: **novelty / thinner product story** | Depth without Opus finish; Live Share feels demo |
| **System Properties** | Hero strip + disk ring; free-space clamp so free bytes never paint 100% | **Likely solid** after meter fix; still hero-heavy | Trust if meter regresses |
| **Fast Search** | Modes: Easy / Everything / Advanced / Duplicates + hero mode cards | Core search **solid**; mode cards still web-appy | Density vs XY |
| **Visual Filters** | Rules + Groups (Semantic Desk absorb); template cards with `bg-gradient-to-br` | Rules: solid-ish; Groups/Semantic: absorb-child craft | Gradient template tiles |
| **Drop Stack** | Stack / Intake / Policies | Intake+Policies absorbed — **one product story in code**; live polish TBD | — |
| **Batch Rename** | Rename / Magnets | Magnets absorbed — **keep** | — |
| **Folder Sync** | Jobs / Diff | Diff absorbed — **keep** | — |
| **Metadata** | Overview / Media / System / All / Encode | Encode absorb — **keep**; many tabs | Tab sprawl |
| **Project Sandbox** | Active / History / Checkpoints / Vault | Vault absorb — **keep** | — |
| **Branching Time** | Hero + timeline | Real IPC surface; hero chrome | Selling-point risk if empty feels SaaS |
| **Catalog / Action Log / Shell Menus / Icon Studio** | Dedicated hosts | Catalog/Action Log denser; Icon Studio real | Hub length |
| **Bottom panel empty** | BndzPlaque + “Installed plugins open here” | Plaque craft (post SaaS scrub) — **better** | — |
| **Sidebar** | Rapid access, Cloud Drives, Drives, Mini Tree, Navigation Tree | Core FM — **keep**; Mini Tree off by default | — |
| **Quarantine** | ram-staging, ghost-link, design-board | **Hidden from Hub** — correct | Do not resurrect StatCard farms |
| **PluginStatCard** | Still exported; used in quarantine only (live Hub prefers PluginOpsMeter) | Pattern not fully dead | Guard against re-use |
| **Mandatory plugin heroes** | `colorConfigSchema` “plugin-heroes” = mandatory multi-stop gradient | Structural SaaS landings | XY density conflict |
| **FM launch gates** | `fm-launch-readiness.md` rows 1–100 + E4.* all ☐ | Premium core blocked until live signed | **Blocks “finished core”** |
| **DoD open** | White icon rects (P32), WSL names (P28), BandzVPS pin (P30), Podman/Incus (P16), drag tooltip (P07), OLE X cursor partial | Core FM unfinished bits | Opus depth gap |

---

## 4. SaaS / web-appy pattern scan (code-audit)

| Pattern | Where found | Severity |
|---------|-------------|----------|
| `PluginHeroStrip` landings | Cleanup, Find, Filters, Properties, Capacity, Health, LibraryHealth, RealityCheck, BranchingTime, Compare (embed), PolicyPack, Inbound, SemanticDesk, Mesh child panels | High — default plugin open ≠ Explorer density |
| Soft web shadows / glow | PluginPanelPrimitives danger btn, ActionLog timeline dots, Inbound watch LED, LibraryHealth chips | Medium |
| Gradient template / header washes | Filters template cards `from-white/[0.06]`; Catalog/Filters `from-sky-500/[0.06]`; SemanticDesk amber gradient callout | Medium |
| `PluginStatCard` farm | Quarantine Ram/Ghost only; comment prefers `PluginOpsMeter` | Low for Hub (quarantined) |
| Marketing launch cards | Cleanup Organize (“Smart organize wizard”); Cleanup Advanced launch card; Mesh Live Share card | Medium–High |
| Mandatory hero gradients | Colors schema `plugin-heroes` + themePresets `--plugin-hero-fill` | Structural |
| Launcher / SuperCmd | Separate launcher CSS still heavy radial/pastel — out of FM shell but same brand family | Note only |

Native density pass (`a18b870`) + plaques (`bf1ae2d`) already pushed core FM away from SaaS; **plugin bottoms lag**.

---

## 5. Plugin inventory (Hub registry)

Source of truth: `src/data/PluginRegistryContext.tsx` `ALL_PLUGINS` + absorb remaps. Defaults installed: `properties`, `find`, `filters`.

| Id | Name | Purpose | Modes / tabs (code) | Status (code-audit) |
|----|------|---------|---------------------|---------------------|
| `properties` | System Properties | Inspector, hash, ACL, attrs, drive meter | Hero + sections | **Keep / solidifying** — capacity display fixed recently |
| `find` | Fast Search | Instant search | Easy / Everything / Advanced / Duplicates | **Keep** — hero mode cards feel webby |
| `filters` | Visual Filters | Color rules + smart groups | Rules / Groups | **Keep** — Groups = Semantic absorb |
| `context-menu-manager` | Shell Menus | In-app + Explorer menus | app / global / verbs | **Keep** |
| `icon-studio` | Icon Studio | Icon libs on files/folders | Grid / libraries | **Keep** |
| `batch-rename` | Batch Rename | Bulk rename + drop magnets | Rename / Magnets | **Keep** |
| `dropstack` | Drop Stack | Stage / intake / policies | Stack / Intake / Policies | **Keep** |
| `metadata` | Metadata | Facts + tags + encode | Overview / Media / System / All / Encode | **Keep** — consider tab slim |
| `storage-cleanup` | Storage Cleanup | Free space, dupes, health, apps, organize | Overview / Scan&Clean / Duplicates / Capacity / Apps / Organize / Health | **Keep core; hide/slim thin tabs** — **P0 trust** |
| `folder-sync` | Folder Sync | Sync jobs + diff | Jobs / Diff | **Keep** |
| `catalog` | Catalog | Virtual collections | Catalog list / contents | **Keep** |
| `action-log` | Action Log | Undo/redo history | Timeline | **Keep** |
| `remote-mesh` | Remote | SSH, send, VPS, terminal, share | Hosts / Send / Temp cloud / Shares / Sync / Terminal / Live Share | **Keep Hosts+Terminal+Send; hide or demote Live Share / Temp cloud until finished** |
| `project-sandbox` | Project Sandbox | Checkpoints + vault | Active / History / Checkpoints / Vault | **Keep** |
| `branching-time` | Branching Time | Folder snapshots | Hero + timeline | **Keep** — prove daily trust live |

**Dropped / remapped (not Hub):**

| Id | Fate |
|----|------|
| `ram-staging`, `ghost-link`, `design-board`, `photo-studio` | DROPPED_HUB — `_a1_quarantine` |
| `capacity-solver`, `library-health`, `reality-check` | → `storage-cleanup` |
| `drop-magnet` → `batch-rename`; `compare` → `folder-sync`; `transcode-rack` → `metadata`; `semantic-desk` → `filters`; `policy-packs` / `inbound-volume` / `capture-inbox` → `dropstack`; `zk-vault` → `project-sandbox`; `shell-verb-forge` → `context-menu-manager` | Remapped |

### Sidebar modes (not plugins)

| Section | Purpose | Note |
|---------|---------|------|
| Rapid access | Pins / quick roots | DoD: BandzVPS pin pending |
| Cloud Drives | Cloud providers | — |
| Drives | Volume list | Free-space honesty shared with Properties |
| Mini Tree | Compact tree | Off by default |
| Navigation Tree | Full tree | Core |

---

## 5b. Plugin keep / cut / hide draft

Plain-language draft for coordinator (not shipped). Prefer hide unfinished over deleting features Mikey likes.

| Plugin / mode | Draft | Why (code-audit) |
|---------------|-------|------------------|
| System Properties | **Keep** | Core trust surface; meter fix must stay true live |
| Fast Search | **Keep**; soft-polish mode cards | Daily tool; hero cards are the cheap bit |
| Visual Filters | **Keep** | Default install; Groups absorb stays |
| Storage Cleanup — Overview / Duplicates / Capacity / Health | **Keep** (finish honesty) | Real ops; capacity historically wrong |
| Storage Cleanup — Organize | **Hide or demote** until wizard feels native | Landing is marketing card + Start wizard |
| Storage Cleanup — Scan & Clean tab | **Keep wizard**; thin tab landing OK if Overview is home | Advanced tab is a launch plaque |
| Storage Cleanup — Apps | **Keep** if InstalledAppsPanel proves useful live | Else nest under Overview link only |
| Remote — Hosts / Terminal / Send files | **Keep** | Terminal soft-park is real craft investment |
| Remote — Sync / Shares | **Keep** if used; else secondary | Sync has real rule cards |
| Remote — Temp cloud (ephemeral VPS) | **Hide for launch** unless Podman/Incus DoD closes | DoD P16 Podman fake endpoint still pending |
| Remote — Live Share | **Hide for launch** or Settings-only | One-card demo; novelty vs TC honesty |
| Drop Stack / Batch Rename / Folder Sync / Metadata / Sandbox | **Keep** | Absorb hosts — finish craft, don’t cut |
| Branching Time | **Keep** but don’t oversell | Selling pillar — empty/hero must not feel SaaS |
| Catalog / Action Log / Shell Menus / Icon Studio | **Keep** | Solid-ish specialty tools |
| Quarantine Ram / Ghost / Design Board | **Stay cut** | Do not Hub-resurrect StatCard farms |
| Hub net-new (Archive, Notes, …) | **Later** | Per PLUGINS-TODO — after hosts professionalize |

---

## 6. Evidence log

### 2026-09-21 — code-audit (executor, local tree only)

- **Doc:** `docs/BNDZ-PREMIUM-GAP.md` did not exist in tree/branches; created and filled from this audit (no inventing live screenshot feelings).
- **Registry:** 15 Hub plugins in `ALL_PLUGINS`; defaults `properties` / `find` / `filters`; DROPPED_HUB + RETIRED_PLUGIN_REMAP match Launch Ready A1 / absorb map.
- **Cleanup modes:** `overview | advanced | duplicates | capacity | uninstaller | organize | health`. Overview restored with category wheel (`df45810`). Capacity embeds `CapacitySolverPlugin`; Health embeds `LibraryHealthPlugin`.
- **Capacity trust:** commit `3829c62` — Win32 `GetDiskFreeSpaceEx`, Properties ring never rounds free drive to 100%; duplicate scan timeouts hardened. **Still P0 until live screenshot confirms.**
- **SaaS:** `PluginHeroStrip` still default on many hosts; `PluginStatCard` only in quarantine; schema still mandates plugin-hero gradients; Filters/Catalog gradient washes remain.
- **Mesh:** 7 tabs including Live Share (start/stop + peers via `%LocalAppData%\BNDZ\LiveShare`) and Temp cloud — terminal path heavily engineered (soft-park / HWND).
- **DoD open:** P32 icons, P28 WSL, P30 BandzVPS pin, P16 Podman/Incus, P07 drag tooltips, P09/P11 OLE cursor partial.
- **Launch readiness:** checks 1–100 and Wave E4.1–E4.14 still ☐ — premium core gated on Windows live sign-off (`BNDZShell`).
- **PLUGINS-TODO:** absorption checklists marked done; Launch Ready E live UAC/ops still open.

---

## 7. Next live screenshot targets (recommended)

1. System Properties on a large volume with known free space (prove meter ≠ 100%).
2. Storage Cleanup Overview → Capacity → Health walk (trust + tab density feeling).
3. Fast Search Easy vs Everything mode cards (SaaS vs craft).
4. Remote Hosts → Terminal → ← Remote warm return (craft vs gimmick).
5. Remote Live Share + Temp cloud (candidate hide).
6. Bottom panel empty plaque vs first-open plugin hero (density contrast).
7. Default Command Deck (only three plugins) cold start.

---

## 8. Cleanup P0?

**Yes — Cleanup stays P0** for premium trust: capacity/free-space honesty + “too many modes / marketing landings” are exactly the cheap-vs-XY/Opus/TC gap. Finish or hide thin tabs; do not expand Hub until Overview/Capacity feel Explorer-honest live.
