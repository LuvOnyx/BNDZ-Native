# Windows Launch Ready — test playbook (BNDZShell)

**Ship binary only:** `scripts\run-bndz-native.cmd` / `BNDZShell.exe`  
Do **not** sign rows on FilesMerge or classic WPF.

Build before testing:

```powershell
powershell -File scripts/build-bndz-native.ps1
scripts\run-bndz-native.cmd
```

If `BNDZ.AssemblyInfo.cs` / CS1056 `\0` errors appear, the script auto-scrubs `obj`; or manually:

```powershell
Remove-Item -Recurse -Force BNDZBackend\obj, BNDZBackend\bin -ErrorAction SilentlyContinue
powershell -File scripts/build-bndz-native.ps1
```

Flip ☐→☑ in [`fm-launch-readiness.md`](fm-launch-readiness.md) only after user-visible proof. Paste evidence (ole-dnd.log snippets, UAC Allow/Cancel notes) into the PR or `project-notes.md`.

---

## 0 — Smoke (2 min)

| # | Check | ☐ |
|---|--------|---|
| 0.1 | Cold start → interactive list on `C:\` | ☐ |
| 0.2 | No RAM Staging / Ghost Hub / Deck / menu chrome | ☐ |
| 0.3 | Preview idle + System Properties idle plaques look right (dark + light) | ☐ |
| 0.4 | Taskbar ICO crisp at 16 / 32 / 48 | ☐ |

---

## 1 — DnD matrix 46–58 (CRITICAL — after C4)

**Short run sheet:** [`DND-46-58-VERIFY-CHECKLIST.md`](DND-46-58-VERIFY-CHECKLIST.md) — use this at the keyboard; sign rows in `fm-launch-readiness.md`.

| # | Check | Evidence |
|---|--------|----------|
| 46–58 | Full matrix in `fm-launch-readiness.md` | ☐ |
| Outbound | Ghost follows on wallpaper (`ole-dnd.log` → `outbound-ghost show`) | ☐ |
| Inbound | List FluidDrag arms over list; no double-ghost; Drop still commits | ☐ |

---

## 2 — Menus / terminal (D2)

| # | Check | ☐ |
|---|--------|---|
| 2.1 | Normal RMB: BNDZ weave; **no duplicate** Open / Properties / Share | ☐ |
| 2.2 | Shift+RMB: full OS menu still works | ☐ |
| 2.3 | Open Terminal → Local PowerShell prompt in Remote panel (WinUI TermControl + ConPTY over the hole; no external `cmd`/`wt`) — G1 | ☐ |
| 2.4 | TermControl fills the Remote terminal hole; ← Remote / New / Close strip usable; resize bottom dock — G2 | ☐ |
| 2.5 | Close session + caption X with live terminal → quit dialog; UI stays responsive — G3 | ☐ |
| 2.6 | Sidebar cold-boot LMB still works | ☐ |

---

## 3 — A2 absorb smoke (each host tab once)

Install remapped plugins from Extension Hub if needed, then open:

| Retired | Host tab |
|---------|----------|
| Drop Magnets | Batch Rename → Magnets |
| Transcode | Metadata → Encode |
| Semantic Desk | Visual Filters → Groups |
| Policy / Inbound / Capture | Drop Stack → Policies / Intake / Captures |
| Compare | Folder Sync → Diff |
| ZK Vault | Project Sandbox → Vault |
| Library Health / Reality / Capacity | Storage Cleanup → Health / Refs / Capacity |

---

## 4 — E4 ops suite (collision + UAC)

| # | Scenario | ☐ |
|---|----------|---|
| E4.1 | Same-name **file** → Replace / Keep both / Skip / Cancel all | ☐ |
| E4.2 | Same-name **folder** → sheet says **folder** (not “file”) | ☐ |
| E4.3 | Disk-full sheet + capacity line | ☐ |
| E4.4 | File-in-use → Skip / Retry / Action Log | ☐ |
| E4.5 | Path-too-long sheet | ☐ |
| E4.6–7 | Access denied → UAC Allow (retry) **and** Cancel (honest fail) | ☐ |
| E4.8 | Folder-into-self blocked | ☐ |
| E4.9 | Partial batch → Retry failed / Skip rest | ☐ |
| E4.10–12 | Shell Integration elevate / already-elevated / Cancel restore | ☐ |
| E4.13 | Read-only destination sheet | ☐ |
| E4.14 | Invalid name → sheet with **Fix name** | ☐ |

---

## 5 — Sign-off

1. Mark rows in `fm-launch-readiness.md` (100 + E4).  
2. Note Native build path + commit SHA.  
3. Attach ole-dnd.log + UAC notes.  
4. Label build **unsigned Native beta** until Authenticode (see `BNDZ_NATIVE.md` § Distribute).
