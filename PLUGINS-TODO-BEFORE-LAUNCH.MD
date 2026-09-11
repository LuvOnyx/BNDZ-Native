# Plugins To-Do Before Launch (Relaunch)

**Status:** living plan — execute in phases below.  
**Supersedes:** the earlier draft whose §2 “replacement plugins” (Share Packets, Job Tickets, Space Ledger, Print to BNDZ, Contact Sheets, Duplicate Studio, Portable Kits, Safe Zones, Open With Lab) were **forced Hub padding**. Those names are **killed**. Do not implement them.

Related rules: `.cursor/rules/bndz-implementation-rule.mdc`, selling pillars in `to-do-selling-points.md`, parity backlog in `to-do-future-upgrades.md`.

---

## 0. Non-negotiables

1. **Fewer, better.** Hub may shrink. Never invent a plugin to keep headcount after an absorb.
2. **Marketplace bar.** Every Hub plugin must clear: ≥3 distinct everyday workflows (UI + IPC + persistence), list/selection integration, install-gated Command Deck/context only, honest copy, real depth (preview/confirm/progress) — not a one-IPC façade. If it would not earn an install in a VS Code–class marketplace, it does not ship.
3. **Zero feature loss on absorb.** Every tab, IPC path, rule, recipe, scan, encode preset, vault unlock, policy action, and UI affordance from an absorbed plugin lands in the host (or list/preview/Command Deck/context).
4. **Install migration.** Old installed IDs remap to absorb targets. Net-new plugins ship **Uninstalled by default**.
5. **No competitor name-dropping** in Extension Hub copy.
6. **External packages later** — design clear IPC/`PluginPanelShell` boundaries now; do not ship zip/npm loaders in this pass (`to-do.md`).
7. **Mesh Drop networking labels:** plain language for STUN/TURN (e.g. “Connection helpers (advanced)”) before launch.

---

## 1. Absorption map (thin / overlapping Hub slots → hosts)

| Remove from Hub as standalone | Absorb **100%** into | Why |
| --- | --- | --- |
| **Drop Magnets** (`drop-magnet`) | **Batch Rename** | Rename/tag/route recipes on drop — same domain as pattern rename. |
| **Transcode Rack** (`transcode-rack`) | **Metadata** | Batch encode beside hashes/EXIF/media tags — one File Intelligence panel. |
| **Semantic Desk** (`semantic-desk`) | **Visual Filters** | Clustering is a smart view/filter layer, not a product. |
| **Policy Packs** (`policy-packs`) | **DropStack** | Drop-time rules fire on the same transfer path as staged drops. |
| **ZK Vault** (`zk-vault`) | **Project Sandbox** | Encrypted folders + checkpoint/discard = safe workspaces. |
| **Compare** (`compare`) | **Folder Sync** | Diff belongs next to mirror/robocopy — verify before/after sync. |
| **Inbound Volume** (`inbound-volume`) | **DropStack** | Clipboard/OCR/watcher intake + multi-source staging = one Intake & Stage surface. |
| **Ghost-Link** (`ghost-link`) | **RAM Staging** | Hot RAM + cold offload = one **Staging** continuum (Ghost is deep — move intact, do not gut). |
| **Library Health** (`library-health`) | **Storage Cleanup** | Broken refs/orphans/repairs belong with deep clean + capacity (Health is deep — move intact). |

**Already absorbed (keep remaps):** `shell-verb-forge` → Shell Menus; `capacity-solver` → Storage Cleanup; `capture-inbox` → follow Inbound → DropStack; `reality-check` → follow Library Health → Storage Cleanup.

### 1.1 Feature checklists (must all survive)

#### Drop Magnets → Batch Rename
- [ ] Named magnets / recipes (CRUD)
- [ ] Rename patterns on drop
- [ ] Tag apply on drop
- [ ] Target folder routing
- [ ] Test-against-selection
- [ ] Explorer → BNDZ drop strip / host hooks (`DropMagnetStrip`)

#### Transcode Rack → Metadata
- [ ] JPEG / PNG / WebP queue
- [ ] Resize + quality presets
- [ ] Background progress
- [ ] Selection → encode into folder / replace-with-confirm

#### Semantic Desk → Visual Filters
- [ ] Cluster into 3–8 piles
- [ ] List group headers / overlay
- [ ] Optional ONNX embeddings when model present
- [ ] Clear/reset clustering

#### Policy Packs → DropStack
- [ ] Shareable policy packs
- [ ] Extension / size / tag / deny patterns
- [ ] Block / warn / reroute on drop or move
- [ ] Enforcement on main FM drop path

#### ZK Vault → Project Sandbox
- [ ] Encrypt-at-rest vault create
- [ ] Session unlock / lock
- [ ] Folder-level mounts inside BNDZ
- [ ] No cloud key requirement
- [ ] Coexist with checkpoint / commit / discard

#### Compare → Folder Sync
- [ ] Binary file compare (hash + first-diff)
- [ ] Recursive folder diff (same / different / only A / only B)
- [ ] Dual-pane path pickers / “use left/right pane”
- [ ] Filter chips and result list navigation
- [ ] Report / CSV export
- [ ] Entry points from dual-pane and prior Compare wiring

#### Inbound Volume → DropStack
- [ ] Clipboard catcher
- [ ] OCR screenshot / capture inbox
- [ ] Folder watcher intake
- [ ] Review → copy into library / stage
- [ ] Settings for watch roots and capture naming
- [ ] Absorbed `capture-inbox` alias behavior

#### Ghost-Link → RAM Staging
- [ ] Cold-storage root and offload rules
- [ ] Scan / offload / restore
- [ ] Ghost inventory and reopen paths
- [ ] Presets (idle age / size rules)
- [ ] Honest “keeps a link at the old path” messaging
- [ ] Capacity relief without breaking app paths
- [ ] User-facing rename: Staging cold tier (no Ghost mystique)

#### Library Health → Storage Cleanup
- [ ] Library scan summary
- [ ] Problems list (broken links, shortcuts, orphans, empty dirs, locks)
- [ ] Missing project refs tab
- [ ] Repair plan + safe one-click fixes
- [ ] Reality-check / absorbed `reality-check` paths

### 1.2 Hub / config migration
- [ ] Extension Hub: remove absorbed IDs from catalog
- [ ] `RETIRED_PLUGIN_REMAP` + `installedPlugins` migration (old → host)
- [ ] Bottom panel last-tab / Command Deck / `paneCommandDeck` / context-tool scrub
- [ ] Prior aliases (`capture-inbox`, `reality-check`, etc.) follow new hosts
- [ ] Smoke: install/uninstall hosts; open each migrated feature once

### 1.3 Do not dissolve
System Properties, Fast Search, Visual Filters (host), Batch Rename (host), DropStack (host), Metadata (host), Storage Cleanup (host), Folder Sync (host), Catalog, Action Log, Remote/Mesh, RAM Staging (host), Project Sandbox (host), Branching Time, Design Board / OpenShop, Context Menu Manager (Shell Menus), Icon Studio.

---

## 2. Professionalize hosts (after / during absorb)

Absorb alone is not enough — hosts must feel like power tools.

| Host after absorb | Product story | Deepen bar |
| --- | --- | --- |
| DropStack | **Intake & Stage** | Stash + inbound + policies + batch transfer; one narrative |
| RAM Staging | **Staging** | Hot RAM zones + cold offload continuum; plain language |
| Storage Cleanup | **Cleanup & Health** | Clean + capacity + library health ops |
| Metadata | **File Intelligence** | Facts, hashes, media tags, encode queue |
| Batch Rename | **Rename & Magnets** | Patterns + drop recipes on one compose surface |
| Folder Sync | **Sync & Diff** | Jobs + diff-before-sync |
| Filters | **Visual Filters** | Rules + optional semantic grouping |
| Project Sandbox | **Safe Workspaces** | Sandbox checkpoints + vault |

Also: Hub copy, empty states, and selection wiring for already-strong plugins (Properties, Find, Mesh, Action Log, Catalog, Icon Studio, Branching Time, Design Board, Shell Menus) — polish, don’t invent filler tabs.

Uiverse craft applies to every host/panel pass (`.cursor/rules/bndz-uiverse-ui.mdc`).

---

## 3. Net-new Hub plugins (gap-driven — not slot-fill)

**Only five candidates.** Each fills a verified capability hole. Default: **Uninstalled**.

| ID | Name | Min workflows (must all ship) | Gap |
| --- | --- | --- | --- |
| `archive-studio` | **Archive Studio** | (1) Create multi-format / encrypted / split from selection, (2) browse / test / repair inside archive, (3) smart extract (flat / structure / conflict policy) | Archive IPC/preview exists; no first-class product surface |
| `integrity-desk` | **Integrity Desk** | (1) Generate SFV / SHA256SUM for selection or folder, (2) verify suite + fail list, (3) folder seal manifest + re-check later | Per-file hash only today |
| `stamp-forge` | **Stamp Forge** | (1) Bulk set/shift Created/Modified, (2) EXIF/DateTaken → filesystem times, (3) bulk attribute templates on trees | Timestamps display-only; attrs mostly single-file |
| `link-workshop` | **Link Workshop** | (1) Inventory hardlinks/junctions/symlinks under a root, (2) retarget/repair broken, (3) hardlink collapse for duplicate files | Create-link exists; no manage/repair product (Staging cold tier ≠ this) |
| `recover-lab` | **Recover Lab** | (1) Recycle restore filtered by original folder/date, (2) aging purge policies, (3) secure wipe selection with progress/confirm | Recycle browse basic; wipe is a shell preset |

### 3.1 Killed former “replacements” (do not build)
`share-packets`, `job-tickets`, `space-ledger`, `open-with-lab`, `print-to-bndz`, `contact-sheets`, `duplicate-studio`, `portable-kits`, `safe-zones`.

### 3.2 Parked for later (real gaps, not launch padding)
ACL Lab (bulk take-own / inheritance), Hex Lab, Network Places manager, Directory Reports / print listings, PDF tools / contact sheets → `to-do-future-upgrades.md` after §1–§3 land.

### 3.3 New-plugin acceptance
- [ ] ≥3 workflows E2E per plugin
- [ ] Uninstalled by default
- [ ] No competitor names in Hub copy
- [ ] Command Deck / context only when installed
- [ ] Manual QA checklist per plugin before done

---

## 4. Continuum honesty (separate, non-blocking)

**Pillar Board** must become a real `/bndz/pillars` command center (not a Spatial redirect). Schedule **after** host professionalization so tiles point at real Staging / Cleanup / Intake / Sandbox surfaces. Details formerly in old §3 remain valid; do not block absorb on this.

---

## 5. Extension Hub copy
- [x] Strip XYplorer from marketplace descriptions (prior pass)
- [ ] Re-read all Hub descriptions for competitor names and filler jargon
- [ ] Staging cold-tier naming after Ghost absorb
- [ ] Mesh Drop STUN/TURN plain language (§0.7)

---

## 6. External packages (design-now, ship later)
- [ ] Document minimal future manifest: `id`, `version`, `permissions`, `entry`, `tools[]`
- [ ] Keep new UI on `PluginPanelShell` + typed IPC only
- [ ] Loader / zip-npm / signature check = future release (`to-do.md`) — not launch-blocking

---

## 7. Execution order

1. Agree this relaunch plan (this file).
2. Absorb hosts one-at-a-time; parity checklist green before deleting thin Hub entries.
3. Professionalize host UX (Phase §2).
4. Ship the five gap plugins (§3) only after hosts are credible.
5. Hub copy + migration QA; fresh `npm run build` + Debug `dotnet` per implementation rule.
6. Pillar Board honesty pass.
7. External loader in a later release.

```text
rewrite plan → absorb → deepen hosts → five gap plugins → Hub QA → (later) external packages
```

---

## 8. Sign-off

| Gate | Check |
| --- | --- |
| Every §1.1 checklist box with UI proof | |
| Hosts meet marketplace bar (§0.2 / §2) | |
| Five §3 plugins meet §3.3 (or consciously deferred) | |
| Hub has zero competitor name-drops | |
| No killed §3.1 names reappear | |
| User can explain Mesh Drop networking without saying “STUN” | |

**Do not mark plugin track launch-ready until §8 is complete.**
