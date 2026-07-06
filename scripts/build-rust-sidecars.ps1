# Builds vendored Rust engines and stages the binaries for BNDZ packaging.
param(
    [string]$Configuration = "Release",
    [string]$Root = "",
    [string]$StageRoot = "",
    [switch]$SkipSpacedrive,
    [switch]$SkipSpacebot,
    [switch]$BuildSpacedriveWeb,
    [string]$CargoTargetDir = "",
    [int]$CargoJobs = 0
)

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
if (-not $StageRoot) {
    $StageRoot = Join-Path $Root "BNDZBackend\Assets\RustSidecars"
}

$SpacedriveRoot = Join-Path $Root "external\spacedrive"
$SpacebotRoot = Join-Path $Root "external\spacebot"

function Assert-Command {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$InstallHint
    )

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "$Name was not found. $InstallHint"
    }
}

function Resolve-CommandPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [string[]]$AdditionalPaths = @()
    )

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    foreach ($path in $AdditionalPaths) {
        if ($path -and (Test-Path $path)) {
            return $path
        }
    }

    return $null
}

function Invoke-CargoBuild {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Repository,
        [Parameter(Mandatory = $true)]
        [string[]]$CargoArgs,
        [Parameter(Mandatory = $true)]
        [string]$BinaryName,
        [Parameter(Mandatory = $true)]
        [string]$StageDirectory
    )

    Push-Location $Repository
    try {
        $buildArgs = @("build")
        if ($Configuration -ieq "Release") {
            $buildArgs += "--release"
            $targetKind = "release"
        }
        else {
            $targetKind = "debug"
        }
        if ($CargoJobs -gt 0) {
            $buildArgs += @("-j", $CargoJobs.ToString())
        }
        $buildArgs += $CargoArgs

        Write-Host "==> cargo $($buildArgs -join ' ')" -ForegroundColor Yellow
        $previousCargoTargetDir = $env:CARGO_TARGET_DIR
        if ($CargoTargetDir) {
            $env:CARGO_TARGET_DIR = $CargoTargetDir
            Write-Host "==> Using Cargo target dir $CargoTargetDir" -ForegroundColor DarkGray
        }
        cargo @buildArgs
        if ($LASTEXITCODE -ne 0) {
            throw "cargo build failed for $BinaryName"
        }

        $extension = if ($IsWindows -or $env:OS -like "*Windows*") { ".exe" } else { "" }
        $targetRoot = if ($CargoTargetDir) { $CargoTargetDir } else { Join-Path $Repository "target" }
        $binaryPath = Join-Path $targetRoot "$targetKind\$BinaryName$extension"
        if (-not (Test-Path $binaryPath)) {
            throw "Built binary not found: $binaryPath"
        }

        $defaultBinaryPath = Join-Path $Repository "target\$targetKind\$BinaryName$extension"
        if ($CargoTargetDir -and $binaryPath -ne $defaultBinaryPath) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $defaultBinaryPath) -Force | Out-Null
            Copy-Item $binaryPath $defaultBinaryPath -Force
        }

        if (Test-Path $StageDirectory) {
            Remove-Item $StageDirectory -Recurse -Force
        }
        New-Item -ItemType Directory -Path $StageDirectory -Force | Out-Null
        Copy-Item $binaryPath (Join-Path $StageDirectory "$BinaryName$extension") -Force

        foreach ($metadata in @("LICENSE", "LICENSE.md", "README.md", "NOTICE", "NOTICE.md")) {
            $metadataPath = Join-Path $Repository $metadata
            if (Test-Path $metadataPath) {
                Copy-Item $metadataPath (Join-Path $StageDirectory $metadata) -Force
            }
        }

        Write-Host "==> Staged $BinaryName to $StageDirectory" -ForegroundColor Green
    }
    finally {
        if ($CargoTargetDir) {
            $env:CARGO_TARGET_DIR = $previousCargoTargetDir
        }
        Pop-Location
    }
}

function Ensure-SpacedriveWebBundle {
    $distIndex = Join-Path $SpacedriveRoot "apps\web\dist\index.html"
    if (Test-Path $distIndex) {
        return
    }

    if (-not $BuildSpacedriveWeb) {
        throw "Spacedrive sd-server embeds apps\web\dist at compile time. Run this script with -BuildSpacedriveWeb, or build external\spacedrive\apps\web first with bun."
    }

    $bun = Resolve-CommandPath -Name "bun" -AdditionalPaths @(
        (Join-Path $env:USERPROFILE ".bun\bin\bun.exe")
    )
    if (-not $bun) {
        throw "bun was not found. Install Bun 1.3+ from https://bun.sh before building the Spacedrive web bundle."
    }

    Push-Location $SpacedriveRoot
    try {
        $bunDirectory = Split-Path -Parent $bun
        if ($env:PATH -notlike "*$bunDirectory*") {
            $env:PATH = "$bunDirectory;$env:PATH"
        }

        Write-Host "==> Installing Spacedrive web dependencies with bun" -ForegroundColor Yellow
        & $bun install
        if ($LASTEXITCODE -ne 0) { throw "bun install failed for Spacedrive" }

        Write-Host "==> Building Spacedrive web bundle" -ForegroundColor Yellow
        & $bun run --filter "@sd/web" build
        if ($LASTEXITCODE -ne 0) { throw "Spacedrive web build failed" }
    }
    finally {
        Pop-Location
    }

    if (-not (Test-Path $distIndex)) {
        throw "Spacedrive web bundle did not produce apps\web\dist\index.html"
    }
}

Write-Host "==> BNDZ Rust sidecar build ($Configuration)" -ForegroundColor Cyan
Assert-Command -Name "cargo" -InstallHint "Install Rust with rustup from https://rustup.rs."

if (-not $SkipSpacedrive) {
    if (-not (Test-Path (Join-Path $SpacedriveRoot "Cargo.toml"))) {
        throw "Spacedrive source not found. Run: git clone --depth 1 https://github.com/spacedriveapp/spacedrive external/spacedrive"
    }

    Ensure-SpacedriveWebBundle
    Invoke-CargoBuild `
        -Repository $SpacedriveRoot `
        -CargoArgs @("-p", "sd-server", "--bin", "sd-server") `
        -BinaryName "sd-server" `
        -StageDirectory (Join-Path $StageRoot "spacedrive")
}

if (-not $SkipSpacebot) {
    if (-not (Test-Path (Join-Path $SpacebotRoot "Cargo.toml"))) {
        throw "Spacebot source not found. Run: git clone --depth 1 https://github.com/spacedriveapp/spacebot external/spacebot"
    }

    Invoke-CargoBuild `
        -Repository $SpacebotRoot `
        -CargoArgs @("--bin", "spacebot") `
        -BinaryName "spacebot" `
        -StageDirectory (Join-Path $StageRoot "spacebot")
}

Write-Host "==> Rust sidecars staged under $StageRoot" -ForegroundColor Green
