# Verify BNDZ frontend build is staged for WebView2
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
if (-not (Test-Path "$root\BNDZBackend\Assets\ui\index.html")) {
    $root = Get-Location
}

Write-Host "==> Branch: $(git -C $root branch --show-current 2>$null)"
$html = "$root\BNDZBackend\Assets\ui\index.html"
if (-not (Test-Path $html)) {
    Write-Error "Missing $html — run npm run build first"
}
$bundle = Select-String -Path $html -Pattern 'index-[^"]+\.js' | ForEach-Object { $_.Matches[0].Value }
Write-Host "==> index.html bundle: $bundle"
Write-Host "==> index.html modified: $((Get-Item $html).LastWriteTime)"
$assetPath = Join-Path (Split-Path $html) "assets\$bundle"
if (Test-Path $assetPath) {
    Write-Host "==> Bundle modified: $((Get-Item $assetPath).LastWriteTime)"
} else {
    Write-Warning "Bundle file not found: $assetPath"
}
Write-Host "==> Restart dotnet run after build so WebView2 loads the new bundle."
