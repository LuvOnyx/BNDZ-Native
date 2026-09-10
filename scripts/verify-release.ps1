# Verifies BNDZ publish output and optional installer artifacts.
# Usage:
#   .\scripts\verify-release.ps1
#   .\scripts\verify-release.ps1 -Runtime win-x64 -Version 3.6.2 -RequireInstaller

param(
    [string]$Runtime = "win-x64",
    [string]$Version = "1.0.0",
    [switch]$RequireInstaller,
    [switch]$RequireSigned
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$PublishDir = Join-Path $Root "dist\publish\$Runtime"
$SetupExe = Join-Path $Root "dist\BNDZ-Setup-$Version.exe"
$PortableZip = Join-Path $Root "dist\BNDZ-$Runtime-portable.zip"
$WebView2Bootstrapper = Join-Path $Root "installer\redist\MicrosoftEdgeWebview2Setup.exe"

$failures = @()

function Test-Artifact {
    param([string]$Path, [string]$Label)
    if (-not (Test-Path $Path)) {
        $script:failures += "Missing $Label : $Path"
        return $false
    }
    Write-Host "  OK  $Label" -ForegroundColor Green
    return $true
}

Write-Host "==> Verifying BNDZ release ($Version / $Runtime)" -ForegroundColor Cyan

Write-Host "`nPublish folder:" -ForegroundColor Yellow
Test-Artifact (Join-Path $PublishDir "BNDZ.exe") "BNDZ.exe" | Out-Null
Test-Artifact (Join-Path $PublishDir "Assets\ui\index.html") "UI bundle" | Out-Null
Test-Artifact (Join-Path $PublishDir "Assets\BNDZ.ico") "App icon" | Out-Null
foreach ($legal in @("EULA.md", "PRIVACY.md", "THIRD_PARTY_LICENSES.md")) {
    Test-Artifact (Join-Path $PublishDir "Assets\legal\$legal") "Legal: $legal" | Out-Null
}

$coreClr = Join-Path $PublishDir "coreclr.dll"
if (Test-Path $coreClr) {
    Write-Host "  OK  Self-contained .NET runtime (coreclr.dll)" -ForegroundColor Green
} else {
    $failures += "Missing coreclr.dll - publish was not self-contained. Use npm run package:installer (includes -SelfContained)."
}

$diAbs = Join-Path $PublishDir "Microsoft.Extensions.DependencyInjection.Abstractions.dll"
if (Test-Path $diAbs) {
    $ver = [System.Reflection.AssemblyName]::GetAssemblyName($diAbs).Version
    if ($ver.Major -ge 10) {
        Write-Host "  OK  DI.Abstractions assemblyVersion=$ver" -ForegroundColor Green
    } else {
        $failures += "Published DI.Abstractions is $ver (need >= 10.0.0.0). Self-contained publish overwrote NuGet packages — check RestorePublishedExtensionsAssemblies target."
    }
} else {
    $failures += "Missing Microsoft.Extensions.DependencyInjection.Abstractions.dll in publish output"
}

$wvWpf = Join-Path $PublishDir "Microsoft.Web.WebView2.Wpf.dll"
if (Test-Path $wvWpf) {
    $wvVer = [System.Reflection.AssemblyName]::GetAssemblyName($wvWpf).Version
    # PackageReference is Microsoft.Web.WebView2 1.0.4078.44 — stale publish dirs used to ship 1.0.2903.40.
    if ($wvVer.Build -ge 4078) {
        Write-Host "  OK  WebView2.Wpf assemblyVersion=$wvVer" -ForegroundColor Green
    } else {
        $failures += "Published WebView2.Wpf is $wvVer (need >= 1.0.4078.44). Dirty publish folder left stale DLLs — build-release.ps1 must wipe PublishDir first."
    }
} else {
    $failures += "Missing Microsoft.Web.WebView2.Wpf.dll in publish output"
}

$exe = Join-Path $PublishDir "BNDZ.exe"
if (Test-Path $exe) {
    $vi = (Get-Item $exe).VersionInfo
    Write-Host "  ver FileVersion=$($vi.FileVersion) ProductVersion=$($vi.ProductVersion)" -ForegroundColor DarkGray
    if ($RequireSigned) {
        $sig = Get-AuthenticodeSignature $exe
        if ($sig.Status -eq 'Valid') {
            Write-Host "  OK  BNDZ.exe Authenticode signature valid" -ForegroundColor Green
        } else {
            $failures += "BNDZ.exe is not Authenticode-signed (status: $($sig.Status))"
        }
    }
}

Write-Host "`nPortable package:" -ForegroundColor Yellow
Test-Artifact $PortableZip "Portable ZIP" | Out-Null

Write-Host "`nInstaller prerequisites:" -ForegroundColor Yellow
if (Test-Path $WebView2Bootstrapper) {
    $wvBytes = (Get-Item $WebView2Bootstrapper).Length
    $mb = [math]::Round($wvBytes / 1MB, 1)
    if ($wvBytes -lt 1MB) {
        $failures += "WebView2 bootstrapper is only $wvBytes bytes (corrupt): $WebView2Bootstrapper"
    } else {
        Write-Host "  OK  WebView2 bootstrapper ($mb MB)" -ForegroundColor Green
    }
} elseif ($RequireInstaller) {
    $failures += "Missing WebView2 bootstrapper: $WebView2Bootstrapper (run npm run package:installer to download)"
} else {
    Write-Host "  --  WebView2 bootstrapper not cached (downloaded during package:installer)" -ForegroundColor DarkGray
}

# Optional ONNX Runtime native — warn (not hard-fail) so portable builds without Semantic Desk stay shippable.
$ortCandidates = @(
    (Join-Path $PublishDir "onnxruntime.dll"),
    (Join-Path $PublishDir "runtimes\win-x64\native\onnxruntime.dll")
) | Where-Object { Test-Path $_ }
if ($ortCandidates.Count -gt 0) {
    Write-Host "  OK  ONNX Runtime present ($($ortCandidates[0]))" -ForegroundColor Green
} else {
    Write-Host "  --  onnxruntime.dll not in publish (Semantic Desk ONNX optional)" -ForegroundColor DarkGray
}

$iscc = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe",
    "${env:LOCALAPPDATA}\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($iscc) {
    Write-Host "  OK  Inno Setup 6: $iscc" -ForegroundColor Green
} else {
    Write-Host "  !!  Inno Setup 6 not installed" -ForegroundColor Yellow
    if ($RequireInstaller) { $failures += "Inno Setup 6 required but not found" }
}

Write-Host "`nInstaller output:" -ForegroundColor Yellow
if (Test-Path $SetupExe) {
    $mb = [math]::Round((Get-Item $SetupExe).Length / 1MB, 1)
    Write-Host "  OK  BNDZ-Setup-$Version.exe ($mb MB)" -ForegroundColor Green
    if ($RequireSigned) {
        $sig = Get-AuthenticodeSignature $SetupExe
        if ($sig.Status -eq 'Valid') {
            Write-Host "  OK  Installer Authenticode signature valid" -ForegroundColor Green
        } else {
            $failures += "Installer is not Authenticode-signed (status: $($sig.Status))"
        }
    }
} else {
    if ($RequireInstaller) {
        $failures += "Missing installer: $SetupExe"
    } else {
        Write-Host "  --  Installer not built (run npm run package:installer)" -ForegroundColor DarkGray
    }
}

if ($failures.Count) {
    Write-Host "`nVerification FAILED:" -ForegroundColor Red
    $failures | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}

Write-Host "`nVerification passed." -ForegroundColor Green

