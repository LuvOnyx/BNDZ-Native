@echo off
setlocal EnableExtensions
cd /d "%~dp0.."

REM ARCHIVED: FilesMerge hybrid — use scripts\run-bndz-native.cmd for BNDZ-Native product.
echo [archived] FilesMerge is reference-only. Primary launcher: scripts\run-bndz-native.cmd
echo.
REM MUST be launched as a registered MSIX layout — raw Files.exe crashes instantly
REM (DeploymentManager REGDB_E_CLASSNOTREG / blank flash then exit).

set "LAYOUT="
for %%P in (
  "FilesMerge\src\Files.App\bin\x64\Debug\net10.0-windows10.0.26100.0"
  "FilesMerge\src\Files.App\bin\x64\Debug\net10.0-windows10.0.26100.0\win-x64"
  "FilesMerge\src\Files.App\bin\Debug\net10.0-windows10.0.26100.0\win-x64"
) do if exist "%%~P\Files.exe" if exist "%%~P\AppxManifest.xml" set "LAYOUT=%%~P"

if "%LAYOUT%"=="" (
  echo BNDZ-Native shell layout not found. Run:
  echo   powershell -File scripts\build-files-bndz-merge.ps1
  exit /b 1
)

echo Registering / updating FilesDev package from:
echo   %LAYOUT%
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0register-files-merge.ps1" -Layout "%LAYOUT%"
if errorlevel 1 (
  echo Package register/launch failed.
  exit /b 1
)

endlocal
