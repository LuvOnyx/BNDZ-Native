# BNDZ Release Build Script
# Produces a publish folder and optionally an Inno Setup installer.
#
# Usage:
#   .\scripts\build-release.ps1
#   .\scripts\build-release.ps1 -SelfContained
#   .\scripts\build-release.ps1 -BuildInstaller
#   .\scripts\build-release.ps1 -BuildInstaller -Sign

param(
    [switch]$SelfContained,
    [switch]$BuildInstaller,
    [switch]$Sign,
    [switch]$BuildRustSidecars,
    [switch]$RequireRustSidecars,
    [switch]$BuildSpacedriveWeb,
    [switch]$SkipWebView2Download,
    [string]$Runtime = "win-x64",
    [string]$Configuration = "Release",
    [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Backend = Join-Path $Root "BNDZBackend"
$Dist = Join-Path $Root "dist"
$PublishDir = Join-Path $Dist "publish\$Runtime"
$InstallerDir = Join-Path $Root "installer"
$RedistDir = Join-Path $InstallerDir "redist"
$WebView2Bootstrapper = Join-Path $RedistDir "MicrosoftEdgeWebview2Setup.exe"
$WebView2Url = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

function Get-InnoSetupCompiler {
    @(
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
        "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
}

Write-Host "==> BNDZ Release Build ($Configuration / $Runtime v$Version)" -ForegroundColor Cyan

function Ensure-WebView2Bootstrapper {
    if ($SkipWebView2Download) {
        Write-Host "==> Skipping WebView2 bootstrapper download (-SkipWebView2Download)" -ForegroundColor DarkGray
        return
    }
    if (-not (Test-Path $RedistDir)) {
        New-Item -ItemType Directory -Path $RedistDir -Force | Out-Null
    }
    if (Test-Path $WebView2Bootstrapper) {
        $size = (Get-Item $WebView2Bootstrapper).Length
        if ($size -gt 1MB) {
            Write-Host "==> WebView2 bootstrapper present ($([math]::Round($size/1MB, 1)) MB)" -ForegroundColor DarkGray
            return
        }
    }
    Write-Host "==> Downloading WebView2 Evergreen Bootstrapper" -ForegroundColor Yellow
    Invoke-WebRequest -Uri $WebView2Url -OutFile $WebView2Bootstrapper -UseBasicParsing
    if (-not (Test-Path $WebView2Bootstrapper)) {
        throw "Failed to download WebView2 bootstrapper"
    }
    Write-Host "==> WebView2 bootstrapper saved to $WebView2Bootstrapper" -ForegroundColor Green
}

function Invoke-CodeSign {
    param([string[]]$Files)
    $signScript = Join-Path $Root "scripts\sign-release.ps1"
    if (-not (Test-Path $signScript)) { return }
    & $signScript -Files $Files
}

Push-Location $Root
try {
    if ($BuildInstaller -and -not $env:BNDZ_LICENSE_SECRET) {
        Write-Warning "BNDZ_LICENSE_SECRET is not set — retail builds should use a unique secret before generating customer serials."
    }
    if ($BuildInstaller -and $env:BNDZ_LICENSE_SECRET -eq "BNDZ-36-Commercial-Key-Seed-CHANGE-ME") {
        Write-Warning "BNDZ_LICENSE_SECRET is still the development placeholder. Rotate before shipping installers."
    }

    Write-Host "==> Copying legal documents" -ForegroundColor Yellow
    & (Join-Path $Root "scripts\copy-legal-docs.ps1") -Root $Root

    if ($BuildRustSidecars) {
        Write-Host "==> Building vendored Rust sidecars from source" -ForegroundColor Yellow
        & (Join-Path $Root "scripts\build-rust-sidecars.ps1") -Root $Root -Configuration $Configuration -BuildSpacedriveWeb:$BuildSpacedriveWeb
        if ($LASTEXITCODE -ne 0) { throw "Rust sidecar build failed" }
    } elseif ($RequireRustSidecars) {
        Write-Host "==> Verifying staged Rust sidecars" -ForegroundColor Yellow
        & (Join-Path $Root "scripts\stage-rust-sidecars.ps1") -Root $Root -Configuration $Configuration -RequireSpacedrive -RequireSpacebot
        if ($LASTEXITCODE -ne 0) { throw "Rust sidecar staging failed" }
    } else {
        Write-Host "==> Skipping Rust sidecars (use -RequireRustSidecars to package staged Spacedrive/Spacebot)" -ForegroundColor DarkGray
    }

    Write-Host "==> Building frontend (Vite -> BNDZBackend/Assets/ui)" -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }

    if (-not (Test-Path (Join-Path $Backend "Assets\ui\index.html"))) {
        throw "Missing Assets\ui\index.html - frontend build did not output to BNDZBackend/Assets/ui"
    }

    Write-Host "==> Publishing .NET app" -ForegroundColor Yellow
    $publishArgs = @(
        "publish", (Join-Path $Backend "BNDZ.csproj"),
        "-c", $Configuration,
        "-r", $Runtime,
        "-o", $PublishDir,
        "/p:DebugType=embedded"
    )
    if ($SelfContained) {
        $publishArgs += @("--self-contained", "true", "/p:PublishSingleFile=false")
    } else {
        $publishArgs += @("--self-contained", "false")
    }

    dotnet @publishArgs
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed" }

    $ExePath = Join-Path $PublishDir "BNDZ.exe"
    if (-not (Test-Path $ExePath)) {
        throw "BNDZ.exe not found in publish output"
    }
    if (-not (Test-Path (Join-Path $PublishDir "Assets\ui\index.html"))) {
        throw "Assets\ui not copied to publish output"
    }

    if ($Sign -or $env:BNDZ_SIGN_CERT_THUMBPRINT -or $env:BNDZ_SIGN_PFX_PATH) {
        Write-Host "==> Code signing BNDZ.exe" -ForegroundColor Yellow
        Invoke-CodeSign -Files @($ExePath)
    }

    $ZipPath = Join-Path $Dist "BNDZ-$Runtime-portable.zip"
    if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
    Write-Host "==> Creating portable ZIP: $ZipPath" -ForegroundColor Yellow
    Compress-Archive -Path (Join-Path $PublishDir "*") -DestinationPath $ZipPath -Force

    Write-Host "==> Publish complete: $PublishDir" -ForegroundColor Green
    Write-Host "==> Portable ZIP: $ZipPath" -ForegroundColor Green

    $builtInstaller = $false
    if ($BuildInstaller) {
        Ensure-WebView2Bootstrapper

        $Iscc = Get-InnoSetupCompiler

        if (-not $Iscc) {
            Write-Warning "Inno Setup 6 not found. Install from https://jrsoftware.org/isinfo.php"
            Write-Warning "Skipping installer build. Publish folder and ZIP are ready."
        } else {
            if (-not (Test-Path $WebView2Bootstrapper)) {
                Write-Warning "WebView2 bootstrapper missing. Run without -SkipWebView2Download or place file at:"
                Write-Warning "  $WebView2Bootstrapper"
            }
            Write-Host "==> Building installer with Inno Setup" -ForegroundColor Yellow
            & $Iscc (Join-Path $InstallerDir "BNDZ.iss") "/DPublishDir=$PublishDir" "/DMyAppVersion=$Version" "/DSourcePath=$Root"
            if ($LASTEXITCODE -ne 0) { throw "Inno Setup build failed" }
            $SetupPath = Join-Path $Dist "BNDZ-Setup-$Version.exe"
            Write-Host "==> Installer: $SetupPath" -ForegroundColor Green

            if ($Sign -or $env:BNDZ_SIGN_CERT_THUMBPRINT -or $env:BNDZ_SIGN_PFX_PATH) {
                Write-Host "==> Code signing installer" -ForegroundColor Yellow
                Invoke-CodeSign -Files @($SetupPath)
            }
            $builtInstaller = $true
        }
    } else {
        Write-Host "Tip: run with -BuildInstaller after installing Inno Setup 6" -ForegroundColor DarkGray
        Write-Host "Tip: set BNDZ_SIGN_CERT_THUMBPRINT or BNDZ_SIGN_PFX_PATH and use -Sign" -ForegroundColor DarkGray
    }

    $VerifyScript = Join-Path $Root "scripts\verify-release.ps1"
    if (Test-Path $VerifyScript) {
        Write-Host "==> Verifying release artifacts" -ForegroundColor Yellow
        $requireInstaller = if ($BuildInstaller) { [bool]$builtInstaller } else { $false }
        $requireSigned = [bool]($Sign -or $env:BNDZ_SIGN_CERT_THUMBPRINT -or $env:BNDZ_SIGN_PFX_PATH)
        & $VerifyScript -Runtime $Runtime -Version $Version -RequireInstaller:$requireInstaller -RequireSigned:$requireSigned
        if ($LASTEXITCODE -ne 0) { throw "Release verification failed" }
    }
}
finally {
    Pop-Location
}
