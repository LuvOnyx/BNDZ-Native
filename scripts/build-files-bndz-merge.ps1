# Build Files × BNDZ merge (Windows)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> Classic BNDZ (required for BNDZ Workspace embed)" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
if ($LASTEXITCODE -ne 0) { throw "BNDZBackend build failed" }

Write-Host "==> Files merge app (WinUI — needs .NET 10 + Windows App SDK)" -ForegroundColor Cyan
Push-Location FilesMerge
try {
  dotnet build src/Files.App/Files.App.csproj -c Debug -p:Platform=x64
  if ($LASTEXITCODE -ne 0) { throw "Files.App build failed — install .NET 10 SDK and Windows App SDK" }
}
finally { Pop-Location }

Write-Host ""
Write-Host "Ready for A/B:" -ForegroundColor Green
Write-Host "  MERGE (Files + BNDZ):  scripts\run-files-merge.cmd"
Write-Host "  CLASSIC (main-style): scripts\run-classic.cmd"
Write-Host ""
Write-Host "In the Files app, click 'BNDZ Workspace' for full BNDZ UI inside Files chrome."
