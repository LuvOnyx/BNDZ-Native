# Sync studio engines + editor HTML into BNDZBackend Assets (WebView2 load path).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$srcEditors = Join-Path $root "public\editors"
$dstEditors = Join-Path $root "BNDZBackend\Assets\ui\editors"

if (-not (Test-Path $srcEditors)) { throw "Missing $srcEditors" }
New-Item -ItemType Directory -Force -Path $dstEditors | Out-Null

Write-Host "==> Sync editor HTML" -ForegroundColor Cyan
Copy-Item -Force (Join-Path $srcEditors "bndz-design-board.html") (Join-Path $dstEditors "bndz-design-board.html")
Copy-Item -Force (Join-Path $srcEditors "bndz-photo-studio.html") (Join-Path $dstEditors "bndz-photo-studio.html")
$vendorSrc = Join-Path $srcEditors "vendor"
$vendorDst = Join-Path $dstEditors "vendor"
if (Test-Path $vendorSrc) {
    New-Item -ItemType Directory -Force -Path $vendorDst | Out-Null
    Copy-Item -Force -Recurse "$vendorSrc\*" $vendorDst
}

$engineSrc = Join-Path $srcEditors "engines"
$engineDst = Join-Path $dstEditors "engines"
if (-not (Test-Path $engineSrc)) { throw "Missing $engineSrc - build OpenPencil/OpenShop first" }

Write-Host "==> Sync engines (OpenPencil + OpenShop)" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $engineDst | Out-Null
& robocopy.exe $engineSrc $engineDst /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
$rc = $LASTEXITCODE
# robocopy 0-7 = success-ish
if ($rc -ge 8) { throw "robocopy failed with code $rc" }
Write-Host "  engines synced (robocopy $rc)" -ForegroundColor DarkGreen
