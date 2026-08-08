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

Write-Host "==> Patch WinUI XamlCompiler (WMC9999 / ErrorMessages embed)" -ForegroundColor Cyan
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "patch-xaml-compiler.ps1")
if ($LASTEXITCODE -ne 0) { throw "XamlCompiler patch failed" }

Write-Host "==> BNDZ-Native shell (FilesMerge / WinUI)" -ForegroundColor Cyan
Push-Location FilesMerge
try {
  dotnet build src/Files.App/Files.App.csproj -c Debug -p:Platform=x64
  if ($LASTEXITCODE -ne 0) { throw "Files.App build failed - install .NET 10 SDK and Windows App SDK" }
}
finally { Pop-Location }

# Stage isolated tree next to Files.exe (ResolveBndzExe prefers bndz-host\BNDZ.exe).
# Do NOT dump BNDZ net8 deps into the Files root — that breaks both hosts.
$bndzDir = Join-Path $root "BNDZBackend\bin\Debug\net8.0-windows10.0.19041.0"
$bndzExe = Join-Path $bndzDir "BNDZ.exe"
$bndzUi = Join-Path $root "BNDZBackend\Assets\ui"
$filesOutCandidates = @(
  (Join-Path $root "FilesMerge\src\Files.App\bin\x64\Debug\net10.0-windows10.0.26100.0\win-x64"),
  (Join-Path $root "FilesMerge\src\Files.App\bin\x64\Debug\net10.0-windows10.0.26100.0"),
  (Join-Path $root "FilesMerge\src\Files.App\bin\Debug\net10.0-windows10.0.26100.0\win-x64")
)
if (Test-Path $bndzExe) {
  foreach ($dir in $filesOutCandidates) {
    if (-not (Test-Path $dir)) { continue }
    $stage = Join-Path $dir "bndz-host"
    Write-Host "==> Staging BNDZ host tree: $stage" -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $stage | Out-Null
    & robocopy $bndzDir $stage /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
    if ($LASTEXITCODE -ge 8) { throw "robocopy BNDZ output failed (exit $LASTEXITCODE)" }
    if (Test-Path $bndzUi) {
      $uiDestHost = Join-Path $stage "Assets\ui"
      New-Item -ItemType Directory -Force -Path $uiDestHost | Out-Null
      & robocopy $bndzUi $uiDestHost /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "robocopy Assets/ui (bndz-host) failed (exit $LASTEXITCODE)" }

      # Also stage next to Files.exe for BndzPaneHost ResolveUiAssetsRoot (Assets\ui).
      $uiDestRoot = Join-Path $dir "Assets\ui"
      New-Item -ItemType Directory -Force -Path $uiDestRoot | Out-Null
      & robocopy $bndzUi $uiDestRoot /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
      if ($LASTEXITCODE -ge 8) { throw "robocopy Assets/ui (layout root) failed (exit $LASTEXITCODE)" }
    }
    # Remove any leftover flat sibling from older staging (pollutes Files net10 output).
    Remove-Item -Force (Join-Path $dir "BNDZ.exe") -ErrorAction SilentlyContinue
    break
  }
}

Write-Host ""
Write-Host "Ready:" -ForegroundColor Green
Write-Host "  BNDZ-Native (FilesMerge shell):  scripts\run-files-merge.cmd"
Write-Host "  Classic BNDZ.exe (reference):    scripts\run-classic.cmd"
Write-Host ""
Write-Host "Architecture #3: Files owns chrome + list; BNDZ.exe --backend-host provides full services via named pipe."
Write-Host "Status chip in the shell shows 'BNDZ backend connected' when the host is live."
