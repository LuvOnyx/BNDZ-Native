# BNDZ × Files merge (this branch)

This folder is a **vendored copy of [files-community/Files](https://github.com/files-community/Files)** (MIT), integrated with full BNDZ for **A/B product-direction testing** against classic WebView2 BNDZ on `main`.

**Branch:** `cursor/winui-native-shell-spike-1f6d` · **PR:** typically #18 · **Compare against:** `main` (official classic BNDZ)

---

## Why this exists (session decisions)

BNDZ’s classic stack is **WPF + WebView2 + React** (`BNDZBackend` + `src/`). It feels “web-appy” vs native WinUI FMs. The product question was:

> Can we take the **Files** repo (modern native WinUI FM) and merge in **all of BNDZ’s content and UI**, on a **separate branch**, so we can pull this branch vs `main` and decide which experience we prefer?

### What we decided

| Decision | Detail |
|----------|--------|
| **Do the Files merge on a side branch** | So `main` stays the official classic product while this branch is the experimental merge. |
| **Keep full BNDZ experience** | Plugins, Automation, Spatial, Command Deck, IPC — not a thin demo. A solid A/B needs both sides fully testable. |
| **Do not soft-fork forever (yet)** | This is a **comparison merge**, not a commitment to track upstream Files forever. |
| **Do not “graft HTML into Files” as the only story** | Files stays the native chrome/list; full BNDZ UI is the real BNDZ process embedded (see below). |

### What we explicitly rejected (for this experiment)

- Treating “native shell” as **only** a banner on classic WebView2 (`--native-shell`) as the merge — that was an intermediate misread; useful for chrome experiments, **not** the Files merge the user asked for.
- Claiming “Files merge” while leaving only a thin WPF list host with no Files sources.
- Big-bang rewrite of ~128k LOC React into WinUI XAML before anyone can A/B.

### Inventory that informed the approach (still true)

- Classic BNDZ: large **React UI** (~128k LOC) + thick **C# services** (~40k+ LOC services) + huge IPC hub (`MainWindow.xaml.cs`).
- Files: large **WinUI 3 / XAML** FM (~145 XAML, ~1.1k C# files), MIT, high upstream churn.
- “Merge Files + keep entire BNDZ UI” is not a drop-in repo merge of two UI stacks — hence **Files chrome + embedded full BNDZ** for a fair full-experience A/B.

---

## What you get

| Surface | Source |
|---------|--------|
| Native FM chrome, sidebar, tabs, omnibar, file list | **Files** (WinUI) under `FilesMerge/` |
| Full BNDZ product UI (plugins, Automation, Spatial, …) | **`BNDZ.exe --embedded`** reparented into Files via **BNDZ Workspace** |

**In the Files app:** click **BNDZ Workspace** → full BNDZ inside Files chrome. Click **Files View** → native Files browsing again.

### How embedding works (agents: do not “simplify” this away)

1. Files toolbar starts/finds `BNDZ.exe --embedded --skip-elevation`.
2. BNDZ publishes its HWND to `%TEMP%\bndz-embed-hwnd.txt` (`MainWindow.ApplyEmbeddedMode`).
3. `Files.App/Utils/Bndz/BndzEmbedHost.cs` `SetParent`s that HWND into the Files content host and lays it out on resize.
4. Embedded BNDZ skips the classic single-instance mutex so it can live inside Files while classic may also run for compare.

**Full experience means:** the embedded process is the real BNDZ backend + React UI — same IPC, plugins, and workspace tools as classic. Do not replace this with a stub WebView that only loads static HTML unless the user asks to change the A/B design.

---

## A/B how-to

| Pull / run | Experience |
|------------|------------|
| **`main`** (or classic on this branch) | Official / classic WebView2 BNDZ |
| **This branch → Files merge** | Files native FM + BNDZ Workspace (full BNDZ) |

```powershell
# From repo root on THIS branch (Windows)
powershell -File scripts/build-files-bndz-merge.ps1

scripts\run-files-merge.cmd    # Files × BNDZ merge
scripts\run-classic.cmd        # classic BNDZ (same machine, side-by-side OK)
```

Classic on this branch still works; for a pure “official vs merge” test, compare **`main` checkout** vs **this branch’s Files merge**.

---

## Build & run (Windows)

Requires:

- **.NET 10 SDK** (see `FilesMerge/global.json`)
- **Windows App SDK** workloads (Files is WinUI 3)
- Node for `npm run build` (BNDZ React assets used by embedded BNDZ)

```powershell
powershell -File scripts/build-files-bndz-merge.ps1
scripts\run-files-merge.cmd
```

Embedded BNDZ is resolved from (first hit wins):

- next to the Files exe as `BNDZ.exe`
- `BNDZBackend\bin\Debug\net8.0-windows10.0.19041.0\BNDZ.exe`
- Release equivalent

If **BNDZ Workspace** says BNDZ not found, build classic BNDZ first (`npm run build` + `dotnet build BNDZBackend/...`).

---

## Other artifacts on this branch (do not confuse with the merge)

| Path | Role |
|------|------|
| `FilesMerge/` | **The Files × BNDZ merge** (this README) |
| `BNDZ.exe --embedded` | Full BNDZ for HWND embed into Files |
| `BNDZ.exe --native-shell` | Earlier chrome experiment (Files-*like* banner on classic) — **not** the Files merge |
| `BNDZ.NativeShell.*` | Spike / destination WinUI + Core adapters — progressive port path, not the A/B merge itself |
| `scripts/run-classic.cmd` / `run-native-shell.cmd` / `run-files-merge.cmd` | Launchers |
| `docs/native-shell/` | Route notes |

When the user says “the merge branch” or “Files merge,” they mean **`FilesMerge/` + BNDZ Workspace embed**, not `--native-shell` alone.

---

## Product rules that still apply

- BNDZ is a next-gen Windows FM: compete with File Pilot / XYplorer / Explorer — native feel, not generic SaaS chrome.
- Selling pillars and plugins stay wired to **native C# services** via IPC — not sidecar HTTP / iframes of Spacedrive.
- Fresh builds after product code changes: `npm run build` + Debug `dotnet` for BNDZ; Files merge needs its own WinUI build on Windows.
- Uiverse / BNDZ tokens for BNDZ UI craft; Files UI follows Files’ Fluent/WinUI language unless we deliberately restyle.

---

## Provenance & license

- Upstream: files-community/Files (see `BNDZ_MERGE_SOURCE.txt`, `LICENSE-MIT`; historical `LICENSE-MPL` may still be in tree).
- BNDZ code outside `FilesMerge/` remains the BNDZ product license/structure.
- **Comparison merge** — ship/adopt only after the user picks a direction from A/B testing.

---

## Agent checklist

1. Do **not** delete `FilesMerge/` or strip the BNDZ Workspace embed without an explicit ask.
2. Do **not** call a WebView-only or banner-only change “the Files merge.”
3. Prefer fixing embed path / build scripts / branding over inventing a third architecture mid-A/B.
4. After meaningful BNDZ UI/backend changes, rebuild BNDZ so the embedded Workspace stays current.
5. After FilesMerge changes, rebuild Files on Windows (.NET 10 + WASDK); Linux CI cannot compile WinUI XAML.
