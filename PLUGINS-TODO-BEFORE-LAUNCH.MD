# Plugins To-Do Before Launch

**Status:** planning only — do **not** merge, delete, or ship these changes until this doc is executed as an explicit implementation pass.  
**Scope of this file:** absorb thin/filler plugins into nearest real hosts (100% feature retention), replace every lost Extension Hub slot with a **multi-purpose everyday** plugin, and replace the fake Continuum **Pillar Board** card with a real workspace.

Related product rules still apply: `.cursor/rules/bndz-implementation-rule.mdc`, selling pillars in `to-do-selling-points.md`, parity backlog in `to-do-future-upgrades.md`.

---

## 0. Non-negotiables

1. **Zero feature loss.** Every tab, IPC call, rule, recipe, scan, encode preset, vault unlock, policy action, and UI affordance from an absorbed plugin must land in the target plugin (or its host surfaces: list, preview, Command Deck, context menu). No “we’ll add it later.”
2. **No single-purpose leftovers.** Absorbed IDs leave the Extension Hub. Replacement plugins must each ship **at least three distinct everyday workflows** (not three buzzwords for one button).
3. **No competitor name-dropping** in Extension Hub copy (XYplorer / File Pilot / Explorer parity marketing). Describe what BNDZ does.
4. **Uninstall / install state** must re-map: old installed IDs migrate to the absorb target; Hub shows the new plugins as **Uninstalled by default** unless they replace a default.
5. **STUN / TURN (Mesh Drop settings)** are WebRTC networking fields for peer transfer when LAN discovery is not enough. Before launch, rewrite Workspace Tools → Mesh Drop labels into plain language (e.g. “Connection helpers (advanced)” with a one-line help tip) and bury TURN under an “Advanced / rare networks” disclosure — everyday users should not see jargon first.

---

## 1. Absorption map (named thin plugins → nearest host)

| Thin / filler plugin (remove from Hub as standalone) | Absorb **100%** of features into | Why this host |
| --- | --- | --- |
| **Compare** (`compare`) | **Folder Sync** (`folder-sync`) | Diff belongs next to mirror/update/robocopy jobs — “what differs” before/after sync, dual-pane A/B trees, binary + recursive folder results, CSV export. |
| **Drop Magnets** (`drop-magnet`) | **Batch Rename** (`batch-rename`) | Magnets are rename + tag + route recipes on drop — same domain as pattern rename, preview, and safe apply. |
| **Ghost-Link** (`ghost-link`) | **RAM Staging** (`ram-staging`) | Hot RAM staging + cold offload/reparse should be one **Staging** continuum (stage in, flush out, reclaim space without breaking paths). |
| **Library Health** (`library-health`) | **Storage Cleanup** (`storage-cleanup`) | Broken links, orphans, naming conflicts, permission/ref repairs belong with deep clean + capacity planning. |
| **Inbound Volume** (`inbound-volume`) | **DropStack** (`dropstack`) | Clipboard/OCR/watcher intake is inbound staging; DropStack is multi-source staging — one **Intake & Stage** surface. |
| **Transcode Rack** (`transcode-rack`) | **Metadata** (`metadata`) | Batch image encode/resize is media processing beside hashes, EXIF, and bulk file facts — one **File Intelligence** panel. |
| **Semantic Desk** (`semantic-desk`) | **Visual Filters** (`filters`) | Clustering piles into list groups is a smart filter / view layer, not a separate product. |
| **ZK Vault** (`zk-vault`) | **Project Sandbox** (`project-sandbox`) | Encrypted at-rest folders + checkpoint/commit/discard are both “safe experiment / private workspaces.” |
| **Policy Packs** (`policy-packs`) | **DropStack** (`dropstack`) | Drop-time block/warn/reroute rules fire on the same transfer path as staged drops. |

### 1.1 Feature checklists (must all survive)

#### Compare → Folder Sync
- [ ] Binary file compare (hash + first-diff)
- [ ] Recursive folder diff (same / different / only A / only B)
- [ ] Dual-pane path pickers / “use left/right pane”
- [ ] Filter chips and result list navigation
- [ ] Report / CSV export
- [ ] Entry points from dual-pane and context where Compare was wired

#### Drop Magnets → Batch Rename
- [ ] Named magnets / recipes (create, edit, delete)
- [ ] Rename patterns on drop
- [ ] Tag apply on drop
- [ ] Target folder routing
- [ ] Test-against-selection
- [ ] Explorer → BNDZ drop strip / magnet UI (`DropMagnetStrip` and host hooks)

#### Ghost-Link → RAM Staging
- [ ] Cold-storage root and offload rules
- [ ] Scan / offload / restore
- [ ] Ghost inventory and reopen paths
- [ ] Presets (idle age / size rules)
- [ ] Symlink/reparse transparency messaging (honest: “keeps a link at the old path”)
- [ ] Capacity relief without breaking app paths

#### Library Health → Storage Cleanup
- [ ] Library scan summary
- [ ] Problems list (broken links, shortcuts, orphans, empty dirs, locks)
- [ ] Missing project refs tab
- [ ] Repair plan + safe one-click fixes
- [ ] Reality-check / absorbed `reality-check` paths if still aliased

#### Inbound Volume → DropStack
- [ ] Clipboard catcher
- [ ] OCR screenshot / capture inbox
- [ ] Folder watcher intake
- [ ] Review → copy into library / stage
- [ ] Settings for watch roots and capture naming
- [ ] Absorbed `capture-inbox` alias behavior

#### Transcode Rack → Metadata
- [ ] JPEG / PNG / WebP queue
- [ ] Resize + quality presets
- [ ] Background progress
- [ ] Selection → encode into folder / replace-with-confirm

#### Semantic Desk → Visual Filters
- [ ] Cluster into 3–8 piles
- [ ] List group headers / desk overlay
- [ ] Optional ONNX embeddings path when model present
- [ ] Clear/reset clustering

#### ZK Vault → Project Sandbox
- [ ] Encrypt-at-rest vault create
- [ ] Session unlock / lock
- [ ] Folder-level mounts inside BNDZ
- [ ] No cloud key requirement
- [ ] Coexist with checkpoint / commit / discard sandbox flows

#### Policy Packs → DropStack
- [ ] Shareable policy packs
- [ ] Extension / size / tag / deny patterns
- [ ] Block / warn / reroute on drop or move
- [ ] Enforcement on main FM drop path

### 1.2 Hub / config migration tasks
- [ ] Extension Hub: remove absorbed IDs from catalog listings
- [ ] `installedPlugins` migration map (old id → absorb target)
- [ ] Bottom panel last-tab / Command Deck / context-tool registry scrub
- [ ] Absorb aliases already in registry (`capture-inbox` → inbound, `reality-check` → health) follow the new hosts
- [ ] Docs/tooltips: no “Ghost-Link” mystique — call cold staging what it is after merge
- [ ] Smoke: install/uninstall absorb targets; open each migrated feature tab once

---

## 2. Replacement plugins (one net-new Hub entry per absorbed slot)

Each replacement **must** be useful for everyday Windows file work, multi-workflow, and not a rename of the thing we just deleted.

| Replaces lost slot | New plugin id (proposed) | Name | Everyday jobs (minimum 3) | Why it is not filler |
| --- | --- | --- | --- | --- |
| Compare | `share-packets` | **Share Packets** | (1) Bundle selection into a dated zip with manifest, (2) split oversized packs for email/USB, (3) verify packet on receive (hash list), (4) optional password zip | Shipping folders to clients/USB is daily; not “diff with a costume.” |
| Drop Magnets | `job-tickets` | **Job Tickets** | (1) Attach ticket notes to folders/files, (2) due/priority filters in list, (3) hand-off packet (paths + note) to clipboard or DropStack, (4) close/archive tickets | Work tracking on real paths — preview already teases tickets; make it real. |
| Ghost-Link | `space-ledger` | **Space Ledger** | (1) Per-folder growth timeline, (2) “what landed this week” on a drive, (3) pin budgets with warn thresholds, (4) export growth CSV | Answers “where did my disk go?” without another symlink toy. |
| Library Health | `open-with-lab` | **Open With Lab** | (1) See/edit per-extension default apps, (2) one-shot “open with…” profiles, (3) broken association repair, (4) “always ask” toggles for risky types | Everyday Windows pain; multi-surface (list + preview + Hub). |
| Inbound Volume | `print-to-bndz` | **Print to BNDZ** | (1) Virtual printer / PDF drop inbox, (2) rename + file into Downloads/Desktop rules, (3) OCR text sidecar optional, (4) open last print in preview | Capture from any app — broader than clipboard watcher alone. |
| Transcode Rack | `contact-sheets` | **Contact Sheets** | (1) Grid PDF/PNG of folder images, (2) selection storyboard export, (3) video frame strip (interval), (4) print-ready margins | Photographers/designers use this weekly; multi-output not one encode button. |
| Semantic Desk | `duplicate-studio` | **Duplicate Studio** | (1) Content + name duplicate groups, (2) keep/delete assistants, (3) hardlink/symlink optional collapse, (4) scope: selection / folder / drive | Real cleanup tool users search for; not “AI piles.” |
| ZK Vault | `portable-kits` | **Portable Kits** | (1) Build portable tool folders (apps + configs), (2) run-from-USB manifests, (3) sync kit ↔ PC delta, (4) checksum lockfile | Power-user everyday without fake crypto branding. |
| Policy Packs | `safe-zones` | **Safe Zones** | (1) Mark folders as protected (no accidental delete/move), (2) confirm gates for bulk ops, (3) child-account / shared-PC presets, (4) audit last blocked ops | Safety people understand; multi-policy, not one deny regex. |

### 2.1 Replacement acceptance bar
- [ ] Each new plugin has **≥3** distinct user workflows wired end-to-end (UI + IPC + persistence)
- [ ] Default Hub state: **Uninstalled**
- [ ] No competitor names in Hub copy
- [ ] Command Deck / context entries only appear when installed
- [ ] Manual QA checklist written per plugin before marking done

---

## 3. Continuum: fake Pillar Board → real workspace

**Problem:** Continuum “Pillar Board” is not a product. It only flips Spatial Canvas and pins cards. That is dishonest and confuses Spatial vs “pillars.”

### Decision (locked for launch prep)
**Build a real Pillar Board** — do **not** keep a second card that is secretly Spatial.

| Item | Spec |
| --- | --- |
| Path | `/bndz/pillars` (new virtual view; Continuum card navigates here, **not** `/bndz/canvas`) |
| What it is | Full-workspace **command center** for BNDZ selling systems: live status tiles for Staging (RAM+cold), Sandbox, Library/Cleanup health, Inbound/DropStack intake, Capacity/Space Ledger, Automation pipelines, Spatial deep-link |
| What it is not | Not a freeform pin canvas. Spatial Canvas stays the blank board. |
| Card copy | Honest: “Live status for staging, health, intake, capacity, sandbox, and automation — open any system in one click.” |
| Home grid | Replace current Pillar Board `WorkspaceLaunchCard` to `onNavigate(BNDZ_PILLARS)` |
| Minimum tiles | Staging · Sandbox · Cleanup/Health · Intake · Capacity · Automation · Open Spatial (explicit secondary action) |
| Live data | Badges from existing services (free space, inbound count, sandbox sessions, pipeline count) — no fake “SETTING PILLARS” theater |

### 3.1 Pillar Board tasks
- [ ] Add `BNDZ_PILLARS` + view component (not a redirect)
- [ ] Wire Continuum card + any Spatial “Open Pillar Board” CTAs that currently fake it
- [ ] Remove sessionStorage `bndz-pending-pillar-board` hack that only seeds Spatial
- [ ] Tree/label/displayPath support for `/bndz/pillars`
- [ ] QA: Home → Pillar Board never lands on empty Spatial with a toast

---

## 4. Extension Hub copy pass (launch)

- [x] Strip **XYplorer** from marketplace descriptions/capabilities (`compare`, `action-log`) — done in the same change set as this file
- [ ] Re-read **all** Hub descriptions for competitor names and filler (“parity”, “constellation”, “desk overlay”)
- [ ] Rename Ghost-Link user-facing strings after absorb (Staging cold tier)
- [ ] Mesh Drop: plain-language STUN/TURN (see §0.5)

---

## 5. Execution order (when implementing — not this turn)

1. Write absorb feature matrices into tickets; freeze Hub catalog IDs.
2. Migrate features into hosts; delete thin plugin modules only after parity checklist green.
3. Ship replacement plugins one-by-one with QA.
4. Ship real Pillar Board + Continuum card swap.
5. Hub copy + Mesh Drop wording pass.
6. Full install/uninstall + default-plugin regression.

---

## 6. Explicitly out of scope for “absorb” (keep)

These are multi-workflow or host-critical — **do not** dissolve as part of this cleanup unless a later pass proves overlap:

- System Properties, Fast Search / Find, Visual Filters (host after Semantic absorb), Batch Rename (host), DropStack (host), Metadata (host), Storage Cleanup (host), Folder Sync (host), Catalog, Action Log, Remote / Mesh, RAM Staging (host), Project Sandbox (host), Branching Time, Design Board / OpenShop, Context Menu Manager, Icon Studio

---

## 7. Sign-off

| Gate | Owner check |
| --- | --- |
| Every §1 checklist box checked with UI proof | |
| Nine replacement plugins meet §2.1 | |
| Pillar Board is a real `/bndz/pillars` surface | |
| Hub has zero competitor name-drops | |
| User can explain Mesh Drop networking without saying “STUN” | |

**Do not mark launch-ready until §7 is complete.**
