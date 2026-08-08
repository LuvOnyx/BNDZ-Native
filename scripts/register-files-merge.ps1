# Register the FilesMerge Debug layout as FilesDev and launch packaged (AUMID).
# Required: unpackaged Files.exe hits WASDK DeploymentManager REGDB_E_CLASSNOTREG.

param(
  [Parameter(Mandatory = $true)]
  [string]$Layout
)

$ErrorActionPreference = "Stop"

$manifest = Join-Path $Layout "AppxManifest.xml"
$exe = Join-Path $Layout "Files.exe"
if (-not (Test-Path $manifest)) { throw "Missing AppxManifest.xml under $Layout" }
if (-not (Test-Path $exe)) { throw "Missing Files.exe under $Layout" }

$bndzHost = Join-Path $Layout "bndz-host\BNDZ.exe"
if (-not (Test-Path $bndzHost)) {
  Write-Warning "bndz-host\BNDZ.exe missing next to layout - backend chip may stay offline. Re-run scripts\build-files-bndz-merge.ps1"
}

try {
  Add-AppxPackage -Register $manifest -ForceApplicationShutdown -ErrorAction Stop
}
catch {
  Add-AppxPackage -Register $manifest -ForceApplicationShutdown -ForceUpdateFromAnyVersion -ErrorAction Stop
}

$pkg = Get-AppxPackage -Name FilesDev -ErrorAction Stop
$aumid = $pkg.PackageFamilyName + '!App'
Write-Host ("Starting BNDZ-Native (packaged): " + $aumid)
Write-Host ("  InstallLocation: " + $pkg.InstallLocation)
Start-Process -FilePath explorer.exe -ArgumentList @("shell:AppsFolder\$aumid")
