# Plugins To-Do Before Launch

**Status:** absorption + professionalize first. Net-new Hub plugins wait until after launch polish of what we already have.

Plain English goal: fold thin/overlapping plugins into the plugins that already own that job, make the survivors feel like real tools, ship the app. Build brand-new marketplace plugins after that.

---

## Later (do not build in the absorb pass)

Write these down so we don’t lose them. They take Hub slots **after** absorption, when we’re ready for net-new work:

| Idea | Direction |
| --- | --- |
| **Archive** | WinRAR / 7-Zip–class plugin (create, extract, browse, test). We already have preview-panel archive support — this would be the full product surface. |
| **Text Editor** | Our own Notepad++–style editor plugin (tabs, syntax, find/replace, encoding) — useful and distinct. |

More net-new ideas only after those two (or instead of them) are designed properly. No filler “replacement” catalogs.

---

## Also for launch polish (not plugins, but called out)

| Surface | Files | Need |
| --- | --- | --- |
| **About** popup | [`src/components/AboutDialog.tsx`](src/components/AboutDialog.tsx) | Stronger brand/craft — less bare version sheet |
| **Serial / Register** | [`src/components/RegisterDialog.tsx`](src/components/RegisterDialog.tsx), [`TrialExpiredGate.tsx`](src/components/TrialExpiredGate.tsx), [`LicenseBanner.tsx`](src/components/LicenseBanner.tsx) | Clearer activation UX, more professional purchase/activate flow |

Schedule after or alongside host professionalization — same launch bar.

---

## Non-negotiables for absorption

1. **Features move, they don’t die.** Everything the thin plugin could do must still work inside the host (tabs, IPC, drop hooks, Command Deck entries remapped).
2. **Hub drops the old names.** After absorb, users install the host plugin, not the old id.
3. **If someone had the thin plugin installed,** config remaps to the host so they don’t lose access.
4. **No auto-install.** Opening a tool never silently installs a plugin.
5. **Make hosts actually good** — not a junk drawer of dumped tabs. One clear product story per host.

---

## Absorption map (this is the work)

| Thin / overlapping plugin (leaves Hub) | Moves into | What the user gets |
| --- | --- | --- |
| Magnets | **Batch Rename** | Rename patterns + drop recipes (rename / tag / route) in one place |
| Encode | **Metadata** | File facts + media tags + image encode queue |
| Groups | **Filters** | Smart grouping as part of filters/views |
| Policies | **Drop Zone** | Staging drops + rules that block/warn/reroute |
| Vault | **Sandbox** | Safe workspaces: sandbox checkpoints + encrypted vault |
| Compare | **Folder Sync** | Diff folders/files next to sync jobs |
| Intake (+ Captures) | **Drop Zone** | Clipboard / OCR / folder watchers + staging |
| Offload | **Staging** | One **Staging** tool: fast RAM stage + cold offload that keeps a path link |
| Health (+ Missing Files) | **Cleanup** | Cleanup, capacity, and library repair in one ops plugin |

**Already folded earlier (keep):** Shell Verbs → Context Menus; Capacity → Cleanup.

### Leave alone (keep as their own Hub plugins)

Properties, Search, Filters, Batch Rename, Drop Zone, Metadata, Cleanup, Folder Sync, Catalog, History, Remote/Mesh, Staging, Sandbox, Snapshots, Design, Context Menus, Icons.

---

## Feature must-move checklists

### Magnets → Batch Rename
- [ ] Named magnets (create / edit / delete)
- [ ] Rename on drop, tag on drop, route to folder
- [ ] Test against current selection
- [ ] Desktop → BNDZ magnet strip still works

### Encode → Metadata
- [ ] JPEG / PNG / WebP queue, resize, quality
- [ ] Progress; encode to folder or replace with confirm

### Groups → Filters
- [ ] Cluster folder into piles; show as list groups
- [ ] Optional embeddings when a model is present; clear/reset

### Policies → Drop Zone
- [ ] Policy packs (patterns → block / warn / reroute)
- [ ] Still enforced on real FM drops

### Vault → Sandbox
- [ ] Create vault, unlock/lock session, browse mount
- [ ] Works beside checkpoint / commit / discard

### Compare → Folder Sync
- [ ] File binary compare + recursive folder diff
- [ ] Pick left/right paths; filters; CSV/report
- [ ] Dual-pane / old Compare entry points still open Diff

### Intake → Drop Zone
- [ ] Clipboard catcher, OCR captures, folder watchers
- [ ] Review → stage or copy into library; settings

### Offload → Staging
- [ ] Cold root, rules/presets, scan, offload, restore, inventory
- [ ] Honest UI: “keeps a link at the old path” (call it Staging cold tier, not mystique)

### Health → Cleanup
- [ ] Scan summary, problem list, missing refs, repair plan
- [ ] Reality-check paths still reachable

### Wiring cleanup (every absorb)
- [ ] Remove old id from Plugins catalog
- [ ] Remap `installedPlugins` + bottom tabs + Command Deck tools
- [ ] Smoke: install host, open each moved feature once

---

## Professionalize hosts (same phase)

After features land, each host should feel like one product:

| Host | Story |
| --- | --- |
| Drop Zone | Intake & stage (stash + inbound + policies + batch move/copy) |
| Staging | Staging (hot RAM + cold offload) |
| Cleanup | Cleanup & health |
| Metadata | File intelligence (facts + tags + encode) |
| Batch Rename | Rename & magnets |
| Folder Sync | Sync & diff |
| Filters | Filters (+ smart groups) |
| Sandbox | Safe workspaces (sandbox + vault) |

Polish copy, empty states, selection wiring, and Uiverse-level craft. Defaults already shipping (Properties, Search, etc.) get the same quality bar — no fake new tabs.

---

## Order of work

1. Remap plumbing (`RETIRED_PLUGIN_REMAP`, Command Deck, Hub catalog) as each absorb lands  
2. Absorb one host at a time (checklist green before deleting the old Hub entry)  
3. Professionalize that host’s UI/story  
4. About + Register/serial polish  
5. Launch with a smaller, stronger Hub  
6. **Later:** Archive plugin, Text Editor plugin  

```text
absorb → professionalize hosts → About/Register polish → launch
        → (later) Archive + Text Editor
```

---

## Sign-off (absorption track)

| Gate | Done when |
| --- | --- |
| Every must-move checklist item works in the host | |
| Old thin ids gone from Hub; remaps work | |
| Hosts read as one product each, not dumped tabs | |
| About + Register feel launch-ready | |
| Archive + Text Editor are only listed under Later — not fake-shipped | |


## Absorption progress

- [x] Magnets → Batch Rename (Magnets tab + Hub remap + strip kept)
- [x] Compare → Folder Sync (Diff tab + Hub remap)
- [x] Transcode → Metadata
- [x] Groups → Filters
- [x] Policies + Inbound → Drop Zone
- [x] Vault → Sandbox
- [x] Offload → Staging
- [x] Health → Cleanup

## Professionalize progress

- [x] Remap plumbing hardened (Command Deck, Quick Actions, work-intent, deep-links)
- [x] Drop Zone new-stack crash fixed
- [x] Host product titles/stories + Hub capability copy
- [x] Embedded child chrome renamed to host language (Magnets, Diff, Encode, Groups, Intake, Policies, Vault, Cold, Health)
- [x] About + Register dialog polish
- [x] Display names standardized (Filters, Metadata, Drop Zone, Staging, Sandbox, Snapshots, …)
- [x] About / Register / menubar / Size Map professionalized (flat FM chrome)
- [ ] User smoke: install remaps, open each absorbed tab, Command Deck gating
