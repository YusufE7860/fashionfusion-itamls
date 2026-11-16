<#
.SYNOPSIS
    Long-running RMM agent for ITAMLS. Opens a WebSocket to the API and
    stays connected so administrators can see live metrics, run saved
    PowerShell scripts, trigger restarts and view ad-hoc screenshots
    without needing a VPN into the store.

.DESCRIPTION
    Runs under SYSTEM via a scheduled task registered by Install-ITAMLSAgent.
    Reads its enrolment config (apiBase + agentKey) from the same agent.json
    the inventory/backup scripts use, so there's no second credential to
    manage.

    Protocol — matches apps/api/src/rmm/rmm.gateway.ts:
        >>  hello       { agentVersion, osName, osVersion, publicIp, localIp }
        >>  metrics     { cpuPct, memUsed/Total, diskUsed/Total, netRx/Tx, loggedInUser }
        >>  cmd_result  { id, status, exitCode, stdout, stderr }
        <<  cmd         { id, kind, payload }        — server-issued command
        <<  pong        { } (keepalive)

    Supported command kinds:
        SHELL           payload.script + payload.interpreter (POWERSHELL|CMD)
        SCRIPT          same shape — runs a longer timeout
        RESTART         payload.delaySeconds — schedules shutdown.exe /r
        SCREENSHOT      captures the active desktop and uploads to MinIO via
                        the API, then returns the storage key in stdout
        FILE_PULL       payload.path — reads file, returns base64 content
        FILE_PUSH       payload.path + payload.base64 — writes file

.PARAMETER ConfigPath
    Path to agent.json. Defaults to C:\ProgramData\ITAMLS\agent.json.

.NOTES
    Uses only built-in .NET: System.Net.WebSockets.ClientWebSocket for the
    WS transport and System.Drawing / System.Windows.Forms for screen
    capture. No external PowerShell modules required — works on vanilla
    Windows Server 2016 / 10 / 11.
#>
[CmdletBinding()]
param(
    [string]$ConfigPath = "$env:ProgramData\ITAMLS\agent.json"
)

$ErrorActionPreference = 'Continue'   # keep looping through transient failures
$script:AgentVersion  = '1.1.0'       # bump when wire protocol changes
$script:ReconnectSecs = 5

# ---------- Config ----------
if (-not (Test-Path $ConfigPath)) {
    Write-Host "[RMM] Config not found at $ConfigPath — is Install-ITAMLSAgent finished?"
    exit 2
}
$config  = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$apiBase = $config.apiBase.TrimEnd('/')
$apiKey  = $config.agentKey
if (-not $apiBase -or -not $apiKey) {
    Write-Host "[RMM] apiBase / agentKey missing from config"
    exit 3
}

# Build the WS URL from the HTTPS api URL (wss://host:port/api/v1/rmm/ws)
$wsBase = ($apiBase -replace '^https://', 'wss://') -replace '^http://', 'ws://'
$wsUrl  = "$wsBase/rmm/ws"

# ---------- Logging to a rolling file so we can debug remotely ----------
$logDir = "$env:ProgramData\ITAMLS\logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir 'rmm-agent.log'
function Log([string]$m) {
    $line = "{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
    $line | Add-Content -Path $logPath -Encoding UTF8
    try {
        # Keep the log file bounded. Trim to the last 2000 lines when it grows past 10k.
        if ((Get-Item $logPath -ErrorAction SilentlyContinue).Length -gt 2MB) {
            $lines = Get-Content $logPath -Tail 2000
            Set-Content -Path $logPath -Value $lines -Encoding UTF8
        }
    } catch {}
}

Add-Type -AssemblyName System.Drawing      -ErrorAction SilentlyContinue
Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue

# P/Invoke wrappers for synthetic mouse + keyboard. We send MOUSEEVENTF /
# KEYEVENTF events straight through user32 — same path real input hardware
# takes, so apps can't tell the difference.
if (-not ("Itamls.NativeInput" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace Itamls {
    public static class NativeInput {
        [DllImport("user32.dll")]  public static extern bool SetCursorPos(int x, int y);
        [DllImport("user32.dll")]  public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, UIntPtr dwExtraInfo);
        [DllImport("user32.dll")]  public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
        [DllImport("user32.dll")]  public static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")]  public static extern bool GetCursorPos(out POINT lpPoint);
        [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
        public const uint MOUSEEVENTF_LEFTDOWN   = 0x0002;
        public const uint MOUSEEVENTF_LEFTUP     = 0x0004;
        public const uint MOUSEEVENTF_RIGHTDOWN  = 0x0008;
        public const uint MOUSEEVENTF_RIGHTUP    = 0x0010;
        public const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
        public const uint MOUSEEVENTF_MIDDLEUP   = 0x0040;
        public const uint MOUSEEVENTF_WHEEL      = 0x0800;
        public const uint KEYEVENTF_KEYUP        = 0x0002;
        public const uint KEYEVENTF_EXTENDEDKEY  = 0x0001;
    }
}
"@ -Language CSharp -ErrorAction SilentlyContinue
}

# Streaming state for the live remote-view mode. When $script:streaming is
# true, the main loop also captures + sends frames in-between message
# polling. One active stream per PC — multiple watchers would need the
# server to multiplex (cheap on the API side, we don't care here).
$script:streaming      = $false
$script:streamQuality  = 55   # JPEG quality 1-100. 55 balances bandwidth + legibility.
$script:streamScale    = 1.0  # 1.0 = native; 0.5 = half-res for low bandwidth
$script:streamSeq      = 0
$script:lastFrameSent  = [datetime]::MinValue
$script:frameIntervalMs = 100  # 10 fps target

# ---------- Helpers ----------
function Get-RmmMetrics {
    $out = @{}
    try {
        # Wall-clock CPU — one quick sample. Get-Counter has no permissions trap.
        $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
        $out.cpuPct = [math]::Round([double]$cpu, 1)
    } catch {}
    try {
        $os = Get-CimInstance Win32_OperatingSystem
        $out.memTotalBytes = [int64]$os.TotalVisibleMemorySize * 1024
        $out.memUsedBytes  = $out.memTotalBytes - ([int64]$os.FreePhysicalMemory * 1024)
    } catch {}
    try {
        # System drive (usually C:) is representative. Keeps payload small.
        $drv = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$($env:SystemDrive)'"
        $out.diskTotalBytes = [int64]$drv.Size
        $out.diskUsedBytes  = [int64]$drv.Size - [int64]$drv.FreeSpace
    } catch {}
    try {
        # Explorer under the logged-in session owner. Works even when the agent
        # runs as SYSTEM.
        $exp = Get-CimInstance Win32_Process -Filter "Name='explorer.exe'" | Select-Object -First 1
        if ($exp) {
            $owner = Invoke-CimMethod -InputObject $exp -MethodName GetOwner
            if ($owner.ReturnValue -eq 0) {
                $out.loggedInUser = "$($owner.Domain)\$($owner.User)"
            }
        }
    } catch {}
    return $out
}

function Capture-FrameJpegB64 {
    # Fast capture path used by the live stream. Captures primary screen,
    # optionally downscales, encodes JPEG at $script:streamQuality, returns
    # the base64 payload + the raw pixel dims the viewer needs for scaling.
    try {
        $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $w = [int]($b.Width  * $script:streamScale)
        $h = [int]($b.Height * $script:streamScale)
        $bmp = New-Object System.Drawing.Bitmap $w, $h
        $g   = [System.Drawing.Graphics]::FromImage($bmp)
        if ($script:streamScale -lt 1.0) {
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear
            $g.CopyFromScreen([System.Drawing.Point]::new(0, 0), [System.Drawing.Point]::new(0, 0), $b.Size)
        } else {
            $g.CopyFromScreen(0, 0, 0, 0, $b.Size)
        }
        $ms = New-Object System.IO.MemoryStream
        # JPEG with explicit quality — Bitmap.Save uses default 75 which is
        # heavier than we need for a remote-view frame.
        $codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
        $params = New-Object System.Drawing.Imaging.EncoderParameters 1
        $params.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), ([int64]$script:streamQuality)
        $bmp.Save($ms, $codec, $params)
        $g.Dispose(); $bmp.Dispose()
        return @{
            b64 = [Convert]::ToBase64String($ms.ToArray())
            w   = $b.Width       # NATIVE size, so the viewer maps clicks correctly
            h   = $b.Height
        }
    } catch {
        return $null
    }
}

function Send-ViewFrame($ws) {
    $now = Get-Date
    if (($now - $script:lastFrameSent).TotalMilliseconds -lt $script:frameIntervalMs) { return }
    $f = Capture-FrameJpegB64
    if (-not $f) { return }
    $script:streamSeq++
    Send-Json -ws $ws -obj @{
        type = 'view_frame'
        seq  = $script:streamSeq
        w    = $f.w; h = $f.h
        jpeg = $f.b64
    }
    $script:lastFrameSent = $now
}

function Handle-RemoteInput($payload) {
    # payload.kind: mouse_move | mouse_down | mouse_up | wheel | key_down | key_up
    # Coordinates come in NATIVE screen pixels (viewer scales mouse events
    # back to screen size before sending).
    try {
        switch ($payload.kind) {
            'mouse_move' { [Itamls.NativeInput]::SetCursorPos([int]$payload.x, [int]$payload.y) | Out-Null }
            'mouse_down' {
                [Itamls.NativeInput]::SetCursorPos([int]$payload.x, [int]$payload.y) | Out-Null
                $flag = switch ($payload.button) {
                    'right'  { [Itamls.NativeInput]::MOUSEEVENTF_RIGHTDOWN }
                    'middle' { [Itamls.NativeInput]::MOUSEEVENTF_MIDDLEDOWN }
                    default  { [Itamls.NativeInput]::MOUSEEVENTF_LEFTDOWN }
                }
                [Itamls.NativeInput]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero)
            }
            'mouse_up' {
                [Itamls.NativeInput]::SetCursorPos([int]$payload.x, [int]$payload.y) | Out-Null
                $flag = switch ($payload.button) {
                    'right'  { [Itamls.NativeInput]::MOUSEEVENTF_RIGHTUP }
                    'middle' { [Itamls.NativeInput]::MOUSEEVENTF_MIDDLEUP }
                    default  { [Itamls.NativeInput]::MOUSEEVENTF_LEFTUP }
                }
                [Itamls.NativeInput]::mouse_event($flag, 0, 0, 0, [UIntPtr]::Zero)
            }
            'wheel' {
                # WHEEL_DELTA is 120. Positive = wheel up / toward user.
                $delta = [int]$payload.delta
                [Itamls.NativeInput]::mouse_event([Itamls.NativeInput]::MOUSEEVENTF_WHEEL, 0, 0, [uint32]$delta, [UIntPtr]::Zero)
            }
            'key_down' {
                [Itamls.NativeInput]::keybd_event([byte]$payload.vk, 0, 0, [UIntPtr]::Zero)
            }
            'key_up' {
                [Itamls.NativeInput]::keybd_event([byte]$payload.vk, 0, [Itamls.NativeInput]::KEYEVENTF_KEYUP, [UIntPtr]::Zero)
            }
            default { }
        }
    } catch {
        Log "input handler error: $($_.Exception.Message)"
    }
}

function Get-DesktopScreenshotBytes {
    try {
        $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
        $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
        $g   = [System.Drawing.Graphics]::FromImage($bmp)
        $g.CopyFromScreen(0, 0, 0, 0, $b.Size)
        $ms = New-Object System.IO.MemoryStream
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Jpeg)
        $g.Dispose(); $bmp.Dispose()
        return $ms.ToArray()
    } catch {
        Log "screenshot failed: $($_.Exception.Message)"
        return $null
    }
}

function Invoke-Shell([string]$script, [string]$interpreter, [int]$timeoutMs) {
    # Run in a temp file so complex scripts with embedded quotes don't need
    # shell-escaping. Stdout/err captured via Start-Process redirection.
    $tmp = [IO.Path]::Combine($env:TEMP, "itamls-rmm-" + [guid]::NewGuid() + ".ps1")
    try {
        $script | Set-Content -Path $tmp -Encoding UTF8
        $outFile = $tmp + '.out'
        $errFile = $tmp + '.err'
        $args = switch ($interpreter) {
            'CMD'        { @('/c', $script) }
            'POWERSHELL' { @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $tmp) }
            default      { @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $tmp) }
        }
        $exe = if ($interpreter -eq 'CMD') { 'cmd.exe' } else { 'powershell.exe' }
        $proc = Start-Process -FilePath $exe -ArgumentList $args -NoNewWindow `
            -PassThru -RedirectStandardOutput $outFile -RedirectStandardError $errFile
        if (-not $proc.WaitForExit([int]$timeoutMs)) {
            try { $proc.Kill() } catch {}
            return @{ exitCode = 124; stdout = (Get-Content $outFile -Raw -ErrorAction SilentlyContinue); stderr = "Timed out after $timeoutMs ms" }
        }
        return @{
            exitCode = $proc.ExitCode
            stdout   = (Get-Content $outFile -Raw -ErrorAction SilentlyContinue) -replace "`r", ""
            stderr   = (Get-Content $errFile -Raw -ErrorAction SilentlyContinue) -replace "`r", ""
        }
    } finally {
        Remove-Item $tmp,"$tmp.out","$tmp.err" -ErrorAction SilentlyContinue
    }
}

function Upload-ScreenshotToApi([byte[]]$bytes) {
    # The API has a presigned-upload endpoint pair. We mirror the signage
    # snapshot flow: ask for a key, HTTP PUT the bytes, tell the API we're done.
    try {
        $headers = @{ 'x-agent-key' = $apiKey }
        $resp = Invoke-RestMethod -Method Post -Uri "$apiBase/agents/pcs/$($config.pcId)/screenshot-upload-url" `
            -Headers $headers -TimeoutSec 20
        if (-not $resp.uploadUrl -or -not $resp.storageKey) { return $null }
        Invoke-WebRequest -Method Put -Uri $resp.uploadUrl -Body $bytes `
            -ContentType 'image/jpeg' -TimeoutSec 60 | Out-Null
        Invoke-RestMethod -Method Post -Uri "$apiBase/agents/pcs/$($config.pcId)/screenshot-complete" `
            -Headers $headers -ContentType 'application/json' `
            -Body (@{ storageKey = $resp.storageKey } | ConvertTo-Json) -TimeoutSec 20 | Out-Null
        return $resp.storageKey
    } catch {
        Log "screenshot upload failed: $($_.Exception.Message)"
        return $null
    }
}

# ---------- WebSocket helpers ----------
function New-Ws() {
    $ws = [System.Net.WebSockets.ClientWebSocket]::new()
    $ws.Options.SetRequestHeader('Authorization', "Bearer $apiKey")
    $ws.Options.KeepAliveInterval = [TimeSpan]::FromSeconds(30)
    return $ws
}

function Send-Json($ws, $obj) {
    $json  = $obj | ConvertTo-Json -Compress -Depth 10
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $seg   = [System.ArraySegment[byte]]::new($bytes)
    $null  = $ws.SendAsync($seg, [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [System.Threading.CancellationToken]::None).Wait()
}

function Receive-Json($ws, $timeoutMs) {
    # ClientWebSocket.ReceiveAsync completes after at least ONE chunk. For our
    # protocol every frame is small (<64k) so a single read is almost always
    # sufficient; we concatenate anyway in case a large screenshot ack arrives.
    $buf = New-Object byte[] 65536
    $seg = [System.ArraySegment[byte]]::new($buf)
    $sb  = New-Object System.Text.StringBuilder
    $cts = New-Object System.Threading.CancellationTokenSource
    $cts.CancelAfter($timeoutMs)
    try {
        do {
            $task = $ws.ReceiveAsync($seg, $cts.Token)
            $task.Wait()
            if ($task.Result.MessageType -eq 'Close') { return $null }
            $null = $sb.Append([System.Text.Encoding]::UTF8.GetString($buf, 0, $task.Result.Count))
        } until ($task.Result.EndOfMessage)
    } catch [System.OperationCanceledException] {
        return @{ _timeout = $true }
    } catch {
        return $null
    }
    try { return $sb.ToString() | ConvertFrom-Json } catch { return $null }
}

# ---------- Main loop ----------
function Handle-Command($ws, $cmd) {
    $id      = $cmd.id
    $kind    = $cmd.kind
    $payload = $cmd.payload
    Log "cmd $kind id=$id"
    $result  = @{ type = 'cmd_result'; id = $id; status = 'DONE'; exitCode = 0; stdout = ''; stderr = '' }
    try {
        switch ($kind) {
            { $_ -in 'SHELL', 'SCRIPT' } {
                $interp  = if ($payload.interpreter) { $payload.interpreter } else { 'POWERSHELL' }
                $timeout = if ($payload.timeoutMs)   { [int]$payload.timeoutMs } else { 60000 }
                $r = Invoke-Shell -script $payload.script -interpreter $interp -timeoutMs $timeout
                $result.exitCode = $r.exitCode
                $result.stdout   = ($r.stdout ?? '').ToString()
                $result.stderr   = ($r.stderr ?? '').ToString()
                if ($r.exitCode -ne 0) { $result.status = 'FAILED' }
            }
            'RESTART' {
                $delay = if ($payload.delaySeconds) { [int]$payload.delaySeconds } else { 10 }
                $result.stdout = "Restart scheduled in $delay seconds"
                Start-Process -FilePath 'shutdown.exe' -ArgumentList @('/r','/f','/t',"$delay",'/d','p:4:1','/c','ITAMLS RMM-initiated restart') -WindowStyle Hidden
            }
            'SCREENSHOT' {
                $bytes = Get-DesktopScreenshotBytes
                if (-not $bytes) { $result.status = 'FAILED'; $result.stderr = 'capture failed'; break }
                $key = Upload-ScreenshotToApi -bytes $bytes
                if ($key) { $result.stdout = "screenshotKey=$key" } else { $result.status = 'FAILED'; $result.stderr = 'upload failed' }
            }
            'FILE_PULL' {
                $p = $payload.path
                if (-not (Test-Path $p)) { $result.status = 'FAILED'; $result.stderr = 'not found'; break }
                $b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($p))
                # Limit payload to keep message size reasonable (~1MB raw → 1.3MB b64).
                if ($b64.Length -gt 5_000_000) { $result.status = 'FAILED'; $result.stderr = 'file too large (>3.5MB)'; break }
                $result.stdout = $b64
            }
            'FILE_PUSH' {
                if (-not $payload.base64 -or -not $payload.path) { $result.status = 'FAILED'; $result.stderr = 'path/base64 required'; break }
                New-Item -ItemType Directory -Force -Path (Split-Path $payload.path -Parent) | Out-Null
                [IO.File]::WriteAllBytes($payload.path, [Convert]::FromBase64String($payload.base64))
                $result.stdout = "wrote $($payload.path)"
            }
            'VIEW_START' {
                # Live remote-view session begins. Tune quality / fps / scale
                # per the request so low-bandwidth stores can still be
                # supported at 5fps + 0.5 scale.
                if ($payload.quality)      { $script:streamQuality   = [int]$payload.quality }
                if ($payload.scale)        { $script:streamScale     = [double]$payload.scale }
                if ($payload.fps)          { $script:frameIntervalMs = [int](1000 / [double]$payload.fps) }
                $script:streaming = $true
                $script:streamSeq = 0
                $result.stdout = "view started quality=$($script:streamQuality) scale=$($script:streamScale) fps=$([int](1000/$script:frameIntervalMs))"
            }
            'VIEW_STOP' {
                $script:streaming = $false
                $result.stdout = "view stopped"
            }
            default { $result.status = 'FAILED'; $result.stderr = "unknown kind $kind" }
        }
    } catch {
        $result.status = 'FAILED'
        $result.stderr = $_.Exception.Message
    }
    # Trim output so we never exceed the server's 100k column cap.
    foreach ($field in 'stdout','stderr') {
        if ($result[$field] -and $result[$field].Length -gt 90000) {
            $result[$field] = $result[$field].Substring(0, 90000) + "`n...(truncated)"
        }
    }
    Send-Json -ws $ws -obj $result
}

function Run-Session {
    $ws = New-Ws
    try {
        Log "connecting $wsUrl"
        $ws.ConnectAsync([Uri]$wsUrl, [System.Threading.CancellationToken]::None).Wait()
        Log "connected"
    } catch {
        Log "connect failed: $($_.Exception.Message)"
        return
    }

    # hello
    $hello = @{
        type         = 'hello'
        agentVersion = $script:AgentVersion
        osName       = (Get-CimInstance Win32_OperatingSystem).Caption
        osVersion    = [System.Environment]::OSVersion.Version.ToString()
        localIp      = ((Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                         Where-Object { $_.PrefixOrigin -ne 'WellKnown' -and $_.IPAddress -notmatch '^169\.254' } |
                         Select-Object -First 1).IPAddress)
    }
    Send-Json -ws $ws -obj $hello

    $nextMetrics = (Get-Date).AddSeconds(30)
    while ($ws.State -eq 'Open') {
        # Push metrics on the 30s tick.
        if ((Get-Date) -ge $nextMetrics) {
            $m = Get-RmmMetrics
            $m['type'] = 'metrics'
            Send-Json -ws $ws -obj $m
            $nextMetrics = (Get-Date).AddSeconds(30)
        }
        # While streaming, we need a MUCH tighter loop so frames + input
        # events feel interactive. 50ms poll window gives us up to 20 input
        # events/second and the Send-ViewFrame throttle enforces the fps cap.
        $pollMs = if ($script:streaming) { 50 } else { 3000 }
        $msg = Receive-Json -ws $ws -timeoutMs $pollMs
        if ($msg -and $msg._timeout) {
            # No inbound this tick. If we're streaming, grab + send a frame
            # (Send-ViewFrame enforces its own frame-interval cap). Then
            # loop back to polling.
            if ($script:streaming) { Send-ViewFrame -ws $ws }
            continue
        }
        if (-not $msg) { break }
        switch ($msg.type) {
            'cmd'           { Handle-Command -ws $ws -cmd $msg }
            'remote_input'  { Handle-RemoteInput -payload $msg.payload }
            'pong'          { }
            'ping'          { Send-Json -ws $ws -obj @{ type = 'pong' } }
            default         { Log "unknown inbound type: $($msg.type)" }
        }
        if ($script:streaming) { Send-ViewFrame -ws $ws }
    }

    try { $ws.Dispose() } catch {}
    Log "session ended; will reconnect in $script:ReconnectSecs s"
}

# ---------- Forever loop ----------
Log "RMM agent $script:AgentVersion starting for pc $($config.pcId) → $wsUrl"
while ($true) {
    Run-Session
    Start-Sleep -Seconds $script:ReconnectSecs
}
