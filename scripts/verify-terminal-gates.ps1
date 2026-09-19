#Requires -Version 5.1
# BNDZ terminal quality gates — WinUI TermControl overlay for Local (static G0-G5).
param(
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'BNDZShell'))) {
  $root = (Get-Location).Path
}

$script:failed = New-Object System.Collections.Generic.List[string]
function Ok([string]$msg) { Write-Host ("  OK  " + $msg) -ForegroundColor Green }
function Fail([string]$msg) {
  Write-Host ("  FAIL  " + $msg) -ForegroundColor Red
  [void]$script:failed.Add($msg)
}

Write-Host '==> G0 Architecture (WinUI EasyTerminalControl overlay over Remote hole)' -ForegroundColor Cyan
$mesh = Join-Path $root 'src\components\plugins\MeshPlugin.tsx'
$ipc = Join-Path $root 'src\lib\ipcBridge.ts'
$hostCs = Join-Path $root 'BNDZShell\src\BNDZShell.App\Bndz\NativeTerminalHost.xaml.cs'
$mainCs = Join-Path $root 'BNDZShell\src\BNDZShell.App\MainWindow.xaml.cs'

if (-not (Test-Path $mesh)) { Fail 'MeshPlugin.tsx missing' }
else {
  $fe = Get-Content -LiteralPath $mesh -Raw
  if ($fe -match 'nativeTerminalOpen') { Ok 'MeshPlugin calls nativeTerminalOpen' }
  else { Fail 'MeshPlugin must call nativeTerminalOpen for Local on BNDZShell' }

  if ($fe -match 'NativeTerminalHole|useNativeWinUiTerminal') { Ok 'MeshPlugin has TermControl hole helpers' }
  else { Fail 'MeshPlugin missing NativeTerminalHole / useNativeWinUiTerminal' }
}

if (Test-Path $ipc) {
  $ipcText = Get-Content -LiteralPath $ipc -Raw
  if ($ipcText -match "NATIVE_TERMINAL_OPEN") { Ok 'ipcBridge nativeTerminalOpen posts NATIVE_TERMINAL_OPEN' }
  else { Fail 'ipcBridge must post NATIVE_TERMINAL_OPEN' }
  if ($ipcText -match 'WinUI TermControl strip retired') {
    Fail 'ipcBridge still refuses nativeTerminalOpen'
  } else { Ok 'ipcBridge nativeTerminalOpen is live' }
}

Write-Host '==> G1/G2 Host creates EasyTerminalControl' -ForegroundColor Cyan
if (Test-Path $hostCs) {
  $cs = Get-Content -LiteralPath $hostCs -Raw
  if ($cs -match 'EasyTerminalControl') { Ok 'NativeTerminalHost creates EasyTerminalControl' }
  else { Fail 'NativeTerminalHost must create EasyTerminalControl' }
  if ($cs -match 'ApplyBounds') { Ok 'NativeTerminalHost has ApplyBounds overlay' }
  else { Fail 'NativeTerminalHost must expose ApplyBounds' }
}

if (Test-Path $mainCs) {
  $mcs = Get-Content -LiteralPath $mainCs -Raw
  if ($mcs -match 'NativeTerminal\.Open\(') { Ok 'MainWindow calls NativeTerminal.Open' }
  else { Fail 'MainWindow must call NativeTerminal.Open on NATIVE_TERMINAL_OPEN' }
  if ($mcs -match 'TermControl strip retired') {
    Fail 'MainWindow still refuses NATIVE_TERMINAL_OPEN'
  } else { Ok 'MainWindow accepts NATIVE_TERMINAL_OPEN' }
}

Write-Host '==> G3 Close' -ForegroundColor Cyan
if (Test-Path $mainCs) {
  $mcs = Get-Content -LiteralPath $mainCs -Raw
  if ($mcs -match 'NativeTerminal\.Close' -or $mcs -match 'CollapseTerminalStrip') {
    Ok 'Caption/close path can tear down TermControl'
  } else {
    Fail 'Close path must Close NativeTerminal'
  }
}

Write-Host '==> G4 Docs lock' -ForegroundColor Cyan
$gatesDoc = Join-Path $root 'docs\TERMINAL-QUALITY-GATES.md'
if (Test-Path $gatesDoc) {
  $gd = Get-Content -LiteralPath $gatesDoc -Raw
  if ($gd -match 'EasyTerminalControl' -or $gd -match 'TermControl overlay') {
    Ok 'TERMINAL-QUALITY-GATES locks WinUI TermControl'
  } else {
    Fail 'TERMINAL-QUALITY-GATES must document WinUI TermControl overlay'
  }
} else { Fail 'docs/TERMINAL-QUALITY-GATES.md missing' }

Write-Host '==> G5 Build' -ForegroundColor Cyan
if (-not $SkipBuild) {
  Push-Location $root
  try {
    Write-Host '  npm run build...'
    npm run build
    if ($LASTEXITCODE -ne 0) { Fail 'npm run build failed' }
    else { Ok 'npm run build' }

    Write-Host '  native Debug build...'
    powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\build-bndz-native.ps1') -Configuration Debug
    if ($LASTEXITCODE -ne 0) { Fail 'build-bndz-native.ps1 failed' }
    else { Ok 'build-bndz-native Debug' }
  } finally {
    Pop-Location
  }
} else {
  Ok 'SkipBuild — static gates only'
}

if ($script:failed.Count -gt 0) {
  Write-Host ''
  Write-Host ('FAILED: ' + ($script:failed -join '; ')) -ForegroundColor Red
  exit 1
}
Write-Host ''
Write-Host 'All terminal quality gates passed.' -ForegroundColor Green
exit 0
