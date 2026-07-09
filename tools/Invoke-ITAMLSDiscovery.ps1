<#
.SYNOPSIS
    Collects local hardware information and reports it to the Fashion Fusion
    IT Asset Management & Logistics System (ITAMLS).

.DESCRIPTION
    Designed to run silently from Kaseya VSA's "Run Procedure" feature, but
    works fine standalone too.

    Reads from WMI / CIM:
      * Computer name, manufacturer, model, BIOS serial number
      * OS version, CPU model, RAM (GB)
      * MAC addresses of all active network adapters

    Posts the result as JSON to:
      POST <ApiBase>/discovery/report
      Header: X-Api-Key: <ApiKey>

.PARAMETER ApiBase
    Base URL of the ITAMLS API, including /api/v1.
    Example: https://itamls.fashionfusion.local/api/v1
    For local dev: http://YOUR-IP:4000/api/v1

.PARAMETER ApiKey
    Discovery API key generated in ITAMLS > Admin > API Keys.
    Format: itamls_<32 hex chars>.

.PARAMETER LocationCode
    Optional. Location code in ITAMLS (e.g. STR-001 for Store 001, HO for
    head office). When provided, the asset is automatically assigned to that
    location on first discovery.

.EXAMPLE
    # Kaseya VSA procedure — silent, schedule daily
    PowerShell -ExecutionPolicy Bypass -File Invoke-ITAMLSDiscovery.ps1 `
        -ApiBase "https://itamls.fashionfusion.local/api/v1" `
        -ApiKey  "itamls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" `
        -LocationCode "STR-001"

.NOTES
    Requires PowerShell 5.1+ (built-in on Windows 10/11 and Server 2016+).
    Exit codes:
      0 = reported successfully
      1 = configuration error (missing args, invalid URL)
      2 = network / API error
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ApiBase,

    [Parameter(Mandatory = $true)]
    [string]$ApiKey,

    [Parameter(Mandatory = $false)]
    [string]$LocationCode
)

$ErrorActionPreference = 'Stop'

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $ts = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
    Write-Host "[$ts] [$Level] $Message"
}

try {
    if (-not $ApiBase.StartsWith('http')) {
        Write-Log "ApiBase must start with http(s)://" 'ERROR'
        exit 1
    }
    $ApiBase = $ApiBase.TrimEnd('/')

    Write-Log "Collecting hardware information..."
    $cs   = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
    $bios = Get-CimInstance -ClassName Win32_BIOS -ErrorAction SilentlyContinue
    $os   = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
    $cpu  = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1

    # MAC addresses for active, non-virtual adapters
    $macs = @()
    try {
        $macs = Get-NetAdapter -ErrorAction Stop |
            Where-Object { $_.Status -eq 'Up' -and $_.MacAddress -and -not $_.Virtual } |
            Select-Object -ExpandProperty MacAddress
    } catch {
        # Fallback for older PowerShell
        $macs = Get-CimInstance -ClassName Win32_NetworkAdapterConfiguration |
            Where-Object { $_.IPEnabled -eq $true -and $_.MACAddress } |
            Select-Object -ExpandProperty MACAddress
    }

    $ramGb = if ($cs) { [int][math]::Round(($cs.TotalPhysicalMemory / 1GB)) } else { $null }

    # @() forces the result to be a real array even when there's only one MAC,
    # so ConvertTo-Json emits "macAddresses": [...] rather than a bare string.
    $payload = @{
        hostname     = $env:COMPUTERNAME
        manufacturer = if ($cs)   { $cs.Manufacturer.Trim() }     else { $null }
        model        = if ($cs)   { $cs.Model.Trim() }            else { $null }
        serialNo     = if ($bios) { $bios.SerialNumber.Trim() }   else { $null }
        osVersion    = if ($os)   { "$($os.Caption) $($os.Version)" } else { $null }
        cpuModel     = if ($cpu)  { $cpu.Name.Trim() }            else { $null }
        ramGb        = $ramGb
        macAddresses = @($macs)
        locationCode = if ($LocationCode) { $LocationCode } else { $null }
    }

    Write-Log ("Hostname={0}  Manufacturer={1}  Model={2}  Serial={3}  RAM={4}GB  MACs={5}" -f `
        $payload.hostname, $payload.manufacturer, $payload.model, $payload.serialNo, $payload.ramGb, ($macs -join ','))

    $json = $payload | ConvertTo-Json -Depth 4
    $uri  = "$ApiBase/discovery/report"
    Write-Log "POST $uri"

    try {
        $response = Invoke-RestMethod -Method Post -Uri $uri `
            -Headers @{ 'X-Api-Key' = $ApiKey; 'Content-Type' = 'application/json' } `
            -Body $json -TimeoutSec 30
        Write-Log ("Success. assetTag={0}" -f $response.assetTag) 'OK'
        exit 0
    } catch {
        $code = $_.Exception.Response.StatusCode.value__
        Write-Log "API call failed: HTTP $code - $($_.Exception.Message)" 'ERROR'
        exit 2
    }
} catch {
    Write-Log "Unhandled error: $($_.Exception.Message)" 'ERROR'
    exit 1
}
