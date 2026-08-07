# Build BNDZ-Native WinUI shell (FilesMerge) + keep BNDZBackend warm for Phase 2+
# Windows only for Files/WinUI (.NET 10 + Windows App SDK).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> BNDZBackend + React assets (Phase 2 readiness — not HWND embed)" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
if ($LASTEXITCODE -ne 0) { throw "BNDZBackend build failed" }

Write-Host "==> BNDZ-Native shell (FilesMerge / WinUI)" -ForegroundColor Cyan
Push-Location FilesMerge
try {
  dotnet build src/Files.App/Files.App.csproj -c Debug -p:Platform=x64
  if ($LASTEXITCODE -ne 0) { throw "Files.App build failed — install .NET 10 SDK and Windows App SDK" }
}
finally { Pop-Location }

Write-Host ""
Write-Host "Ready:" -ForegroundColor Green
Write-Host "  BNDZ-Native (FilesMerge shell):  scripts\run-files-merge.cmd"
Write-Host "  Classic BNDZ.exe (reference):    scripts\run-classic.cmd"
Write-Host ""
Write-Host "Architecture #3: Files owns chrome + file list. Full-window HWND embed is not product UX."
Write-Host "Next: Phase 2 backend IPC, Phase 3 hosted React panes."
