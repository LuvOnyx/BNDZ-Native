# BNDZ Native File Manager — Be Native (Not Act Native)

**Status:** COMPLETE (Phases A–H shipped; deferred polish tracked below)  
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

## Phase A — Shell clipboard + kill hybrid tells ✅

- [x] Host `SET_SHELL_CLIPBOARD` / `GET_SHELL_CLIPBOARD`
- [x] `ClipboardContext` syncs Windows clipboard on cut/copy
- [x] Paste prefers Windows `CF_HDROP`; focus imports Explorer clipboard
- [x] Default `nativeContextMenu` / `useNativeOSContextMenu` on
- [x] Kill fake `getExtendedMetadata` browser mock
- [x] Go to… → address bar; paste-structure → ModalProvider
- [x] Fresh FE + BE builds

## Phase B — Real shell context menu host ✅

- [x] `ShowNativeContextMenu` via Vanara `ShellContextMenu.ShowContextMenu`
- [x] Multi-select same-parent `GetChildrenUIObjects`
- [x] Shift+right-click live host menu; default merge shell verbs
- [x] Cascades / shellcmd multi-select aware
- [ ] Optional: `HostContextMenuService` for tab chrome (deferred → next plan)

## Phase C — File ops = Explorer parity ✅

- [x] Default `fileOperationEngine: 'native'` (`IFileOperation`)
- [x] Action Log records native ops when `LogActions`; undo toast fixed (no false “shell doesn’t log”)
- [x] Shell conflict UI enabled (dropped `NoConfirmation`/`NoErrorUI` when progress shown)
- [x] Recycle Bin original location/path columns + auto-visible in Recycle pane

## Phase D — DnD = one OLE spine ✅

- [x] `IDragSourceHelper.InitializeFromWindow` on outbound OLE drag
- [x] Outbound `Preferred DropEffect` (Copy|Link) on `DataObject`
- [x] RamStaging accepts Explorer `FileList` paths; list OLE remains primary
- [x] HTML5 kept for UI reorder only (tree/sidebar)
- [ ] Spatial/PortalComposer full OLE-only (deferred — canvas semantics; next plan)

## Phase E — List = Property Store columns + New ✅

- [x] Dimensions / Duration / Artists custom columns enabled by default
- [x] File → New merges live shell New cascade (hardcoded fallback)
- [ ] Full builtin Details = PROPERTYKEY map for every column (deferred)
- [ ] Thumbnail hang campaign (deferred)

## Phase F — Namespaces & devices ✅

- [x] Control Panel CLSID browse (`/shell:ControlPanel`)
- [x] Recycle Bin first-class pane with original-path columns
- [x] This PC / Network / Libraries / MTP already on shell enumerator
- [ ] Deep MTP write/parity + pin unification (deferred)

## Phase G — Search without Everything ✅

- [x] Skip whole-disk FS walk on global search when index path preferred
- [x] Windows Search / RRF already present; Everything remains accelerator
- [ ] Connection pooling / FTS schema rebuild (deferred)

## Phase H — Dead hybrid purge ✅

- [x] `/api/fs/*` product fallbacks → `Native host required`
- [x] `SHOW_CONTEXT_MENU` is live (not deleted)
- [ ] Mass-delete compile-removed launcher sources (deferred quarantine)

---

## Done criteria

- [x] Copy in BNDZ → Paste in Explorer (and reverse)
- [x] Right-click shell verbs (merged + Shift+RMB live popup)
- [x] Desktop ↔ BNDZ drop; Preferred DropEffect + shell drag image
- [x] No fake EXIF outside host; Go-to without browser prompt
- [x] `npm run build` + Debug `dotnet` green

---

## Deferred → `to-do-native-fm-next.md`

Optional HostContextMenu for tabs · Spatial/PortalComposer OLE-only · unified shell↔Action Log undo stack · full PROPERTYKEY Details · deep MTP · launcher source quarantine · FTS pooling

## Related docs

- Stabilization (done): `to-do.md`
- Selling pillars: `to-do-selling-points.md`
- Parity backlog: `to-do-future-upgrades.md`
- **Next plan:** `to-do-native-fm-next.md`
