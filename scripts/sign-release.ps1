# Authenticode signing for BNDZ release artifacts.
# Requires Windows SDK signtool.exe and a code signing certificate.
#
# Environment variables (any one auth method):
#   BNDZ_SIGN_CERT_THUMBPRINT  - cert thumbprint in CurrentUser\My store
#   BNDZ_SIGN_PFX_PATH         - path to .pfx file
#   BNDZ_SIGN_PFX_PASSWORD     - PFX password (optional if unprotected)
#
# Usage:
#   .\scripts\sign-release.ps1 -Files @("dist\publish\win-x64\BNDZ.exe")
#   .\scripts\sign-release.ps1 -Files @("dist\BNDZ-Setup-3.6.2.exe")

param(
    [Parameter(Mandatory = $true)]
    [string[]]$Files,
    [string]$TimestampUrl = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

function Find-SignTool {
    $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (-not (Test-Path $kits)) { return $null }
    Get-ChildItem $kits -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object {
            $candidate = Join-Path $_.FullName "x64\signtool.exe"
            if (Test-Path $candidate) { return $candidate }
        } | Select-Object -First 1
}

$SignTool = Find-SignTool
if (-not $SignTool) {
    throw "signtool.exe not found. Install the Windows 10/11 SDK."
}

$thumb = $env:BNDZ_SIGN_CERT_THUMBPRINT
$pfx = $env:BNDZ_SIGN_PFX_PATH
$pfxPass = $env:BNDZ_SIGN_PFX_PASSWORD

if (-not $thumb -and -not $pfx) {
    Write-Warning "No signing certificate configured (BNDZ_SIGN_CERT_THUMBPRINT or BNDZ_SIGN_PFX_PATH). Skipping."
    return
}

$signArgs = @("sign", "/fd", "sha256", "/tr", $TimestampUrl, "/td", "sha256", "/v")

if ($pfx) {
    if (-not (Test-Path $pfx)) { throw "PFX not found: $pfx" }
    $signArgs += @("/f", $pfx)
    if ($pfxPass) { $signArgs += @("/p", $pfxPass) }
} else {
    $signArgs += @("/sha1", $thumb)
}

foreach ($file in $Files) {
    if (-not (Test-Path $file)) {
        Write-Warning "Skip missing file: $file"
        continue
    }
    Write-Host "==> Signing $file" -ForegroundColor Cyan
    & $SignTool @signArgs $file
    if ($LASTEXITCODE -ne 0) { throw "signtool failed for $file" }
    Write-Host "    OK" -ForegroundColor Green
}
