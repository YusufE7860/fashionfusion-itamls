@echo off
REM ITAMLS agent double-click installer.
REM Prompts for the enrollment token and API URL, then runs the PowerShell installer elevated.

setlocal enabledelayedexpansion

echo.
echo ============================================================
echo   Fashion Fusion ITAMLS - PC Agent Installer
echo ============================================================
echo.

REM Prefill API URL from a sibling file if the admin dropped one here.
set "DEFAULT_API="
if exist "%~dp0api-url.txt" (
    set /p DEFAULT_API=<"%~dp0api-url.txt"
)

if not "%DEFAULT_API%"=="" (
    set /p API=API URL [%DEFAULT_API%]:
    if "!API!"=="" set "API=%DEFAULT_API%"
) else (
    set /p API=API URL (e.g. https://itamls.fashionfusion.local/api/v1):
)

set /p TOKEN=Enrollment token (12 chars):

if "%TOKEN%"=="" (
    echo No token entered. Exiting.
    pause
    exit /b 1
)

echo.
echo Running installer elevated...
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
    "Start-Process powershell.exe -Verb RunAs -Wait -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-Command',\"$env:ITAMLS_API='%API%'; iwr '%API%/tools/install-pc.ps1' -UseBasicParsing | iex; Install-ITAMLSAgent -Token '%TOKEN%' -Api '%API%'; Read-Host 'Press Enter to close'\""

endlocal
