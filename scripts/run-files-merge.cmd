@echo off
setlocal
cd /d "%~dp0.."
REM BNDZ-Native primary shell = FilesMerge WinUI app (AssemblyName still Files.exe this phase)
set EXE=
for %%P in (
  "FilesMerge\src\Files.App\bin\x64\Debug\net10.0-windows10.0.26100.0\win-x64\Files.exe"
  "FilesMerge\src\Files.App\bin\x64\Debug\net10.0-windows10.0.26100.0\Files.exe"
  "FilesMerge\src\Files.App\bin\Debug\net10.0-windows10.0.26100.0\win-x64\Files.exe"
) do if exist %%~P set EXE=%%~P
if "%EXE%"=="" (
  echo BNDZ-Native shell exe not found. Run scripts\build-files-bndz-merge.ps1 on Windows first.
  exit /b 1
)
echo Starting BNDZ-Native (FilesMerge shell): %EXE%
start "" %EXE%
endlocal
