# Build BNDZ-Native: React assets + BNDZBackend + BNDZShell (WinUI, in-process backend)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Ensure-BndzShellMsixAssets {
    $assetsDir = Join-Path $root "BNDZShell\src\BNDZShell.App\Assets"
    $iconPath = Join-Path $root "BNDZBackend\Assets\BNDZ.ico"
    if (-not (Test-Path $iconPath)) { return }
    New-Item -ItemType Directory -Force -Path $assetsDir | Out-Null

    Add-Type -AssemblyName System.Drawing
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon($iconPath)
    if ($null -eq $icon) { return }

    $sizes = @{
        "StoreLogo.png"           = 50
        "Square44x44Logo.png"     = 44
        "Square150x150Logo.png"   = 150
        "Wide310x150Logo.png"     = 150
    }
    foreach ($entry in $sizes.GetEnumerator()) {
        $dest = Join-Path $assetsDir $entry.Key
        if (Test-Path $dest) { continue }
        $size = [int]$entry.Value
        $bmp = New-Object System.Drawing.Bitmap $size, $size
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.Clear([System.Drawing.Color]::FromArgb(12, 15, 20))
        $rect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
        $g.DrawIcon($icon, $rect)
        $g.Dispose()
        $bmp.Save($dest, [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
    }
    $icon.Dispose()
}

Write-Host "==> MSIX tile assets" -ForegroundColor Cyan
Ensure-BndzShellMsixAssets

Write-Host "==> React / UI assets" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

Write-Host "==> BNDZBackend (services + embedded host)" -ForegroundColor Cyan
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
if ($LASTEXITCODE -ne 0) { throw "BNDZBackend build failed" }

Write-Host "==> BNDZShell WinUI (native list + craft islands)" -ForegroundColor Cyan
dotnet build BNDZShell/src/BNDZShell.App/BNDZShell.App.csproj -c Debug -p:Platform=x64
if ($LASTEXITCODE -ne 0) { throw "BNDZShell build failed" }

Write-Host ""
Write-Host "Ready - launch either:" -ForegroundColor Green
Write-Host "  scripts\run-bndz-native.cmd"
Write-Host "  or double-click BNDZShell.exe under bin\x64\Debug\net*-windows*\"
Write-Host "(Unpackaged self-contained WinAppSDK - MSIX register no longer required.)"
