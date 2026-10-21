# ITAMLS RMM Agent

Windows service that keeps a persistent WebSocket to ITAMLS so technicians can
remote in: run PowerShell / cmd, see live metrics, (later) take screenshots and
remote-desktop in. Compiles to a single self-contained `.exe` (no .NET runtime
required on the target PC).

## Build

Requires the .NET 8 SDK on a build box (Windows or Linux fine).

```bash
cd apps/rmm-agent
dotnet publish -c Release
# Output: bin/Release/net8.0/win-x64/publish/itamls-rmm-agent.exe
```

Copy the resulting `itamls-rmm-agent.exe` to:
- `apps/api/public/rmm-agent/itamls-rmm-agent.exe` so the API serves it, OR
- host it on a share.

## Install on a target PC

**Option A — one-shot via the existing enrolment `.cmd`** (recommended):

Drop the exe + a token through the existing agent installer flow. The `.cmd`
calls:

```cmd
itamls-rmm-agent.exe install <AGENT_TOKEN>
```

**Option B — manual**:

```powershell
# PowerShell as Administrator
Set-Location "C:\ProgramData\ITAMLS\rmm-agent"
.\itamls-rmm-agent.exe install <AGENT_TOKEN>
```

The installer:
1. Writes `%ProgramData%\ITAMLS\rmm-agent\config.json` with the token.
2. Registers the Windows service `ITAMLSRmmAgent`.
3. Starts the service.
4. Configures auto-restart on failure.

To uninstall:

```powershell
.\itamls-rmm-agent.exe uninstall
```

## Config

`%ProgramData%\ITAMLS\rmm-agent\config.json`:

```json
{
  "serverUrl":  "wss://it.ffgsa.co.za:41235/api/v1/rmm/ws",
  "agentToken": "<per-PC token>",
  "metricsIntervalSeconds":   10,
  "heartbeatIntervalSeconds": 30,
  "reconnectBaseMs":  1000,
  "reconnectMaxMs":  60000
}
```

Env vars override the file:
- `ITAMLS_RMM_URL`
- `ITAMLS_RMM_TOKEN`

## Logs

Windows Event Log → **Applications and Services Logs → ITAMLSRmmAgent**. Use
Event Viewer or:

```powershell
Get-WinEvent -ProviderName ITAMLSRmmAgent -MaxEvents 50
```

## Protocol

Implements the ITAMLS RMM Agent Protocol v1 (see `docs/RMM-AGENT-PROTOCOL.md`).
Supports today:

- `hello` on connect
- `metrics` every 10s (CPU / mem / disk / net / logged-in user)
- `ping` / `pong`
- `cmd` of kind `SHELL`, `SCRIPT`, `RESTART`
- `cmd_output` streaming + `cmd_result` on completion

Coming next: `FILE_PUSH`, `FILE_PULL`, `SESSION_START` (remote desktop).
