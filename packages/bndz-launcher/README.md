# BNDZ Launcher (standalone)

The BNDZ Launcher ships separately from the File Manager. It includes:

- **BNDZ.Launcher.Host.exe** — WebView2 shell (`LauncherShellWindow`) + launcher C# services (AI chat, snippets, quick links, notes, clipboard, Flow query bridge)
- **BNDZ.Launcher.exe** — rebranded Flow Launcher engine + BNDZ plugin
- **Assets/launcher-ui/** — Vite-built React launcher frontend (`src/launcher` in the FM repo)
- **Assets/BNDZLauncher/** — Flow distribution + plugins

## Build

From repo root:

```powershell
npm run package:launcher
```

Or from this package:

```powershell
cd packages/bndz-launcher
npm run build
powershell -ExecutionPolicy Bypass -File scripts/build-launcher-release.ps1
```

Output: `dist/publish/launcher-win-x64/` and `dist/BNDZ-Launcher-win-x64-portable.zip`

## Install / run

1. Extract the launcher ZIP (or run from publish folder).
2. Start **BNDZ.Launcher.Host.exe** (registers `BNDZ.Launcher.IPC`, starts Flow engine).
3. Press **Alt+Space** (default) for the command palette shell.

Optional: install **BNDZ File Manager** separately. The launcher opens paths via `BNDZ.FileManager.IPC` or `BNDZ.exe --open-path`.

## FM interoperability

| Mechanism | Purpose |
|-----------|---------|
| `BNDZ.exe --open-path "C:\path"` | Open a path in FM (spawns FM if not running) |
| `BNDZ.FileManager.IPC` | Named pipe: `open_path`, `show` (when FM is already running) |
| `BNDZ.Launcher.IPC` | Flow plugin → launcher host shell (`show_shell`, `toggle_shell`, `open_path` forwarded to FM) |

Set `BNDZ_FM_EXE` to override FM executable discovery from the launcher host.
