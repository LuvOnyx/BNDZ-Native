@echo off
setlocal EnableExtensions
REM BNDZ-Native — unpackaged WinUI shell (self-contained Windows App SDK).
cd /d "%~dp0.."
set BNDZ_DRAGSTARTING=1

REM Hard-kill shell + backend so DLL/UI assets are not locked (zombie WinUI PIDs).
taskkill /F /T /IM BNDZShell.exe >nul 2>&1
taskkill /F /T /IM BNDZ.exe >nul 2>&1
wmic process where "name='BNDZShell.exe'" call terminate >nul 2>&1
wmic process where "name='BNDZ.exe'" call terminate >nul 2>&1
REM timeout fails under redirected stdin — use ping instead
ping -n 2 127.0.0.1 >nul

REM Prefer newest bin\x64\Debug build — artifacts\ can be days stale if build never staged it.
set "EXE="
for /f "delims=" %%F in ('dir /b /s /a:-d "BNDZShell\src\BNDZShell.App\bin\x64\Debug\BNDZShell.exe" 2^>nul') do (
  set "EXE=%%F"
  goto :found
)
for /f "delims=" %%F in ('dir /b /s /a:-d "BNDZShell\src\BNDZShell.App\bin\x64\Release\BNDZShell.exe" 2^>nul') do (
  set "EXE=%%F"
  goto :found
)
if exist "artifacts\bndzshell-debug\BNDZShell.exe" (
  set "EXE=%CD%\artifacts\bndzshell-debug\BNDZShell.exe"
  goto :found
)

echo BNDZShell.exe not found.
echo Run: powershell -File scripts\build-bndz-native.ps1
exit /b 1

:found
REM Always stage newest Vite output next to the exe (MSBuild PreserveNewest often leaves stale Assets\ui).
if exist "BNDZBackend\Assets\ui\index.html" (
  for %%I in ("%EXE%") do (
    mkdir "%%~dpIAssets\ui" >nul 2>&1
    robocopy "BNDZBackend\Assets\ui" "%%~dpIAssets\ui" /MIR /NFL /NDL /NJH /NJS /nc /ns /np >nul
  )
)

:launch
for %%I in ("%EXE%") do set "EXEDIR=%%~dpI"
echo Starting BNDZ-Native:
echo   %EXE%
start "" /D "%EXEDIR%" "%EXE%" %*
endlocal
