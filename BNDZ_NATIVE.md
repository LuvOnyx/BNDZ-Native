# BNDZ-Native

**Primary product:** `BNDZShell/` — WinUI 3 greenfield shell hosting **one** full BNDZUI WebView2 face.

## Architecture

```text
BNDZShell (WinUI)
  ├─ CraftPaneHost (Pane=browser)   full classic BNDZUI (?nativeShell=1)
  └─ NativeListHost                 collapsed (WebView2 HWND airspace blocks overlay)
BNDZCore (in-proc)                  BndzIpcHost via BndzEmbeddedBackendHost
```

- One cohesive BNDZ craft face — **no** chrome/sidebar/preview WebView islands (those looked like nested apps).
- React list owns FS listing via in-process IPC. NativeListHost stays for a future non-overlapping grid cell layout once craft can split without looking fragmented.
- WinUI owns caption buttons (`ExtendsContentIntoTitleBar`); React WindowControls are hidden on `native-host`.
- Classic WPF remains for `scripts/run-classic.cmd` only.

## Build & run

```powershell
powershell -File scripts/build-bndz-native.ps1
scripts\run-bndz-native.cmd
```

Or double-click `BNDZShell.exe` under `BNDZShell\src\BNDZShell.App\bin\x64\Debug\net*-windows*\` — the shell is unpackaged + Windows App SDK self-contained.

## Distribute (D6 — Launch Ready)

**Current ship path = unpackaged Native beta** (not the classic Inno `BNDZ-Setup` from `docs/LAUNCH.md`).

| Artifact | How |
|----------|-----|
| Dev / test | `scripts\build-bndz-native.ps1` → `scripts\run-bndz-native.cmd` |
| Share with testers | Zip the newest `BNDZShell\src\BNDZShell.App\bin\x64\Debug\net*-windows*\` folder (or `artifacts\bndzshell-debug` if staged) and keep `Assets\ui` beside the exe |
| Clean PC | WebView2 Runtime required; Windows 10/11 x64 |

**Unsigned beta:** builds are **not** Authenticode-signed. Expect SmartScreen “Windows protected your PC” until an OV/EV cert is wired. For public/marketing ships, follow classic signing notes in `docs/LAUNCH.md` **only after** a Native installer target exists — do not distribute classic WPF `dist\BNDZ-Setup-*.exe` as BNDZ-Native.

**Launch gate:** sign [`docs/fm-launch-readiness.md`](docs/fm-launch-readiness.md) on this binary only. Use [`docs/WINDOWS-TEST-PLAYBOOK.md`](docs/WINDOWS-TEST-PLAYBOOK.md) on a real Windows machine.
