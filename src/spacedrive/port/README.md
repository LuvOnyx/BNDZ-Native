# Spacedrive / Spacebot UI ports

Upstream patterns copied from `spacedriveapp/spacedrive` and `spacedriveapp/spacebot`, adapted to BNDZ via `src/lib/ipcBridge.ts` — no Spacedrive RPC or `@spacedrive/primitives`.

| Port | Upstream source |
|------|-----------------|
| `SizeView.tsx` | `packages/interface/.../SizeView/SizeView.tsx` (d3 pack bubbles) |
| `SearchToolbar.tsx` | `packages/interface/.../SearchToolbar.tsx` |
| `PortalComposer.tsx` | `spacebot/.../PortalComposer.tsx` |
| `RedundancyGroupsView.tsx` | Spacedrive redundancy group layout |
| `TagAssignmentMode.tsx` | `packages/interface/.../TagAssignmentMode.tsx` |
