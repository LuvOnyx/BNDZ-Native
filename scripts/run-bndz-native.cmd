@echo off
setlocal EnableExtensions
REM BNDZ-Native — unpackaged WinUI shell (self-contained Windows App SDK).
cd /d "%~dp0.."

REM Kill shell + child WebView2 tree so the NativeShell profile is not locked (blank dark window).
taskkill /F /T /IM BNDZShell.exe >nul 2>&1
REM timeout fails under redirected stdin — use ping instead
ping -n 2 127.0.0.1 >nul

REM Always stage newest Vite output next to the exe (MSBuild PreserveNewest often leaves stale Assets\ui).
if exist "BNDZBackend\Assets\ui\index.html" (
  for /f "delims=" %%D in ('dir /b /ad /s "BNDZShell\src\BNDZShell.App\bin\x64\Debug\net*-windows*" 2^>nul') do (
    if exist "%%D\BNDZShell.exe" (
      mkdir "%%D\Assets\ui" >nul 2>&1
      robocopy "BNDZBackend\Assets\ui" "%%D\Assets\ui" /MIR /NFL /NDL /NJH /NJS /nc /ns /np >nul
    )
  )
)

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
