@echo off
setlocal
REM Native Shell BNDZ — same full product UI + Files-like host chrome.
REM Separate single-instance mutex: can run beside classic for A/B.
cd /d "%~dp0.."
set EXE=BNDZBackend\bin\Debug\net8.0-windows10.0.19041.0\BNDZ.exe
if not exist "%EXE%" set EXE=BNDZBackend\bin\Release\net8.0-windows10.0.19041.0\BNDZ.exe
if not exist "%EXE%" (
  echo BNDZ.exe not found. Run scripts\build-compare-versions.ps1 first.
  exit /b 1
)
start "" "%EXE%" --native-shell --skip-elevation %*
endlocal
