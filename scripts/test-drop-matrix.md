# BNDZ Drop Acceptance Matrix

Enable debug overlay before testing:

```js
localStorage.bndzDropDebug = '1'
```

Relaunch BNDZ after builds. Check Visual Studio **Output** window for `[Drop]` host lines.

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Explorer → list (real folder tab) | Open `Desktop` tab. Drag file from Explorer onto list body. | Copy into folder; list refreshes; debug shows `committed: true`, real `destPath`. |
| 2 | Explorer → list on BNDZ Home | Stay on Home tab. Drop file on list area. | Toast "Open a real folder…" OR auto-route to last real path in tab history. |
| 3 | Explorer → subfolder row | Details view. Drop onto a folder row. | Copy into that subfolder. |
| 4 | Explorer → inactive pane (dual pane) | Enable dual pane. Drop on inactive pane list. | Pane activates; copy succeeds. |
| 5 | Archive entry → list folder | Open `.zip` preview. Drag entry over list folder tab/body. | Ghost visible entire drag ("Preparing extract…" then labels); extract + copy on drop. |
| 6 | Archive entry → desktop | Drag archive entry outside BNDZ chrome; release on desktop. | OLE drag-out to Explorer/desktop. |
| 7 | List row → Explorer | Drag selected rows out of BNDZ. | OLE export (regression). |
| 8 | Drop within 3s of launch | Cold-start BNDZ; drop from Explorer immediately. | No lost IPC; drop commits (eager `IPC.init()`). |
| 9 | 125% DPI | Set Windows display scale 125%. Repeat #1. | Debug dot lands on row under cursor; correct destination. |

## Debug overlay fields

- **coords** — resolved client position + `coordSource` (`drop` | `lastHover` | `htmlTarget` | `activeList` | `fallback`)
- **dest** — resolved destination path
- **source** — `externalOle` | `archiveInternal` | `listPointer`
- **committed** — whether `executeInternalDrop` ran

## Failure telemetry

When host cannot extract paths from OLE payload, UI toast should appear via `EXTERNAL_FILES_DROP_FAILED` / `bndz-external-drop-failed`.
