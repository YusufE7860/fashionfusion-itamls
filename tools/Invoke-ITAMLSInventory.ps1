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

# --- Verifone PIN pad detection (Nedbank inventory) ---
# Verifone's USB VID is 11CA (hex). Every PIN pad plugged into this till
# shows up under HKLM\SYSTEM\CurrentControlSet\Enum\USB\VID_11CA_PID_XXXX\<SERIAL>.
# Some deployments use VeriFone's 4B04 VID on newer devices too — include both.
# Fallback: also match Manufacturer strings for Ingenico-branded units in case
# any store received a mixed-brand replacement, so nothing gets missed.
$pinPads = @()
$verifoneVids = @('VID_11CA', 'VID_4B04')

try {
    # Method 1: registry walk — most reliable, gives us the actual USB serial
    foreach ($vid in $verifoneVids) {
        $vidPath = "HKLM:\SYSTEM\CurrentControlSet\Enum\USB\$vid*"
        Get-ChildItem $vidPath -ErrorAction SilentlyContinue | ForEach-Object {
            $pidKey = $_
            $pidValue = ($pidKey.PSChildName -split '_')[-1]   # "PID_0207" -> "0207"
            Get-ChildItem $pidKey.PSPath -ErrorAction SilentlyContinue | ForEach-Object {
                $serialKey = $_
                $serial = $serialKey.PSChildName
                # Skip Windows-generated serials (start with & means "no serial from device")
                if ($serial -match '^&') { return }
                $props = Get-ItemProperty $serialKey.PSPath -ErrorAction SilentlyContinue
                $friendly = if ($props.FriendlyName) { $props.FriendlyName } elseif ($props.DeviceDesc) { ($props.DeviceDesc -split ';')[-1] } else { $null }
                $mfg = if ($props.Mfg) { ($props.Mfg -split ';')[-1] } else { $null }
                $pinPads += [pscustomobject]@{
                    serialNo     = $serial
                    model        = $friendly
                    manufacturer = if ($mfg -and $mfg -notmatch '^Generic') { $mfg } else { 'Verifone' }
                    productId    = "0x$pidValue"
                    usbDeviceId  = "USB\$($vid)_PID_$pidValue\$serial"
                }
            }
        }
    }
} catch { Log "Registry PIN pad scan failed: $($_.Exception.Message)" 'WARN' }

# Method 2: WMI Win32_PnPEntity — catches devices that expose Verifone in
# Manufacturer but aren't under VID_11CA (some newer USB-CDC composite units)
try {
    Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue |
        Where-Object { $_.Manufacturer -match 'Verifone|VeriFone' -or $_.Name -match 'VeriFone|Verifone' } |
        ForEach-Object {
            # Try to extract serial from DeviceID (last segment)
            $devId = $_.DeviceID
            if ($devId -match 'USB\\.*\\(.+)$') {
                $serial = $matches[1]
                if ($serial -notmatch '^&' -and -not ($pinPads | Where-Object { $_.serialNo -eq $serial })) {
                    $pinPads += [pscustomobject]@{
                        serialNo     = $serial
                        model        = $_.Name
                        manufacturer = $_.Manufacturer
                        productId    = $null
                        usbDeviceId  = $devId
                    }
                }
            }
        }
} catch {}

$pinPads = @($pinPads | Where-Object { $_.serialNo -and $_.serialNo.Length -gt 3 } | Sort-Object serialNo -Unique)
if ($pinPads.Count -gt 0) { Log ("Detected {0} Verifone PIN pad(s): {1}" -f $pinPads.Count, (($pinPads.serialNo) -join ', ')) }

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
    pinPads      = @($pinPads)
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
