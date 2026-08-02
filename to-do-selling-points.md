# BNDZ Phase 9+ — Selling Points (8 × 3 real implementations)

**Prerequisite:** [`to-do.md`](to-do.md) Phases 1–8.

**Rule for this doc:** Each pillar has **three architectures that disagree with each other**. Different storage model, different Windows API surface, different product behavior. If you can swap A for B by changing a button placement, it is not a separate implementation.

**Not selling points:** anything already in repo (RAM staging, GhostLink, Spatial, Automation, Lens, mesh, music analysis, tabsets). Those live in [`to-do-future-upgrades.md`](to-do-future-upgrades.md).

---

## 1 — Project Sandbox (`sell-sandbox-overlay`)

**Sell:** Wrap a project tree. Work freely. **Commit** or **Discard** the whole thing.

### Impl A — WinFsp COW virtual volume
Mount a WinFsp user-mode drive (`P:\`) that presents the project as a virtual tree. Reads come from the real folder; writes land in a shadow store under `%LocalAppData%/BNDZ/Sandbox/<id>/`. Commit = merge shadow → real; Discard = delete shadow + unmount. Other apps (DAWs, editors) see a normal drive letter.

- **Stack:** [WinFsp](https://github.com/winfsp/winfsp), C# host service, transfer queue for commit merge
- **Tradeoff:** Needs WinFsp redist; best app compatibility
- **Feels like:** "This project lives on P: until I commit"

### Impl B — Windows ProjFS hydrate + mutate journal
Use Microsoft **Projected File System** (same family as GVFS/OneDrive placeholders). Project the real tree into a sandbox root. First read hydrates; mutations write a journal of deltas (not a full shadow tree). Commit = apply journal; Discard = drop placeholders + journal.

- **Stack:** ProjFS APIs (CsWin32 / Vanara), SQLite journal of ops
- **Tradeoff:** Windows-native, no third-party FSD; weaker for apps that hate placeholders
- **Feels like:** "Cloud-files UX, but the cloud is your own disk and you own Commit/Discard"

### Impl C — Transactional op log (no virtual FS)
BNDZ intercepts **only its own** FS ops (and optional shell IFileOperation hook). Every delete/move/rename/write is recorded as reversible intents against a snapshot index (content hashes of touched files). Commit = finalize intents; Discard = reverse from snapshots. No drive letter — works inside normal panes.

- **Stack:** Existing transfer queue + content-addressed blob store + tombstones
- **Tradeoff:** Only covers ops BNDZ sees; external apps bypass the sandbox
- **Feels like:** "BNDZ undo for the whole project session, not one file"

---

## 2 — Library Health OS (`sell-library-health`)

**Sell:** A file manager mode that shows **what's broken**, not what's there.

### Impl A — Offline health index (Everything-speed)
Nightly / on-demand walk builds a dedicated `health.db`: broken reparse points, missing ghost targets, path length >260, ACL denials, orphan sidecars, size-matched dups (reuse `DuplicateFinderService` hashes), empty dirs, MOTW ZoneId=3 in System32, etc. UI is a **Problems** root (like a virtual drive) with severity + one-click fix recipes.

- **Stack:** SQLite health schema, `BndzFileIndexService` join, Find-plugin-style results but problem-typed
- **Tradeoff:** Stale until refresh; cheap CPU
- **Feels like:** "Antivirus for your library structure"

### Impl B — Live ETW / USN health stream
Subscribe to USN journal + optional ETW file events. Health state updates **as things break** (symlink target deleted → problem appears in <2s). Bottom panel is a live "sick bay" feed; list rows get problem badges without a full rescan.

- **Stack:** `Meziantou.Framework.Win32.ChangeJournal`, event aggregator, badge IPC
- **Tradeoff:** Needs privileges for full USN; continuous work
- **Feels like:** "Problems appear the moment the filesystem lies"

### Impl C — Constraint solver + auto-repair plans
Same problem catalog as A, but the product is not a list — it is a **repair plan**. User sets goals ("free 50GB", "zero broken links", "no dups under Samples"). Solver outputs ordered actions (ghost / delete / re-link / move) with impact preview; Approve runs the plan through the transfer queue.

- **Stack:** Constraint ranking engine + transfer queue + GhostLink/dup services as actuators
- **Tradeoff:** Harder UX; highest "wow" if correct
- **Feels like:** "I don't browse problems — I approve a fix"

---

## 3 — File Lineage (`sell-file-lineage`)

**Sell:** Every file answers: **where did you come from, and what did you become?**

### Impl A — Windows forensic harvest (read-only)
On focus/preview: read `Zone.Identifier` ADS (HostUrl, ReferrerUrl), USN history for renames, shell link targets, Jump List / RecentDocs hits, browser download DB joins when available. Render a **lineage timeline** in preview. No new writes — pure archaeology.

- **Stack:** ADS reader, USN, optional Edge/Chrome History DB (read-only), `BndzLensStage`-style panel
- **Tradeoff:** Incomplete for files without MOTW; privacy-sensitive
- **Feels like:** "Forensics for normal people"

### Impl B — BNDZ provenance bus (write-ahead)
Every BNDZ op (copy, move, download-via-BNDZ, mesh receive, sandbox commit, rename) writes a provenance edge to `lineage.db`. External apps can be covered by optional shell copy hook. Preview graph is **authoritative for BNDZ-touched files**.

- **Stack:** Append-only SQLite edges `{from,to,op,ts,actor}`, IPC on every transfer
- **Tradeoff:** Incomplete history before install; strong after
- **Feels like:** "BNDZ never forgets what it did to your files"

### Impl C — Content-identity lineage (hash genealogy)
Ignore paths. Fingerprint content (XxHash/BLAKE3). When the same bytes appear under a new path, or a near-hash after edit (audio/image perceptual optional later), link nodes: `parent-content → child-content`. Lineage is a **content DAG**, not a path timeline.

- **Stack:** Extend `DuplicateFinderService` hashing into persistent content graph
- **Tradeoff:** Costly; powerful for "this stem is a bounce of that stem"
- **Feels like:** "DNA of the file, not the folder it sat in"

---

## 4 — Capacity Solver (`sell-capacity-solver`)

**Sell:** "40 GB free, 200 GB project" → one **approved plan**, not a scavenger hunt.

### Impl A — Greedy multi-actuator planner
Inputs: free space, target free, recency, size, dup groups, ghost-eligibility. Outputs ranked actions across **actuators that already exist** (GhostLink offload, delete dups, archive zip, eject RAM). UI is a plan sheet → Approve.

- **Stack:** Planner service + GhostLink + DuplicateFinder + transfer queue
- **Tradeoff:** Heuristic, not optimal; ships fast
- **Feels like:** "One button that knows all your tools"

### Impl B — What-if sandbox (dry-run volume)
Solver clones the **directory listing + size model** into a simulated state (no disk writes). User scrubbers ("keep last 14 days hot") recompute free-space outcome live. Only then materialize ops.

- **Stack:** In-memory FS model from index; UI scrubbers; then emit real jobs
- **Tradeoff:** Simulation ≠ reality for sparse/reparse; great UX
- **Feels like:** "Photoshop history for disk pressure"

### Impl C — Always-on budget governor
Per volume / per project **quota policy**. BNDZ blocks or redirects ops that would breach budget (new copies go to cold root; large drops require confirm). Solver is continuous, not a button.

- **Stack:** Policy engine in transfer/drop path; soft/hard quotas
- **Tradeoff:** Can annoy; unique "FM as OS disk policy"
- **Feels like:** "My drive can't be accidentally filled"

---

## 5 — Shell Succession (`sell-shell-succession`)

**Sell:** BNDZ is how Windows opens folders — not a toy beside Explorer.

### Impl A — Default folder verb replacement
Register BNDZ as handler for `Folder` / `Directory` open verbs (and pinned-folder handoff). Desktop / taskbar / "Open folder location" launches BNDZ with the path. Recycle / common dialogs stay Explorer unless opted in.

- **Stack:** Registry verb registration, single-instance IPC activate-with-path
- **Tradeoff:** Contested with Explorer; reversible
- **Feels like:** "Double-click a folder → BNDZ"

### Impl B — Shell Namespace Extension (virtual root)
Expose `BNDZ:\\` (or This PC child) as a **namespace extension**: Continuum, Health, Sandboxes, Mesh peers as shell folders visible even inside native Explorer / file dialogs. BNDZ features leak into the OS without replacing Explorer.

- **Stack:** COM NSE (C++/C# with care), Vanara shell
- **Tradeoff:** Hard COM; huge lock-in when done right
- **Feels like:** "BNDZ places appear everywhere Windows has a tree"

### Impl C — Explorer replacement host (fullscreen shell)
BNDZ can run as the **shell replacement** session (optional advanced mode): own desktop icons / taskbar integration / folder windows are BNDZ frames. Extreme power-user path.

- **Stack:** Shell replacement patterns, Win32 desktop integration
- **Tradeoff:** Highest risk / support cost
- **Feels like:** "Windows runs on BNDZ"

---

## 6 — Branching Time (`sell-branching-time`)

**Sell:** Folder history with **branches**, not a single undo stack. "Before the agent wrecked it."

### Impl A — VSS shadow branches
Before bulk ops (or on schedule), create a Volume Shadow Copy; BNDZ UI lists named branches (`pre-agent`, `friday-export`). Open branch = read-only virtual listing of that snapshot; Restore selected paths from branch → live tree.

- **Stack:** AlphaVSS / Vanara VSS, virtual listing provider
- **Tradeoff:** Volume-scoped; admin; Windows-native durability
- **Feels like:** "System Restore, but for one project folder UI"

### Impl B — Content-addressed time machine (unf-class)
Watch project roots; every change stores content-addressed blobs + manifests (like [undo-anything](https://github.com/agenticraptor/undo-anything) / unf). Branch = pointer in a DAG of manifests. Scrub UI in bottom plugin; restore any path at any node.

- **Stack:** Dedup blob store under `%LocalAppData%/BNDZ/TimeMachine`, FSW/USN
- **Tradeoff:** Disk for history; works without VSS privileges
- **Feels like:** "Git for folders without git"

### Impl C — Named sandbox checkpoints (depends on Pillar 1)
If Project Sandbox exists: **Checkpoint** freezes current shadow as a branch tip; continue working; switch checkpoint = swap active shadow. No whole-volume VSS; project-scoped.

- **Stack:** Sandbox shadow dirs as branch refs
- **Tradeoff:** Only covers sandboxed projects
- **Feels like:** "Save states for a project session"

---

## 7 — Work Intent Surfaces (`sell-intent-surfaces`)

**Sell:** The FM **changes personality** by job — Ingest / Archive / Fix / Ship / Review — not a theme.

### Impl A — Layout + chrome compiler
Each intent is a declarative pack: columns, sort, plugins shown, toolbar actions, default Automation graph, preview mode, confirm strictness. Switching intent **recompiles** the host chrome from the pack (persisted per window).

- **Stack:** Intent JSON packs, `BNDZUI` layout apply, settings registry
- **Tradeoff:** UX complexity; pure product layer
- **Feels like:** "Different apps inside one exe"

### Impl B — Path-bound intents (folder contracts)
Folders carry `.bndz-intent` (or ADS / desktop.ini sibling). Entering the folder **forces** intent chrome + allowed ops (e.g. Archive folder forbids accidental delete without confirm). Intent travels with the library on disk.

- **Stack:** Sidecar reader on navigate, ACL-like op gates in transfer path
- **Tradeoff:** Portable across machines; surprise if misunderstood
- **Feels like:** "The folder knows what it's for"

### Impl C — Intent from live context graph
No manual picker. Intent inferred from: selection types, recent ops, open Spatial board, active Automation graph, disk pressure. Host suggests "Switch to Fix?" with one confirm; declines stay sticky.

- **Stack:** Context scorer + `LocalAiService` optional; never auto-switch without confirm
- **Tradeoff:** Magic can be wrong; must be humble
- **Feels like:** "It notices what I'm doing"

---

## 8 — Inbound Reality Volume (`sell-reality-clipboard`)

**Sell:** Clipboard, downloads, and drops are a **real place** in the sidebar — not ephemeral OS chrome.

### Impl A — Virtual folder provider (clipboard watch)
BNDZ watches clipboard (files + text/images saved as artifacts). Sidebar root `Inbound/Clipboard` lists entries with TTL. Drag into a real folder = copy from artifact store. Survives app focus loss.

- **Stack:** Clipboard listener service, artifact dir, virtual listing IPC
- **Tradeoff:** Custom virtual root only inside BNDZ
- **Feels like:** "Clipboard is a folder"

### Impl B — WinFsp / ProjFS Inbound drive
Expose `I:\` (Inbound) as a real drive so **any app** can Save As / export into Inbound. Subfolders: `Clipboard`, `Downloads` (junction or mirror), `Drops`. TTL cleaner. Same as A but OS-visible.

- **Stack:** WinFsp or ProjFS + junctions to Downloads
- **Tradeoff:** Drive letter; maximum interoperability
- **Feels like:** "A real inbound tray on my PC"

### Impl C — Shell NSE + common-dialog hook
Inbound appears in Explorer / file dialogs via namespace extension; BNDZ also optionally injects "Send to Inbound" verb. No drive letter; deep OS integration.

- **Stack:** Shell NSE + context menu handler
- **Tradeoff:** COM complexity; pairs with Shell Succession B
- **Feels like:** "Inbound is part of Windows"

---

## Ship order (after Phases 1–8)

1. **Project Sandbox** — category-defining, demoable  
2. **Branching Time** — trust after agents / bulk ops  
3. **Library Health** — daily value  
4. **File Lineage** — "how did this get here"  
5. **Capacity Solver** — disk panic moments  
6. **Inbound Reality Volume** — constant convenience  
7. **Work Intent Surfaces** — power-user lock-in  
8. **Shell Succession** — last (OS politics / support)

---

## One-line pitches

| Pillar | Pitch |
|--------|-------|
| Sandbox | Commit or discard an entire project like a transaction |
| Health | Browse what's broken, approve the fix |
| Lineage | See where a file came from and what it became |
| Capacity | One plan when the disk is out of room |
| Shell Succession | Windows opens folders in BNDZ |
| Branching Time | Folder save-states and branches |
| Intent Surfaces | The FM changes job with you |
| Inbound Volume | Clipboard and downloads are a place |
