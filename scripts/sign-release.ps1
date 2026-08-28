# Authenticode signing for BNDZ release artifacts.
#
# BNDZ does NOT get a Windows Authenticode certificate from Cursor Origin.
# Origin "signing keys" are Ed25519 API keys for Origin repos/webhooks — not SmartScreen trust.
#
# Choose ONE auth method:
#
# A) Certificate in Windows store or PFX (traditional OV/EV):
#    BNDZ_SIGN_CERT_THUMBPRINT  - cert thumbprint in CurrentUser\My
#    BNDZ_SIGN_PFX_PATH         - path to .pfx
#    BNDZ_SIGN_PFX_PASSWORD     - optional PFX password
#
# B) Azure Trusted Signing (cloud HSM, ~$10/mo — recommended for indie retail):
#    BNDZ_AZURE_SIGNING_ENDPOINT  - e.g. https://eus.codesigning.azure.net/
#    BNDZ_AZURE_SIGNING_ACCOUNT    - Artifact Signing account name
#    BNDZ_AZURE_SIGNING_PROFILE    - Certificate profile name
#    Authenticate: `az login` locally, or AZURE_TENANT_ID + AZURE_CLIENT_ID + AZURE_CLIENT_SECRET in CI
#    Requires: dotnet SDK + `dotnet tool install -g --prerelease sign`
#
# Usage:
#   .\scripts\sign-release.ps1 -Files @("dist\publish\win-x64\BNDZ.exe")
#   .\scripts\check-signing-prereqs.ps1

param(
    [Parameter(Mandatory = $true)]
    [string[]]$Files,
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [switch]$Strict
)

$ErrorActionPreference = "Stop"

function Get-SigningMode {
    if ($env:BNDZ_AZURE_SIGNING_ENDPOINT -and $env:BNDZ_AZURE_SIGNING_ACCOUNT -and $env:BNDZ_AZURE_SIGNING_PROFILE) {
        return "azure"
    }
    if ($env:BNDZ_SIGN_CERT_THUMBPRINT -or $env:BNDZ_SIGN_PFX_PATH) {
        return "traditional"
    }
    return "none"
}

function Find-SignTool {
    $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (-not (Test-Path $kits)) { return $null }
    Get-ChildItem $kits -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending |
        ForEach-Object {
            $candidate = Join-Path $_.FullName "x64\signtool.exe"
            if (Test-Path $candidate) { return $candidate }
        } | Select-Object -First 1
}

function Invoke-TraditionalSign {
    param([string[]]$TargetFiles)

    $SignTool = Find-SignTool
    if (-not $SignTool) {
        throw "signtool.exe not found. Install the Windows 10/11 SDK."
    }

    $thumb = $env:BNDZ_SIGN_CERT_THUMBPRINT
    $pfx = $env:BNDZ_SIGN_PFX_PATH
    $pfxPass = $env:BNDZ_SIGN_PFX_PASSWORD

    $signArgs = @("sign", "/fd", "sha256", "/tr", $TimestampUrl, "/td", "sha256", "/v")

    if ($pfx) {
        if (-not (Test-Path $pfx)) { throw "PFX not found: $pfx" }
        $signArgs += @("/f", $pfx)
        if ($pfxPass) { $signArgs += @("/p", $pfxPass) }
    } else {
        $signArgs += @("/sha1", $thumb)
    }

    foreach ($file in $TargetFiles) {
        if (-not (Test-Path $file)) {
            Write-Warning "Skip missing file: $file"
            continue
        }
        Write-Host "==> Signing (signtool) $file" -ForegroundColor Cyan
        & $SignTool @signArgs $file
        if ($LASTEXITCODE -ne 0) { throw "signtool failed for $file" }
        $sig = Get-AuthenticodeSignature $file
        if ($sig.Status -ne "Valid") {
            throw "Signature not valid after signing $file (status: $($sig.Status))"
        }
        Write-Host "    OK — $($sig.SignerCertificate.Subject)" -ForegroundColor Green
    }
}

function Invoke-AzureArtifactSign {
    param([string[]]$TargetFiles)

    $endpoint = $env:BNDZ_AZURE_SIGNING_ENDPOINT.TrimEnd('/')
    $account = $env:BNDZ_AZURE_SIGNING_ACCOUNT
    $profile = $env:BNDZ_AZURE_SIGNING_PROFILE

    if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
        throw "dotnet SDK required for Azure Trusted Signing. Install .NET 8 SDK."
    }

    $signTool = & dotnet tool list -g 2>$null | Select-String -Pattern "^\s*sign\s"
    if (-not $signTool) {
        Write-Host "==> Installing dotnet sign tool (global, prerelease)" -ForegroundColor Yellow
        & dotnet tool install -g --prerelease sign
        if ($LASTEXITCODE -ne 0) { throw "Failed to install dotnet sign tool" }
    }

    $credType = $env:BNDZ_AZURE_CREDENTIAL_TYPE
    $credArgs = @()
    if ($credType) {
        $credArgs += @("--azure-credential-type", $credType)
    }

    foreach ($file in $TargetFiles) {
        if (-not (Test-Path $file)) {
            Write-Warning "Skip missing file: $file"
            continue
        }
        Write-Host "==> Signing (Azure Trusted Signing) $file" -ForegroundColor Cyan
        & dotnet sign code artifact-signing `
            --timestamp-url "http://timestamp.acs.microsoft.com" `
            --artifact-signing-endpoint $endpoint `
            --artifact-signing-account $account `
            --artifact-signing-certificate-profile $profile `
            @credArgs `
            $file
        if ($LASTEXITCODE -ne 0) { throw "dotnet sign failed for $file" }
        $sig = Get-AuthenticodeSignature $file
        if ($sig.Status -ne "Valid") {
            throw "Signature not valid after Azure signing $file (status: $($sig.Status))"
        }
        Write-Host "    OK — $($sig.SignerCertificate.Subject)" -ForegroundColor Green
    }
}

$mode = Get-SigningMode
if ($mode -eq "none") {
    $msg = @(
        "No signing credentials configured.",
        "Origin does NOT provide Windows Authenticode certificates.",
        "Set BNDZ_SIGN_CERT_THUMBPRINT or BNDZ_SIGN_PFX_PATH (traditional),",
        "or BNDZ_AZURE_SIGNING_ENDPOINT + ACCOUNT + PROFILE (Azure Trusted Signing).",
        "See docs/LAUNCH.md section 3."
    ) -join " "
    if ($Strict) { throw $msg }
    Write-Warning $msg
    return
}

if ($mode -eq "azure") {
    Invoke-AzureArtifactSign -TargetFiles $Files
} else {
    Invoke-TraditionalSign -TargetFiles $Files
}
