# Terminal quality gates (G0–G5)

Hard gates for BNDZ Local PowerShell in the **Remote bottom plugin** on BNDZShell.

**Locked architecture (user-directed 2026-09-19):**

**WinUI `EasyTerminalControl` (TermControl + ConPTY)** hosted in `NativeTerminalHost`, positioned as an overlay over the React Remote terminal hole via `NATIVE_TERMINAL_*` IPC.

React only reports the hole rect (`NativeTerminalHole` → `nativeTerminalLayout`). It does **not** render Local shell output via xterm.js.

The earlier ConPTY→`MESH_TERMINAL_*`→xterm-in-WebView path for Local is **retired on BNDZShell** after repeated attach failures. Classic/non-native hosts may still use mesh/xterm for SSH.

Run automated checks:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-terminal-gates.ps1
```

| Gate | Pass | Fail |
|------|------|------|
| **G0 Architecture** | Local uses `nativeTerminalOpen` + `EasyTerminalControl` overlay | Local forced through xterm-only / refused TermControl |
| **G1 Open** | Open Terminal → real PowerShell prompt in TermControl over the hole | Blank hole, refused OPEN, external `wt` |
| **G2 Geometry** | `ApplyBounds` tracks the React hole | Misaligned / zero-size overlay |
| **G3 Close** | Close ends TermControl; caption X stays responsive | Freeze / orphaned ConPTY |
| **G4 Docs lock** | This file matches WinUI TermControl overlay | Silent pivot to xterm-only without doc + user notice |
| **G5 Build** | `npm run build` + `scripts/build-bndz-native.ps1` green | Claim without builds |

`verify-terminal-gates.ps1` statically proves G0–G5 code paths.
