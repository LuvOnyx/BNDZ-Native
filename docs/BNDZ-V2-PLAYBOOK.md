# BNDZ V2 Playbook

Living checklist for the next version after V1 (site installer freeze).  
Update this as we decide, ship, or kill ideas. Do not lose the goal in day-to-day patches.

**Status:** skeleton — structure first; fill sections as we go.  
**Branch:** `cursor/tabs-formatting-consistency-3e94` (working).  
**Frozen release:** `V1` @ `b6c2f519` (do not rewrite history of that tip).  
**Bar:** Explorer-grade native craft. Trust like XYplorer. No web-appy / AI slop. No lazy half-measures.

---

## 1. Goal (what V2 must feel like)

- [ ] Mikey reaches for BNDZ instead of XYplorer for daily file work because it **works**, **does what it says**, and **feels native**.
- [ ] Storage Cleanup is a tool he **relies on** (CCleaner-grade trust): scan → clear report → choose keep/delete.
- [ ] System Properties capacity stays the radial wheel he likes — accurate + healthy green when free space is fine.
- [ ] Official path stays: buy key on bndz.org → installer + license (already live on V1; V2 patches swap installer without breaking that).

*Notes / success definition (fill later):*


---

## 2. How we get there (path)

High-level sequence — reorder only with a note why.

1. [ ] Lock this playbook and keep it current every meaningful decision.
2. [ ] Storage Cleanup — restore trust + craft (home, scan/report, duplicates, modes).
3. [ ] System Properties — capacity craft polish (wheel kept; green/amber/red aligned with drive bars).
4. [ ] App-wide native craft pass (kill remaining SaaS/web chrome).
5. [ ] Thicker batches → rebuild/verify from logs → ship; avoid babysit retest loops.
6. [ ] When ready: package next installer, swap on bndz.org `/downloads`, keep license stamp.

*Open path decisions:*

- [ ] **Cleanup approach (undecided):** keep evolving current BNDZ Cleanup vs rebuild Cleanup’s home flow using **WinZenith as a playbook** (see §5).

---

## 3. What’s required (checklist by area)

### 3.1 Storage Cleanup

- [ ] Overview is the real home / landing (not an empty wizard dump).
- [ ] “Deep Clean” renamed to a clear plain name (e.g. Scan & Clean) and not flavorless.
- [ ] Front flow: pick folder/target → scan → detailed report → select keep vs delete.
- [ ] Duplicate finder reliable (no host IPC death on big trees); progress + cancel.
- [ ] Other modes (Capacity, Apps, Organize, Health, etc.) actually work and feel solid.
- [ ] Feels native / trustworthy — not web-appy.
- [ ] *(Optional idea)* Segmented “what’s using space” wheel by type with hover → top offenders; must stay snappy (smart sample, no whole-drive freeze).
- [ ] *(Possibility — not chosen yet)* Rebuild Cleanup using **WinZenith** as the playbook — see §5.

### 3.2 System Properties / capacity

- [x] Keep radial capacity wheel (not replace with a bar).
- [x] Accurate free space (never round to 100% used while GB free remain).
- [x] Healthy = green like drive bars; amber when tight; red when nearly full.
- [ ] Further denser native craft if still feels cheap after live use.

### 3.3 Overall app craft / trust

- [ ] Match XYplorer bar: predictable, dense, Windows-native.
- [ ] No replacing things Mikey said he likes without asking.
- [ ] Ship thicker batches; verify from logs before asking him to click-test.

### 3.4 Release / packaging (when V2 is ready)

- [ ] Release build with license + token secrets embedded.
- [ ] Swap installer on bndz.org; Stripe receipt still carries key + download.
- [ ] Tag / note the V2 tip (do not clobber `V1`).

---

## 4. Calculations (how we know we’re there)

Fill concrete numbers as we lock them. Placeholders for now.

| Metric | Target | How measured | Status |
|--------|--------|--------------|--------|
| Cleanup scan trust | No false “timeout/dead” on normal folders; drive roots show progress + cancel | Log markers + timed runs | TBD |
| Cleanup scan budget | Soft cap (e.g. ~10–15s first paint / partial OK) | Wall clock + UI partial results | TBD |
| Capacity % honesty | Never show 100% used if free &gt; 0 | Properties on large volumes with small free | In progress |
| Healthy color | Green under ~85% used (same as drive bars) | Sidebar bars + Properties wheel | In progress |
| Craft bar | Mikey prefers BNDZ over XYplorer for Cleanup + daily FM for N days | His call | TBD |
| Installer swap | V2 setup on site; buy path still mints key | Checkout smoke | Later |

*Add rows as we invent real gates — don’t invent fake precision.*

---

## 5. Possibilities / research (not committed)

### WinZenith as Cleanup playbook

- **Source:** https://github.com/WinZenith/winzenith.github.io  
- **What it is:** Free Windows optimizer/cleaner — System Cleanup with many junk categories, **Scan → checklist report with sizes → clean selected**, risk levels, presets, cancelable scans.
- **Why it matters for V2:** Closest open reference to the CCleaner-style flow Mikey wants for Storage Cleanup trust.
- **Hard limit:** Their EULA forbids copying/modifying their software. **Do not paste their code into BNDZ.** Public repo ≠ free to take.
- **Allowed use:** Playbook only — same *ideas* and UX shape (categories, scan/report/select, risk, presets), **reimplemented** natively in BNDZ C# / our craft.
- **Decision:** **Not yet.** Mentioned here so we don’t lose it. Rebuild Cleanup this way only after an explicit yes.
- **Also later (optional):** Uninstaller / Startup Manager ideas from the same suite — not scoped until Cleanup path is chosen.

### Other notes to park

- Type-breakdown (media/docs/…) wheel on Cleanup Overview — desired, performance-sensitive; may complement or wait on the WinZenith-style junk scan decision.

---

## 6. Done / shipped this cycle (append as we go)

- V1 branch freeze @ `b6c2f519`; kept `main` + working branch; cleaned other branches.
- Duplicate scan host wait / streaming progress hardening.
- Capacity wheel restored; green healthy / amber / red aligned toward drive bars.
- Cleanup Overview default + Scan & Clean rename + category wheel work landed on working branch (verify live; craft still open).

---

## 7. How to use this doc

1. Before a Cleanup / Properties / craft batch: read §1–§3 for that area.  
2. After a decision: update the checkbox + one line under the right section.  
3. After a ship: append §6 with commit / what changed.  
4. Never delete the Goal — only refine it.

