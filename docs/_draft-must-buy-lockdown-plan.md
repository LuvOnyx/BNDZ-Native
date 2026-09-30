# BNDZ Must-Buy Lockdown Plan
**Scope:** BNDZ-Native only · Week 1 Undo truth shipped · Week 1-2 Recycle + multi + conflict->log in progress  
**Date:** Wed Sep 30, 2026 (CT)  
**Evidence:** `docs/BNDZ-PREMIUM-GAP.md`, V2 playbook, launch readiness, Action Log / undo code (`BndzActionLogService`, `undoRedo.ts`, History dialog), recent commits (remote unfreeze, toasts, DnD, Home, Command Hub)

---

## 1. North star — what “people beg to pay” means

Not a feature checklist. Daily moments where someone stops comparing and just stays:

| Moment | What it must feel like |
|--------|------------------------|
| **Open** | Cold start → real folder list, no “is it frozen?” pause. Home / Rapid access land somewhere useful. |
| **Browse** | Tree + breadcrumbs + tabs remember where you were. Big folders scroll without drama. Preview / Spacebar work without leaving the list. |
| **Move** | Drag, cut/paste, or Other Pane move does exactly what you meant. Progress is honest. Conflicts ask once, clearly. |
| **Undo** | Ctrl+Z brings the last file op back. Delete → files return. Move → files go home. Redo (Ctrl+Y / Ctrl+Shift+Z) puts it back. If it can’t undo, it says so *before* you trust it. |
| **Trust** | No fake success toasts. No half-dead Remote tabs. No “History says undoable” then “Nothing to undo.” You’d hand a friend your license key without an apology. |

**Bar in one sentence:** *Mikey reaches for BNDZ instead of XYplorer for ordinary file work because it does what it says — especially when he messes up.*

---

## 2. Honest current state

### Already strong (keep; don’t rip)
- **Core shell craft** — tabs + tabsets that restore, dual pane, tree / Mini Tree / breadcrumbs / Rapid access, virtualized list, views + sort/group/filter, selection, inspector + Quick Look, omnibar filter / Everything hook.
- **Ops skeleton** — cut/copy/paste, delete → Recycle (Shift+Delete permanent), transfer queue with pause/cancel, conflict modal, destination picker.
- **Recent ship wins (working branch):**
  - Remote / VPS rename·delete·mkdir **unfrozen** (`e779b9a0`)
  - Louder transfer plaque / Windows progress / less “Loading…” noise
  - Outbound OLE DnD into Explorer (`820b5851`) + inbound craft from Launch Ready
  - Home dashboard fixes (`cc89b1f6`)
  - Omnibar **Command Hub** expanded (`c62221c1` / earlier hub work)
  - Capacity meter honesty + green healthy storage; Cleanup Overview wheel restored
  - SaaS chrome flattened on core FM surfaces
- **Undo exists as a system**, not a stub: backend Action Log with inverse ops, History dialog, Ctrl+Z/Y wired, long undo timeout fix, early-record so slow native ops don’t leave “Nothing to undo.”

### Still feels cheap / risky (why it isn’t buy-worthy yet)
- **Undo/Redo is the trust hole.** Wired, but flaky in daily use; **undelete and un-move are the pain Mikey named**. Launch readiness still has Undo delete / Redo as open gates (rows 32–33). Recycle restore gates (12–15) also unsigned.
- **Copy/move/delete trust** — conflict/UAC live gates still open; big-folder speed / long session not signed.
- **DnD** — better, but launch DnD rows 46–58 still ☐; drag tooltip / X-cursor polish still open in DoD.
- **Dual pane / keyboard density** — not TC-muscle-memory (F5 still refresh). Fine for Explorer users; not “finished power FM” yet.
- **Archives** — browse in preview, not as a normal folder path.
- **Batch rename** — lives as a Hub plugin, not first-class shell.
- **Plugins sprawl** — Cleanup / Remote still show thin or demo-ish tabs (Live Share, Temp cloud, Organize marketing cards). Marketplace install story still fake. None of that sells the core FM.
- **Launch readiness** — most of the 100 live gates still unchecked. Code gates can say PASS while the product still feels unfinished on a real PC.

**Bottom line:** Shape of a premium FM is there. The *promise* breaks when you delete or move something and Ctrl+Z doesn’t save you.

---

## 3. Must-buy pillars (ranked)

About six pillars. Trust first. Cosmetics last.

### Pillar 1 — Undo / Redo spine (FIRST-CLASS)
- **Why buyers care:** File managers earn money by being a safety net. One failed undelete = refund brain. This is the #1 reason Mikey says it isn’t buy-worthy.
- **What’s broken / missing now:** Ctrl+Z/Y don’t always fire or succeed; History can claim undoable when inverse fails; delete→undelete and move→unmove are the worst; multi-file, permanent delete, remote/mesh, and “after quit” limits are muddy. (Detail in §4.)
- **Ship target (done when):** Local Recycle deletes and local moves/renames undo/redo reliably via Ctrl+Z/Y *and* History; toast tells truth; permanent delete never pretends; remote ops either undo or say “not undoable here” up front. Live checklist: delete one + many, move one + many (list + DnD + paste), rename, copy-then-undo, Shift+Delete honesty, redo chain.
- **Effort:** **L**
- **Risks:** Path mismatches after conflict rename; Recycle restore by original path; early-record vs failed ops; remote/mesh without a real inverse.

### Pillar 2 — Delete / Recycle honesty
- **Why:** Undelete only works if Recycle path is solid. Empty / restore / permanent must match what History claims.
- **What’s missing:** Launch gates 12–15, 29–31 unsigned; Action Log restore can fail if bin purged, emptied, or path matching misses.
- **Ship target:** Recycle list, restore one/many, empty bin, permanent from bin, and Action-Log undelete all pass live; UI never offers Undo for permanent deletes.
- **Effort:** **M** (overlaps Pillar 1)
- **Risks:** Shell Recycle quirks across drives; STA / property key edge cases.

### Pillar 3 — Move / copy / conflict trust
- **Why:** Daily bread. Failed move without undo = data panic.
- **What’s missing:** Conflicts/UAC not live-signed; DnD + Other Pane + paste must all hit the same logged engine; progress toasts must not lie.
- **Ship target:** Internal DnD, Explorer↔BNDZ OLE, paste, Other Pane copy/move — same conflict UI, same Action Log entry, honest queue. Un-move works for those paths (see §4).
- **Effort:** **M–L**
- **Risks:** OLE boundary handoff; conflict “keep both” renaming breaking inverse paths.

### Pillar 4 — Browse / open / session feel
- **Why:** First 30 seconds decide “pro” vs “toy.”
- **What’s missing:** Cold start / 10k scroll / session gates open; Home + Command Hub recent but must stay useful, not pretty-only.
- **Ship target:** Cold start interactive on C:\; tabs restore; Home not broken; Command Hub finds places + real FM commands; big folder scroll usable.
- **Effort:** **M**
- **Risks:** Chasing polish instead of signing gates.

### Pillar 5 — Remote: don’t freeze, don’t fake undo
- **Why:** Remote unfreeze was real progress; buyers hate frozen rename/delete. Fake local-style Ctrl+Z on remote will destroy trust.
- **What’s missing:** Mesh/remote FS ops are outside the local Action Log inverse model; thin Remote tabs still look like demos.
- **Ship target:** Local-feel rename/delete/mkdir stay unfrozen; either (a) limited remote undo with a clear toast, or (b) explicit “Remote changes aren’t on Ctrl+Z — use Recycle/host tools.” Hide Live Share / Temp cloud until finished.
- **Effort:** **M** for honesty; **L** if full remote undo
- **Risks:** Over-promising mesh undo; scope creep into Incus/VPS novelty.

### Pillar 6 — Core density & keyboard (no TC cosplay required)
- **Why:** Power users feel “finished” when hands stay on keys.
- **What’s missing:** Explorer-like chords, not TC F5/F6 loop; dual pane optional.
- **Ship target:** Documented daily chord set works every time (rename, delete, undo, dual pane toggle, filter, preview). No dead shortcuts when focus is in the list.
- **Effort:** **S–M**
- **Risks:** Rebinding wars; focus stolen by omnibar/plugins.

### Pillar 7 — Proof pass (buy gate)
- **Why:** Code PASS ≠ buy-worthy. Mikey’s gut is the product bar.
- **What’s missing:** `fm-launch-readiness.md` mostly ☐.
- **Ship target:** Sign the core rows that map to Pillars 1–4 (nav, delete/recycle, undo/redo, DnD, transfers). One written “Mikey would pay” note.
- **Effort:** **M** (mostly live time, not code)
- **Risks:** Signing theater without real clicks.

---

## 4. Pillar deep-dive — Undo / Redo spine

### What exists today (grounded)
- **Shortcuts:** Ctrl+Z undo, Ctrl+Y / Ctrl+Shift+Z redo (`keybindings.ts` + `BNDZUI`).
- **Host Action Log:** `BndzActionLogService` — undo stack + redo stack, optional persist under `%AppData%\BNDZ64\action_log.json` (off by default).
- **Kinds with inverse logic:** Move, Rename, BatchRename, Copy, Delete (Recycle only), Create folder/file/link, archives create/extract, sync folder, Ghost Link offload/restore.
- **Delete inverse:** Recycle Bin `RestoreByOriginalPath` (shell undelete). Permanent delete → explicitly *not* undoable.
- **Move/Rename inverse:** move targets back to recorded source paths (and forward again on redo).
- **UI:** Edit → History dialog; Action Log plugin; toolbar canUndo/canRedo refreshed from host (comment notes FE used to lag deletes).
- **Hardening already in tree:** 120s undo timeout; early Record so slow ops don’t leave empty stack; discard last entry if op fails after optimistic record; undo/redo runs as high-priority transfer jobs.

### Ctrl+Z / Y scope today
| Works in theory | Fragile / incomplete | Explicitly cannot |
|-----------------|----------------------|-------------------|
| Local move / rename / batch rename | Path after conflict “keep both”; DnD vs menu parity | Permanent delete (Shift+Delete / bypass) |
| Local copy (undo = delete copy) | Multi-file when max-items-per-log truncates | Anything after Recycle emptied / item purged |
| Recycle delete → restore | Restore-by-original-path misses | After quit if “remember between sessions” is off (default) |
| Create folder/file/link | Empty-folder-only undo for create-dir | Ops never recorded (some remote/mesh paths) |
| History “undo through selection” | Single-step undo setting shrinks stack to 1 | Outside apps’ moves (Explorer moved it, not BNDZ) |

### Gaps Mikey named (must fix)

**A. Ctrl+Z / redo don’t always work**
Likely causes to grind, not guess-ship:
1. Focus / shortcut swallowed (input field, plugin, omnibar).
2. FE `canUndo` vs host race (partially mitigated — still verify live).
3. Early Record with *planned* paths ≠ actual paths after collision rename → inverse looks for missing file.
4. Undo queued in transfer panel → user thinks it failed; or reverse.
5. Settings: logging off, single-step undo, prompt-before-undo blocking flow.

**B. Undelete doesn’t work (or feels like it doesn’t)**
1. Delete not logged (`logActionsAndEnableUndoRedo` / engine path).
2. `UsedRecycleBin` false → History `canUndo` false — good — but default Delete must always set Recycle true.
3. `RestoreByOriginalPath` fails (name/path normalize, already restored, bin emptied).
4. List doesn’t refresh after restore → “it didn’t work.”
5. Recycle Bin virtual folder itself unsigned (launch 12–15).

**C. Un-moving doesn’t work**
1. Move logged with wrong target list (folder vs full dest file path).
2. Inverse `move` destination semantics wrong for “put file back at exact old path.”
3. DnD / OLE / Other Pane path skipped Action Log or double-recorded then discarded.
4. Cross-volume move = copy+delete under the hood → inverse incomplete.
5. Source folder gone / locked / UAC — error toast must say why.

**D. Multi-file**
`MaxItemsPerLoggedAction` can truncate; partial undo worse than none. Done = either full multi undo or refuse to log truncated batches with a clear message.

**E. Remote / mesh**
Local Action Log inverses are filesystem-local. Remote delete/move must not silently no-op on Ctrl+Z. Prefer honest “not undoable” until a real remote inverse exists.

### Proposed architecture (plan only — no code now)

Think **action log + inverse ops** (already the shape — finish it, don’t reinvent):

1. **One write path:** Every user-facing local copy/move/rename/delete/create goes through the same recorder *after* real destinations are known (or early record patched to actual paths on success).
2. **Inverse table (product promise):**
   - Move/Rename → move back (exact paths)
   - Copy → delete created targets (not originals)
   - Delete+Recycle → shell restore
   - Delete permanent → no entry / or entry with canUndo=false
   - Create → remove if still empty/safe
3. **Truth UI:** Toast on undo: “Restored 3 items from Recycle” / “Moved Photos back to D:\Work” / “Can’t undo — permanent delete” / “Can’t undo — file missing from Recycle.”
4. **History:** Keep Edit → History; disable Undo on rows that aren’t reversible; never show green “undoable” for permanent.
5. **Persistence (settings, honest defaults):**
   - Default: session memory only (current default).
   - Optional: remember between sessions — with warning that Recycle/disk may have changed.
6. **Tests / live script:** Scripted matrix in launch readiness — one file, many files, DnD move, paste move, Recycle delete, Shift+Delete, redo, quit+reopen with persist off.

### What NOT to promise
- Undo after **app quit** unless “remember actions between sessions” is on — and even then, only if files still exist where expected.
- Undo **permanent** delete.
- Undo after user **emptied Recycle Bin** or restored elsewhere.
- Undo **Explorer/Desktop** moves BNDZ didn’t perform (OLE out may sync listings; it is not full Action Log coverage unless we explicitly record it).
- Full **mesh/remote** Ctrl+Z parity in must-buy v1.
- Infinite history / cross-PC undo.
- Undoing *other apps’* writes inside a folder.

---

## 5. Suggested grind order (trust before cosmetics)

| Batch | Focus | Outcome |
|-------|--------|---------|
| **Week 1 — Undo truth** | Instrument + fix local delete→undelete and move→unmove; Ctrl+Z/Y reliability; honest toasts; History canUndo honesty | Mikey can panic-undo daily mistakes |
| **Week 1–2 — Recycle + multi** | Recycle list/restore/empty gates; multi-file log completeness; Shift+Delete never lies | Pillars 1–2 signed |
| **Week 2 — Move/copy/DnD log parity** | Every move path writes correct targets; conflict rename updates log; OLE/internal DnD same spine | Un-move works from drag too |
| **Week 3 — Browse / Home / Hub** | Cold start + tabs + Home + Command Hub daily usefulness only (no plugin redesign) | First 30s feels paid |
| **Week 3 — Remote honesty** | Keep unfreeze; label non-undoable remote ops; hide thin Remote tabs | No fake safety net |
| **Week 4 — Proof** | Sign launch rows for nav, delete, undo, DnD, transfers; one “would I pay?” pass | Must-buy gate |

Cosmetics, plaque art, Cleanup redesign, marketplace, new plugins = **after** this spine.

---

## 6. Out of scope for must-buy

These don’t sell the core file manager. Park them:

- New Hub plugins / Archive plugin / Notes / net-new selling-point architectures (`to-do-selling-points.md`)
- Marketplace install/uninstall/update theater
- Cleanup full redesign / WinZenith rebuild (playbook only until Undo spine ships)
- Live Share, Temp cloud, Organize wizard polish
- Quarantine resurrection (RAM Staging, Ghost Link, Design Board)
- Plaque / emoji art gather (already pinned parked)
- TC F5/F6 remapping cosplay
- AI launcher chrome / SuperCmd fluff
- Cross-device undo, cloud action log sync

---

## 7. One-line ask for Mikey

**Approve this order (Undo spine → Recycle → Move/DnD parity → Browse feel → Remote honesty → Proof), or rearrange the pillars before any coding starts.**

---



---

## 8. Week 1 acceptance checklist (Undo truth)

Local only. Tick live on BandzPC after the Week 1 commit:

| # | Scenario | Pass when |
|---|----------|-----------|
| 1 | Delete **1** file → Recycle → Ctrl+Z | File returns; toast says restored |
| 2 | Delete **many** → Recycle → Ctrl+Z | All return (or honest partial / limit message) |
| 3 | Move **1** via list / toolbar | Ctrl+Z puts it back |
| 4 | Move **many** via list | Ctrl+Z puts all back (or honest limit message) |
| 5 | Cut+paste move | Ctrl+Z un-moves |
| 6 | Internal DnD move (same Action Log path; no OLE rewrite) | Ctrl+Z un-moves if logged |
| 7 | Rename (F2) | Ctrl+Z restores old name |
| 8 | Redo Ctrl+Y / Ctrl+Shift+Z | Re-applies after undo |
| 9 | Shift+Delete (permanent) | Confirm warns; History **canUndo=false**; Ctrl+Z does not claim success |
| 10 | Focus in file list → Ctrl+Z | Fires even after clicking rows (list owns focus / capture) |
| 11 | History dialog | Permanent rows never show as undoable; Undo button matches truth |

Remote / mesh: **no promise** — prefer honesty toast if nothing local to undo.

---

## 9. Pre-check findings (live code map)

**Host:** Classic WPF product compiles `MainWindow.xaml.cs` (not `BndzIpcHost.cs` — that is headless/BNDZShell only). Shared brain: `BndzActionLogService`, `FileOperationService`, `RecycleBinService`.

### Action Log / Undo / Redo
- Stacks + optional persist (`action_log.json`, off by default).
- Inverse: Move/Rename back by path; Copy deletes targets; Delete+Recycle → `RestoreByOriginalPath`; permanent delete throws.
- `CanUndo` was **stack non-empty only** — permanent delete on top still advertised undoable until inverse failed.
- Success toast was generic `Undid: {Label}` — not "restored N" / "moved back".
- Default `allowedNumberOfItemsPerLoggedAction: 50` **silently truncated** multi-file batches → partial / broken undo.
- Mesh/remote FS ops bypass Action Log (good — no fake local undo).

### FE wiring
- `undoRedo.ts` → IPC with 120s timeout; `BNDZUI.runUndoRedo` refreshes host `canUndo` before run.
- Shortcuts: `keybindings.ts` Ctrl+Z / Ctrl+Y; also Ctrl+Shift+Z.
- Gate: `isInput` (input/textarea) **blocks undo** — omni filter focus after type-ahead/filter steals Ctrl+Z from file ops; list click does not always steal focus back.
- Undo listener is **bubble** phase; capture-phase type-ahead exists separately.

### Delete → Recycle → Restore
- Default delete uses Recycle (`FOF_ALLOWUNDO`); Shift+Delete / bypass → permanent + confirm.
- Undo restore matches `PKEY_Recycle_DeletedFrom` + `item.Name` only — **no `$I` info-file fallback** (unlike Recycle Archaeology) → common undelete miss.
- Partial restore still threw → entry put back after some files already restored.

### Move / rename / paste / DnD
- Bndz engine (default with background processing): `FileOperationService` records **after** real `movedTo` paths — good for un-move.
- Native/TeraCopy: records **planned** destinations after success — conflict "keep both" can desync inverse paths (Week 2 hardening).
- Internal DnD / paste use same `executeFsOperation` → same log. OLE spine left alone.

### Settings that affect undo
- `logActionsAndEnableUndoRedo` — gates History **UI only**; Ctrl+Z still intended to work.
- `allowOnlySingleStepUndoRedo` — default multi-step in settingsDefaults; shrinks stack to 1 when single-step.
- `allowedNumberOfItemsPerLoggedAction` — default **50** (silent truncate) — trust bug.
- `promptBeforeUndoRedo` — default if older than 10 minutes.
- Remember-between-sessions — off by default.

### Top 3 concrete bugs (Mikey "doesn't always work / no undelete / no unmove")
1. **Undelete:** `RestoreByOriginalPath` matching too fragile (no `$I` fallback / DeletedFrom shape) → Ctrl+Z after Recycle delete fails.
2. **Ctrl+Z flaky in daily use:** omni filter / non-list focus + bubble listener → shortcut no-ops or edits filter text instead of undoing the file op; list focus not always claimed.
3. **Multi-file / honesty:** silent 50-item truncate + `CanUndo==true` for permanent delete + weak toasts → History/Ctrl+Z lie or half-undo.




### Week 1 fixes applied (this pass)
1. **Recycle undelete:** `RestoreByOriginalPath` now matches DeletedFrom-as-full-path, parent+name, and `$I` info-file original path; partial restore reports honesty instead of rolling the stack back after some files returned.
2. **Ctrl+Z reliability:** capture-phase undo/redo; file undo allowed from omni filter; list body focuses on pointer down; `runUndoRedo` in effect deps.
3. **Honesty:** stack `CanUndo` respects permanent/truncated; History uses same `IsEntryUndoable`; success toasts say restored / moved back; over-limit batches marked not undoable (default log limit set to **0 = unlimited**); early-record verify-fail discards + destination patch on IpcHost; MainWindow records existing destinations after native/TeraCopy.

*Plan expanded for Week 1 implementation. Pre-check findings above.*


---

## 10. Week 1-2 progress (Recycle + multi + conflict->log parity)

**Tip base:** Week 1 `75d39573613d70835ba23e040ca495c4c4d8be28` on `cursor/slice1-remote-feel-trust`.

### Root causes addressed this pass

1. **Recycle UI vs Action Log drift** — Empty / Restore / Purge from the Recycle Bin virtual folder did not invalidate Delete->Recycle undo rows, so Ctrl+Z could still claim undelete after the shell already restored or purged the items.
2. **Restore matching fragility** — `Restore(parsingNames)` only exact-matched slash-normalized parsing names; FE paths / display names / original-path hints could miss. Listing `OriginalPath` also doubled the leaf when `DeletedFrom` was already a full path.
3. **Conflict keep-both -> wrong undo targets** — Native/TeraCopy `RecordExternalActionLog` preferred *planned* destinations that still existed (the pre-conflict file). After "keep both", the landed file is `name (N).ext`; un-move looked for the wrong path. IpcHost early-record patch had the same hole when `missing == 0`.
4. **Multi-file folder batches** — BNDZ engine logged top-level sources against a flat list that also included files inside moved folders -> index-mismatched TargetPaths (silent half-wrong undo). Over-limit honesty + default `allowedNumberOfItemsPerLoggedAction: 0` (unlimited) already from Week 1.

### Fixes shipped (this commit)

| Area | Change |
|------|--------|
| **Recycle** | `RestoreDetailed` / `PurgeDetailed` with broader matching + original paths; Empty/Restore/Purge invalidate Action Log recycle undeletes; permanent purge still never records undo |
| **Conflict->log** | New `ActionLogLandedPathResolver` (before-snapshot + keep-both sibling resolve); MainWindow native/TeraCopy record actual land sites; IpcHost early-record re-records via resolver |
| **Multi** | `FileOperationService` pairs top-level sources<->dests via `PairTopLevel`; limit=0 unlimited verified; over-limit still History-only |
| **Paste / Other Pane** | Same `executeFsOperation` spine — no separate recorder; inherits conflict + pair fixes |

### Files touched

- `BNDZBackend/Services/ActionLogLandedPathResolver.cs` (new)
- `BNDZBackend/Services/BndzActionLogService.cs`
- `BNDZBackend/Services/RecycleBinService.cs`
- `BNDZBackend/Services/FileOperationService.cs`
- `BNDZBackend/MainWindow.xaml.cs`
- `BNDZBackend/Services/BndzIpcHost.cs`
- `docs/_draft-must-buy-lockdown-plan.md`

### Live verify (BandzPC)

1. Open Recycle Bin virtual folder -> list items; Restore one + many; Empty Bin; Purge one (permanent) — confirm toasts; Ctrl+Z after purge/empty does **not** claim success.
2. Delete->Recycle -> Ctrl+Z still restores (Week 1); then Empty Bin -> prior delete rows show not undoable / Ctrl+Z honest.
3. Conflict keep-both on BNDZ engine move/copy -> History shows `name (N)` target; Ctrl+Z un-moves/removes the renamed land site.
4. Native or TeraCopy engine (if enabled): same keep-both -> log parity best-effort.
5. Large multi-select (> former 50) with default unlimited log -> full undo or clear not-undoable if user set a limit.
6. Paste move + Other Pane move -> targets match list ops in Action Log.

### Remaining before Week 2 Move/DnD polish / Week 3

- Live-sign launch gates 12-15 (Recycle list/empty/restore/purge) and undo rows on BandzPC.
- OLE inbound/outbound DnD Action Log parity still Week 2 (spine left alone this pass).
- Cross-volume move inverse edge cases; redo chain after conflict rename.
- Do **not** start Week 3 Browse cosmetics until the verify matrix above is solid.

