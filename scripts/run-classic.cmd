@echo off
setlocal
REM Classic BNDZ — full WebView2 product (default).
cd /d "%~dp0.."
set EXE=BNDZBackend\bin\Debug\net8.0-windows10.0.19041.0\BNDZ.exe
if not exist "%EXE%" set EXE=BNDZBackend\bin\Release\net8.0-windows10.0.19041.0\BNDZ.exe
if not exist "%EXE%" (
  echo BNDZ.exe not found. Run scripts\build-compare-versions.ps1 first.
  exit /b 1
)
start "" "%EXE%" --skip-elevation %*
endlocal
