# Full pre-test build - BNDZ File Manager + Launcher shell + Flow plugin
param(
    [string]$Root = "",
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

Write-Host "==> Stopping launcher processes" -ForegroundColor Yellow
& (Join-Path $Root "scripts\stop-launcher-for-build.ps1")

Write-Host "==> Copying toolbar icons" -ForegroundColor Yellow
& (Join-Path $Root "scripts\copy-launcher-toolbar-icons.ps1")

Write-Host "==> Building file manager UI" -ForegroundColor Cyan
Push-Location $Root
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed" }
}
finally { Pop-Location }

Write-Host "==> Building launcher WebView2 shell" -ForegroundColor Cyan
Push-Location $Root
try {
    npm run build:launcher
    if ($LASTEXITCODE -ne 0) { throw "npm run build:launcher failed" }
}
finally { Pop-Location }

Write-Host "==> Building BNDZ Launcher (Flow + plugin)" -ForegroundColor Cyan
& (Join-Path $Root "scripts\build-bndz-launcher.ps1") -Configuration $Configuration -Root $Root

Write-Host "==> Building BNDZ backend" -ForegroundColor Cyan
Push-Location (Join-Path $Root "BNDZBackend")
try {
    dotnet build -c $Configuration
    if ($LASTEXITCODE -ne 0) { throw "dotnet build failed" }
}
finally { Pop-Location }

Write-Host ""
Write-Host "==> BUILD COMPLETE - ready to test" -ForegroundColor Green
Write-Host "   cd BNDZBackend" -ForegroundColor DarkGray
Write-Host "   dotnet run -c $Configuration" -ForegroundColor DarkGray
Write-Host ""
Write-Host "   Alt+Space or tray - Open Launcher" -ForegroundColor DarkGray
Write-Host "   Set GEMINI_API_KEY for AI chat" -ForegroundColor DarkGray
