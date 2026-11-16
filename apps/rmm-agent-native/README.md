# ITAMLS native RMM agent

A .NET 8 Windows service + per-session helper. Proper VSA-grade remote
access — live screen, mouse + keyboard, clipboard sync, audio, multi-monitor,
UAC capture, commands, file transfer.

## Architecture

```
┌──────────────────────────────────┐   ┌──────────────────────────────────┐
│ ItamlsRmm.Service                │   │ ItamlsRmm.Helper (per session)   │
│  • Windows service (LocalSystem) │◄──┤  • Default-desktop helper:       │
│  • One WebSocket to ITAMLS API   │   │       screen / input / clipboard │
│  • Named-pipe hub                │   │  • Winlogon-desktop helper:      │
│  • SessionManager — spawns a     │   │       UAC + secure-desktop       │
│    Default + Winlogon helper per │   │                                  │
│    active logon session          │   │  Backends:                       │
│  • Metrics loop (30 s)           │   │   DXGI Desktop Duplication (fast)│
│                                  │   │   GDI fallback (RDP / no-GPU)    │
└──────────────────────────────────┘   └──────────────────────────────────┘
          ▲                                             ▲
          │ wss://.../rmm/ws  (Bearer agent key)        │
          ▼                                             │
┌──────────────────────────────────┐                    │
│ ITAMLS API gateway                │                    │
│  • Fan-out to browser viewers    │────────────────────┘ named pipes:
└──────────────────────────────────┘    \\.\pipe\itamls-rmm-<sid>
                                        \\.\pipe\itamls-rmm-secure-<sid>
```

## What Phase 1 shipped

- Service / Helper split that defeats session-0 isolation.
- WTS session enumeration + `CreateProcessAsUser` into the user's token.
- Named-pipe transport between service and helper.
- WebSocket client to the ITAMLS API.
- GDI screen capture, `SendInput` mouse + keyboard, WinForms clipboard,
  shell execution, metrics.

## What Phase 2 adds

### DXGI Desktop Duplication
- Hardware-accelerated capture via Vortice.DXGI + Direct3D11.
- 30–60 fps on real hardware, zero CPU cost on the compositor side.
- One `IDXGIOutputDuplication` + staging texture per monitor, held for
  the helper's lifetime.
- Access-lost / mode-change invalidation handled — the duplication
  reconstructs on the next call.
- GDI backend remains as fallback: RDP sessions, Hyper-V consoles, or any
  box where DXGI construction fails drops to GDI without the viewer
  noticing (frame rate just drops to ~15 fps).

### Multi-monitor
- `IScreenCapture.Monitors` returns every output the chosen adapter
  enumerates — index, name, width/height, desktop coord origin, primary
  flag.
- Helper announces its monitor list on the `helper_hello` message so the
  browser viewer can show a monitor picker.
- `VIEW_START` and `VIEW_MONITOR` accept `{ monitor: N }` to switch live.

### Secure Desktop (UAC) capture
- Each active logon session gets a *second* helper instance spawned onto
  `winsta0\Winlogon` via `CreateProcessAsUser` with
  `STARTUPINFO.lpDesktop = "winsta0\\Winlogon"`.
- The Winlogon helper idles until `SecureDesktopDetector.IsOnSecureDesktop()`
  returns true (i.e. the user is at a UAC prompt / Ctrl+Alt+Del / logon
  screen) — then it begins streaming frames tagged `secure: true`.
- When UAC dismisses, it idles again and the Default-desktop helper
  resumes.
- SeTcbPrivilege (which LocalSystem has) is required for this spawn;
  without it the service logs and falls back to Phase 1 behaviour (viewer
  freezes during UAC).
- **Known limit, same as every commercial tool**: Windows explicitly
  rejects synthetic input sent to the secure desktop from unprivileged
  callers. The admin *sees* the UAC prompt but has to ask the user to
  click Yes (or deploy a signed credential provider — a separate, deeper
  Windows integration).

### Audio (speakers)
- WASAPI loopback via NAudio captures whatever the default render device
  is outputting.
- Resampled on the fly to 24 kHz mono 16-bit PCM (~48 KB/s on the wire).
- Browser decodes with Web Audio API — no codec negotiation.
- `AUDIO_START` / `AUDIO_STOP` commands from the viewer control it; the
  helper streams `audio_chunk` messages roughly every 100 ms.

### Clipboard sync
- Already present in Phase 1 but worth calling out: both directions work.
  Agent watches the user's clipboard (STA thread) and emits
  `clipboard_change`; viewer sends `CLIPBOARD_SET` and the helper's
  `Clipboard.SetText` lands the payload in the user's clipboard.

## Build

```powershell
cd apps\rmm-agent-native
dotnet publish ItamlsRmm.Service -c Release -o dist
dotnet publish ItamlsRmm.Helper  -c Release -o dist
```

Both exes are self-contained (no .NET runtime on target), single-file.
NuGet packages: Vortice.DXGI, Vortice.Direct3D11, NAudio, generic host
+ Windows services.

## Install

```powershell
# Prereq: Install-ITAMLSAgent must have run first so agent.json exists.
. .\install\Install-ItamlsRmmNative.ps1
Install-ItamlsRmmNative -Source C:\path\to\dist
```

Service name: `ItamlsRmm`. Logs: Event Viewer → Applications → source `ItamlsRmm`.

## What's still outside scope

- **Signed credential provider** to send synthetic input to the secure
  desktop. Requires EV code-signing + Windows Security review. Multi-week
  engineering.
- **Opus / AV1 audio + video codecs** instead of raw PCM + JPEG. Current
  wire is ~500 KB/s at 10 fps 1080p. Opus gets audio to <20 KB/s; AV1
  would cut video to a quarter of its bandwidth. Add when bandwidth bites.
- **Session 0 service UI**. When Winlogon is the active desktop, viewing
  works but SendInput is blocked (Windows security). Admin needs a
  signed service to cross that boundary.
- **Code-signed MSI**. Current installer is a PowerShell script; good
  enough for internal rollout, needed if we ever hand this to a 3rd
  party.
