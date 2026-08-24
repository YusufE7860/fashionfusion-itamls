@echo off
setlocal enabledelayedexpansion
title Fashion Fusion ITAMLS - PC Agent Installer

REM -----------------------------------------------------------------
REM Self-elevating .cmd wrapper for the ITAMLS PC agent installer.
REM  1. If not running as admin, re-launches itself elevated (same window
REM     stays open long enough to prompt for UAC, then hands off).
REM  2. Prompts for API URL + enrollment token.
REM  3. Runs the PowerShell installer with visible per-step output.
REM  4. ALWAYS pauses at the end so the window never flashes-and-closes.
REM -----------------------------------------------------------------

REM --- Check for admin rights ---
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo   This installer needs administrator rights.
    echo   Requesting elevation - please approve the UAC prompt...
    echo.
    REM Re-launch elevated. The new window runs this same file, sees itself
    REM as admin, and skips this block.
    powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
        "Start-Process cmd -ArgumentList '/c ""%~f0""' -Verb RunAs"
    exit /b
)

cls
echo.
echo   ============================================================
echo    Fashion Fusion ITAMLS - PC Agent Installer
echo   ============================================================
echo.
echo   This will:
echo     [1/5] Enrol this PC with the ITAMLS server
echo     [2/5] Save the agent config to C:\ProgramData\ITAMLS
echo     [3/5] Download the inventory + backup scripts
echo     [4/5] Register scheduled tasks (Inventory 03:00, Backup 02:00)
echo     [5/5] Run the first inventory push
echo.
echo   ============================================================
echo.

REM --- Prefill API URL from a sibling file if the admin dropped one here ---
set "DEFAULT_API="
if exist "%~dp0api-url.txt" (
    set /p DEFAULT_API=<"%~dp0api-url.txt"
)

if not "%DEFAULT_API%"=="" (
    set /p API="   API URL [%DEFAULT_API%]: "
    if "!API!"=="" set "API=%DEFAULT_API%"
) else (
    echo   Enter the ITAMLS API URL, e.g. https://itamls.fashionfusion.local/api/v1
    set /p API="   API URL: "
)

if "%API%"=="" (
    echo.
    echo   ERROR: No API URL entered. Cannot continue.
    goto :end
)

echo.
echo   Enter the 12-character enrollment token you generated in ITAMLS.
set /p TOKEN="   Token: "

if "%TOKEN%"=="" (
    echo.
    echo   ERROR: No token entered. Cannot continue.
    goto :end
)

echo.
echo   ------------------------------------------------------------
echo    Running installer...
echo    API:   %API%
echo    Token: %TOKEN%
echo    PC:    %COMPUTERNAME%
echo   ------------------------------------------------------------
echo.

REM --- Run PowerShell inline, capturing full stderr into stdout so we
REM     always see what went wrong. -Command with a here-string keeps
REM     everything in this window (no Start-Process). ---
set "PS_SCRIPT=$ErrorActionPreference='Continue';"
set "PS_SCRIPT=!PS_SCRIPT! try {"
set "PS_SCRIPT=!PS_SCRIPT!   Write-Host '   > Loading installer from server...' -ForegroundColor Cyan;"
set "PS_SCRIPT=!PS_SCRIPT!   $env:ITAMLS_API = '%API%';"
set "PS_SCRIPT=!PS_SCRIPT!   $installerScript = (Invoke-WebRequest -Uri '%API%/tools/install-itamlsagent.ps1' -UseBasicParsing -TimeoutSec 30).Content;"
set "PS_SCRIPT=!PS_SCRIPT!   Write-Host '   > Executing installer...' -ForegroundColor Cyan;"
set "PS_SCRIPT=!PS_SCRIPT!   Invoke-Expression $installerScript;"
set "PS_SCRIPT=!PS_SCRIPT!   Install-ITAMLSAgent -Token '%TOKEN%' -Api '%API%';"
set "PS_SCRIPT=!PS_SCRIPT!   $Global:LASTEXITCODE = 0;"
set "PS_SCRIPT=!PS_SCRIPT! } catch {"
set "PS_SCRIPT=!PS_SCRIPT!   Write-Host '';"
set "PS_SCRIPT=!PS_SCRIPT!   Write-Host '   ---------- ERROR ----------' -ForegroundColor Red;"
set "PS_SCRIPT=!PS_SCRIPT!   Write-Host ('   ' + $_.Exception.Message) -ForegroundColor Red;"
set "PS_SCRIPT=!PS_SCRIPT!   if ($_.ScriptStackTrace) { Write-Host ('   ' + ($_.ScriptStackTrace -replace \"`n\",\"`n   \")) -ForegroundColor DarkGray; }"
set "PS_SCRIPT=!PS_SCRIPT!   Write-Host '   ---------------------------' -ForegroundColor Red;"
set "PS_SCRIPT=!PS_SCRIPT!   $Global:LASTEXITCODE = 1;"
set "PS_SCRIPT=!PS_SCRIPT! }"

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "!PS_SCRIPT!"
set "PS_EXIT=%errorlevel%"

echo.
echo   ------------------------------------------------------------
if "%PS_EXIT%"=="0" (
    echo    INSTALLATION COMPLETE
    echo   ------------------------------------------------------------
    echo.
    echo    This PC is now enrolled with ITAMLS.
    echo.
    echo    Scheduled tasks registered:
    echo      * ITAMLS-Inventory  - daily 03:00 (+ 5 min post-boot)
    echo      * ITAMLS-Backup     - daily 02:00 (+ 5 min post-boot)
    echo.
    echo    First inventory push has been run - the PC should now appear
    echo    in ITAMLS ^> Head Office / Stores ^> Agent Enrollment.
    echo.
    echo    You can verify the scheduled tasks in Task Scheduler under
    echo    Microsoft ^> Windows ^> ITAMLS-*.
) else (
    echo    INSTALLATION FAILED - see error above
    echo   ------------------------------------------------------------
    echo.
    echo    Common causes:
    echo      * Wrong API URL - the PC couldn't reach the ITAMLS server
    echo      * Expired or already-used token - generate a fresh one
    echo      * TLS cert error - self-signed cert not trusted by this PC
    echo      * Windows Defender / AV blocked the script download
    echo.
    echo    Run the installer again once the cause is resolved.
)
echo   ------------------------------------------------------------
echo.

:end
echo.
echo   Press any key to close this window...
pause >nul
endlocal
