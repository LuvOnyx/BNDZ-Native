# BNDZ-Native — FilesMerge WinUI shell

This folder is a **vendored copy of [files-community/Files](https://github.com/files-community/Files)** (MIT). It is the **primary runnable WinUI host** for [BNDZ-Native](https://github.com/LuvOnyx/BNDZ-Native).

Classic official BNDZ stays in [BNDZ-1.0](https://github.com/LuvOnyx/BNDZ-1.0). Do not mix the two product lines.

---

## Locked architecture (#3)

```text
WinUI / FilesMerge     →  title bar, tabs, sidebar, omnibar, file list
BNDZBackend (full)     →  ALL services + IPC + plugins brain — no stubs
BNDZ React surfaces    →  hosted panes ONLY (Automation, Spatial, plugins,
                          Command Deck, preview tools)
```

**Not the product end state:** HWND-painting classic `BNDZ.exe --embedded` inside Files (`Utils/Bndz/BndzEmbedHost.cs`). That was an A/B glue experiment. The code may remain as **reference only**; it is not wired into MainPage and must not be treated as “merge complete.”

---

## What you get today (Phases 1–3)

| Surface | Source |
|---------|--------|
| Native FM chrome, sidebar, tabs, omnibar, file list | **Files** under `FilesMerge/` — branded **BNDZ-Native** |
| Full BNDZBackend (services, index, plugins brain) | Child `BNDZ.exe --backend-host` + named pipe `BNDZ.Backend.Host` |
| Status chip | Omnibar trailing label: connected / offline / indexed count |
| Plugins + Command Deck | Bottom dock WebView (`?pane=plugins`) — toggle **Plugins** |
| Automation / Spatial | Workspace overlay WebViews (`?pane=automation` / `canvas`) |
| Preview tools | `?pane=preview` shell (selection-driven) |

Default session = Files-class shell + live backend host + optional hosted panes. There is **no** nested classic React FM layout.

### Backend host protocol (Phase 2)

1. FilesMerge resolves `BNDZ.exe` (sibling of `Files.exe`, or `BNDZBackend\bin\…`).
2. Starts `BNDZ.exe --backend-host --skip-elevation` (hidden window, full services, no tray).
3. Speaks WebView-compatible JSON over named pipe `BNDZ.Backend.Host` (`IPC_PING`, `GET_INDEX_STATUS`, …).
4. On shell exit, owned backend process is torn down.

```powershell
# From repo root
powershell -File scripts/build-files-bndz-merge.ps1
scripts\run-files-merge.cmd    # BNDZ-Native (FilesMerge shell)
```

The build script compiles `BNDZBackend` + React assets and stages `BNDZ.exe` next to the Files output.

Exe output remains `Files.exe` this phase (AssemblyName unchanged); package **DisplayName** / **ShortName** are **BNDZ-Native**.

---

## Historical A/B embed (superseded)

Earlier spike: toolbar **BNDZ Workspace** HWND-reparented full `BNDZ.exe --embedded` into the content area. Rejected as product architecture — layouts conflicted. `BndzEmbedHost.cs` remains reference-only; do not rewire into MainPage.

---

## Other artifacts (do not confuse with the shell)

| Path | Role |
|------|------|
| `FilesMerge/` | **Primary** WinUI shell for BNDZ-Native |
| `BNDZ.exe --backend-host` | Full backend brain for Phase 2 (hidden; named pipe) |
| `BndzEmbedHost.cs` | Reference-only historical HWND embed |
| `BNDZ.exe --native-shell` | Earlier WPF banner experiment — **not** the Files merge |
| `BNDZ.NativeShell.*` | Spike / progressive port — **not** the product shell |
| `scripts/run-classic.cmd` | Classic `BNDZ.exe` for reference on this machine |

When the user says “Files merge” or “native shell,” they mean **`FilesMerge/` as the WinUI host** under architecture #3 — not `--native-shell` alone and not full-window HWND embed.

---

## Product rules

- Compete with File Pilot / XYplorer / Explorer — native feel, not generic SaaS chrome.
- Plugins and selling pillars wire to **native C# services** via IPC — not sidecar HTTP / Spacedrive iframes.
- Fresh builds: `npm run build` + Debug `dotnet` for BNDZBackend; FilesMerge needs its own WinUI build on Windows.
- Uiverse / BNDZ tokens for hosted BNDZ panes; Files UI follows Fluent/WinUI unless deliberately restyled.

---

## Provenance & license

- Upstream: files-community/Files (see `BNDZ_MERGE_SOURCE.txt`, `LICENSE-MIT`).
- BNDZ code outside `FilesMerge/` remains the BNDZ product license/structure.

---

## Agent checklist

1. Do **not** treat HWND embed / “BNDZ Workspace” as the product merge.
2. Do **not** nest the classic outer FM layout (17/71/12) inside Files.
3. Do **not** call `BNDZ.NativeShell*` or `--native-shell` “the Files merge.”
4. Prefer shell composition + hosted panes + full backend over more embed glue.
5. After FilesMerge changes, rebuild on Windows (.NET 10 + WASDK).
