# Copies retail legal documents into BNDZBackend/Assets/legal for publish output.
param(
    [string]$Root = (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
)

$ErrorActionPreference = "Stop"
$docs = Join-Path $Root "docs"
$dest = Join-Path $Root "BNDZBackend\Assets\legal"
$files = @("EULA.md", "PRIVACY.md", "THIRD_PARTY_LICENSES.md")

if (-not (Test-Path $docs)) {
    throw "Missing docs folder: $docs"
}

New-Item -ItemType Directory -Path $dest -Force | Out-Null
foreach ($name in $files) {
    $src = Join-Path $docs $name
    if (-not (Test-Path $src)) {
        throw "Missing legal doc: $src"
    }
    Copy-Item $src (Join-Path $dest $name) -Force
}
Write-Host "==> Legal docs copied to $dest" -ForegroundColor Green
