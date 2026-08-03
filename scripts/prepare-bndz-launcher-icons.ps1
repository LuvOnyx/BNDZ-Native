# Generates BNDZ multi-size ICO and copies launcher icon assets.
param(
    [string]$Root = "",
    [string]$TargetDir = "",
    [switch]$GenerateIco
)

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

# Use the square app-icon master, never the wide light banner.
$BndzPng = Join-Path $Root "BNDZBackend\Assets\bndz-square.png"
if (-not (Test-Path $BndzPng)) {
    $BndzPng = Join-Path $Root "BNDZBackend\Assets\bndz-app.png"
}
$BndzIco = Join-Path $Root "BNDZBackend\Assets\BNDZ.ico"
$BackendProj = Join-Path $Root "BNDZBackend\BNDZ.csproj"

if (-not (Test-Path $BndzPng)) {
    throw "BNDZ square-master icon PNG not found. Run regenerate-ico.ps1 first to create bndz-square.png."
}

if ($GenerateIco -or -not (Test-Path $BndzIco) -or (Get-Item $BndzIco).Length -lt 4096) {
    Write-Host "==> Generating multi-size BNDZ.ico" -ForegroundColor Yellow
    Push-Location (Join-Path $Root "BNDZBackend")
    try {
        dotnet build -c Release --verbosity quiet | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "dotnet build failed for icon generation" }
        dotnet run -c Release --no-build -- --generate-icon | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "BNDZ --generate-icon failed" }
    }
    finally {
        Pop-Location
    }
}

if (-not (Test-Path $BndzIco)) {
    throw "BNDZ.ico not found after generation: $BndzIco"
}

function Copy-IconAssets {
    param([string]$Dir)
    if (-not $Dir -or -not (Test-Path $Dir)) { return }

    $images = Join-Path $Dir "Images"
    $resources = Join-Path $Dir "Resources"
    if (-not (Test-Path $images)) { New-Item -ItemType Directory -Path $images -Force | Out-Null }
    if (-not (Test-Path $resources)) { New-Item -ItemType Directory -Path $resources -Force | Out-Null }

    Copy-Item $BndzPng (Join-Path $images "app.png") -Force
    Copy-Item $BndzIco (Join-Path $images "app.ico") -Force
    Copy-Item $BndzIco (Join-Path $resources "app.ico") -Force

    $pluginImg = Join-Path $Dir "Plugins\Flow.Launcher.Plugin.BNDZ\Images"
    if (-not (Test-Path $pluginImg)) { New-Item -ItemType Directory -Path $pluginImg -Force | Out-Null }
    Copy-Item $BndzPng (Join-Path $pluginImg "bndz.png") -Force
}

if ($TargetDir) {
    Write-Host "==> Copying BNDZ icons to $TargetDir" -ForegroundColor Cyan
    Copy-IconAssets -Dir $TargetDir
}

return @{
    Ico = $BndzIco
    Png = $BndzPng
}
