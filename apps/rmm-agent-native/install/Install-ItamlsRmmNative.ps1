#Requires -RunAsAdministrator
<#
.SYNOPSIS
    Deploys the native C# RMM agent — service + helper — alongside the
    existing scheduled tasks. Replaces (not coexists with) the PowerShell
    `Invoke-ITAMLSRmm.ps1` scheduled task set up by the old installer.

.DESCRIPTION
    Three steps:
      1. Stop + unregister the old ITAMLS-RMM scheduled task if present.
      2. Lay down itamls-rmm-service.exe + itamls-rmm-helper.exe under
         C:\Program Files\ITAMLS-RMM\.
      3. Create + start a Windows service called "ItamlsRmm" running as
         LocalSystem. The service spawns per-session helpers itself.

    Config (apiBase, agentKey, pcId, etc.) is read from the same file the
    other agents already use: C:\ProgramData\ITAMLS\agent.json. If that
    file doesn't exist, run Install-ITAMLSAgent first.

.PARAMETER Source
    Path to the folder containing the two published exes. If you pulled a
    .zip from the API, point this at the extracted directory.

.EXAMPLE
    irm https://itamls.example/api/v1/tools/install-rmm-native.ps1 | iex
    Install-ItamlsRmmNative -Source C:\Temp\itamls-rmm-native
#>
function Install-ItamlsRmmNative {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Source
    )

    $ErrorActionPreference = 'Stop'
    $installDir = 'C:\Program Files\ITAMLS-RMM'
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null

    # 1. Remove the old PowerShell scheduled-task RMM agent, if any.
    try {
        Get-ScheduledTask -TaskName 'ITAMLS-RMM' -ErrorAction SilentlyContinue |
          Unregister-ScheduledTask -Confirm:$false
        Write-Host 'Removed old ITAMLS-RMM scheduled task.' -ForegroundColor Yellow
    } catch { }

    # 2. Stop + delete the Windows service if we're re-installing.
    $existing = Get-Service -Name 'ItamlsRmm' -ErrorAction SilentlyContinue
    if ($existing) {
        if ($existing.Status -eq 'Running') { Stop-Service 'ItamlsRmm' -Force }
        sc.exe delete 'ItamlsRmm' | Out-Null
        Start-Sleep -Seconds 2
    }

    # 3. Copy binaries. Both exes must sit together — the service launches
    #    the helper by path based on its own directory.
    foreach ($exe in 'itamls-rmm-service.exe','itamls-rmm-helper.exe') {
        $src = Join-Path $Source $exe
        if (-not (Test-Path $src)) { throw "Missing $src — rebuild and re-publish before installing." }
        Copy-Item -Force $src $installDir
    }

    # 4. Register the Windows service.
    $svcPath = Join-Path $installDir 'itamls-rmm-service.exe'
    sc.exe create 'ItamlsRmm' binPath= "`"$svcPath`"" start= auto DisplayName= 'ITAMLS Remote Monitoring' | Out-Null
    sc.exe description 'ItamlsRmm' 'ITAMLS native RMM agent — screen / input / clipboard / commands over WebSocket.' | Out-Null
    # Auto-restart on crash (5s, 10s, 30s backoff).
    sc.exe failure 'ItamlsRmm' reset= 86400 actions= restart/5000/restart/10000/restart/30000 | Out-Null

    Start-Service 'ItamlsRmm'
    Write-Host ''
    Write-Host '✅ ItamlsRmm installed and running.' -ForegroundColor Green
    Write-Host "   Binaries:   $installDir"
    Write-Host '   Config:     C:\ProgramData\ITAMLS\agent.json'
    Write-Host '   Log:        Event Viewer → Applications → ItamlsRmm'
    Write-Host ''
    Write-Host 'Tail the WS behaviour live with:'
    Write-Host '   Get-WinEvent -LogName Application -MaxEvents 50 | Where-Object ProviderName -eq ItamlsRmm'
}
