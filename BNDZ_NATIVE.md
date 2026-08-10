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
