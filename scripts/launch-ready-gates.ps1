#Requires -Version 5.1
<#
.SYNOPSIS
  Launch Ready code gates for BNDZ-Native.
#>
param(
  [switch]$SkipBuild,
  [switch]$SkipOle
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$failed = New-Object System.Collections.Generic.List[string]
function Ok([string]$m) { Write-Host ("  OK  " + $m) -ForegroundColor Green }
function Warn([string]$m) { Write-Host ("  WARN  " + $m) -ForegroundColor DarkYellow }
function Fail([string]$m) {
  Write-Host ("  FAIL  " + $m) -ForegroundColor Red
  [void]$failed.Add($m)
}

Write-Host '==> E4 transfer error classifier' -ForegroundColor Cyan
& npx --yes tsx scripts/test-transfer-error-kind.ts
if ($LASTEXITCODE -ne 0) { Fail 'test-transfer-error-kind' } else { Ok 'transferErrorKind suite' }

Write-Host '==> A2 plugin registry / remaps / defaults' -ForegroundColor Cyan
& npx --yes tsx scripts/test-plugin-registry.mjs
if ($LASTEXITCODE -ne 0) { Fail 'test-plugin-registry' } else { Ok 'plugin registry (defaults + remaps)' }

Write-Host '==> D2 shell menu dedupe' -ForegroundColor Cyan
& npx --yes tsx scripts/test-shell-menu-dedupe.ts
if ($LASTEXITCODE -ne 0) { Fail 'test-shell-menu-dedupe' } else { Ok 'shell menu dedupe' }

Write-Host '==> A1 retired plugins not in Hub catalog' -ForegroundColor Cyan
$reg = Get-Content -LiteralPath (Join-Path $root 'src\data\PluginRegistryContext.tsx') -Raw
foreach ($id in @('ram-staging','ghost-link','design-board')) {
  if ($reg -match "id:\s*['`"]$id['`"]") { Fail "Hub still registers $id" }
  else { Ok "$id not in Hub catalog ids" }
}
$ns = Get-Content -LiteralPath (Join-Path $root 'BNDZBackend\Services\BndzNamespaceService.cs') -Raw
if ($ns -match 'Label = "RAM Staging"') { Fail 'Namespace still exposes RAM Staging' }
else { Ok 'Namespace roots scrubbed of RAM Staging' }

Write-Host '==> Terminal quality gates' -ForegroundColor Cyan
$tg = Join-Path $root 'scripts\verify-terminal-gates.ps1'
& powershell -NoProfile -ExecutionPolicy Bypass -File $tg -SkipBuild
if ($LASTEXITCODE -ne 0) { Fail 'verify-terminal-gates' } else { Ok 'terminal G0-G5 static' }

$hostCs = Get-Content -LiteralPath (Join-Path $root 'BNDZShell\src\BNDZShell.App\Bndz\NativeTerminalHost.xaml.cs') -Raw
foreach ($m in @('_closeAfterRemount','_lastShowBoundsTick','Never SoftCollapse here','RemountWarmSurfaceAfterUnpark')) {
  if ($hostCs.Contains($m)) { Ok "NativeTerminalHost has $m" }
  else { Fail "NativeTerminalHost missing $m" }
}

Write-Host '==> Wave B native tokens' -ForegroundColor Cyan
$css = Get-Content -LiteralPath (Join-Path $root 'src\index.css') -Raw
foreach ($c in @('.bndz-mesh-tile','.bndz-native-scrim','.bndz-native-dialog','.bndz-plugin-glyph-well')) {
  if ($css.Contains($c)) { Ok "CSS $c" } else { Fail "CSS missing $c" }
}

if (-not $SkipOle) {
  Write-Host '==> DnD evidence (ole-dnd.log)' -ForegroundColor Cyan
  $ole = Join-Path $env:LOCALAPPDATA 'BNDZ\ole-dnd.log'
  if (-not (Test-Path $ole)) {
    Warn 'no ole-dnd.log yet — DnD code landed; log appears after a drag session'
  } else {
    # Whole-file proof (log can rotate / grow past a tiny tail window).
    $all = Get-Content $ole -Raw -ErrorAction SilentlyContinue
    if ($null -eq $all) { $all = '' }
    $outOk = $all -match 'outbound-ghost show'
    $inOk = $all -match 'DeliverExternalDropJson|FE_DEBUG inbound-drop'
    if ($outOk) { Ok 'outbound-ghost show (log evidence)' } else { Warn 'outbound-ghost show not in ole-dnd.log' }
    if ($inOk) { Ok 'inbound deliver/drop (log evidence)' } else { Warn 'inbound drop markers not in ole-dnd.log' }
    # Soft: historical evidence counts; do not fail Launch Ready on a quiet recent tail.
  }
}

Write-Host ''
if ($failed.Count -eq 0) {
  Write-Host 'RESULT: Launch Ready CODE GATES PASS' -ForegroundColor Green
  exit 0
}
Write-Host ('RESULT: FAIL (' + $failed.Count + ')') -ForegroundColor Red
$failed | ForEach-Object { Write-Host ("  - " + $_) }
exit 1
