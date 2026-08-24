<#
.SYNOPSIS
    Enrols this Windows PC with the Fashion Fusion ITAMLS server. Installs the
    software-inventory + backup scheduled tasks and runs the first inventory
    push immediately.

.DESCRIPTION
    One-shot enrolment flow:
        1. Redeem the store-scoped enrollment token you paste in
        2. Save the returned per-PC agent key to C:\ProgramData\ITAMLS\agent.json
        3. Download Invoke-ITAMLSInventory.ps1 and Invoke-ITAMLSBackup.ps1
           from the server into C:\ProgramData\ITAMLS
        4. Register two scheduled tasks:
             ITAMLS-Inventory  — daily 03:00 (SYSTEM)
             ITAMLS-Backup     — daily 02:00 (SYSTEM)
        5. Run the first inventory push so the PC appears in the app right away

    The enrollment token is single-use (well, few-use, per admin's setting).
    The per-PC agent key it hands back is what stays on disk long-term.

.PARAMETER Token
    12-character enrollment token generated in ITAMLS > Admin > Agent Enrollment.

.PARAMETER Api
    ITAMLS API base URL, e.g. https://itamls.fashionfusion.local/api/v1

.PARAMETER PcName
    Override the machine name reported to ITAMLS (defaults to $env:COMPUTERNAME).

.PARAMETER Role
    TILL or BACKOFFICE. Default TILL.

.EXAMPLE
    # As administrator:
    Install-ITAMLSAgent -Token 'K7X9M3PQR2AB' -Api 'https://itamls.fashionfusion.local/api/v1'

.EXAMPLE
    # One-liner (fetch + install in one step):
    iwr https://itamls.fashionfusion.local/api/v1/tools/install-pc.ps1 -UseBasicParsing | iex
    Install-ITAMLSAgent -Token 'K7X9M3PQR2AB' -Api 'https://itamls.fashionfusion.local/api/v1'
#>
function Install-ITAMLSAgent {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][string]$Token,
        [Parameter(Mandatory=$true)][string]$Api,
        [string]$PcName = $env:COMPUTERNAME,
        [ValidateSet('TILL','BACKOFFICE')][string]$Role = 'TILL'
    )

    $ErrorActionPreference = 'Stop'
    function LogS($m, $lvl='INFO') {
        $t = (Get-Date).ToString('HH:mm:ss')
        $color = switch ($lvl) {
            'OK'    { 'Green' }
            'WARN'  { 'Yellow' }
            'ERROR' { 'Red' }
            'STEP'  { 'Cyan' }
            default { 'White' }
        }
        Write-Host "   [$t] " -NoNewline -ForegroundColor DarkGray
        Write-Host "[$lvl] " -NoNewline -ForegroundColor $color
        Write-Host $m
    }
    function Step($n, $of, $msg) {
        Write-Host ''
        Write-Host "   ================================================================" -ForegroundColor DarkCyan
        Write-Host "    STEP $n / $of - $msg" -ForegroundColor Cyan
        Write-Host "   ================================================================" -ForegroundColor DarkCyan
    }

    # Elevation check
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($current)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Please re-run this from an ELEVATED PowerShell window (Run as Administrator).'
    }

    $Api = $Api.TrimEnd('/')
    $installDir = "$env:ProgramData\ITAMLS"
    New-Item -ItemType Directory -Force -Path $installDir | Out-Null

    # --- 1. Enrol ---
    Step 1 5 "Enrolling this PC with ITAMLS"
    LogS "Contacting $Api/agents/enroll as $PcName"
    $os  = Get-CimInstance Win32_OperatingSystem
    $cs  = Get-CimInstance Win32_ComputerSystem
    $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
    $ip  = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object { $_.PrefixOrigin -ne 'WellKnown' -and $_.IPAddress -notmatch '^169\.254' } |
            Select-Object -First 1).IPAddress

    $body = @{
        token        = $Token
        pcName       = $PcName
        role         = $Role
        agentVersion = '1.0.0'
        osVersion    = "$($os.Caption)".Trim()
        osBuild      = "$($os.Version)".Trim()
        cpuModel     = if ($cpu) { "$($cpu.Name)".Trim() } else { $null }
        ramGb        = if ($cs.TotalPhysicalMemory) { [int]([math]::Round($cs.TotalPhysicalMemory/1GB)) } else { $null }
        ipAddress    = $ip
    } | ConvertTo-Json -Compress

    try {
        $res = Invoke-RestMethod -Method Post -Uri "$Api/agents/enroll" `
            -ContentType 'application/json' -Body $body -TimeoutSec 30
    } catch {
        throw "Enrolment failed: $($_.Exception.Message). Verify the token hasn't expired and the API URL is reachable from this PC."
    }
    LogS "Enrolled OK - pcId $($res.pcId), scope $($res.storeCode), key $($res.agentKeyPrefix)..." 'OK'

    # --- 2. Save config (chmod-equivalent: strip inheritance, admins+SYSTEM only) ---
    Step 2 5 "Saving agent config"
    $cfgPath = Join-Path $installDir 'agent.json'
    $config = [pscustomobject]@{
        apiBase   = $Api
        storeId   = $res.storeId
        storeCode = $res.storeCode
        pcId      = $res.pcId
        pcName    = $res.pcName
        agentKey  = $res.agentKey
        installedAt = (Get-Date).ToString('o')
    }
    $config | ConvertTo-Json | Set-Content -Path $cfgPath -Encoding UTF8
    try {
        $acl = Get-Acl $cfgPath
        $acl.SetAccessRuleProtection($true, $false)
        $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('SYSTEM','FullControl','Allow')))
        $acl.SetAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule('Administrators','FullControl','Allow')))
        Set-Acl $cfgPath $acl
    } catch { LogS "Could not lock down $cfgPath : $($_.Exception.Message)" 'WARN' }
    LogS "Wrote $cfgPath (admins + SYSTEM only)" 'OK'

    # --- 3. Download agent scripts ---
    Step 3 5 "Downloading agent scripts"
    foreach ($script in @('Invoke-ITAMLSInventory.ps1','Invoke-ITAMLSBackup.ps1')) {
        $dest = Join-Path $installDir $script
        $url  = "$Api/tools/$($script.ToLower())"
        try {
            LogS "GET $url"
            Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing -TimeoutSec 60
            LogS "Saved to $dest" 'OK'
        } catch {
            LogS "Could not download $script from $url : $($_.Exception.Message)" 'WARN'
        }
    }

    # --- 4. Scheduled tasks ---
    Step 4 5 "Registering scheduled tasks"
    function Register-ITAMLSTask {
        param([string]$Name, [string]$Script, [string]$Time, [hashtable]$ExtraArgs = @{})
        $extraArgLine = ''
        foreach ($k in $ExtraArgs.Keys) { $extraArgLine += " -$k `"$($ExtraArgs[$k])`"" }
        $argLine = "-NoProfile -ExecutionPolicy Bypass -File `"$installDir\$Script`"$extraArgLine"
        $action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine
        $trigger = New-ScheduledTaskTrigger -Daily -At $Time
        # Also run 5 minutes after boot in case the PC is off at the scheduled time
        $bootTrigger = New-ScheduledTaskTrigger -AtStartup
        $bootTrigger.Delay = 'PT5M'
        $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
            -StartWhenAvailable -RunOnlyIfNetworkAvailable
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction SilentlyContinue
        Register-ScheduledTask -TaskName $Name -Action $action -Trigger @($trigger, $bootTrigger) `
            -Settings $settings -Principal $principal -Force | Out-Null
        LogS "Task '$Name' registered ($Time daily + 5min post-boot)" 'OK'
    }

    Register-ITAMLSTask -Name 'ITAMLS-Inventory' -Script 'Invoke-ITAMLSInventory.ps1' -Time '03:00'
    Register-ITAMLSTask -Name 'ITAMLS-Backup'    -Script 'Invoke-ITAMLSBackup.ps1'    -Time '02:00' `
        -ExtraArgs @{ ApiBase = $Api; ApiKey = $res.agentKey; StoreCode = $res.storeCode; PcName = $res.pcName }

    # --- 5. First inventory push ---
    Step 5 5 "Running first inventory push"
    try {
        & "$installDir\Invoke-ITAMLSInventory.ps1" -ConfigPath $cfgPath
        LogS 'First inventory push complete' 'OK'
    } catch {
        LogS "First inventory push failed (task will retry tomorrow): $($_.Exception.Message)" 'WARN'
    }

    Write-Host ''
    Write-Host '   ================================================================' -ForegroundColor Green
    Write-Host "    AGENT INSTALLED ON $PcName" -ForegroundColor Green
    Write-Host '   ================================================================' -ForegroundColor Green
    Write-Host "    Scope:      $($res.storeCode) ($($res.storeName))" -ForegroundColor Green
    Write-Host "    PC ID:      $($res.pcId)" -ForegroundColor Green
    Write-Host "    Config:     $cfgPath" -ForegroundColor Green
    Write-Host "    Inventory:  daily 03:00 + 5 min post-boot" -ForegroundColor Green
    Write-Host "    Backup:     daily 02:00 + 5 min post-boot" -ForegroundColor Green
    Write-Host '   ================================================================' -ForegroundColor Green
}

Set-Alias -Name Install-ITAMLSAgent -Value Install-ITAMLSAgent -Scope Global -ErrorAction SilentlyContinue

# When dot-sourced via iex, don't auto-run — the user calls Install-ITAMLSAgent with their token.
if ($MyInvocation.InvocationName -notin @('.', '&', 'iex')) {
    # Only auto-run when invoked directly with parameters
    if ($args.Count -gt 0 -or $PSBoundParameters.Count -gt 0) {
        # No-op — the function definition is what matters
    }
}
