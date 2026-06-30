# SuperCmd → BNDZ Launcher port map

Source: [SuperCmdLabs/SuperCmd](https://github.com/SuperCmdLabs/SuperCmd) (MIT) — feature reference only.

BNDZ uses **Flow Launcher (WPF/.NET)** as the plugin engine with a **SuperCmd-derived WebView2 shell** for the primary UI.

## Architecture

```
SuperCmd (reference)          BNDZ port
─────────────────────         ─────────────────────────────
src/renderer/App.tsx      →   src/launcher/BndzLauncherApp.tsx
LauncherSurface.tsx       →   src/launcher/components/*
src/main/clipboard-*.ts   →   BndzClipboardStore.cs + LauncherCommandService.cs
src/main/commands.ts      →   LauncherSystemCommands.cs / BndzSystemCommands.cs
preload.ts IPC sections   →   src/launcher/bridge/flowBridge.ts
```

Re-sync upstream SuperCmd reference files:

```powershell
.\scripts\sync-supercmd-launcher-ui.ps1
```

Build launcher shell:

```powershell
npm run build:launcher
```

Output: `BNDZBackend/Assets/launcher-ui/` — loaded by `LauncherShellWindow` (WebView2).

## Phase status

| Phase | Status |
|-------|--------|
| **A Visual shell** | WebView2 `LauncherShellWindow` + glass CSS |
| **A.2 Flow handoff** | `BndzShellBridge` hides Flow, shows BNDZ shell |
| **B Clipboard** | Live (text history) |
| **B Snippets / Quick links** | Live — Raycast-style managers + JSON stores |
| **C AI** | Live — SuperCmd AiChatView + Gemini streaming |
| **D Extensions** | Live — Flow plugin aggregation + Extension Hub |

## Theme

**BNDZ Launcher** (`Flow.Launcher/Themes/BndzLauncher.xaml`) — glass blur, `#2F6BFF` accent, 14px radius. Forced on settings sync. No third-party product naming in UI.

## How to test

1. Quit BNDZ + BNDZ Launcher completely
2. `.\scripts\build-all-for-test.ps1`
3. Run BNDZ — **Alt+Space** or tray **Open Launcher**
4. You should see the **glass WebView2 panel**, not the old Flow window
5. Set `GEMINI_API_KEY` or `BNDZLauncher/UserData/BNDZ/gemini-api-key.txt` for AI chat
