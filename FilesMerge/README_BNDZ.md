# [ARCHIVED] BNDZ FilesMerge WinUI shell

This folder is a **vendored copy of [files-community/Files](https://github.com/files-community/Files)** (MIT).

**Not the ship binary.** Product path is **`BNDZShell/`** — see root [`BNDZ_NATIVE.md`](../BNDZ_NATIVE.md) and [`scripts/run-bndz-native.cmd`](../scripts/run-bndz-native.cmd). Do not sign launch readiness on FilesMerge.

Classic official BNDZ stays in [BNDZ-1.0](https://github.com/LuvOnyx/BNDZ-1.0). Do not mix the two product lines.

---

## Historical architecture (#3) — archived hybrid

```text
WinUI / FilesMerge     →  title bar, tabs, sidebar, omnibar, file list engines,
                          dock geometry (grid-push plugins row)
BNDZBackend (full)     →  ALL services + IPC + plugins brain — via --backend-host sidecar
BNDZ React surfaces    →  plugins dock + Automation / Spatial / Smart Tools /
                          Hub / Config / preview
```

**Superseded by:** `BNDZShell` + in-process `BndzIpcHost` (one full BNDZUI face, no sidecar).

**Not the product end state:** HWND-painting classic `BNDZ.exe --embedded` inside Files (`Utils/Bndz/BndzEmbedHost.cs`). That was an A/B glue experiment — reference only.

---

## What this tree was (Phases 1–5)

| Surface | Source |
|---------|--------|
| Native FM chrome, sidebar, tabs, omnibar, file list | **Files** under `FilesMerge/` |
| Full BNDZBackend | Child `BNDZ.exe --backend-host` + named pipe `BNDZ.Backend.Host` |
| Plugins / Automation / Spatial / Config / Preview | Hosted React panes (`?pane=…`) |

```powershell
# Archived hybrid only — prefer scripts/build-bndz-native.ps1 for product work
powershell -File scripts/build-files-bndz-merge.ps1
scripts\run-files-merge.cmd
```

Do **not** double-click `Files.exe` in `bin\` — that unpackaged path crashes immediately. Always use `scripts\run-files-merge.cmd` if you need this tree.

---

## Other artifacts (do not confuse)

| Path | Role |
|------|------|
| `BNDZShell/` | **Product** WinUI shell |
| `FilesMerge/` | **Archived** hybrid reference |
| `BNDZ.exe --backend-host` | Sidecar brain for FilesMerge only |
| `BndzEmbedHost.cs` | Reference-only historical HWND embed |
| `scripts/run-classic.cmd` | Classic WPF reference |

---

## Provenance & license

- Upstream: files-community/Files (see `BNDZ_MERGE_SOURCE.txt`, `LICENSE-MIT`).
- BNDZ code outside `FilesMerge/` remains the BNDZ product license/structure.
