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

    private void Reconcile()
    {
        var active = EnumActiveSessions().ToHashSet();

        // Kill helpers whose sessions are gone (logoff, disconnect).
        foreach (var kv in _helpers.ToArray()) {
            if (!active.Contains(kv.Key) || kv.Value.HasExited) {
                try { if (!kv.Value.HasExited) kv.Value.Kill(true); } catch { }
                _helpers.TryRemove(kv.Key, out _);
                if (_secure.TryRemove(kv.Key, out var sd)) { try { sd.Dispose(); } catch { } }
                _log.LogInformation("Helper(s) for session {sid} removed", kv.Key);
            }
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

            // Helper exe is laid down next to the service exe during install.
            var serviceDir = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule!.FileName)!;
            var helperExe  = Path.Combine(serviceDir, "itamls-rmm-helper.exe");
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
