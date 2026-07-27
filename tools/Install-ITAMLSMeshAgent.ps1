<#
.SYNOPSIS
    Installs the MeshCentral agent on this Windows PC, joining it to your
    ITAMLS remote-management server.

.DESCRIPTION
    Deploy via Kaseya VSA as a one-off Run Procedure per machine. Silent.

    Flow:
      1. Downloads the MeshCentral agent installer from the MeshCentral server
         for the "device group" you pass in.
      2. Runs it silently. The agent registers itself and starts as a Windows
         service so it survives reboots.

.PARAMETER MeshUrl
    Base URL of your MeshCentral server, e.g. https://itamls.fashionfusion.local:4430

.PARAMETER MeshId
    The device-group ID copied from MeshCentral's "Add Agent" screen.
    Format: 0xABCDEF012345... (long hex string)

.EXAMPLE
    PowerShell -ExecutionPolicy Bypass -File Install-ITAMLSMeshAgent.ps1 `
        -MeshUrl "https://itamls.fashionfusion.local:4430" `
        -MeshId  "0xABC123..."

.NOTES
    Exit codes:
      0 = installed OK (or already installed)
      1 = configuration error
      2 = network / download error
      3 = installer failed
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$MeshUrl,
    [Parameter(Mandatory=$true)][string]$MeshId
)

$ErrorActionPreference = 'Stop'
function Log($m, $lvl='INFO') { $t=(Get-Date).ToString('yyyy-MM-ddTHH:mm:ss'); Write-Host "[$t] [$lvl] $m" }

if (-not $MeshUrl.StartsWith('http')) { Log "MeshUrl must start with http(s)://" 'ERROR'; exit 1 }
$MeshUrl = $MeshUrl.TrimEnd('/')

# Skip if already installed
$svc = Get-Service -Name Mesh* -ErrorAction SilentlyContinue | Where-Object { $_.Name -like 'Mesh Agent*' -or $_.Name -like 'meshagent*' }
if ($svc) { Log "MeshCentral agent already installed and running as service '$($svc.Name)' - skipping" 'OK'; exit 0 }

# The MSH file for auto-install
$mshUrl = "$MeshUrl/meshagents?id=4&meshinstall=$MeshId"
$mshTmp = Join-Path $env:TEMP "meshagent.msh"

# Agent binary
$exeUrl = "$MeshUrl/meshagents?id=4"
$exeTmp = Join-Path $env:TEMP "MeshAgent-x64.exe"

Log "Downloading MeshCentral agent from $MeshUrl"
try {
    # MeshCentral typically uses a self-signed cert; skip TLS verification for the install itself
    [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
    Invoke-WebRequest -Uri $mshUrl -OutFile $mshTmp -UseBasicParsing -TimeoutSec 60
    Invoke-WebRequest -Uri $exeUrl -OutFile $exeTmp -UseBasicParsing -TimeoutSec 180
} catch {
    Log "Download failed: $($_.Exception.Message)" 'ERROR'; exit 2
}

Log "Running installer silently"
try {
    $p = Start-Process -FilePath $exeTmp -ArgumentList "-fullinstall" -Wait -PassThru -NoNewWindow
    if ($p.ExitCode -ne 0) { Log "Installer returned $($p.ExitCode)" 'ERROR'; exit 3 }
    Log "Agent installed successfully" 'OK'
} catch {
    Log "Installer failed: $($_.Exception.Message)" 'ERROR'; exit 3
} finally {
    Remove-Item $exeTmp -Force -ErrorAction SilentlyContinue
    Remove-Item $mshTmp -Force -ErrorAction SilentlyContinue
}
exit 0
