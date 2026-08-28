# Reports which BNDZ Authenticode signing path is configured and whether tools are present.
# Does not sign anything. Run on a Windows release machine before npm run package:signed.

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

Write-Host "==> BNDZ code signing prerequisites" -ForegroundColor Cyan
Write-Host ""
Write-Host "Note: Cursor Origin hosts Git repos and uses Ed25519 API signing keys." -ForegroundColor DarkGray
Write-Host "      Origin does NOT issue Windows Authenticode / SmartScreen certificates." -ForegroundColor DarkGray
Write-Host ""

$hasAzure = $env:BNDZ_AZURE_SIGNING_ENDPOINT -and $env:BNDZ_AZURE_SIGNING_ACCOUNT -and $env:BNDZ_AZURE_SIGNING_PROFILE
$hasThumb = [bool]$env:BNDZ_SIGN_CERT_THUMBPRINT
$hasPfx = [bool]$env:BNDZ_SIGN_PFX_PATH

if ($hasAzure) {
    Write-Host "Mode: Azure Trusted Signing" -ForegroundColor Green
    Write-Host "  Endpoint : $($env:BNDZ_AZURE_SIGNING_ENDPOINT)"
    Write-Host "  Account  : $($env:BNDZ_AZURE_SIGNING_ACCOUNT)"
    Write-Host "  Profile  : $($env:BNDZ_AZURE_SIGNING_PROFILE)"
    if ($env:BNDZ_AZURE_CREDENTIAL_TYPE) {
        Write-Host "  Cred type: $($env:BNDZ_AZURE_CREDENTIAL_TYPE)"
    }
    if (Get-Command dotnet -ErrorAction SilentlyContinue) {
        Write-Host "  dotnet   : OK" -ForegroundColor Green
        $signListed = & dotnet tool list -g 2>$null | Select-String -Pattern "^\s*sign\s"
        if ($signListed) {
            Write-Host "  dotnet sign tool: installed" -ForegroundColor Green
        } else {
            Write-Host "  dotnet sign tool: NOT installed — run: dotnet tool install -g --prerelease sign" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  dotnet   : MISSING — install .NET 8 SDK" -ForegroundColor Red
        exit 1
    }
    if (Get-Command az -ErrorAction SilentlyContinue) {
        Write-Host "  Azure CLI: OK (use az login for local signing)" -ForegroundColor Green
    } else {
        Write-Host "  Azure CLI: not on PATH — use service principal env vars in CI" -ForegroundColor Yellow
    }
} elseif ($hasThumb -or $hasPfx) {
    Write-Host "Mode: Traditional Authenticode (signtool)" -ForegroundColor Green
    if ($hasThumb) { Write-Host "  Thumbprint: $($env:BNDZ_SIGN_CERT_THUMBPRINT)" }
    if ($hasPfx) {
        $pfxPath = $env:BNDZ_SIGN_PFX_PATH
        if (Test-Path $pfxPath) {
            Write-Host "  PFX: $pfxPath (found)" -ForegroundColor Green
        } else {
            Write-Host "  PFX: $pfxPath (MISSING)" -ForegroundColor Red
            exit 1
        }
    }
    $kits = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    $found = $false
    if (Test-Path $kits) {
        Get-ChildItem $kits -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending |
            ForEach-Object {
                $candidate = Join-Path $_.FullName "x64\signtool.exe"
                if (Test-Path $candidate) {
                    Write-Host "  signtool : $candidate" -ForegroundColor Green
                    $found = $true
                    return
                }
            }
    }
    if (-not $found) {
        Write-Host "  signtool : MISSING — install Windows SDK" -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "Mode: NONE — release builds will be unsigned (SmartScreen warnings)." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "For retail distribution you still need Authenticode signing. Options:" -ForegroundColor Yellow
    Write-Host "  1. Azure Trusted Signing (~`$10/mo) — set BNDZ_AZURE_SIGNING_* env vars" -ForegroundColor DarkGray
    Write-Host "  2. OV/EV certificate from DigiCert/Sectigo — set BNDZ_SIGN_PFX_PATH or thumbprint" -ForegroundColor DarkGray
    Write-Host "  3. Microsoft Store MSIX path — Store re-signs for free (different packaging)" -ForegroundColor DarkGray
    Write-Host ""
    Write-Host "See docs/LAUNCH.md section 3 for setup steps." -ForegroundColor DarkGray
    exit 2
}

Write-Host ""
Write-Host "Ready for: npm run package:signed" -ForegroundColor Green
