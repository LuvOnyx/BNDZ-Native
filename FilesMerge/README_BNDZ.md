# BNDZ × Files merge (this branch)

This folder is a **vendored copy of [files-community/Files](https://github.com/files-community/Files)** (MIT), integrated with full BNDZ for A/B testing against classic WebView2 BNDZ on `main`.

## What you get

| Surface | Source |
|---------|--------|
| Native FM chrome, sidebar, tabs, omnibar, file list | **Files** (WinUI) |
| Full BNDZ product UI (plugins, Automation, Spatial, …) | **BNDZ.exe --embedded** reparented into Files via **BNDZ Workspace** button |

Click **BNDZ Workspace** in the Files toolbar to show complete BNDZ inside Files chrome. Click **Files View** to return to native Files browsing.

## Build & run (Windows)

Requires .NET **10** SDK (see `global.json`) + Windows App SDK workloads.

```powershell
# From repo root — builds classic BNDZ (for embed) + Files merge app
powershell -File scripts/build-files-bndz-merge.ps1

# Run the merge app (then click "BNDZ Workspace")
scripts\run-files-merge.cmd

# Compare against classic on main / without Files:
scripts\run-classic.cmd
```

## Provenance

See `BNDZ_MERGE_SOURCE.txt` and `LICENSE-MIT`. This is a **comparison merge**, not a commitment to forever soft-fork upstream Files.
