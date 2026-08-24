@echo off
setlocal enabledelayedexpansion
title Fashion Fusion ITAMLS - PC Agent Installer

REM -----------------------------------------------------------------
REM Self-elevating .cmd wrapper for the ITAMLS PC agent installer.
REM
REM Elevation uses a VBS trampoline (mshta / Shell.Application) which
REM is the ONLY method that survives:
REM   - paths containing spaces (Desktop, Downloads, OneDrive folders)
REM   - paths on network drives
REM   - unicode / accented characters in the path
REM
REM After elevation, execution stays in the same window until the
REM final pause -- never closes automatically.
REM -----------------------------------------------------------------

REM --- If we've already been re-launched elevated, skip the check ---
if "%~1"=="__elevated__" goto :run

REM --- Check if we're admin ---
net session >nul 2>&1
if not errorlevel 1 goto :run

REM --- Not admin: build a tiny VBS that re-launches this script as admin ---
echo.
echo   This installer needs administrator rights.
echo   A UAC prompt will appear -- please click Yes to continue.
echo.

REM Target command line for cmd:  cmd /k ""FULLPATH.cmd" __elevated__"
REM  - /k (not /c) keeps the window open even if the script errors early
REM  - Outer double-quote-pair rule tells cmd to strip only the outer quotes
REM  - Inner quotes protect the path if it has spaces
REM  - Chr(34) sidesteps the double-echo quote hell
set "VBS=%TEMP%\itamls-elevate-%RANDOM%.vbs"
> "%VBS%" echo Q = Chr(34)
>> "%VBS%" echo Set UAC = CreateObject("Shell.Application")
>> "%VBS%" echo Args = "/k " ^& Q ^& Q ^& "%~f0" ^& Q ^& " __elevated__" ^& Q
>> "%VBS%" echo UAC.ShellExecute "cmd.exe", Args, "", "runas", 1
cscript //nologo "%VBS%"
del "%VBS%" >nul 2>&1
exit /b

:run
REM Change to the script's directory so relative paths work
cd /d "%~dp0"

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
    set /p "API=   API URL [%DEFAULT_API%]: "
    if "!API!"=="" set "API=%DEFAULT_API%"
) else (
    echo   Enter the ITAMLS API URL, e.g. https://itamls.fashionfusion.local/api/v1
    set /p "API=   API URL: "
)

if "%API%"=="" (
    echo.
    echo   ERROR: No API URL entered. Cannot continue.
    goto :end
)

echo.
echo   Enter the 12-character enrollment token you generated in ITAMLS.
set /p "TOKEN=   Token: "

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

REM --- Write the PowerShell installer to a temp file to sidestep
REM     cmd's quoting hell for multi-line PS code. ---
set "PSFILE=%TEMP%\itamls-install-%RANDOM%.ps1"
> "%PSFILE%" echo $ErrorActionPreference = 'Continue'
>> "%PSFILE%" echo try {
>> "%PSFILE%" echo     Write-Host '   ^> Loading installer from server...' -ForegroundColor Cyan
>> "%PSFILE%" echo     $env:ITAMLS_API = '%API%'
>> "%PSFILE%" echo     $installerScript = (Invoke-WebRequest -Uri '%API%/tools/install-itamlsagent.ps1' -UseBasicParsing -TimeoutSec 30).Content
>> "%PSFILE%" echo     Write-Host '   ^> Executing installer...' -ForegroundColor Cyan
>> "%PSFILE%" echo     Invoke-Expression $installerScript
>> "%PSFILE%" echo     Install-ITAMLSAgent -Token '%TOKEN%' -Api '%API%'
>> "%PSFILE%" echo     exit 0
>> "%PSFILE%" echo } catch {
>> "%PSFILE%" echo     Write-Host ''
>> "%PSFILE%" echo     Write-Host '   ---------- ERROR ----------' -ForegroundColor Red
>> "%PSFILE%" echo     Write-Host ('   ' + $_.Exception.Message) -ForegroundColor Red
>> "%PSFILE%" echo     if ($_.ScriptStackTrace) { Write-Host ('   ' + ($_.ScriptStackTrace -replace \"`n\",\"`n   \")) -ForegroundColor DarkGray }
>> "%PSFILE%" echo     Write-Host '   ---------------------------' -ForegroundColor Red
>> "%PSFILE%" echo     exit 1
>> "%PSFILE%" echo }

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PSFILE%"
set "PS_EXIT=%errorlevel%"
del "%PSFILE%" >nul 2>&1

echo.
echo   ------------------------------------------------------------
if "%PS_EXIT%"=="0" (
    echo    INSTALLATION COMPLETE
    echo   ------------------------------------------------------------
    echo.
    echo    This PC is now enrolled with ITAMLS.
    echo.
    echo    Scheduled tasks registered:
    echo      * ITAMLS-Inventory  - daily 03:00 (+ 5 min post-boot^)
    echo      * ITAMLS-Backup     - daily 02:00 (+ 5 min post-boot^)
    echo.
    echo    First inventory push has been run - the PC should now appear
    echo    in ITAMLS ^> Head Office / Stores ^> PC Agent Enrollment.
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
