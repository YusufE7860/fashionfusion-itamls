using System.Runtime.InteropServices;

namespace ItamlsRmm.Service.Wts;

/// <summary>
/// Minimal P/Invoke surface for Windows Terminal Services session enumeration
/// and spawning a process into a specific user session with that user's
/// primary token. This is the crux of "runs as SYSTEM but can see / interact
/// with the logged-in user's desktop".
///
/// References:
///   WTSEnumerateSessionsEx, WTSQueryUserToken  — wtsapi32.dll
///   DuplicateTokenEx, CreateProcessAsUser      — advapi32.dll
///   CreateEnvironmentBlock                      — userenv.dll
/// </summary>
internal static class WtsApi
{
    public const int WTS_CURRENT_SERVER_HANDLE = 0;

    public enum WTS_CONNECTSTATE_CLASS
    {
        Active, Connected, ConnectQuery, Shadow, Disconnected,
        Idle, Listen, Reset, Down, Init,
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct WTS_SESSION_INFO
    {
        public uint SessionId;
        [MarshalAs(UnmanagedType.LPStr)] public string pWinStationName;
        public WTS_CONNECTSTATE_CLASS State;
    }

    [DllImport("wtsapi32.dll", SetLastError = true)]
    public static extern int WTSEnumerateSessions(
        IntPtr hServer, int Reserved, int Version,
        ref IntPtr ppSessionInfo, ref int pCount);

    [DllImport("wtsapi32.dll")]
    public static extern void WTSFreeMemory(IntPtr pMemory);

    [DllImport("wtsapi32.dll", SetLastError = true)]
    public static extern bool WTSQueryUserToken(uint sessionId, out IntPtr Token);

    [Flags]
    public enum TokenAccess : uint
    {
        TOKEN_ASSIGN_PRIMARY = 0x0001, TOKEN_DUPLICATE = 0x0002,
        TOKEN_IMPERSONATE = 0x0004, TOKEN_QUERY = 0x0008,
        TOKEN_QUERY_SOURCE = 0x0010, TOKEN_ADJUST_PRIVILEGES = 0x0020,
        TOKEN_ADJUST_GROUPS = 0x0040, TOKEN_ADJUST_DEFAULT = 0x0080,
        TOKEN_ADJUST_SESSIONID = 0x0100,
        TOKEN_ALL_ACCESS = 0x000F01FF,
    }

    public enum SECURITY_IMPERSONATION_LEVEL { SecurityAnonymous, SecurityIdentification, SecurityImpersonation, SecurityDelegation }
    public enum TOKEN_TYPE { TokenPrimary = 1, TokenImpersonation }

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool DuplicateTokenEx(
        IntPtr hExistingToken, uint dwDesiredAccess, IntPtr lpTokenAttributes,
        SECURITY_IMPERSONATION_LEVEL ImpersonationLevel, TOKEN_TYPE TokenType,
        out IntPtr phNewToken);

    [StructLayout(LayoutKind.Sequential)]
    public struct STARTUPINFO
    {
        public int    cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint   dwX, dwY, dwXSize, dwYSize;
        public uint   dwXCountChars, dwYCountChars, dwFillAttribute;
        public uint   dwFlags;
        public short  wShowWindow;
        public short  cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PROCESS_INFORMATION
    {
        public IntPtr hProcess, hThread;
        public uint dwProcessId, dwThreadId;
    }

    public const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
    public const uint CREATE_NEW_CONSOLE         = 0x00000010;
    public const uint CREATE_NO_WINDOW           = 0x08000000;

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool CreateProcessAsUser(
        IntPtr hToken, string? lpApplicationName, string lpCommandLine,
        IntPtr lpProcessAttributes, IntPtr lpThreadAttributes,
        bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment,
        string? lpCurrentDirectory, ref STARTUPINFO lpStartupInfo,
        out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("userenv.dll", SetLastError = true)]
    public static extern bool CreateEnvironmentBlock(out IntPtr lpEnvironment, IntPtr hToken, bool bInherit);

    [DllImport("userenv.dll", SetLastError = true)]
    public static extern bool DestroyEnvironmentBlock(IntPtr lpEnvironment);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool CloseHandle(IntPtr hObject);
}
