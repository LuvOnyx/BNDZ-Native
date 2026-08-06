# Build both compare versions (classic + native-shell) from one BNDZ.exe.
# Usage (Windows):  powershell -File scripts/build-compare-versions.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> Frontend (React UI shared by both versions)" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

Write-Host "==> Backend Debug (classic + --native-shell)" -ForegroundColor Cyan
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
if ($LASTEXITCODE -ne 0) { throw "dotnet build BNDZ failed" }

Write-Host "==> Native shell launcher" -ForegroundColor Cyan
dotnet build BNDZ.NativeShell.Host/BNDZ.NativeShell.Host.csproj -c Debug -p:EnableWindowsTargeting=true
if ($LASTEXITCODE -ne 0) { throw "dotnet build NativeShell.Host failed" }

Write-Host "==> Core tests" -ForegroundColor Cyan
dotnet test BNDZ.NativeShell.Core.Tests/BNDZ.NativeShell.Core.Tests.csproj -c Debug --verbosity quiet

$exe = Join-Path $root "BNDZBackend\bin\Debug\net8.0-windows10.0.19041.0\BNDZ.exe"
Write-Host ""
Write-Host "Ready. Two complete versions (same features, different chrome):" -ForegroundColor Green
Write-Host "  Classic:      scripts\run-classic.cmd"
Write-Host "  Native Shell: scripts\run-native-shell.cmd"
Write-Host "  Or: `"$exe`""
Write-Host "      `"$exe`" --native-shell"
Write-Host ""
Write-Host "Both can run at once (separate single-instance mutexes)." -ForegroundColor Green
