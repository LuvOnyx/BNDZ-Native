# Copies Icons8 3D toolbar icons into file manager web assets (see download-icons8-3d-toolbar.ps1).
param([string]$Root = "")

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

$download = Join-Path $Root "scripts\download-icons8-3d-toolbar.ps1"
if (Test-Path $download) {
    & $download -Root $Root
    exit $LASTEXITCODE
}

Write-Warning "download-icons8-3d-toolbar.ps1 not found"
exit 1
