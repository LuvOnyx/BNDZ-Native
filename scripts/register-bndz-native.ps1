# Register the BNDZShell Debug layout as BNDZNative and launch packaged (AUMID).
# Required: raw BNDZShell.exe is not a supported launch path (WASDK / WebView2 init fails).

param(
  [Parameter(Mandatory = $true)]
  [string]$Layout
)

$ErrorActionPreference = "Stop"

$manifest = Join-Path $Layout "AppxManifest.xml"
$exe = Join-Path $Layout "BNDZShell.exe"
if (-not (Test-Path $manifest)) { throw "Missing AppxManifest.xml under $Layout" }
if (-not (Test-Path $exe)) { throw "Missing BNDZShell.exe under $Layout" }

try {
  Add-AppxPackage -Register $manifest -ForceApplicationShutdown -ErrorAction Stop
}
catch {
  Add-AppxPackage -Register $manifest -ForceApplicationShutdown -ForceUpdateFromAnyVersion -ErrorAction Stop
}

$pkg = Get-AppxPackage -Name BNDZNative -ErrorAction Stop
$aumid = $pkg.PackageFamilyName + '!App'
Write-Host ("Starting BNDZ-Native (packaged): " + $aumid)
Write-Host ("  InstallLocation: " + $pkg.InstallLocation)
Start-Process -FilePath explorer.exe -ArgumentList @("shell:AppsFolder\$aumid")
