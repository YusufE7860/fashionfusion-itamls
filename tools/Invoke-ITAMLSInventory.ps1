<#
.SYNOPSIS
    Collects installed software from this PC and POSTs it to ITAMLS.

.DESCRIPTION
    Reads HKLM + HKCU Uninstall registry keys (both 64-bit + 32-bit hives),
    plus Windows Store (Appx) packages, and posts the deduplicated list to
    /agents/inventory. Also refreshes OS / CPU / RAM / IP metadata.

    Config comes from C:\ProgramData\ITAMLS\agent.json, written by the
    Install-ITAMLSAgent installer.

.NOTES
    Requires PowerShell 5.1+. Runs silently under a scheduled task.
    Exit codes: 0 ok, 1 config missing, 2 API error.
#>
[CmdletBinding()]
param(
    [string]$ConfigPath = "$env:ProgramData\ITAMLS\agent.json"
)

$ErrorActionPreference = 'Stop'
$AgentVersion = '1.0.0'

function Log($m, $lvl='INFO') { $t=(Get-Date).ToString('yyyy-MM-ddTHH:mm:ss'); Write-Host "[$t] [$lvl] $m" }

if (-not (Test-Path $ConfigPath)) { Log "Config missing at $ConfigPath" 'ERROR'; exit 1 }
$cfg = Get-Content $ConfigPath -Raw | ConvertFrom-Json
if (-not $cfg.apiBase -or -not $cfg.agentKey) { Log "apiBase / agentKey missing in config" 'ERROR'; exit 1 }
$apiBase = $cfg.apiBase.TrimEnd('/')

# --- collect installed software from all standard registry locations ---
$paths = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
)
$entries = @()
foreach ($p in $paths) {
    try {
        $items = Get-ItemProperty $p -ErrorAction SilentlyContinue |
            Where-Object { $_.DisplayName -and -not $_.SystemComponent -and -not $_.ParentKeyName }
        foreach ($i in $items) {
            $installDate = $null
            if ($i.InstallDate -and $i.InstallDate -match '^\d{8}$') {
                try { $installDate = [datetime]::ParseExact($i.InstallDate, 'yyyyMMdd', $null).ToString('o') } catch {}
            }
            $entries += [pscustomobject]@{
                name        = "$($i.DisplayName)".Trim()
                version     = if ($i.DisplayVersion) { "$($i.DisplayVersion)".Trim() } else { $null }
                publisher   = if ($i.Publisher)      { "$($i.Publisher)".Trim() }      else { $null }
                installDate = $installDate
                source      = 'REGISTRY'
            }
        }
    } catch { Log "Registry read failed for $p : $($_.Exception.Message)" 'WARN' }
}

# Windows Store apps (best-effort, skip on older systems)
try {
    Get-AppxPackage -AllUsers -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notmatch '^Microsoft\.(NET|VCLibs|Services|UI|Advertising)' } |
        ForEach-Object {
            $entries += [pscustomobject]@{
                name = $_.Name; version = $_.Version; publisher = $_.Publisher
                installDate = $null; source = 'APPX'
            }
        }
} catch {}

# Dedupe by (name+version)
$entries = $entries |
    Where-Object { $_.name -and $_.name.Length -lt 300 } |
    Sort-Object -Property name, version -Unique

# --- host metadata ---
$os  = Get-CimInstance Win32_OperatingSystem
$cs  = Get-CimInstance Win32_ComputerSystem
$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$ip  = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.PrefixOrigin -ne 'WellKnown' -and $_.IPAddress -notmatch '^169\.254' } |
        Select-Object -First 1).IPAddress

$payload = @{
    agentVersion = $AgentVersion
    osVersion    = "$($os.Caption)".Trim()
    osBuild      = "$($os.Version)".Trim()
    cpuModel     = if ($cpu) { "$($cpu.Name)".Trim() } else { $null }
    ramGb        = if ($cs.TotalPhysicalMemory) { [int]([math]::Round($cs.TotalPhysicalMemory / 1GB)) } else { $null }
    ipAddress    = $ip
    entries      = @($entries)
} | ConvertTo-Json -Depth 5 -Compress

# --- POST ---
try {
    Log ("Uploading {0} software entries to $apiBase" -f $entries.Count)
    $resp = Invoke-RestMethod -Method Post -Uri "$apiBase/agents/inventory" `
        -Headers @{ 'X-Api-Key' = $cfg.agentKey; 'Content-Type' = 'application/json' } `
        -Body $payload -TimeoutSec 60
    Log ("Ingested: {0}" -f $resp.ingested) 'OK'
    exit 0
} catch {
    Log "Upload failed: $($_.Exception.Message)" 'ERROR'
    exit 2
}
