# Build BNDZ-Native WinUI shell (FilesMerge) + full BNDZBackend for Phase 2+
# Windows only for Files/WinUI (.NET 10 + Windows App SDK).

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host "==> BNDZBackend + React assets (full brain for --backend-host)" -ForegroundColor Cyan
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

# Stage BNDZ.exe next to Files.exe so ResolveBndzExe finds the sibling first.
$bndzExe = Join-Path $root "BNDZBackend\bin\Debug\net8.0-windows10.0.19041.0\BNDZ.exe"
$bndzUi = Join-Path $root "BNDZBackend\Assets\ui"
$filesOutCandidates = @(
  (Join-Path $root "FilesMerge\src\Files.App\bin\x64\Debug\net10.0-windows10.0.26100.0\win-x64"),
  (Join-Path $root "FilesMerge\src\Files.App\bin\x64\Debug\net10.0-windows10.0.26100.0"),
  (Join-Path $root "FilesMerge\src\Files.App\bin\Debug\net10.0-windows10.0.26100.0\win-x64")
)
if (Test-Path $bndzExe) {
  foreach ($dir in $filesOutCandidates) {
    if (Test-Path $dir) {
      Write-Host "==> Staging BNDZ.exe + Assets/ui next to Files shell: $dir" -ForegroundColor Cyan
      Copy-Item -Force $bndzExe (Join-Path $dir "BNDZ.exe")
      $bndzDir = Split-Path $bndzExe -Parent
      Get-ChildItem $bndzDir -Filter "*.dll" | ForEach-Object {
        Copy-Item -Force $_.FullName (Join-Path $dir $_.Name) -ErrorAction SilentlyContinue
      }
      if (Test-Path $bndzUi) {
        $uiDest = Join-Path $dir "Assets\ui"
        New-Item -ItemType Directory -Force -Path $uiDest | Out-Null
        Copy-Item -Recurse -Force (Join-Path $bndzUi "*") $uiDest
      }
      break
    }
  }
}

Write-Host ""
Write-Host "Ready:" -ForegroundColor Green
Write-Host "  BNDZ-Native (FilesMerge shell):  scripts\run-files-merge.cmd"
Write-Host "  Classic BNDZ.exe (reference):    scripts\run-classic.cmd"
Write-Host ""
Write-Host "Architecture #3: Files owns chrome + list; BNDZ.exe --backend-host provides full services via named pipe."
Write-Host "Status chip in the shell shows 'BNDZ backend connected' when the host is live."
