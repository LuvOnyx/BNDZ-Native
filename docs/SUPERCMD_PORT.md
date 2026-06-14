# SuperCmd → BNDZ Launcher port map

Source: [SuperCmdLabs/SuperCmd](https://github.com/SuperCmdLabs/SuperCmd) (MIT, macOS Electron + Raycast shim)

BNDZ uses **Flow Launcher (WPF/.NET)** as the engine with a **SuperCmd-derived React shell** for the Raycast UI phase.

## Architecture

```
SuperCmd (reference)          BNDZ port
─────────────────────         ─────────────────────────────
src/renderer/App.tsx      →   src/launcher/BndzLauncherApp.tsx
LauncherSurface.tsx       →   src/launcher/components/* (adapted)
src/main/clipboard-*.ts   →   Plugins/.../BndzClipboardStore.cs
src/main/commands.ts      →   Plugins/.../BndzSystemCommands.cs
preload.ts IPC sections   →   src/launcher/bridge/flowBridge.ts (WebView2)
raycast-api/              →   Phase D (extension platform)
```

Re-sync upstream SuperCmd UI files:

```powershell
.\scripts\sync-supercmd-launcher-ui.ps1
```

Build Raycast shell:

```powershell
npm run build:launcher
```

Output: `BNDZBackend/Assets/launcher-ui/` (WebView2 host, Phase A.2)

## Phase status

| Phase | SuperCmd source | BNDZ target | Status |
|-------|-----------------|-------------|--------|
| **A Visual shell** | `LauncherMainView`, glass CSS | `BndzRaycast.xaml` + `src/launcher/` | In progress |
| **B Clipboard** | `clipboard-manager.ts` | `BndzClipboardStore.cs` | Text history live |
| **B Snippets** | `snippet-store.ts` | Flow plugin + JSON store | Planned |
| **B Quick links** | `quicklink-store.ts` | Flow plugin | Planned |
| **B File search** | `file-search-index.ts` | Flow Everything plugin | Exists |
| **C AI chat** | `ai-provider.ts`, `AiChatView.tsx` | BNDZ Gemini bridge | Planned |
| **C Whisper/TTS** | Swift natives | Windows Speech / Edge TTS | Planned |
| **D Extensions** | `raycast-api/`, `extension-runner.ts` | WebView2 + Node shim | Planned |
| **D Window tiling** | `window-adjust.swift` | Win32 plugin | Planned |

## SuperCmd system commands ported

| SuperCmd ID | BNDZ status |
|-------------|-------------|
| `system-clipboard-manager` | Live (text) |
| `system-search-snippets` | Stub |
| `system-search-quicklinks` | Stub |
| `system-search-files` | Via Flow Everything |
| `system-cursor-prompt` | Stub → BNDZ AI |
| `system-search-notes` | Stub |
| `system-window-management` | Stub |

## Theme

**BNDZ Raycast** (`Flow.Launcher/Themes/BndzRaycast.xaml`) uses SuperCmd design tokens:

- Accent `#2F6BFF`
- 14px window radius, 8px result pills
- Blur backdrop (Win11 DWM)
- Compact 40px result rows

Default for dark BNDZ themes via `BndzLauncherSettingsBridge`.

## WebView2 bridge protocol

`src/launcher/bridge/flowBridge.ts` mirrors SuperCmd `preload.ts` launcher section:

- `LAUNCHER_READY` — shell loaded
- `QUERY` / `QUERY_RESULT` — search Flow plugins
- `EXECUTE` — run selected command
- `THEME_SYNC` — BNDZ theme colors

Phase A.2 wires this to Flow `MainViewModel` via BNDZ plugin IPC.
