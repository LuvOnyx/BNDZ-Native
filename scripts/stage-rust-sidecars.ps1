# Stages already-built Rust sidecar binaries into BNDZBackend/Assets.
param(
    [string]$Configuration = "Release",
    [string]$Root = "",
    [string]$StageRoot = "",
    [switch]$VerifyOnly,
    [switch]$RequireSpacedrive,
    [switch]$RequireSpacebot
)

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}
if (-not $StageRoot) {
    $StageRoot = Join-Path $Root "BNDZBackend\Assets\RustSidecars"
}

$targetKind = if ($Configuration -ieq "Release") { "release" } else { "debug" }
$exe = if ($IsWindows -or $env:OS -like "*Windows*") { ".exe" } else { "" }

$sidecars = @(
    @{
        Name = "Spacedrive"
        Required = [bool]$RequireSpacedrive
        Source = Join-Path $Root "external\spacedrive\target\$targetKind\sd-server$exe"
        DestinationDir = Join-Path $StageRoot "spacedrive"
        Destination = Join-Path $StageRoot "spacedrive\sd-server$exe"
        MetadataRoot = Join-Path $Root "external\spacedrive"
    },
    @{
        Name = "Spacebot"
        Required = [bool]$RequireSpacebot
        Source = Join-Path $Root "external\spacebot\target\$targetKind\spacebot$exe"
        DestinationDir = Join-Path $StageRoot "spacebot"
        Destination = Join-Path $StageRoot "spacebot\spacebot$exe"
        MetadataRoot = Join-Path $Root "external\spacebot"
    }
)

$failures = @()
Write-Host "==> Staging Rust sidecars from cached builds ($Configuration)" -ForegroundColor Cyan

foreach ($sidecar in $sidecars) {
    $source = $sidecar.Source
    $destination = $sidecar.Destination
    $destinationDir = $sidecar.DestinationDir
    $label = $sidecar.Name

    if (-not (Test-Path $source)) {
        $message = "$label binary not built: $source"
        if ($sidecar.Required) {
            $failures += $message
            Write-Host "  !!  $message" -ForegroundColor Red
        } else {
            Write-Host "  --  $message" -ForegroundColor DarkGray
        }
        continue
    }

    if (-not $VerifyOnly) {
        if (-not (Test-Path $destinationDir)) {
            New-Item -ItemType Directory -Path $destinationDir -Force | Out-Null
        }
        Copy-Item $source $destination -Force

        foreach ($metadata in @("LICENSE", "LICENSE.md", "README.md", "NOTICE", "NOTICE.md")) {
            $metadataPath = Join-Path $sidecar.MetadataRoot $metadata
            if (Test-Path $metadataPath) {
                Copy-Item $metadataPath (Join-Path $destinationDir $metadata) -Force
            }
        }
    }

    $sizeMb = [math]::Round((Get-Item $source).Length / 1MB, 1)
    Write-Host "  OK  $label ($sizeMb MB)" -ForegroundColor Green
}

if ($failures.Count) {
    Write-Host "`nRust sidecar staging FAILED:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    Write-Host "`nBuild missing binaries separately with scripts\build-rust-sidecars.ps1, or run Spacebot/Spacedrive source builds in CI." -ForegroundColor Yellow
    exit 1
}

Write-Host "==> Rust sidecar staging complete: $StageRoot" -ForegroundColor Green
