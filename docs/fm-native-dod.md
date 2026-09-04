# BNDZ Native FM — Definition of Done

Living audit registry for the 38-phase native FM parity plan. A feature is **not done** until its gate passes here.

## Core rules

| Rule | Meaning |
|------|---------|
| No fake completion | IPC handler exists ≠ user-visible outcome in list/preview/plugin |
| No silent no-ops | Create/copy on collision must not toast success when nothing changed |
| Explorer create parity | New item → select → inline rename; collision-safe `New folder (2)` |
| OLE is required | Outbound drag to desktop/apps works from list, tree, archive |
| Every button works | Plugin buttons work E2E or are hidden/disabled with reason |
| No layout-shift menus | Built-in context menu rows must not move when shell extensions load |
| Virtual paths labeled | RAM / mesh / WSL paths clearly labeled; local disk hits real paths |

## Open audit items (owner phase)

| Item | Phase | Status |
|------|-------|--------|
| Create → select → rename all entry points | P01 | done (verify shell New cascade) |
| Collision-safe `GetUniquePath` on create | P01 | done |
| Context menu shell-extension layout shift | P31 | done |
| List/grid white rectangle icons | P32 | in progress |
| WSL Linux → Ubuntu distro in tree + list | P28 | in progress |
| Pin BandzVPS to Rapid Access | P30 | pending |
| Podman fake Incus local endpoint | P16 | pending |
| Fluid drag tooltips / status bar | P07 | pending |
| External OLE menubar X cursor | P09/P11 | partial |

## Verification

- Builds: `npm run build`, `dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true`, `scripts/build-bndz-native.ps1`
- Sign-off: `docs/fm-acceptance-playbook.md` (P27)
