# Deploy BNDZ license API to Cloudflare (Workers + D1).
# Requires: wrangler login OR CLOUDFLARE_API_TOKEN in the environment.
#
# Usage:
#   .\scripts\deploy-license-api.ps1
#   .\scripts\deploy-license-api.ps1 -LicenseSecret "..." -TokenSecret "..." -AdminKey "..."

param(
    [string]$LicenseSecret = $env:BNDZ_LICENSE_SECRET,
    [string]$TokenSecret = $env:BNDZ_TOKEN_HMAC_SECRET,
    [string]$AdminKey = $env:BNDZ_LICENSE_ADMIN_KEY
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ApiDir = Join-Path $Root "services\bndz-license-api"
$SecretsFile = Join-Path $ApiDir ".deploy-secrets.local.json"
$Wrangler = Join-Path $ApiDir "wrangler.jsonc"

function New-RandomSecret([int]$Bytes = 48) {
    $buf = New-Object byte[] $Bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $rng.GetBytes($buf)
    $rng.Dispose()
    return [Convert]::ToBase64String($buf)
}

Push-Location $ApiDir
try {
    if (-not (Test-Path "node_modules\wrangler")) {
        npm install --legacy-peer-deps
    }

    Write-Host "==> Checking Cloudflare auth" -ForegroundColor Cyan
    npx wrangler whoami
    if ($LASTEXITCODE -ne 0) {
        throw "Not logged in to Cloudflare. Run: npx wrangler login   (or set CLOUDFLARE_API_TOKEN)"
    }

    if (-not $LicenseSecret -or $LicenseSecret -eq "BNDZ-36-Commercial-Key-Seed-CHANGE-ME") {
        $LicenseSecret = New-RandomSecret 32
        Write-Host "==> Generated BNDZ_LICENSE_SECRET" -ForegroundColor Yellow
    }
    if (-not $TokenSecret) {
        $TokenSecret = New-RandomSecret 48
        Write-Host "==> Generated BNDZ_TOKEN_HMAC_SECRET" -ForegroundColor Yellow
    }
    if (-not $AdminKey) {
        $AdminKey = New-RandomSecret 32
        Write-Host "==> Generated BNDZ_LICENSE_ADMIN_KEY" -ForegroundColor Yellow
    }

    @{
        generatedAtUtc = [DateTime]::UtcNow.ToString("o")
        BNDZ_LICENSE_SECRET = $LicenseSecret
        BNDZ_TOKEN_HMAC_SECRET = $TokenSecret
        BNDZ_LICENSE_ADMIN_KEY = $AdminKey
        notes = "Store safely. Match Worker secrets LICENSE_HMAC_SECRET / TOKEN_HMAC_SECRET / ADMIN_API_KEY."
    } | ConvertTo-Json | Set-Content -Path $SecretsFile -Encoding UTF8
    Write-Host "==> Wrote secrets to $SecretsFile (gitignored)" -ForegroundColor Green

    $cfg = Get-Content $Wrangler -Raw
    if ($cfg -match 'REPLACE_AFTER_D1_CREATE') {
        Write-Host "==> Creating D1 database bndz-licenses" -ForegroundColor Cyan
        $createOut = npx wrangler d1 create bndz-licenses 2>&1 | Out-String
        Write-Host $createOut
        if ($createOut -match 'database_id\s*=\s*"([^"]+)"' -or $createOut -match '"database_id"\s*:\s*"([^"]+)"') {
            $dbId = $Matches[1]
        } elseif ($createOut -match '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})') {
            $dbId = $Matches[1]
        } else {
            throw "Could not parse D1 database_id from wrangler output. Paste it into wrangler.jsonc manually."
        }
        $cfg = $cfg -replace 'REPLACE_AFTER_D1_CREATE', $dbId
        Set-Content -Path $Wrangler -Value $cfg -Encoding UTF8
        Write-Host "==> Updated wrangler.jsonc database_id=$dbId" -ForegroundColor Green
    } else {
        Write-Host "==> D1 database_id already set" -ForegroundColor DarkGray
    }

    Write-Host "==> Applying remote migrations" -ForegroundColor Cyan
    npx wrangler d1 migrations apply bndz-licenses --remote
    if ($LASTEXITCODE -ne 0) { throw "D1 migrate failed" }

    Write-Host "==> Setting Worker secrets" -ForegroundColor Cyan
    $LicenseSecret | npx wrangler secret put LICENSE_HMAC_SECRET
    if ($LASTEXITCODE -ne 0) { throw "secret LICENSE_HMAC_SECRET failed" }
    $TokenSecret | npx wrangler secret put TOKEN_HMAC_SECRET
    if ($LASTEXITCODE -ne 0) { throw "secret TOKEN_HMAC_SECRET failed" }
    $AdminKey | npx wrangler secret put ADMIN_API_KEY
    if ($LASTEXITCODE -ne 0) { throw "secret ADMIN_API_KEY failed" }

    Write-Host "==> Deploying Worker" -ForegroundColor Cyan
    $deployOut = npx wrangler deploy 2>&1 | Out-String
    Write-Host $deployOut
    if ($LASTEXITCODE -ne 0) { throw "wrangler deploy failed" }

    $url = $null
    if ($deployOut -match 'https://[a-z0-9.-]+\.workers\.dev') {
        $url = $Matches[0].TrimEnd('/')
    }

    if ($url) {
        $secrets = Get-Content $SecretsFile -Raw | ConvertFrom-Json
        $secrets | Add-Member -NotePropertyName LICENSE_API_URL -NotePropertyValue $url -Force
        $secrets | ConvertTo-Json | Set-Content -Path $SecretsFile -Encoding UTF8

        $licCs = Join-Path $Root "BNDZBackend\Services\LicenseService.cs"
        $src = Get-Content $licCs -Raw
        if ($src -match 'public const string DefaultLicenseApiBase = "[^"]+";') {
            $src = $src -replace 'public const string DefaultLicenseApiBase = "[^"]+";',
                "public const string DefaultLicenseApiBase = `"$url`";"
            Set-Content -Path $licCs -Value $src -Encoding UTF8
            Write-Host "==> Updated LicenseService.DefaultLicenseApiBase → $url" -ForegroundColor Green
        }
    }

    Write-Host ""
    Write-Host "Done. Next:" -ForegroundColor Cyan
    Write-Host "  `$env:BNDZ_LICENSE_SECRET = (from $SecretsFile)"
    Write-Host "  `$env:BNDZ_TOKEN_HMAC_SECRET = (from $SecretsFile)"
    Write-Host "  `$env:LICENSE_API_URL = $url"
    Write-Host "  `$env:ADMIN_API_KEY = (from $SecretsFile)"
    Write-Host "  cd services\bndz-license-api; npm run issue -- you@example.com `"Name`""
}
finally {
    Pop-Location
}
