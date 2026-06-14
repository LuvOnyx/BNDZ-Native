# Sets the Windows executable icon resource (taskbar / Alt+Tab) on a built .exe.
param(
    [Parameter(Mandatory = $true)]
    [string]$ExePath,
    [Parameter(Mandatory = $true)]
    [string]$IconPath
)

$ErrorActionPreference = "Stop"
$ExePath = (Resolve-Path $ExePath).Path
$IconPath = (Resolve-Path $IconPath).Path
if (-not (Test-Path $ExePath)) { throw "EXE not found: $ExePath" }
if (-not (Test-Path $IconPath)) { throw "ICO not found: $IconPath" }

$rceditModule = Join-Path $env:APPDATA "npm\node_modules\rcedit"
if (-not (Test-Path (Join-Path $rceditModule "lib\rcedit.js"))) {
    Write-Host "==> Installing rcedit..." -ForegroundColor Yellow
    npm install -g rcedit@4.0.1 2>&1 | Out-Null
}

if (Test-Path (Join-Path $rceditModule "lib\rcedit.js")) {
    $js = @"
const rcedit = require('$($rceditModule.Replace('\','\\'))');
rcedit('$($ExePath.Replace('\','\\'))', { icon: '$($IconPath.Replace('\','\\'))' })
  .then(() => process.exit(0))
  .catch((err) => { console.error(err.message || err); process.exit(1); });
"@
    $tempJs = [IO.Path]::GetTempFileName() + ".js"
    Set-Content -Path $tempJs -Value $js -Encoding UTF8
    try {
        & node $tempJs
        if ($LASTEXITCODE -eq 0) {
            Write-Host "==> Set EXE icon: $ExePath" -ForegroundColor Green
            exit 0
        }
    }
    finally {
        Remove-Item $tempJs -Force -ErrorAction SilentlyContinue
    }
}

Write-Warning "Could not patch EXE icon. Rebuild with scripts/build-bndz-launcher.ps1 for embedded icon."
exit 1
