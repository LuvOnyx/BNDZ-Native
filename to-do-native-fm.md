# BNDZ Native File Manager — Be Native (Not Act Native)

**Status:** IN PROGRESS — Phase A complete; Phase B largely complete; Phase C next  
**Branch:** `cursor/native-fm-be-native-c12d`  
**Base:** `cursor/spatial-drag-preview-audio-6c2d`  
**Bar:** AGENTS.md + `.cursor/rules/bndz-implementation-rule.mdc` — top-tier native Windows FM (File Pilot / XYplorer / Explorer peer). WebView2 is chrome; the shell owns truth.

**Non-goals for this track:** selling pillars, Spacedrive sidecars, packaging milestones as “done.”

**Build gate after every implementation turn:**
```bash
npm run build
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
```

---

## North star

BNDZ must **be** a native file manager:

| Own | Mean |
|-----|------|
| Shell clipboard | Ctrl+C/X/V ↔ Explorer via `CF_HDROP` + Preferred DropEffect |
| Shell menus | Live `IContextMenu` (+2/+3), multi-select `IShellItemArray`, host popup |
| Shell file ops | Vanara `IFileOperation` with Explorer progress/undo by default |
| Shell DnD | OLE only; `IDragSourceHelper` visuals; one path |
| Shell icons/thumbs/metadata | Property store → list columns + preview + tips |
| Shell namespaces | This PC / Network / Libraries / Recycle / MTP depth |
| UI ownership | React paints; host executes. No `prompt`/`confirm`, no fake metadata, no `/api/fs` product path |

---

## Phase A — Shell clipboard + kill hybrid tells (NOW)

Highest user-visible “web app” leak: cut/copy stay in `sessionStorage`.

- [x] Expose host `SET_SHELL_CLIPBOARD` / `GET_SHELL_CLIPBOARD` (wrap `SetClipboardFileDrop` + FileDrop read)
- [x] `ClipboardContext.setClipboardState` → sync Windows clipboard on cut/copy (resolve RAM/virtual paths first)
- [x] Paste: prefer Windows `CF_HDROP` when present (Explorer → BNDZ); keep in-app history
- [x] Focus sync: import Explorer clipboard into app state for cut ghosting / Paste enablement
- [x] Default `nativeContextMenu: true` / `useNativeOSContextMenu: true` in `settingsDefaults.ts`
- [x] Kill fake `getExtendedMetadata` browser mock in `ipcBridge.ts`
- [x] Replace FM-critical `window.prompt` for Go to path → address bar focus; paste structure → ModalProvider
- [x] Fresh FE + BE builds

## Phase B — Real shell context menu host

- [x] Implement `ShowNativeContextMenu` with Vanara `ShellContextMenu.ShowContextMenu` (never open Explorer)
- [x] Multi-select via same-parent `GetChildrenUIObjects` / `ShellItem[]`
- [x] Shift+right-click opens live host shell menu; default merge shell verbs into BNDZ menu
- [x] Cascades / shellcmd invoke multi-select aware
- [ ] Optional: use `HostContextMenuService` for pure-BNDZ chrome menus (tabs) outside WebView clip

## Phase C — File ops = Explorer parity

- [x] Default copy/move/delete through `NativeShellFileOperationService` (`IFileOperation`) — `fileOperationEngine: 'native'`
- [ ] Consistent undo with shell when possible; Action Log mirrors Explorer undo
- [ ] Conflict UI at Explorer quality (replace/skip/keep both) on shell path
- [ ] Recycle Bin pane: original path columns + restore/purge using `RecycleBinService`

## Phase D — DnD = one OLE spine

- [ ] `IDragSourceHelper` shell drag image (multi-file) alongside Fluid stack for in-app
- [ ] Remove dual HTML5 file-drag on secondary file surfaces (RamStaging / Spatial file drops → `fileDropBus` / OLE)
- [ ] Keep HTML5 only for UI reorder (sidebar sections / tree keys)
- [ ] Cross-pane move/copy/link cursors match Preferred DropEffect

## Phase E — List = Details columns from Property Store

- [ ] Vanara property-store columns: Type, Size, Modified, Authors, Dimensions, Duration, Camera, …
- [ ] Custom column definitions map to `PROPERTYKEY` where possible
- [ ] Thumbnail/icon CAS: no re-fetch on revisit; folder → shell icon fallback already present — harden hangs
- [ ] Inline rename fidelity + New submenu from live shell

## Phase F — Namespaces & devices

- [ ] This PC / Network / Libraries / Control Panel browse depth
- [ ] Recycle Bin as first-class pane (not just empty/restore APIs)
- [ ] MTP/phone: beyond CLSID list — copy/delete/rename where shell allows
- [ ] Shortcuts: create/resolve/pin consistently

## Phase G — Search feel without Everything

- [ ] BNDZ FTS + Windows Search default path feels instant without Everything
- [ ] Everything remains accelerator when installed
- [ ] Snippets / RRF already landed — polish ranking + empty states

## Phase H — Dead hybrid paths purge

- [ ] Remove or hard-gate product use of `/api/fs/*` web fallbacks
- [ ] Delete/ignore compile-removed dead preview/launcher surfaces from docs/mental model
- [ ] Ensure every FM action has a host IPC path; no silent browser stubs in installed builds

---

## Execution order (why)

1. Clipboard (A) — every power user hits Ctrl+C into Explorer daily  
2. Context menu (B) — shell extensions = “this is Windows”  
3. File ops (C) — progress/undo trust  
4. DnD (D) — already gold inbound; finish outbound visuals + secondary surfaces  
5. Columns/namespaces/search (E–G) — depth  
6. Purge (H) — no regressions to hybrid

---

## Done criteria (product)

- Copy in BNDZ → Paste in Explorer works (and reverse)
- Right-click shows real shell extension verbs on multi-select
- Desktop ↔ BNDZ drop never swallowed; drag cursor shows move/copy correctly
- No browser `prompt`/`confirm` on core FM paths
- No fake EXIF/metadata outside native host
- `npm run build` + Debug `dotnet` green every ship turn

---

## Related docs

- Stabilization (done): `to-do.md`
- Selling pillars: `to-do-selling-points.md` (do not conflate with native parity)
- Parity backlog: `to-do-future-upgrades.md`
