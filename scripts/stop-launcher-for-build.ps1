# Stops BNDZ Launcher / Flow Launcher so dotnet build can copy plugin DLLs.
$names = @("BNDZ.Launcher", "Flow.Launcher")
foreach ($name in $names) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}
Start-Sleep -Milliseconds 500
Write-Host "==> Launcher processes stopped (safe to dotnet build)" -ForegroundColor Green
