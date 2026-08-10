@echo off
setlocal
REM DEPRECATED: this launched the old WPF --native-shell comparison build.
REM Product path is BNDZShell (unpackaged). Forwarding to the real launcher.
echo [deprecated] scripts\run-native-shell.cmd - use scripts\run-bndz-native.cmd
call "%~dp0run-bndz-native.cmd" %*
endlocal
