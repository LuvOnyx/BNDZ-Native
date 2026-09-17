# Register the BNDZ Debug layout as BNDZNative and launch packaged (AUMID).

param(
  [Parameter(Mandatory = $true)]
  [string]$Layout
)

$ErrorActionPreference = "Stop"

$manifest = Join-Path $Layout "AppxManifest.xml"
$exe = Join-Path $Layout "BNDZ.exe"
if (-not (Test-Path $exe)) { $exe = Join-Path $Layout "BNDZShell.exe" }
if (-not (Test-Path $manifest)) { throw "Missing AppxManifest.xml under $Layout" }
if (-not (Test-Path $exe)) { throw "Missing BNDZ.exe under $Layout" }

try {
  Add-AppxPackage -Register $manifest -ForceApplicationShutdown -ErrorAction Stop
}
catch {
  Add-AppxPackage -Register $manifest -ForceApplicationShutdown -ForceUpdateFromAnyVersion -ErrorAction Stop
}

$pkg = Get-AppxPackage -Name BNDZNative -ErrorAction Stop
$aumid = $pkg.PackageFamilyName + '!App'
Write-Host ("Starting BNDZ (packaged): " + $aumid)
Write-Host ("  InstallLocation: " + $pkg.InstallLocation)
Start-Process -FilePath explorer.exe -ArgumentList @("shell:AppsFolder\$aumid")
