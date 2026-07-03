# Builds and publishes the standalone BNDZ Launcher package.
param(
    [string]$Configuration = "Release",
    [string]$Runtime = "win-x64",
    [string]$Root = ""
)

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
    $Root = Split-Path -Parent $Root
}

$PkgRoot = Join-Path $Root "packages\bndz-launcher"
$HostProject = Join-Path $PkgRoot "BNDZ.Launcher.Host\BNDZ.Launcher.Host.csproj"
$PublishDir = Join-Path $Root "dist\publish\launcher-$Runtime"
$FlowScript = Join-Path $Root "scripts\build-bndz-launcher.ps1"
$AssetsDir = Join-Path $PkgRoot "BNDZ.Launcher.Host\Assets"

Write-Host "==> BNDZ Launcher standalone release ($Configuration / $Runtime)" -ForegroundColor Cyan

Push-Location $PkgRoot
try {
    Write-Host "==> Building launcher WebView2 UI" -ForegroundColor Yellow
    npm run build:ui
    if ($LASTEXITCODE -ne 0) { throw "launcher UI build failed" }
}
finally {
    Pop-Location
}

if (Test-Path $FlowScript) {
    Write-Host "==> Building Flow-based BNDZ.Launcher.exe" -ForegroundColor Yellow
    & $FlowScript -Configuration $Configuration -Root $Root -StageDir (Join-Path $AssetsDir "BNDZLauncher")
    if ($LASTEXITCODE -ne 0) { throw "Flow launcher build failed" }
} else {
    throw "Missing $FlowScript"
}

$iconSrc = Join-Path $Root "BNDZBackend\Assets\BNDZ.ico"
$iconDest = Join-Path $AssetsDir "BNDZ.ico"
if (Test-Path $iconSrc) { Copy-Item $iconSrc $iconDest -Force }

Write-Host "==> Publishing BNDZ.Launcher.Host" -ForegroundColor Yellow
dotnet publish $HostProject -c $Configuration -r $Runtime -o $PublishDir --self-contained false
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed for launcher host" }

$hostExe = Join-Path $PublishDir "BNDZ.Launcher.Host.exe"
if (-not (Test-Path $hostExe)) { throw "BNDZ.Launcher.Host.exe missing from publish output" }

$ZipPath = Join-Path $Root "dist\BNDZ-Launcher-$Runtime-portable.zip"
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path (Join-Path $PublishDir "*") -DestinationPath $ZipPath -Force

Write-Host "==> Launcher publish: $PublishDir" -ForegroundColor Green
Write-Host "==> Launcher ZIP: $ZipPath" -ForegroundColor Green
