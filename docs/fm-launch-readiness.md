# BNDZ Native FM — Launch Readiness (100 gated checks)

Gate: **every row must pass** on `BNDZShell` (`scripts/run-bndz-native.cmd`) before user launch.
Build gate after code changes: `npm run build` → `dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true` → `scripts/build-bndz-native.ps1`.

## FM core — navigation & listing (1–20)

| # | Check | Status |
|---|--------|--------|
| 1 | Cold start < 8s to interactive list on `C:\` | ☐ |
| 2 | Navigate folders via list double-click | ☐ |
| 3 | Navigate via breadcrumb segments | ☐ |
| 4 | Navigate via sidebar tree | ☐ |
| 5 | Back / Forward history | ☐ |
| 6 | Up navigates parent | ☐ |
| 7 | Home / Quick access roots load | ☐ |
| 8 | This PC drives list + free space | ☐ |
| 9 | Network locations enumerate | ☐ |
| 10 | `\\wsl.localhost\` shows real distro names (not UTF-16 garbage) | ☐ |
| 11 | WSL distro folder lists files | ☐ |
| 12 | Recycle Bin virtual path lists items | ☐ |
| 13 | Empty Recycle Bin actually removes all items from list | ☐ |
| 14 | Restore from Recycle Bin works | ☐ |
| 15 | Permanent delete from Recycle Bin works | ☐ |
| 16 | List view sort columns (name/size/modified) | ☐ |
| 17 | Group by (none/name/type/date) | ☐ |
| 18 | Grid zoom slider uniform tile sizes | ☐ |
| 19 | Details view column resize | ☐ |
| 20 | Virtualized scroll 10k+ files stays smooth | ☐ |

## Create, rename, delete (21–35)

| # | Check | Status |
|---|--------|--------|
| 21 | Context menu → New → Folder creates in current dir | ☐ |
| 22 | Context menu → New → Text Document creates | ☐ |
| 23 | Ctrl+Shift+N creates folder | ☐ |
| 24 | Inline rename after create (Explorer parity) | ☐ |
| 25 | No false "Transfer failed" toast on create | ☐ |
| 26 | Create collision → `New folder (2)` naming | ☐ |
| 27 | F2 rename single item | ☐ |
| 28 | Rename invalid chars blocked with toast | ☐ |
| 29 | Delete → Recycle Bin (default) | ☐ |
| 30 | Shift+Delete permanent delete | ☐ |
| 31 | Multi-select delete | ☐ |
| 32 | Undo last delete (action log) | ☐ |
| 33 | Redo after undo | ☐ |
| 34 | Create into Drop Stack intake / stage folder | ☐ |
| 35 | Create on mesh remote path | ☐ |

## Context menus (36–45)

| # | Check | Status |
|---|--------|--------|
| 36 | Right-click list background opens menu | ☐ |
| 37 | Right-click file opens menu | ☐ |
| 38 | Right-click tree item opens menu | ☐ |
| 39 | Menu items clickable immediately (no dead zone) | ☐ |
| 40 | Shell extension block loads without layout jump | ☐ |
| 41 | Virtual locations skip shell extension skeleton | ☐ |
| 42 | Shift+right-click native shell menu | ☐ |
| 43 | Cut / Copy / Paste verbs | ☐ |
| 44 | Properties opens correct path | ☐ |
| 45 | Menu dismiss on outside click / Escape | ☐ |

## Drag & drop (46–58)

| # | Check | Status |
|---|--------|--------|
| 46 | Internal drag single file | ☐ |
| 47 | Internal multi-drag fan stack | ☐ |
| 48 | Drop on folder row moves item | ☐ |
| 49 | Drop on tree folder navigates + moves | ☐ |
| 50 | Drop on tab bar | ☐ |
| 51 | Desktop → BNDZ external drop (OLE) | ☐ |
| 52 | BNDZ → Desktop external drag | ☐ |
| 53 | BNDZ → Explorer drag | ☐ |
| 54 | Marquee select during drag doesn't break | ☐ |
| 55 | Ctrl+marquee additive select | ☐ |
| 56 | Empty-space click deselects | ☐ |
| 57 | Drag tooltip shows target path | ☐ |
| 58 | No tree collapse/regression after drop | ☐ |

## Transfers & background queue (59–68)

| # | Check | Status |
|---|--------|--------|
| 59 | Copy large file shows progress | ☐ |
| 60 | Move shows optimistic list update | ☐ |
| 61 | Background processing doesn't swallow create result | ☐ |
| 62 | Transfer panel shows jobs | ☐ |
| 63 | Cancel transfer | ☐ |
| 64 | Conflict dialog (BNDZ sheet: keep both / replace / skip — not Explorer) | ☐ |
| 65 | Copy tags on copy (if enabled) | ☐ |
| 66 | No flicker-back after optimistic move | ☐ |
| 67 | Delete fast-lane not blocked by copy | ☐ |
| 68 | Empty recycle synchronous IPC result | ☐ |

## Preview & search (69–78)

| # | Check | Status |
|---|--------|--------|
| 69 | Image preview loads | ☐ |
| 70 | PDF preview | ☐ |
| 71 | Text / code preview | ☐ |
| 72 | Audio waveform | ☐ |
| 73 | 3D model viewport | ☐ |
| 74 | Quick Look spacebar | ☐ |
| 75 | Fast Search plugin indexes | ☐ |
| 76 | Search results navigate | ☐ |
| 77 | Metadata inspector columns | ☐ |
| 78 | System Properties plugin correct paths | ☐ |

## Mesh / VPS / terminal (79–88)

| # | Check | Status |
|---|--------|--------|
| 79 | Mesh hosts list loads | ☐ |
| 80 | Create local VPS (Podman) | ☐ |
| 81 | Destroy VPS removes container + DB row | ☐ |
| 82 | Manual reconcile (Refresh) doesn't freeze app | ☐ |
| 83 | Shell Here opens terminal tab | ☐ |
| 84 | Terminal input routes to active session | ☐ |
| 85 | Terminal resize propagates | ☐ |
| 86 | Remote mesh host SSH terminal | ☐ |
| 87 | Mesh path browse in list | ☐ |
| 88 | Mesh drop panel | ☐ |

## Shell chrome & stability (89–100)

| # | Check | Status |
|---|--------|--------|
| 89 | No "(Not Responding)" during normal FM ops | ☐ |
| 90 | Caption drag moves window | ☐ |
| 91 | Minimize / maximize / close (Ask/Tray/Quit) | ☐ |
| 92 | Taskbar icon multi-res crisp | ☐ |
| 93 | Tabs open / close / reorder | ☐ |
| 94 | Split panes navigate independently | ☐ |
| 95 | Settings persist across restart | ☐ |
| 96 | Theme / colors apply instantly | ☐ |
| 97 | Command Deck only installed plugins | ☐ |
| 98 | Bottom plugin panel resize | ☐ |
| 99 | Bottom plugin panel resize + install gating (no auto-install) | ☐ |
| 100 | Full session: 30 min mixed FM work — zero crashes | ☐ |

**Gate target:** BNDZ-Native (`BNDZShell`). See [`LAUNCH-READY-PLAN.md`](LAUNCH-READY-PLAN.md) D0 / D5.

## Wave E — Ops dialogs + elevation (E4.1–E4.14)

Sign on real Windows `BNDZShell`. Code suite is landed; these rows are the live gate.

| # | Check | Status |
|---|--------|--------|
| E4.1 | Same-name file collision → Replace / Keep both / Skip / Cancel all (+ apply to all) | ☐ |
| E4.2 | Same-name folder collision uses BNDZ conflict sheet (not silent merge-only) | ☐ |
| E4.3 | Disk-full modal shows need vs free; Skip / Retry; Cleanup only if Storage Cleanup installed | ☐ |
| E4.4 | File-in-use → Skip / Retry / Open Action Log | ☐ |
| E4.5 | Path-too-long → Open destination / Skip / Retry | ☐ |
| E4.6 | Access denied → BNDZ confirm → Windows UAC Allow → transfer retries | ☐ |
| E4.7 | UAC Cancel → clear status; no silent success; no corrupt shell half-state | ☐ |
| E4.8 | Folder-into-self (list DnD + Copy/Move To + paste) → block dialog OK | ☐ |
| E4.9 | Partial batch failure → Retry failed only / Skip rest / Open Action Log | ☐ |
| E4.10 | Shell Integration toggle unelevated → UAC → setting sticks after refresh | ☐ |
| E4.11 | Shell Integration toggle already elevated → applies without false admin loop | ☐ |
| E4.12 | Shell Integration UAC Cancel → prior toggle restored; honest status | ☐ |
| E4.13 | Read-only / write-protected destination → dedicated sheet (Skip / Retry / Open log) | ☐ |
| E4.14 | Invalid / reserved name → dedicated sheet (not silent fail) | ☐ |

## Anti-fake rules

- Partial IPC wiring = **fail** until user-visible behavior works.
- "Build succeeded" alone ≠ pass — run the check in the UI.
- Regressions in list interaction (drag/marquee) block launch regardless of other passes.
- Sign on **BNDZ-Native** only (`scripts/run-bndz-native.cmd`) — FilesMerge / classic WPF do not count.
