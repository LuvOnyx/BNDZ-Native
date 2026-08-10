@echo off
setlocal EnableExtensions
REM BNDZ-Native — unpackaged WinUI shell (self-contained Windows App SDK).
cd /d "%~dp0.."

REM Avoid WebView2 profile lock / zombie second instances (blank dark window).
taskkill /F /IM BNDZShell.exe >nul 2>&1
timeout /t 1 /nobreak >nul

set "EXE="
for /f "delims=" %%F in ('dir /b /s /a:-d "BNDZShell\src\BNDZShell.App\bin\x64\Debug\BNDZShell.exe" 2^>nul') do (
  set "EXE=%%F"
  goto :launch
)
for /f "delims=" %%F in ('dir /b /s /a:-d "BNDZShell\src\BNDZShell.App\bin\x64\Release\BNDZShell.exe" 2^>nul') do (
  set "EXE=%%F"
  goto :launch
)

echo BNDZShell.exe not found.
echo Run: powershell -File scripts\build-bndz-native.ps1
exit /b 1

:launch
for %%I in ("%EXE%") do set "EXEDIR=%%~dpI"
echo Starting BNDZ-Native:
echo   %EXE%
start "" /D "%EXEDIR%" "%EXE%" %*
endlocal
