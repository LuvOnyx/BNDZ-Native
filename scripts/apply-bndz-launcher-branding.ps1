# Applies BNDZ white-labeling to an already-built launcher folder (no Flow source edits).
param(
    [Parameter(Mandatory = $true)]
    [string]$LauncherDir,
    [string]$BndzIcon = "",
    [string]$BndzIco = "",
    [string]$Root = ""
)

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

function Replace-EqualLengthStringInFile {
    param([string]$Path, [string]$From, [string]$To)
    if (-not (Test-Path $Path)) { return 0 }
    if ($From.Length -ne $To.Length) {
        Write-Warning "Skipping binary replace (length mismatch): '$From' -> '$To' in $Path"
        return 0
    }
    $fromBytes = [System.Text.Encoding]::UTF8.GetBytes($From)
    $toBytes = [System.Text.Encoding]::UTF8.GetBytes($To)
    $bytes = [System.IO.File]::ReadAllBytes($Path)
    $count = 0
    for ($i = 0; $i -le $bytes.Length - $fromBytes.Length; $i++) {
        $match = $true
        for ($j = 0; $j -lt $fromBytes.Length; $j++) {
            if ($bytes[$i + $j] -ne $fromBytes[$j]) { $match = $false; break }
        }
        if ($match) {
            for ($j = 0; $j -lt $toBytes.Length; $j++) { $bytes[$i + $j] = $toBytes[$j] }
            $count++
        }
    }
    if ($count -gt 0) {
        [System.IO.File]::WriteAllBytes($Path, $bytes)
    }
    return $count
}

function Replace-TextInXamlFiles {
    param([string]$Root, [string]$From, [string]$To)
    $files = Get-ChildItem -Path $Root -Recurse -Filter "*.xaml" -ErrorAction SilentlyContinue
    foreach ($file in $files) {
        $text = Get-Content $file.FullName -Raw -Encoding UTF8
        if ($text -notmatch [regex]::Escape($From)) { continue }
        $text = $text -replace [regex]::Escape($From), $To
        [System.IO.File]::WriteAllText($file.FullName, $text, [System.Text.UTF8Encoding]::new($false))
    }
}

function Copy-ItemSafe {
    param([string]$Source, [string]$Destination)
    try {
        Copy-Item $Source $Destination -Force
    }
    catch {
        Write-Warning "Skipped locked file: $Destination (quit BNDZ Launcher and re-run branding)"
    }
}

if (-not (Test-Path $LauncherDir)) {
    throw "Launcher directory not found: $LauncherDir"
}

if (-not [System.IO.Path]::IsPathRooted($LauncherDir)) {
    $LauncherDir = Join-Path $Root $LauncherDir
}
$LauncherDir = [System.IO.Path]::GetFullPath($LauncherDir)

Write-Host "==> Branding launcher at $LauncherDir" -ForegroundColor Cyan

# Copy icons — multi-size ICO + PNG for title bar, settings sidebar, taskbar, tray
$prepareScript = Join-Path $Root "scripts\prepare-bndz-launcher-icons.ps1"
if (Test-Path $prepareScript) {
    & $prepareScript -Root $Root -TargetDir $LauncherDir -GenerateIco | Out-Null
}

# Rebuild BNDZ plugin (runtime tray/title-bar branding)
$pluginProj = Join-Path $Root "external\Flow.Launcher\Plugins\Flow.Launcher.Plugin.BNDZ\Flow.Launcher.Plugin.BNDZ.csproj"
if (Test-Path $pluginProj) {
    Write-Host "==> Building BNDZ plugin" -ForegroundColor Yellow
    dotnet build $pluginProj -c Release --verbosity quiet | Out-Null
    if ($LASTEXITCODE -eq 0) {
        $pluginOut = Join-Path $Root "external\Flow.Launcher\Output\Release\Plugins\Flow.Launcher.Plugin.BNDZ"
        $pluginDest = Join-Path $LauncherDir "Plugins\Flow.Launcher.Plugin.BNDZ"
        if (Test-Path $pluginOut) {
            if (-not (Test-Path $pluginDest)) { New-Item -ItemType Directory -Path $pluginDest -Force | Out-Null }
            Copy-Item (Join-Path $pluginOut "*") $pluginDest -Recurse -Force
        }
    }
}
else {
    $imagesDir = Join-Path $LauncherDir "Images"
    if (-not (Test-Path $imagesDir)) { New-Item -ItemType Directory -Path $imagesDir -Force | Out-Null }
    if ($BndzIcon -and (Test-Path $BndzIcon)) {
        Copy-ItemSafe $BndzIcon (Join-Path $imagesDir "app.png")
    }
    if ($BndzIco -and (Test-Path $BndzIco)) {
        Copy-ItemSafe $BndzIco (Join-Path $imagesDir "app.ico")
        $resourcesDir = Join-Path $LauncherDir "Resources"
        if (-not (Test-Path $resourcesDir)) { New-Item -ItemType Directory -Path $resourcesDir -Force | Out-Null }
        Copy-ItemSafe $BndzIco (Join-Path $resourcesDir "app.ico")
    }
}

$resolvedIco = if ($BndzIco -and (Test-Path $BndzIco)) { $BndzIco } else { Join-Path $Root "BNDZBackend\Assets\BNDZ.ico" }
foreach ($exeName in @("BNDZ.Launcher.exe", "Flow.Launcher.exe")) {
    $exePath = Join-Path $LauncherDir $exeName
    if ((Test-Path $exePath) -and (Test-Path $resolvedIco)) {
        $setIconScript = Join-Path $Root "scripts\set-exe-icon.ps1"
        if (Test-Path $setIconScript) {
            & $setIconScript -ExePath $exePath -IconPath $resolvedIco
        }
    }
}

# Copy BNDZ Launcher theme into staged launcher
$launcherTheme = Join-Path $Root "external\Flow.Launcher\Flow.Launcher\Themes\BndzLauncher.xaml"
$themesDest = Join-Path $LauncherDir "Themes"
if ((Test-Path $launcherTheme) -and (Test-Path $themesDest)) {
    Copy-Item $launcherTheme (Join-Path $themesDest "BndzLauncher.xaml") -Force
    if (Test-Path (Join-Path $themesDest "BndzRaycast.xaml")) {
        Remove-Item (Join-Path $themesDest "BndzRaycast.xaml") -Force -ErrorAction SilentlyContinue
    }
}
$textReplacements = @(
    @{ From = "Flow Launcher"; To = "BNDZ Launcher" },
    @{ From = "Open Flow Launcher"; To = "Open BNDZ Launcher" },
    @{ From = "Start Flow Launcher"; To = "Start BNDZ Launcher" },
    @{ From = "Hide Flow Launcher"; To = "Hide BNDZ Launcher" },
    @{ From = "Restart Flow Launcher"; To = "Restart BNDZ Launcher" },
    @{ From = "displays Flow in"; To = "displays BNDZ in" },
    @{ From = "when Flow activates"; To = "when BNDZ activates" },
    @{ From = "Flow detected"; To = "BNDZ detected" },
    @{ From = "restart Flow before"; To = "restart BNDZ before" },
    @{ From = "requires Flow version"; To = "requires BNDZ version" },
    @{ From = "Flow does not meet"; To = "BNDZ does not meet" },
    @{ From = "updating Flow to"; To = "updating BNDZ to" },
    @{ From = "Please restart Flow"; To = "Please restart BNDZ" },
    @{ From = "Flow Launcher got"; To = "BNDZ Launcher got" },
    @{ From = "Enjoy Flow Launcher"; To = "Enjoy BNDZ Launcher" },
    @{ From = "Let's Start Flow Launcher"; To = "Let's Start BNDZ Launcher" },
    @{ From = "running Flow Launcher"; To = "running BNDZ Launcher" },
    @{ From = "in Flow Launcher"; To = "in BNDZ Launcher" },
    @{ From = "from Flow Launcher"; To = "from BNDZ Launcher" },
    @{ From = "via Flow Launcher"; To = "via BNDZ Launcher" },
    @{ From = "the Flow Launcher"; To = "the BNDZ Launcher" },
    @{ From = "from Flow's settings"; To = "from BNDZ's settings" },
    @{ From = "when activating Flow."; To = "when activating BNDZ." },
    @{ From = "Help us translate Flow"; To = "Help us translate BNDZ" },
    @{ From = "for Flow's volume"; To = "for BNDZ's volume" },
    @{ From = "Flow.Launcher Startup"; To = "BNDZ.Launcher Startup" },
    @{ From = "Restarting Flow,"; To = "Restarting BNDZ," },
    @{ From = "installation Flow will"; To = "installation BNDZ will" },
    @{ From = "uninstallation Flow will"; To = "uninstallation BNDZ will" },
    @{ From = "After the update Flow"; To = "After the update BNDZ" }
)

foreach ($pair in $textReplacements) {
    if ($pair.From -eq $pair.To) { continue }
    Replace-TextInXamlFiles -Root $LauncherDir -From $pair.From -To $pair.To
}

$pluginJsonFiles = Get-ChildItem -Path $LauncherDir -Recurse -Filter "plugin.json" -ErrorAction SilentlyContinue
foreach ($file in $pluginJsonFiles) {
    $text = Get-Content $file.FullName -Raw -Encoding UTF8
    $changed = $false
    foreach ($pair in $textReplacements) {
        if ($text -notmatch [regex]::Escape($pair.From)) { continue }
        $text = $text -replace [regex]::Escape($pair.From), $pair.To
        $changed = $true
    }
    if ($changed) {
        [System.IO.File]::WriteAllText($file.FullName, $text, [System.Text.UTF8Encoding]::new($false))
    }
}

# Tray menu labels (unified BNDZ branding)
Replace-TextInXamlFiles -Root $LauncherDir -From 'x:Key="iconTrayOpen">Open</system:String>' -To 'x:Key="iconTrayOpen">Open Launcher</system:String>'
Replace-TextInXamlFiles -Root $LauncherDir -From 'x:Key="iconTrayExit">Exit</system:String>' -To 'x:Key="iconTrayExit">Exit BNDZ</system:String>'

# Compiled strings (welcome hero, settings sidebar, tray title, etc.)
$binaryTargets = @(
    (Join-Path $LauncherDir "Flow.Launcher.dll"),
    (Join-Path $LauncherDir "Flow.Launcher.Infrastructure.dll"),
    (Join-Path $LauncherDir "Flow.Launcher.Core.dll"),
    (Join-Path $LauncherDir "BNDZ.Launcher.exe"),
    (Join-Path $LauncherDir "Flow.Launcher.exe")
)
$binaryReplacements = @(
    @{ From = "Flow Launcher"; To = "BNDZ Launcher" },
    @{ From = "Open Flow Launcher"; To = "Open BNDZ Launcher" },
    @{ From = "displays Flow in"; To = "displays BNDZ in" },
    @{ From = "when Flow activates"; To = "when BNDZ activates" }
)
$totalPatches = 0
foreach ($target in $binaryTargets) {
    foreach ($pair in $binaryReplacements) {
        $totalPatches += Replace-EqualLengthStringInFile -Path $target -From $pair.From -To $pair.To
    }
}
Write-Host "==> Patched $totalPatches embedded branding strings" -ForegroundColor Green
Write-Host "==> BNDZ Launcher branding complete" -ForegroundColor Green
