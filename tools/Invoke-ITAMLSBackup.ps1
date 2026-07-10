<#
.SYNOPSIS
    Zips the configured paths on this PC and uploads the archive to the
    Fashion Fusion ITAMLS backup service.

.DESCRIPTION
    Designed to run silently from Kaseya VSA's "Run Procedure" feature,
    once a day per store PC.

    Flow:
      1. GET  /backups/config?storeCode=X&pcName=Y  → learns which paths to back up
      2. Zips them to %TEMP%\itamls-backup.zip
      3. POST /backups/start                        → gets a pre-signed MinIO PUT URL
      4. PUT  <presignedUrl>                        → uploads the zip directly to MinIO
      5. POST /backups/{runId}/complete             → tells the API the size

.PARAMETER ApiBase
    Base URL of the ITAMLS API, e.g. https://itamls.fashionfusion.local/api/v1
    For local dev: http://YOUR-IP:4000/api/v1

.PARAMETER ApiKey
    Backup API key generated in ITAMLS > Admin > API Keys.

.PARAMETER StoreCode
    The store's code as it appears in ITAMLS (e.g. 001, STR-001, E01).

.PARAMETER PcName
    A stable name for this machine, e.g. POS1, POS2, BackOffice.

.EXAMPLE
    PowerShell -ExecutionPolicy Bypass -File Invoke-ITAMLSBackup.ps1 `
        -ApiBase "https://itamls.fashionfusion.local/api/v1" `
        -ApiKey  "itamls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" `
        -StoreCode "001" `
        -PcName "POS1"

.NOTES
    Requires PowerShell 5.1+ (built-in on Windows 10/11 and Server 2016+).
    Exit codes:
      0 = uploaded successfully
      1 = configuration error
      2 = no paths configured (yet) — nothing to do
      3 = network / API error
      4 = zip / upload error
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][string]$ApiBase,
    [Parameter(Mandatory=$true)][string]$ApiKey,
    [Parameter(Mandatory=$true)][string]$StoreCode,
    [Parameter(Mandatory=$true)][string]$PcName
)

$ErrorActionPreference = 'Stop'
function Log($m, $lvl='INFO') { $t=(Get-Date).ToString('yyyy-MM-ddTHH:mm:ss'); Write-Host "[$t] [$lvl] $m" }

if (-not $ApiBase.StartsWith('http')) { Log "ApiBase must start with http(s)://" 'ERROR'; exit 1 }
$ApiBase = $ApiBase.TrimEnd('/')
$headers = @{ 'X-Api-Key' = $ApiKey; 'Content-Type' = 'application/json' }

# --- 1. fetch config ---
try {
    Log "Fetching backup config for $StoreCode / $PcName"
    $cfg = Invoke-RestMethod -Method Get `
        -Uri "$ApiBase/backups/config?storeCode=$([uri]::EscapeDataString($StoreCode))&pcName=$([uri]::EscapeDataString($PcName))" `
        -Headers @{ 'X-Api-Key' = $ApiKey } -TimeoutSec 30
} catch {
    Log "Could not fetch config: $($_.Exception.Message)" 'ERROR'; exit 3
}
if (-not $cfg.isActive) { Log "PC or store backup is disabled — skipping" 'WARN'; exit 0 }
$paths = @($cfg.backupPaths)
if ($paths.Count -eq 0) { Log "No backup paths configured yet — skipping" 'INFO'; exit 2 }
Log ("Config OK — {0} path(s) to back up" -f $paths.Count)

# --- 2. zip ---
$zipPath = Join-Path $env:TEMP ("itamls-backup-" + (Get-Random) + ".zip")
try {
    Log "Creating archive at $zipPath"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    $existing = @()
    foreach ($p in $paths) {
        if (Test-Path $p) { $existing += $p } else { Log "  path missing: $p" 'WARN' }
    }
    if ($existing.Count -eq 0) { Log "None of the configured paths exist on this machine" 'ERROR'; exit 4 }
    Compress-Archive -Path $existing -DestinationPath $zipPath -CompressionLevel Optimal -Force
    $size = (Get-Item $zipPath).Length
    Log ("Archive built: {0:N0} bytes" -f $size)
} catch {
    Log "Zip failed: $($_.Exception.Message)" 'ERROR'; exit 4
}

# --- 3. start ---
try {
    Log "Requesting upload URL"
    $start = Invoke-RestMethod -Method Post -Uri "$ApiBase/backups/start" -Headers $headers `
        -Body (@{ pcId = $cfg.pcId; sizeBytes = $size } | ConvertTo-Json) -TimeoutSec 30
} catch {
    Log "Could not start run: $($_.Exception.Message)" 'ERROR'; Remove-Item $zipPath -Force -ErrorAction SilentlyContinue; exit 3
}
$runId = $start.runId
$uploadUrl = $start.uploadUrl

# --- 4. upload ---
try {
    Log "Uploading to storage (run $runId)"
    Invoke-WebRequest -Method Put -Uri $uploadUrl -InFile $zipPath `
        -ContentType 'application/zip' -UseBasicParsing -TimeoutSec 3600 | Out-Null
    Log "Upload complete"
} catch {
    Log "Upload failed: $($_.Exception.Message)" 'ERROR'
    try {
        Invoke-RestMethod -Method Post -Uri "$ApiBase/backups/$runId/fail" -Headers $headers `
            -Body (@{ error = "upload: $($_.Exception.Message)" } | ConvertTo-Json) -TimeoutSec 30 | Out-Null
    } catch {}
    Remove-Item $zipPath -Force -ErrorAction SilentlyContinue; exit 4
}

# --- 5. complete ---
try {
    Invoke-RestMethod -Method Post -Uri "$ApiBase/backups/$runId/complete" -Headers $headers `
        -Body (@{ sizeBytes = $size } | ConvertTo-Json) -TimeoutSec 30 | Out-Null
    Log "Backup completed successfully (run $runId, $([math]::Round($size/1MB,2)) MB)" 'OK'
} catch {
    Log "Complete call failed but data was uploaded: $($_.Exception.Message)" 'WARN'
}

Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
exit 0
