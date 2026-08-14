# Build BNDZ-Native: React assets + BNDZBackend + BNDZShell (WinUI, in-process backend)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Stop-BndzLockingProcesses {
    <#
    Hard-kill shell/backend before MSBuild copies DLLs. End Task / taskkill can fail on
    zombie WinUI processes — try multiple APIs and refuse to continue if still locked.
    #>
    $names = @('BNDZShell', 'BNDZ')
    Write-Host "==> Hard-kill locking processes ($($names -join ', '))" -ForegroundColor Cyan
    foreach ($n in $names) {
        Get-Process -Name $n -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Host "  Stop-Process $($_.Id) ($n)" -ForegroundColor DarkYellow
            Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
        }
        # taskkill writes ERROR: to stderr when a PID is already dying — do not treat as throw
        cmd /c "taskkill /F /IM $n.exe /T >nul 2>nul"
    }
    try {
        Get-CimInstance Win32_Process -Filter "Name='BNDZShell.exe' OR Name='BNDZ.exe'" -ErrorAction SilentlyContinue |
            ForEach-Object {
                Write-Host "  WMI Terminate $($_.ProcessId) ($($_.Name))" -ForegroundColor DarkYellow
                Invoke-CimMethod -InputObject $_ -MethodName Terminate -ErrorAction SilentlyContinue | Out-Null
                cmd /c "taskkill /F /PID $($_.ProcessId) >nul 2>nul"
            }
    } catch { }
    Start-Sleep -Milliseconds 1200
    $left = @(Get-Process -Name BNDZShell,BNDZ -ErrorAction SilentlyContinue)
    if ($left.Count -gt 0) {
        $ids = ($left | ForEach-Object { "$($_.ProcessName):$($_.Id)" }) -join ', '
        $locked = @()
        foreach ($p in $left) {
            $path = $null
            try { $path = $p.Path } catch { }
            if ([string]::IsNullOrWhiteSpace($path)) {
                $locked += "$($p.ProcessName):$($p.Id) (no path)"
                continue
            }
            # Probe sibling DLLs too — zombie often keeps BNDZCore.dll open after exe delete.
            $dir = Split-Path -Parent $path
            $probes = @($path, (Join-Path $dir 'BNDZCore.dll'), (Join-Path $dir 'BNDZShell.dll'))
            foreach ($probe in $probes) {
                if (-not (Test-Path -LiteralPath $probe)) { continue }
                try {
                    $fs = [System.IO.File]::Open($probe, [System.IO.FileMode]::Open, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
                    $fs.Close()
                } catch {
                    $locked += $probe
                }
            }
        }
        if ($locked.Count -gt 0) {
            throw "BNDZ processes still locking build output ($ids). Locked: $($locked -join '; '). Reboot or elevated Task Manager End Task, then re-run. Do not claim ready on a locked DLL."
        }
        Write-Host "  WARNING: leftover PID(s) $ids but output files not locked - continuing" -ForegroundColor DarkYellow
    } else {
        Write-Host "  locks clear" -ForegroundColor DarkGreen
    }
}

Stop-BndzLockingProcesses

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

# RAGE (.ydr/.ybn/…) preview depends on CodeWalker.Core (MIT) under external/.
$cwProj = Join-Path $root "external\CodeWalker\CodeWalker.Core\CodeWalker.Core.csproj"
if (-not (Test-Path $cwProj)) {
    Write-Host "==> Cloning CodeWalker.Core (sparse) for RAGE model preview" -ForegroundColor Cyan
    $cwRoot = Join-Path $root "external\CodeWalker"
    New-Item -ItemType Directory -Force -Path (Join-Path $root "external") | Out-Null
    git clone --depth 1 --filter=blob:none --sparse https://github.com/dexyfex/CodeWalker.git $cwRoot
    Push-Location $cwRoot
    git sparse-checkout set CodeWalker.Core
    Pop-Location
}

Write-Host "==> OpenPencil engine host" -ForegroundColor Cyan
Push-Location (Join-Path $root "tools\openpencil-host")
if (-not (Test-Path "node_modules")) { npm install }
npm run build
if ($LASTEXITCODE -ne 0) { Pop-Location; throw "OpenPencil host build failed" }
Pop-Location

Write-Host "==> React / UI assets" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

# Always stage fresh Vite output next to the shell exe even when MSBuild skips Content
# (PreserveNewest / locked BNDZShell.exe). Without this, WebView keeps serving stale bin Assets\ui.
function Sync-UiAssetsToShellOutput {
    $src = Join-Path $root "BNDZBackend\Assets\ui"
    if (-not (Test-Path (Join-Path $src "index.html"))) {
        throw "UI assets missing at $src - npm run build did not produce index.html"
    }
    $outs = @(
        (Join-Path $root "BNDZShell\src\BNDZShell.App\bin\x64\Debug"),
        (Join-Path $root "BNDZShell\src\BNDZShell.App\bin\x64\Release")
    )
    foreach ($base in $outs) {
        if (-not (Test-Path $base)) { continue }
        Get-ChildItem -Path $base -Directory -Recurse -Filter "net*-windows*" -EA SilentlyContinue | ForEach-Object {
            $dest = Join-Path $_.FullName "Assets\ui"
            Write-Host "  sync UI -> $dest" -ForegroundColor DarkCyan
            New-Item -ItemType Directory -Force -Path $dest | Out-Null
            robocopy $src $dest /MIR /NFL /NDL /NJH /NJS /nc /ns /np | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "robocopy UI sync failed ($LASTEXITCODE) -> $dest" }
        }
    }
}

Write-Host "==> Sync UI into shell output" -ForegroundColor Cyan
Sync-UiAssetsToShellOutput

Write-Host "==> BNDZBackend (services + embedded host)" -ForegroundColor Cyan
dotnet build BNDZBackend/BNDZ.csproj -c Debug -p:EnableWindowsTargeting=true
if ($LASTEXITCODE -ne 0) { throw "BNDZBackend build failed" }

Write-Host "==> BNDZShell WinUI (native list + craft islands)" -ForegroundColor Cyan
dotnet build BNDZShell/src/BNDZShell.App/BNDZShell.App.csproj -c Debug -p:Platform=x64
if ($LASTEXITCODE -ne 0) { throw "BNDZShell build failed" }

# MSBuild may have been blocked from refreshing Content — sync again after shell build.
Write-Host "==> Re-sync UI after shell build" -ForegroundColor Cyan
Sync-UiAssetsToShellOutput

Write-Host ""
Write-Host "Ready - launch either:" -ForegroundColor Green
Write-Host "  scripts\run-bndz-native.cmd"
Write-Host "  or double-click BNDZShell.exe under bin\x64\Debug\net*-windows*\"
Write-Host "(Unpackaged self-contained WinAppSDK - MSIX register no longer required.)"
