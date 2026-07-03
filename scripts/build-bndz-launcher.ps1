# Builds the rebranded Flow Launcher as BNDZ Launcher and stages it for BNDZ packaging.
param(
    [string]$Configuration = "Release",
    [string]$Root = "",
    [string]$StageDir = ""
)

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

$FlowRoot = Join-Path $Root "external\Flow.Launcher"
$Solution = Join-Path $FlowRoot "Flow.Launcher.sln"
$LauncherProject = Join-Path $FlowRoot "Flow.Launcher\Flow.Launcher.csproj"
$PluginProject = Join-Path $FlowRoot "Plugins\Flow.Launcher.Plugin.BNDZ\Flow.Launcher.Plugin.BNDZ.csproj"
$OutputDir = Join-Path $FlowRoot "Output\$Configuration"
if (-not $StageDir) {
    $StageDir = Join-Path $Root "BNDZBackend\Assets\BNDZLauncher"
}
$BndzIcon = Join-Path $Root "BNDZBackend\Assets\BNDZ-light.png"

if (-not (Test-Path $Solution)) {
    throw "Flow Launcher not found. Run: git clone https://github.com/Flow-Launcher/Flow.Launcher.git external/Flow.Launcher"
}

Write-Host "==> Building BNDZ Launcher (Flow Launcher fork) [$Configuration]" -ForegroundColor Cyan

# Overlay BNDZ icons before compile so exe + embedded tray resources use BNDZ branding
$prepareScript = Join-Path $Root "scripts\prepare-bndz-launcher-icons.ps1"
$flowAppDir = Join-Path $FlowRoot "Flow.Launcher"
$flowResourcesIco = Join-Path $flowAppDir "Resources\app.ico"
$flowImagesIco = Join-Path $flowAppDir "Images\app.ico"
$flowImagesPng = Join-Path $flowAppDir "Images\app.png"
$iconBackupDir = Join-Path $FlowRoot ".bndz-icon-backup"
if (Test-Path $prepareScript) {
    Write-Host "==> Preparing BNDZ icons for Flow build" -ForegroundColor Yellow
    $iconAssets = & $prepareScript -Root $Root -GenerateIco
    $bndzIco = $iconAssets.Ico
    $bndzPng = $iconAssets.Png
    if (-not (Test-Path $iconBackupDir)) {
        New-Item -ItemType Directory -Path $iconBackupDir -Force | Out-Null
        if (Test-Path $flowResourcesIco) { Copy-Item $flowResourcesIco (Join-Path $iconBackupDir "Resources_app.ico") -Force }
        if (Test-Path $flowImagesIco) { Copy-Item $flowImagesIco (Join-Path $iconBackupDir "Images_app.ico") -Force }
        if (Test-Path $flowImagesPng) { Copy-Item $flowImagesPng (Join-Path $iconBackupDir "Images_app.png") -Force }
    }
    $resDir = Join-Path $flowAppDir "Resources"
    $imgDir = Join-Path $flowAppDir "Images"
    if (-not (Test-Path $resDir)) { New-Item -ItemType Directory -Path $resDir -Force | Out-Null }
    if (-not (Test-Path $imgDir)) { New-Item -ItemType Directory -Path $imgDir -Force | Out-Null }
    Copy-Item $bndzIco $flowResourcesIco -Force
    Copy-Item $bndzIco $flowImagesIco -Force
    Copy-Item $bndzPng $flowImagesPng -Force
}

Push-Location $FlowRoot
try {
    $slnText = Get-Content $Solution -Raw
    if ($slnText -notmatch "Flow.Launcher.Plugin.BNDZ") {
        Write-Host "==> Adding BNDZ plugin to solution" -ForegroundColor Yellow
        dotnet sln $Solution add $PluginProject | Out-Null
    }

    dotnet restore $LauncherProject --force
    if ($LASTEXITCODE -ne 0) { throw "dotnet restore failed for Flow Launcher" }

    # Build main launcher + plugin refs only (skip Flow.Launcher.Test — spurious FLSG0002)
    dotnet build $LauncherProject -c $Configuration --no-restore
    if ($LASTEXITCODE -ne 0) { throw "dotnet build failed for Flow Launcher" }

    Write-Host "==> Building BNDZ plugin" -ForegroundColor Yellow
    dotnet build $PluginProject -c $Configuration --no-restore
    if ($LASTEXITCODE -ne 0) { throw "dotnet build failed for Flow.Launcher.Plugin.BNDZ" }
}
finally {
    Pop-Location
    if (Test-Path $iconBackupDir) {
        Write-Host "==> Restoring original Flow icon assets" -ForegroundColor DarkGray
        $bakRes = Join-Path $iconBackupDir "Resources_app.ico"
        $bakImgIco = Join-Path $iconBackupDir "Images_app.ico"
        $bakImgPng = Join-Path $iconBackupDir "Images_app.png"
        if (Test-Path $bakRes) { Copy-Item $bakRes $flowResourcesIco -Force }
        if (Test-Path $bakImgIco) { Copy-Item $bakImgIco $flowImagesIco -Force }
        if (Test-Path $bakImgPng) { Copy-Item $bakImgPng $flowImagesPng -Force }
    }
}

$LauncherExe = Join-Path $OutputDir "Flow.Launcher.exe"
if (-not (Test-Path $LauncherExe)) {
    $legacy = Join-Path $OutputDir "BNDZ.Launcher.exe"
    if (Test-Path $legacy) { $LauncherExe = $legacy }
    else { throw "Launcher executable not found in $OutputDir" }
}

Write-Host "==> Staging launcher to $StageDir" -ForegroundColor Yellow
if (Test-Path $StageDir) { Remove-Item $StageDir -Recurse -Force }
New-Item -ItemType Directory -Path $StageDir -Force | Out-Null
Copy-Item -Path (Join-Path $OutputDir "*") -Destination $StageDir -Recurse -Force

$StagedFlowExe = Join-Path $StageDir "Flow.Launcher.exe"
$StagedBndzExe = Join-Path $StageDir "BNDZ.Launcher.exe"
if (Test-Path $StagedFlowExe) {
    if (Test-Path $StagedBndzExe) { Remove-Item $StagedBndzExe -Force }
    Rename-Item $StagedFlowExe "BNDZ.Launcher.exe"
}

# White-label staged output only (never touch Flow source / localization inputs)
$BrandingScript = Join-Path $Root "scripts\apply-bndz-launcher-branding.ps1"
$BndzIco = Join-Path $Root "BNDZBackend\Assets\BNDZ.ico"
& $BrandingScript -LauncherDir $StageDir -BndzIcon $BndzIcon -BndzIco $BndzIco

Write-Host "==> BNDZ Launcher ready: $StagedBndzExe" -ForegroundColor Green
