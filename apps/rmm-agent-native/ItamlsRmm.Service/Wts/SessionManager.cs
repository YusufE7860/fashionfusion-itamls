using System.Collections.Concurrent;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;
using static ItamlsRmm.Service.Wts.WtsApi;

namespace ItamlsRmm.Service.Wts;

/// <summary>
/// Watches logon sessions and keeps exactly one helper process running in
/// each active one. Spawns via WTSQueryUserToken + CreateProcessAsUser so
/// the helper inherits the user's desktop handle, environment and
/// integrity level — this is what lets it capture the screen and inject
/// mouse/keyboard events into what the user sees.
///
/// Secure Desktop (UAC) is not covered here. When Winlogon switches to the
/// secure desktop the helper's input calls bounce, and screen capture goes
/// black for the prompt duration. Capturing that too requires a signed
/// credential provider or a mini-port driver — tracked as a Phase 2 item.
/// </summary>
public sealed class SessionManager
{
    private readonly ILogger _log;
    private readonly ConcurrentDictionary<uint, Process> _helpers = new();
    private readonly ConcurrentDictionary<uint, SecureDesktopHelper> _secure = new();
    private CancellationTokenSource? _cts;

    public SessionManager(ILogger log) { _log = log; }

    public void Start(CancellationToken stop)
    {
        _log.LogInformation("SessionManager starting");
        _cts = CancellationTokenSource.CreateLinkedTokenSource(stop);
        _ = Task.Run(() => LoopAsync(_cts.Token));
    }

    public void StopAll()
    {
        _cts?.Cancel();
        foreach (var kv in _helpers) {
            try { if (!kv.Value.HasExited) kv.Value.Kill(entireProcessTree: true); } catch { }
        }
        _helpers.Clear();
        foreach (var kv in _secure) { try { kv.Value.Dispose(); } catch { } }
        _secure.Clear();
    }

    /// <summary>Returns the list of session ids with a healthy helper.</summary>
    public IEnumerable<uint> ActiveSessions() => _helpers.Where(kv => !kv.Value.HasExited).Select(kv => kv.Key);

    private async Task LoopAsync(CancellationToken ct)
    {
        while (!ct.IsCancellationRequested) {
            try { Reconcile(); }
            catch (Exception e) { _log.LogWarning(e, "session reconcile failed"); }
            try { await Task.Delay(TimeSpan.FromSeconds(5), ct); } catch { }
        }
    }

    private DateTime _lastHeartbeat = DateTime.MinValue;
    private void Reconcile()
    {
        var active = EnumActiveSessions().ToHashSet();
        // Heartbeat every 60s so we know the loop is alive + see session count.
        if ((DateTime.UtcNow - _lastHeartbeat).TotalSeconds > 60) {
            _log.LogInformation("Reconcile: active sessions = [{sessions}], helpers = [{helpers}]",
                string.Join(",", active), string.Join(",", _helpers.Keys));
            _lastHeartbeat = DateTime.UtcNow;
        }

        // Only reap helpers whose PROCESS has actually exited. We used to also
        // reap when !active.Contains(sid), but WTSEnumerateSessions flaps:
        // a logged-in user's session can be absent from the enum for one
        // reconcile cycle and back the next. Killing on every dip cycles the
        // helper every 5s and prevents the pipe from ever stabilizing. The
        // helper itself exits cleanly when its user logs off (WTS notifies
        // via Winlogon close + pipe EOF), so HasExited is the right signal.
        foreach (var kv in _helpers.ToArray()) {
            if (!kv.Value.HasExited) continue;
            int exitCode = 0; string exitReason;
            try {
                exitCode = kv.Value.ExitCode;
                exitReason = exitCode switch {
                    0          => "clean exit",
                    2          => "missing --pipe arg",
                    3          => "unhandled exception (see helper log)",
                    -532462766 => "unhandled managed exception (0xE0434352)",
                    -1073741819 => "access violation (0xC0000005)",
                    -1073741511 => "entry point not found (0xC0000139)",
                    -1073741502 => "DLL init failed (0xC0000142)",
                    -1073740771 => "fatal single-file extract error (0xC0000409)",
                    _          => $"exit code 0x{exitCode:X8} ({exitCode})",
                };
            } catch { exitReason = "exited (could not read code)"; }
            _helpers.TryRemove(kv.Key, out _);
            if (_secure.TryRemove(kv.Key, out var sd)) { try { sd.Dispose(); } catch { } }
            _log.LogWarning("Helper for session {sid} exited: {reason}", kv.Key, exitReason);
        }

        // Spawn helpers in newly-active sessions.
        foreach (var sid in active) {
            if (_helpers.ContainsKey(sid)) continue;
            if (TrySpawn(sid, out var p)) {
                _helpers[sid] = p!;
                _log.LogInformation("Default-desktop helper spawned in session {sid} pid={pid}", sid, p!.Id);
                // Pair it with a Winlogon-desktop helper so UAC prompts
                // don't blank the viewer. Secure helper spawning requires
                // SeTcbPrivilege (LocalSystem has it); if the OS refuses
                // we log and continue — the Default helper still works,
                // UAC capture just degrades to the "frozen frame" behaviour.
                var secure = new SecureDesktopHelper(_log);
                if (secure.Start(sid)) _secure[sid] = secure;
                else _log.LogWarning("Secure-desktop helper refused for session {sid} — UAC capture disabled", sid);
            }
        }
    }

    private static IEnumerable<uint> EnumActiveSessions()
    {
        IntPtr info = IntPtr.Zero; int count = 0;
        if (WTSEnumerateSessions((IntPtr)WTS_CURRENT_SERVER_HANDLE, 0, 1, ref info, ref count) == 0) yield break;
        try {
            int size = Marshal.SizeOf<WTS_SESSION_INFO>();
            for (int i = 0; i < count; i++) {
                var cur = Marshal.PtrToStructure<WTS_SESSION_INFO>(IntPtr.Add(info, i * size));
                // Active = someone is logged in and at the console. Disconnected
                // sessions (RDP user hit X) also have a user — spawning in those
                // means scripts still run; input/screen capture degrade gracefully.
                if (cur.State == WTS_CONNECTSTATE_CLASS.Active ||
                    cur.State == WTS_CONNECTSTATE_CLASS.Disconnected) {
                    if (cur.SessionId != 0) yield return cur.SessionId;   // skip session 0 (SYSTEM)
                }
            }
        } finally { WTSFreeMemory(info); }
    }

    private bool TrySpawn(uint sessionId, out Process? proc)
    {
        proc = null;
        if (!WTSQueryUserToken(sessionId, out var userToken)) return false;

        IntPtr primary = IntPtr.Zero;
        IntPtr envBlock = IntPtr.Zero;
        try {
            if (!DuplicateTokenEx(userToken,
                    (uint)TokenAccess.TOKEN_ALL_ACCESS, IntPtr.Zero,
                    SECURITY_IMPERSONATION_LEVEL.SecurityImpersonation,
                    TOKEN_TYPE.TokenPrimary, out primary)) return false;

            if (!CreateEnvironmentBlock(out envBlock, primary, false)) envBlock = IntPtr.Zero;

            var si = new STARTUPINFO { cb = Marshal.SizeOf<STARTUPINFO>(), lpDesktop = @"winsta0\default" };
            var pi = default(PROCESS_INFORMATION);

            // Helper lives in a sibling 'helper' folder (folder of DLLs, not
            // single-file) alongside the service exe - see installer.
            var serviceDir = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule!.FileName)!;
            var helperExe  = Path.Combine(serviceDir, "helper", "itamls-rmm-helper.exe");
            if (!File.Exists(helperExe)) {
                _log.LogError("Helper exe missing at {path}", helperExe);
                return false;
            }
            var cmdLine = $"\"{helperExe}\" --pipe \\\\.\\pipe\\itamls-rmm-{sessionId}";

            if (!CreateProcessAsUser(
                    primary, null, cmdLine,
                    IntPtr.Zero, IntPtr.Zero, false,
                    CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
                    envBlock, null, ref si, out pi)) {
                _log.LogWarning("CreateProcessAsUser failed: {err}", Marshal.GetLastWin32Error());
                return false;
            }
            CloseHandle(pi.hThread);
            proc = Process.GetProcessById((int)pi.dwProcessId);
            return true;
        } finally {
            if (envBlock  != IntPtr.Zero) DestroyEnvironmentBlock(envBlock);
            if (primary   != IntPtr.Zero) CloseHandle(primary);
            if (userToken != IntPtr.Zero) CloseHandle(userToken);
        }
    }
}
