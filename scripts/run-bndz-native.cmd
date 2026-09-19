@echo off
setlocal EnableExtensions EnableDelayedExpansion
REM BNDZ-Native - unpackaged WinUI shell (self-contained Windows App SDK).
cd /d "%~dp0.."
set BNDZ_DRAGSTARTING=1

REM Hard-kill shell + backend so DLL/UI assets are not locked (zombie WinUI PIDs).
taskkill /F /T /IM BNDZ.exe >nul 2>&1
taskkill /F /T /IM BNDZShell.exe >nul 2>&1
wmic process where "name='BNDZ.exe'" call terminate >nul 2>&1
wmic process where "name='BNDZShell.exe'" call terminate >nul 2>&1
REM timeout fails under redirected stdin - use ping instead
ping -n 2 127.0.0.1 >nul

REM Prefer newest bin\x64\Debug BNDZ.exe alias, but never launch a DLL-sized fake
REM (old AliasProductExeAsBndz copied BNDZShell.dll -> BNDZ.exe). Fall back to BNDZShell.exe.
set "EXE="
set "SHELL_EXE="

for /f "delims=" %%F in ('dir /b /s /a:-d "BNDZShell\src\BNDZShell.App\bin\x64\Debug\BNDZShell.exe" 2^>nul') do (
  set "SHELL_EXE=%%F"
  goto :have_shell_debug
)
:have_shell_debug

if defined SHELL_EXE (
  for %%I in ("!SHELL_EXE!") do set "EXEDIR=%%~dpI"
  if exist "!EXEDIR!BNDZ.exe" (
    for %%A in ("!EXEDIR!BNDZ.exe") do set "BNDZ_LEN=%%~zA"
    for %%A in ("!EXEDIR!BNDZShell.dll") do set "DLL_LEN=%%~zA"
    if not "!BNDZ_LEN!"=="!DLL_LEN!" if not "!BNDZ_LEN!"=="0" (
      set "EXE=!EXEDIR!BNDZ.exe"
      goto :found
    )
    echo WARNING: BNDZ.exe looks like a renamed DLL - using BNDZShell.exe
  )
  set "EXE=!SHELL_EXE!"
  goto :found
)

for /f "delims=" %%F in ('dir /b /s /a:-d "BNDZShell\src\BNDZShell.App\bin\x64\Release\BNDZShell.exe" 2^>nul') do (
  set "SHELL_EXE=%%F"
  goto :have_shell_release
)
:have_shell_release

if defined SHELL_EXE (
  for %%I in ("!SHELL_EXE!") do set "EXEDIR=%%~dpI"
  if exist "!EXEDIR!BNDZ.exe" (
    for %%A in ("!EXEDIR!BNDZ.exe") do set "BNDZ_LEN=%%~zA"
    for %%A in ("!EXEDIR!BNDZShell.dll") do set "DLL_LEN=%%~zA"
    if not "!BNDZ_LEN!"=="!DLL_LEN!" if not "!BNDZ_LEN!"=="0" (
      set "EXE=!EXEDIR!BNDZ.exe"
      goto :found
    )
    echo WARNING: BNDZ.exe looks like a renamed DLL - using BNDZShell.exe
  )
  set "EXE=!SHELL_EXE!"
  goto :found
)

if exist "artifacts\bndzshell-debug\BNDZShell.exe" (
  set "SHELL_EXE=%CD%\artifacts\bndzshell-debug\BNDZShell.exe"
  if exist "%CD%\artifacts\bndzshell-debug\BNDZ.exe" (
    for %%A in ("%CD%\artifacts\bndzshell-debug\BNDZ.exe") do set "BNDZ_LEN=%%~zA"
    for %%A in ("%CD%\artifacts\bndzshell-debug\BNDZShell.dll") do set "DLL_LEN=%%~zA"
    if not "!BNDZ_LEN!"=="!DLL_LEN!" if not "!BNDZ_LEN!"=="0" (
      set "EXE=%CD%\artifacts\bndzshell-debug\BNDZ.exe"
      goto :found
    )
  )
  set "EXE=!SHELL_EXE!"
  goto :found
)

echo BNDZShell.exe / BNDZ.exe not found.
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
echo Starting BNDZ:
echo   %EXE%
start "" /D "%EXEDIR%" "%EXE%" %*
endlocal
