using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;
using static ItamlsRmm.Service.Wts.WtsApi;

namespace ItamlsRmm.Service.Wts;

/// <summary>
/// Spawns a second helper instance targeted at the UAC / Secure Desktop
/// (<c>winsta0\Winlogon</c>). While the user is NOT in a UAC prompt, this
/// helper idles and reports nothing. The service kicks it off alongside
/// the normal user-session helper so, when Winlogon switches focus to the
/// secure desktop, the admin's viewer keeps getting frames instead of
/// freezing.
///
/// Requirements:
///   - Service runs as LocalSystem (has SeTcbPrivilege).
///   - CreateProcessAsUser with STARTUPINFO.lpDesktop = "winsta0\\Winlogon".
///   - Helper must detect it's on the secure desktop (OpenInputDesktop +
///     GetThreadDesktop compare) so it only streams while UAC is actually up.
///
/// Known limitation: captured frames show the UAC dialog, but injecting
/// input onto the secure desktop (clicking "Yes") requires an interactive
/// sign-in via Winlogon's credential provider — Windows prevents arbitrary
/// synthetic input there as a security guarantee. The admin still has to
/// click the real "Yes" button via their own input coming from the viewer
/// (which is passed through just like normal, but may be rejected by the
/// secure desktop's hook).
/// </summary>
public sealed class SecureDesktopHelper : IDisposable
{
    private readonly ILogger _log;
    private Process? _proc;

    public SecureDesktopHelper(ILogger log) { _log = log; }

    /// <summary>Launch a Winlogon-desktop helper for the given session.</summary>
    public bool Start(uint sessionId)
    {
        if (!WTSQueryUserToken(sessionId, out var userToken)) return false;

        IntPtr primary = IntPtr.Zero;
        IntPtr envBlock = IntPtr.Zero;
        try {
            if (!DuplicateTokenEx(userToken,
                    (uint)TokenAccess.TOKEN_ALL_ACCESS, IntPtr.Zero,
                    SECURITY_IMPERSONATION_LEVEL.SecurityImpersonation,
                    TOKEN_TYPE.TokenPrimary, out primary)) return false;

            if (!CreateEnvironmentBlock(out envBlock, primary, false)) envBlock = IntPtr.Zero;

            var si = new STARTUPINFO {
                cb = Marshal.SizeOf<STARTUPINFO>(),
                // KEY DIFFERENCE from normal helper: Winlogon desktop, not Default.
                lpDesktop = @"winsta0\Winlogon",
            };
            var pi = default(PROCESS_INFORMATION);

            var dir = Path.GetDirectoryName(Process.GetCurrentProcess().MainModule!.FileName)!;
            var helper = Path.Combine(dir, "itamls-rmm-helper.exe");
            var cmd    = $"\"{helper}\" --pipe \\\\.\\pipe\\itamls-rmm-secure-{sessionId} --secure-desktop";

            if (!CreateProcessAsUser(
                    primary, null, cmd,
                    IntPtr.Zero, IntPtr.Zero, false,
                    CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW,
                    envBlock, null, ref si, out pi)) {
                _log.LogWarning("Winlogon helper spawn failed err={err}", Marshal.GetLastWin32Error());
                return false;
            }
            CloseHandle(pi.hThread);
            _proc = Process.GetProcessById((int)pi.dwProcessId);
            _log.LogInformation("Winlogon-desktop helper spawned pid={pid}", _proc.Id);
            return true;
        } finally {
            if (envBlock  != IntPtr.Zero) DestroyEnvironmentBlock(envBlock);
            if (primary   != IntPtr.Zero) CloseHandle(primary);
            if (userToken != IntPtr.Zero) CloseHandle(userToken);
        }
    }

    public void Stop()
    {
        try { if (_proc is not null && !_proc.HasExited) _proc.Kill(entireProcessTree: true); }
        catch { }
        _proc = null;
    }

    public void Dispose() => Stop();
}
